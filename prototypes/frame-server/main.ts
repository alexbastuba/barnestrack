/**
 * Frame-server evidence page (chunk 1, dev-only; excluded from the build).
 * Runs the acceptance checks of prototypes/frame-server/RESULTS.md against a
 * dropped video and prints tables, verdict lines and a JSON blob.
 */
import { byteSourceFromBlob } from '../../src/video/byte-source.js';
import { fingerprintVideo } from '../../src/video/fingerprint.js';
import { fnv1a32, hashHex } from '../../src/video/frame-hash.js';
import { FrameSource } from '../../src/video/frame-source.js';
import { parseMp4Index, type Mp4Index } from '../../src/video/mp4-index.js';
import type { WorkerRequest, WorkerResponse } from '../../src/video/worker-protocol.js';

const SEQUENTIAL_FPS_TARGET = 300;
const PEAK_MEMORY_LIMIT_BYTES = 300 * 1024 * 1024;
const RANDOM_ACCESS_SAMPLES = 30;
const UNIFORM_SAMPLES = 20;
const MIN_DUPLICATE_MEMBERS = 5;
const T_S_TOLERANCE_S = 1e-6;

interface RandomAccessRow {
  presIndex: number;
  why: string;
  t_s: number;
  sequentialHash: string;
  randomHash: string;
  match: boolean;
  seekMs: number;
  fromCache: boolean;
}

interface Verdict {
  id: string;
  status: 'PASS' | 'FAIL' | 'NOT TESTED';
  text: string;
}

interface Results {
  file: { name: string; byteLength: number; sha256: string; fingerprintMs: number };
  options: { tieBreak: string; optimizeForLatency: boolean; hardwareAcceleration: string };
  browser: string;
  index: {
    frameCount: number;
    timescale: number;
    nominalFps: number;
    editOffsetTicks: number;
    durationSeconds: number;
    keyframes: number;
    tieBreak: string;
    warnings: string[];
    anomalies: Mp4Index['timebaseAnomalies'];
    parseMs: number;
  };
  sequential: {
    status: string;
    outputCount: number;
    monotone: boolean;
    elapsedMs: number;
    fps: number;
    peakMainHeapBytes: number | null;
    peakWorkerHeapBytes: number | null;
    error?: string;
  };
  timestamps: { status: string; maxErrorUs?: number; fixtureFrames?: number };
  randomAccess: {
    rows: RandomAccessRow[];
    matches: number;
    duplicateMembersChecked: number;
    medianSeekMs: number;
    medianColdSeekMs: number;
  };
  verdicts: Verdict[];
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const status = $<HTMLParagraphElement>('status');
const progress = $<HTMLProgressElement>('progress');
const verdictList = $<HTMLUListElement>('verdicts');
const jsonBox = $<HTMLTextAreaElement>('json');
const canvas = $<HTMLCanvasElement>('frameCanvas');
const frameInfo = $<HTMLParagraphElement>('frameInfo');
const frameIndexInput = $<HTMLInputElement>('frameIndex');

let frameSource: FrameSource | null = null;
let currentIndex: Mp4Index | null = null;
let currentHashes: Uint32Array | null = null;

function setStatus(text: string): void {
  status.textContent = text;
}

function table(headers: string[], rows: (string | number)[][]): HTMLTableElement {
  const t = document.createElement('table');
  const thead = t.createTHead();
  const hr = thead.insertRow();
  for (const h of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    hr.append(th);
  }
  const tbody = t.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const cell of row) {
      const td = tr.insertCell();
      td.textContent = String(cell);
      if (typeof cell === 'number') td.className = 'num';
    }
  }
  return t;
}

function renderVerdicts(verdicts: Verdict[]): void {
  verdictList.innerHTML = '';
  for (const v of verdicts) {
    const li = document.createElement('li');
    li.dataset['verdict'] = v.id;
    li.dataset['status'] = v.status;
    li.className = v.status === 'PASS' ? 'pass' : v.status === 'FAIL' ? 'fail' : 'pending';
    li.textContent = `${v.status} ${v.id}: ${v.text}`;
    verdictList.append(li);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Seeded shuffle so the seek order is reproducible but not monotone. */
function shuffle<T>(items: T[], seed = 12345): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 20 uniform + duplicate-timestamp members + first, last, a keyframe, the frame before a keyframe. */
function chooseRandomAccessSet(index: Mp4Index): { presIndex: number; why: string }[] {
  const n = index.frameCount;
  const chosen = new Map<number, string>();
  const add = (p: number, why: string) => {
    if (p >= 0 && p < n && !chosen.has(p)) chosen.set(p, why);
  };
  add(0, 'first');
  add(n - 1, 'last');
  const keys = index.keyframePresIndices;
  const midKey = keys[Math.floor(keys.length / 2)] ?? 0;
  add(midKey, 'keyframe');
  add(midKey - 1, 'before keyframe');
  const duplicates: number[] = [];
  for (let i = 1; i < n; i++) {
    if (index.frames[i]!.cts === index.frames[i - 1]!.cts) duplicates.push(i - 1, i);
  }
  const pairCount = duplicates.length / 2;
  const wantPairs = Math.min(pairCount, Math.ceil(MIN_DUPLICATE_MEMBERS / 2));
  for (let k = 0; k < wantPairs; k++) {
    const pair = Math.floor(((k + 0.5) * pairCount) / wantPairs);
    add(duplicates[pair * 2]!, 'duplicate-timestamp pair, first');
    add(duplicates[pair * 2 + 1]!, 'duplicate-timestamp pair, second');
  }
  for (let i = 0; i < UNIFORM_SAMPLES; i++) {
    add(Math.round(((i + 1) * (n - 1)) / (UNIFORM_SAMPLES + 1)), 'uniform');
  }
  let extra = 0;
  while (chosen.size < Math.min(RANDOM_ACCESS_SAMPLES, n)) {
    add(Math.round(((extra + 0.5) * (n - 1)) / RANDOM_ACCESS_SAMPLES), 'uniform (fill)');
    extra++;
  }
  const list = [...chosen.entries()].map(([presIndex, why]) => ({ presIndex, why }));
  return shuffle(list);
}

function runWorker(
  file: File,
  index: Mp4Index,
  options: { optimizeForLatency: boolean; hardwareAcceleration: HardwareAcceleration },
): Promise<Extract<WorkerResponse, { type: 'done' }> & { peakMainHeapBytes: number | null }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../src/video/track-worker.ts', import.meta.url), {
      type: 'module',
    });
    const perf = performance as PerformanceWithMemory;
    let peakMainHeap: number | null = perf.memory?.usedJSHeapSize ?? null;
    const sampler = setInterval(() => {
      const used = perf.memory?.usedJSHeapSize;
      if (used !== undefined && (peakMainHeap === null || used > peakMainHeap)) peakMainHeap = used;
    }, 100);
    progress.hidden = false;
    progress.value = 0;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const m = event.data;
      if (m.type === 'progress') {
        progress.value = (m.presIndex + 1) / index.frameCount;
        setStatus(
          `Decoding frame ${m.presIndex + 1} of ${index.frameCount} at ${m.fps.toFixed(0)} fps, about ${m.etaSeconds.toFixed(0)} s left.`,
        );
      } else if (m.type === 'done') {
        clearInterval(sampler);
        worker.terminate();
        resolve({ ...m, peakMainHeapBytes: peakMainHeap });
      } else if (m.type === 'error') {
        clearInterval(sampler);
        worker.terminate();
        const error = new Error(m.message);
        error.name = m.name;
        reject(error);
      } else if (m.type === 'cancelled') {
        clearInterval(sampler);
        worker.terminate();
        reject(new Error('cancelled'));
      }
    };
    worker.onerror = (event) => {
      clearInterval(sampler);
      worker.terminate();
      reject(new Error(`worker failed: ${event.message}`));
    };
    const request: WorkerRequest = {
      type: 'start',
      file,
      index,
      consumer: 'hash',
      optimizeForLatency: options.optimizeForLatency,
      hardwareAcceleration: options.hardwareAcceleration,
    };
    worker.postMessage(request);
  });
}

/** Compares t_s with the committed ffprobe fixture, when the dev server can serve it. */
async function checkTimestamps(
  fileName: string,
  index: Mp4Index,
): Promise<Results['timestamps']> {
  const base = fileName.replace(/\.[^.]+$/, '');
  try {
    const response = await fetch(`/tests/fixtures/${base}.pts.json`);
    if (!response.ok) return { status: `NOT TESTED (no fixture tests/fixtures/${base}.pts.json)` };
    const pts = (await response.json()) as number[];
    if (pts.length !== index.frameCount) {
      return { status: `FAIL (fixture has ${pts.length} frames, index ${index.frameCount})`, fixtureFrames: pts.length };
    }
    const first = pts[0] ?? 0;
    let maxError = 0;
    for (let i = 0; i < pts.length; i++) {
      maxError = Math.max(maxError, Math.abs(index.frames[i]!.t_s - (pts[i]! - first)));
    }
    return {
      status: maxError <= T_S_TOLERANCE_S ? 'PASS' : 'FAIL',
      maxErrorUs: maxError * 1e6,
      fixtureFrames: pts.length,
    };
  } catch (e) {
    return { status: `NOT TESTED (${(e as Error).message})` };
  }
}

async function showFrame(presIndex: number): Promise<void> {
  if (!frameSource || !currentIndex) return;
  const p = Math.max(0, Math.min(currentIndex.frameCount - 1, presIndex));
  try {
    const bitmap = await frameSource.getFrame(p);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(bitmap, 0, 0);
    const entry = currentIndex.frames[p]!;
    frameInfo.textContent = `Frame ${p} (decode index ${entry.decodeIndex}, ${entry.isKeyframe ? 'keyframe' : 'delta'}), t_s = ${entry.t_s.toFixed(6)} s, seek ${frameSource.lastSeekMs.toFixed(1)} ms ${frameSource.lastFromCache ? '(cache)' : '(decoded)'}.`;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    frameInfo.textContent = `Could not show frame ${p}: ${(e as Error).message}`;
  }
}

async function analyse(file: File): Promise<void> {
  frameSource?.close();
  frameSource = null;
  currentIndex = null;
  currentHashes = null;
  verdictList.innerHTML = '';
  jsonBox.value = '';
  const verdicts: Verdict[] = [];
  const optDecodeOrder = $<HTMLInputElement>('optDecodeOrder').checked;
  const optimizeForLatency = $<HTMLInputElement>('optLatency').checked;
  const hardwareAcceleration: HardwareAcceleration = $<HTMLInputElement>('optHardware').checked
    ? 'no-preference'
    : 'prefer-software';

  try {
    setStatus(`Parsing the sample table of ${file.name}…`);
    const t0 = performance.now();
    const index = await parseMp4Index(file, { tieBreak: optDecodeOrder ? 'decode_order' : 'poc' });
    const parseMs = performance.now() - t0;
    currentIndex = index;
    frameIndexInput.max = String(index.frameCount - 1);

    const t1 = performance.now();
    const fingerprint = await fingerprintVideo(file, index);
    const fingerprintMs = performance.now() - t1;

    const a = index.timebaseAnomalies;
    $('indexTable').replaceChildren(
      table(
        ['property', 'value'],
        [
          ['frameCount', index.frameCount],
          ['timescale', index.timescale],
          ['nominalFps', index.nominalFps.toFixed(4)],
          ['editOffsetTicks', index.editOffsetTicks],
          ['durationSeconds', index.durationSeconds.toFixed(6)],
          ['keyframes', index.keyframePresIndices.length],
          ['codec', index.codec],
          ['size', `${index.width}×${index.height}`],
          ['tieBreak', index.tieBreak],
          ['duplicateTimestampPairs', a.duplicateTimestampPairs],
          ['droppedFrameGaps', a.droppedFrameGaps],
          ['driftSeconds', a.driftSeconds.toFixed(6)],
          ['nominalTick', a.nominalTick],
          ['warnings', index.warnings.join('; ') || 'none'],
          ['parse ms', parseMs.toFixed(1)],
          ['sha256', fingerprint.sha256],
          ['fingerprint ms', fingerprintMs.toFixed(1)],
        ],
      ),
    );

    const results: Results = {
      file: { name: file.name, byteLength: file.size, sha256: fingerprint.sha256, fingerprintMs },
      options: { tieBreak: index.tieBreak, optimizeForLatency, hardwareAcceleration },
      browser: navigator.userAgent,
      index: {
        frameCount: index.frameCount,
        timescale: index.timescale,
        nominalFps: index.nominalFps,
        editOffsetTicks: index.editOffsetTicks,
        durationSeconds: index.durationSeconds,
        keyframes: index.keyframePresIndices.length,
        tieBreak: index.tieBreak,
        warnings: index.warnings,
        anomalies: a,
        parseMs,
      },
      sequential: {
        status: 'pending',
        outputCount: 0,
        monotone: false,
        elapsedMs: 0,
        fps: 0,
        peakMainHeapBytes: null,
        peakWorkerHeapBytes: null,
      },
      timestamps: { status: 'pending' },
      randomAccess: { rows: [], matches: 0, duplicateMembersChecked: 0, medianSeekMs: 0, medianColdSeekMs: 0 },
      verdicts,
    };

    results.timestamps = await checkTimestamps(file.name, index);
    verdicts.push({
      id: 't_s matches ffprobe fixture within 1 µs',
      status: results.timestamps.status.startsWith('PASS')
        ? 'PASS'
        : results.timestamps.status.startsWith('FAIL')
          ? 'FAIL'
          : 'NOT TESTED',
      text:
        results.timestamps.maxErrorUs !== undefined
          ? `max |error| ${results.timestamps.maxErrorUs.toFixed(3)} µs over ${results.timestamps.fixtureFrames} frames`
          : results.timestamps.status,
    });
    renderVerdicts(verdicts);

    setStatus('Starting the sequential pass in the worker…');
    try {
      const done = await runWorker(file, index, { optimizeForLatency, hardwareAcceleration });
      currentHashes = done.hashes ?? null;
      results.sequential = {
        status: 'done',
        outputCount: done.frameCount,
        monotone: true,
        elapsedMs: done.elapsedMs,
        fps: done.fps,
        peakMainHeapBytes: done.peakMainHeapBytes,
        peakWorkerHeapBytes: done.peakHeapBytes ?? null,
      };
    } catch (e) {
      const error = e as Error;
      results.sequential = {
        status: 'error',
        outputCount: 0,
        monotone: false,
        elapsedMs: 0,
        fps: 0,
        peakMainHeapBytes: null,
        peakWorkerHeapBytes: null,
        error: `${error.name}: ${error.message}`,
      };
    }
    progress.hidden = true;
    const s = results.sequential;
    $('sequentialTable').replaceChildren(
      table(
        ['property', 'value'],
        [
          ['status', s.status + (s.error ? ` — ${s.error}` : '')],
          ['outputCount', s.outputCount],
          ['expected', index.frameCount],
          ['strictly monotone, no repeats', s.monotone ? 'yes (asserted per frame)' : 'no'],
          ['elapsed ms', s.elapsedMs.toFixed(0)],
          ['fps', s.fps.toFixed(1)],
          ['peak main-thread JS heap MB', s.peakMainHeapBytes === null ? 'n/a' : (s.peakMainHeapBytes / 1048576).toFixed(1)],
          ['peak worker JS heap MB', s.peakWorkerHeapBytes === null ? 'n/a' : (s.peakWorkerHeapBytes / 1048576).toFixed(1)],
        ],
      ),
    );
    verdicts.push({
      id: 'sequential output count and order',
      status: s.status === 'done' && s.outputCount === index.frameCount ? 'PASS' : 'FAIL',
      text:
        s.status === 'done'
          ? `${s.outputCount}/${index.frameCount} frames, strictly increasing presIndex, no repeats`
          : `${s.error ?? 'failed'}`,
    });
    verdicts.push({
      id: `sequential decode ≥ ${SEQUENTIAL_FPS_TARGET} fps`,
      status: s.status !== 'done' ? 'NOT TESTED' : s.fps >= SEQUENTIAL_FPS_TARGET ? 'PASS' : 'FAIL',
      text: s.status === 'done' ? `${s.fps.toFixed(1)} fps (${s.elapsedMs.toFixed(0)} ms for ${s.outputCount} frames, ${hardwareAcceleration})` : 'pass did not complete',
    });
    const peak = Math.max(s.peakMainHeapBytes ?? 0, s.peakWorkerHeapBytes ?? 0);
    verdicts.push({
      id: 'peak JS heap < 300 MB',
      status: s.peakMainHeapBytes === null && s.peakWorkerHeapBytes === null ? 'NOT TESTED' : peak < PEAK_MEMORY_LIMIT_BYTES ? 'PASS' : 'FAIL',
      text: `${(peak / 1048576).toFixed(1)} MB (performance.memory; process memory is read from the Task Manager)`,
    });
    renderVerdicts(verdicts);

    if (s.status === 'done' && currentHashes) {
      setStatus('Checking random access against the sequential hashes…');
      frameSource = new FrameSource(index, byteSourceFromBlob(file), {
        optimizeForLatency,
        hardwareAcceleration,
      });
      const rows: RandomAccessRow[] = [];
      for (const { presIndex, why } of chooseRandomAccessSet(index)) {
        const gray = await frameSource.getGray(presIndex);
        const randomHash = fnv1a32(gray);
        const sequentialHash = currentHashes[presIndex]!;
        rows.push({
          presIndex,
          why,
          t_s: index.frames[presIndex]!.t_s,
          sequentialHash: hashHex(sequentialHash),
          randomHash: hashHex(randomHash),
          match: randomHash === sequentialHash,
          seekMs: frameSource.lastSeekMs,
          fromCache: frameSource.lastFromCache,
        });
      }
      const matches = rows.filter((r) => r.match).length;
      const duplicateMembersChecked = rows.filter((r) => r.why.startsWith('duplicate')).length;
      results.randomAccess = {
        rows,
        matches,
        duplicateMembersChecked,
        medianSeekMs: median(rows.map((r) => r.seekMs)),
        medianColdSeekMs: median(rows.filter((r) => !r.fromCache).map((r) => r.seekMs)),
      };
      $('randomTable').replaceChildren(
        table(
          ['presIndex', 'why', 't_s', 'sequential hash', 'random hash', 'match', 'seek ms', 'cache'],
          rows.map((r) => [
            r.presIndex,
            r.why,
            r.t_s.toFixed(6),
            r.sequentialHash,
            r.randomHash,
            r.match ? 'yes' : 'NO',
            Number(r.seekMs.toFixed(1)),
            r.fromCache ? 'hit' : 'decoded',
          ]),
        ),
      );
      const hasDuplicates = a.duplicateTimestampPairs > 0;
      verdicts.push({
        id: 'random-access hash = sequential hash',
        status: matches === rows.length && (!hasDuplicates || duplicateMembersChecked >= MIN_DUPLICATE_MEMBERS) ? 'PASS' : 'FAIL',
        text: `${matches}/${rows.length} frames match, ${duplicateMembersChecked} duplicate-timestamp members checked${hasDuplicates ? '' : ' (clip has no duplicate timestamps)'}`,
      });
      verdicts.push({
        id: 'median seek latency',
        status: 'PASS',
        text: `${results.randomAccess.medianSeekMs.toFixed(1)} ms over all ${rows.length} seeks, ${results.randomAccess.medianColdSeekMs.toFixed(1)} ms for decoded windows (recorded, no threshold)`,
      });
      renderVerdicts(verdicts);
      await showFrame(Number(frameIndexInput.value) || 0);
    }

    jsonBox.value = JSON.stringify(results, null, 2);
    const failed = verdicts.filter((v) => v.status === 'FAIL').length;
    setStatus(failed === 0 ? `Done: ${verdicts.length} checks, none failed.` : `Done: ${failed} of ${verdicts.length} checks failed.`);
  } catch (e) {
    const error = e as Error;
    progress.hidden = true;
    setStatus(`Failed: ${error.name}: ${error.message}`);
    verdicts.push({ id: 'run', status: 'FAIL', text: `${error.name}: ${error.message}` });
    renderVerdicts(verdicts);
    jsonBox.value = JSON.stringify({ error: `${error.name}: ${error.message}`, verdicts }, null, 2);
  }
}

function wireUi(): void {
  const input = $<HTMLInputElement>('file');
  const drop = $<HTMLDivElement>('drop');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void analyse(file);
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer?.files[0];
    if (file) void analyse(file);
  });
  $('showFrame').addEventListener('click', () => void showFrame(Number(frameIndexInput.value)));
  frameIndexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void showFrame(Number(frameIndexInput.value));
  });
  $('copyJson').addEventListener('click', () => {
    void navigator.clipboard.writeText(jsonBox.value).then(
      () => setStatus('JSON copied to the clipboard.'),
      () => setStatus('Clipboard unavailable; select the JSON and copy it.'),
    );
  });
  if (!('VideoDecoder' in window)) {
    setStatus('This browser has no WebCodecs VideoDecoder; use Chrome, Edge, Safari 16.4+ or Firefox 130+.');
    input.disabled = true;
  }
}

wireUi();
