/**
 * Runs the tracker module over a video file from Node: sample-table index
 * for frame identity and `t_s` (D7), a first ffmpeg pass for the background
 * samples, `prepareTracking`, a second pass streaming every frame into the
 * tracker, and the evidence outputs (track JSON, background PNG, contact
 * sheet). Used by the CLI and by the sample-video test.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  backgroundSampleIndices,
  medianBackground,
} from '../../src/analysis/tracker/background.js';
import type { PlatformCircle } from '../../src/analysis/tracker/calibration.js';
import {
  DEFAULT_TRACKING_PARAMETERS,
  type TrackingParameters,
} from '../../src/analysis/tracker/params.js';
import {
  checkBackgroundContamination,
  type ContaminationCheck,
} from '../../src/analysis/tracker/background.js';
import {
  createTracker,
  prepareTracking,
  type TrackerResult,
} from '../../src/analysis/tracker/tracker.js';
import { parseMp4Index, type Mp4Index } from '../../src/video/mp4-index.js';
import {
  IndexedCanvas,
  contactPalette,
  grayIndex,
  renderContactSheet,
  type ContactTile,
} from './contact-sheet.js';
import { streamGrayFrames } from './ffmpeg.js';
import { estimatePlatformCircle, type PlatformEstimate } from './platform-estimate.js';
import { encodePng } from './png.js';
import { renderStageView, renderZoomSheet, type ZoomTile } from './zoom-sheet.js';

/** Extra contact-sheet frames: `count` frames spread over [start_s, end_s] (negative start = from the end). */
export interface ExtraRange {
  start_s: number;
  end_s: number | 'end';
  count: number;
}

export interface RunOptions {
  video: string;
  platformDiameter_cm: number;
  /** Required for tracking; when absent only the estimate is produced. */
  platform?: PlatformCircle;
  params?: TrackingParameters;
  outDir?: string;
  /** Uniformly sampled contact-sheet frames (default 30; 0 disables the sheet). */
  contactFrames?: number;
  extras?: ExtraRange[];
  /** Frames for which a four-panel stage view is written (`<video>.stage-<frame>.png`). */
  debugFrames?: number[];
  /** Moving frames (centroid speed at or above the moving threshold) sampled uniformly for `<video>.moving.png` (default 30; 0 disables). */
  movingFrames?: number;
  log?: (line: string) => void;
}

export interface RunTiming {
  indexMs: number;
  samplePassMs: number;
  medianMs: number;
  trackPassMs: number;
  totalMs: number;
  /** Frames per second of the tracker's own compute (`result.timing.fps`). */
  trackerFps: number;
  /** Frames per second including ffmpeg decoding and piping. */
  wallFps: number;
}

export interface RunResult {
  video: string;
  index: {
    frameCount: number;
    width: number;
    height: number;
    nominalFps: number;
    durationSeconds: number;
    warnings: string[];
  };
  sampleIndices: number[];
  estimate: PlatformEstimate | null;
  platform: PlatformCircle | null;
  contamination: ContaminationCheck | null;
  result: TrackerResult | null;
  contactFrameIndices: number[];
  /** Frames on the moving-frames zoom sheet. */
  movingFrameIndices: number[];
  timing: RunTiming;
  outputs: string[];
}

export function contactFrameIndices(
  index: Mp4Index,
  uniform: number,
  extras: readonly ExtraRange[],
): { uniform: number[]; extra: number[] } {
  const n = index.frameCount;
  const uni: number[] = [];
  for (let k = 0; k < uniform; k++) uni.push(Math.floor(((k + 0.5) * n) / uniform));
  const extra: number[] = [];
  const duration = index.durationSeconds;
  for (const e of extras) {
    const start = e.start_s < 0 ? duration + e.start_s : e.start_s;
    const end = e.end_s === 'end' ? duration : e.end_s;
    for (let k = 0; k < e.count; k++) {
      const t = start + ((k + 0.5) * (end - start)) / e.count;
      let best = 0;
      for (let i = 0; i < n; i++) {
        if (index.frames[i]!.t_s <= t) best = i;
        else break;
      }
      if (!uni.includes(best) && !extra.includes(best)) extra.push(best);
    }
  }
  return { uniform: uni, extra };
}

export async function trackVideo(options: RunOptions): Promise<RunResult> {
  const log = options.log ?? (() => {});
  const params = options.params ?? DEFAULT_TRACKING_PARAMETERS;
  const t0 = performance.now();
  const bytes = readFileSync(options.video);
  const index = await parseMp4Index(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const { width, height, frameCount } = index;
  const indexMs = performance.now() - t0;
  log(
    `${basename(options.video)}: ${frameCount} frames, ${width}×${height}, nominal ${index.nominalFps.toFixed(3)} fps, ${index.durationSeconds.toFixed(3)} s (index ${indexMs.toFixed(0)} ms)`,
  );

  // Pass 1: background samples.
  const sampleIndices = backgroundSampleIndices(
    frameCount,
    params.backgroundSampleCount,
    params.backgroundExcludeRanges,
  );
  const t1 = performance.now();
  const samples: Uint8Array[] = [];
  const sampleCount = await streamGrayFrames(
    options.video,
    width,
    height,
    (gray) => samples.push(Uint8Array.from(gray)),
    { select: sampleIndices },
  );
  if (sampleCount !== sampleIndices.length) {
    throw new Error(
      `ffmpeg emitted ${sampleCount} sample frames, expected ${sampleIndices.length}`,
    );
  }
  const samplePassMs = performance.now() - t1;
  const t2 = performance.now();
  const background = medianBackground(samples, width, height);
  const medianMs = performance.now() - t2;
  log(
    `background: ${sampleCount} samples in ${samplePassMs.toFixed(0)} ms, median ${medianMs.toFixed(0)} ms`,
  );

  const outputs: string[] = [];
  const stem = basename(options.video).replace(/\.[^.]+$/, '');
  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    const bgPath = join(options.outDir, `${stem}.background.png`);
    writeFileSync(bgPath, encodePng(width, height, background, { type: 'gray' }));
    outputs.push(bgPath);
  }

  let estimate: PlatformEstimate | null = null;
  try {
    estimate = estimatePlatformCircle(background, width, height);
    if (options.outDir) {
      // Debug image: the background with the estimated circle (cyan) and, when given, the circle used (yellow).
      const canvas = new IndexedCanvas(width, height);
      for (let p = 0; p < background.length; p++) canvas.pixels[p] = grayIndex(background[p]!);
      const drawCircle = (c: PlatformCircle, color: number) => {
        for (let k = 0; k < 1440; k++) {
          const a = (2 * Math.PI * k) / 1440;
          canvas.set(c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a), color);
        }
        canvas.line(c.cx - 4, c.cy, c.cx + 4, c.cy, color);
        canvas.line(c.cx, c.cy - 4, c.cx, c.cy + 4, color);
      };
      drawCircle(estimate.circle, 242);
      if (options.platform) drawCircle(options.platform, 243);
      const estPath = join(options.outDir, `${stem}.estimate.png`);
      writeFileSync(
        estPath,
        encodePng(width, height, canvas.pixels, { type: 'indexed', palette: contactPalette() }),
      );
      outputs.push(estPath);
    }
    log(
      `platform estimate: cx ${estimate.circle.cx.toFixed(1)} cy ${estimate.circle.cy.toFixed(1)} r ${estimate.circle.r.toFixed(1)} (first pass cx ${estimate.firstPass.cx.toFixed(1)} cy ${estimate.firstPass.cy.toFixed(1)} r ${estimate.firstPass.r.toFixed(1)}; ${estimate.boundaryPixels} boundary px → ${estimate.rimPoints} rim points, ${estimate.rimPointsAfterRejection} kept, rms ${estimate.rmsResidual_px.toFixed(2)} px)`,
    );
  } catch (e) {
    log(`platform estimate failed: ${(e as Error).message}`);
  }

  const baseTiming = {
    indexMs,
    samplePassMs,
    medianMs,
    trackPassMs: 0,
    totalMs: performance.now() - t0,
    trackerFps: 0,
    wallFps: 0,
  };
  if (!options.platform) {
    return {
      video: options.video,
      index: {
        frameCount,
        width,
        height,
        nominalFps: index.nominalFps,
        durationSeconds: index.durationSeconds,
        warnings: index.warnings,
      },
      sampleIndices,
      estimate,
      platform: null,
      contamination: null,
      result: null,
      contactFrameIndices: [],
      movingFrameIndices: [],
      timing: baseTiming,
      outputs,
    };
  }

  const prep = prepareTracking({
    width,
    height,
    platform: options.platform,
    platformDiameter_cm: options.platformDiameter_cm,
    params,
    samples,
    background,
  });
  const contamination = checkBackgroundContamination(background, prep.mask, prep.px);
  log(
    `threshold ${prep.threshold.value} (${prep.threshold.mode}); ${prep.pxPerCm.toFixed(3)} px/cm; contamination check: ${contamination.blobs.length} dark blobs inside the mask, ${contamination.warnings.length} warning(s)`,
  );
  for (const w of prep.warnings) log(`  warning: ${w}`);

  // Pass 2: every frame into the tracker; copies of the contact-sheet frames.
  const contact =
    options.contactFrames === 0
      ? { uniform: [], extra: [] }
      : contactFrameIndices(index, options.contactFrames ?? 30, options.extras ?? []);
  const debugFrames = (options.debugFrames ?? []).filter((i) => i >= 0 && i < frameCount);
  const wanted = new Set([...contact.uniform, ...contact.extra, ...debugFrames]);
  const kept = new Map<number, Uint8Array>();
  const tracker = createTracker({
    width,
    height,
    platform: options.platform,
    pxPerCm: prep.pxPerCm,
    params,
    background,
    threshold: prep.threshold,
    warnings: prep.warnings,
  });
  const t3 = performance.now();
  const emitted = await streamGrayFrames(options.video, width, height, (gray, i) => {
    if (i >= frameCount) throw new Error(`ffmpeg emitted more than ${frameCount} frames`);
    tracker.onFrame(gray, i, index.frames[i]!.t_s);
    if (wanted.has(i)) kept.set(i, Uint8Array.from(gray));
  });
  if (emitted !== frameCount)
    throw new Error(`ffmpeg emitted ${emitted} frames, index has ${frameCount}`);
  const result = tracker.finish();
  const trackPassMs = performance.now() - t3;
  const totalMs = performance.now() - t0;
  const timing: RunTiming = {
    ...baseTiming,
    trackPassMs,
    totalMs,
    trackerFps: result.timing.fps,
    wallFps: (frameCount * 1000) / trackPassMs,
  };

  const orderedContact = [...contact.uniform, ...contact.extra];
  const movingSample: number[] = [];
  if (options.outDir) {
    if (orderedContact.length > 0) {
      const tiles: ContactTile[] = orderedContact.map((i) => ({
        gray: kept.get(i)!,
        frame: result.frames[i]!,
        axis: result.axes[i]!,
        tag: contact.extra.includes(i) ? '+' : '',
      }));
      const sheet = renderContactSheet(
        tiles,
        width,
        height,
        `${stem}  ${orderedContact.length} FRAMES (${contact.uniform.length} UNIFORM + ${contact.extra.length} EXTRA, TAGGED +)  THRESHOLD ${prep.threshold.value}`,
      );
      const sheetPath = join(options.outDir, `${stem}.contact.png`);
      writeFileSync(sheetPath, sheet.png);
      outputs.push(sheetPath);
      const zoomTiles: ZoomTile[] = tiles.map((t) => ({
        gray: t.gray,
        frame: t.frame,
        axis: t.axis,
        tag: t.tag,
      }));
      const zoomPath = join(options.outDir, `${stem}.zoom.png`);
      writeFileSync(
        zoomPath,
        renderZoomSheet(
          zoomTiles,
          width,
          height,
          `${stem}  ZOOM ON THE SAME ${orderedContact.length} FRAMES AS THE CONTACT SHEET`,
        ),
      );
      outputs.push(zoomPath);
    }
    // Moving frames for the nose evidence: a third pass over a uniform sample of them.
    const movingAll = result.noseCues.map((c, i) => (c.moving ? i : -1)).filter((i) => i >= 0);
    const movingWanted = options.movingFrames ?? 30;
    if (movingWanted > 0 && movingAll.length > 0) {
      const n = Math.min(movingWanted, movingAll.length);
      for (let k = 0; k < n; k++)
        movingSample.push(movingAll[Math.floor(((k + 0.5) * movingAll.length) / n)]!);
      const grays = new Map<number, Uint8Array>();
      const got = await streamGrayFrames(
        options.video,
        width,
        height,
        (gray, k) => grays.set(movingSample[k]!, Uint8Array.from(gray)),
        { select: movingSample },
      );
      if (got !== movingSample.length)
        throw new Error(`ffmpeg emitted ${got} moving frames, expected ${movingSample.length}`);
      const movingTiles: ZoomTile[] = movingSample.map((i) => ({
        gray: grays.get(i)!,
        frame: result.frames[i]!,
        axis: result.axes[i]!,
        tag: '',
      }));
      const movingPath = join(options.outDir, `${stem}.moving.png`);
      writeFileSync(
        movingPath,
        renderZoomSheet(
          movingTiles,
          width,
          height,
          `${stem}  ${n} OF ${movingAll.length} MOVING FRAMES (CENTROID SPEED >= ${params.noseMovingSpeed_cmPerS} CM/S), SAMPLED UNIFORMLY`,
        ),
      );
      outputs.push(movingPath);
    }
    for (const i of debugFrames) {
      const stagePath = join(options.outDir, `${stem}.stage-${i}.png`);
      writeFileSync(
        stagePath,
        renderStageView({
          gray: kept.get(i)!,
          background,
          mask: prep.mask,
          threshold: prep.threshold.value,
          px: prep.px,
          frame: result.frames[i]!,
          axis: result.axes[i]!,
        }),
      );
      outputs.push(stagePath);
    }
    const jsonPath = join(options.outDir, `${stem}.track.json`);
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          video: basename(options.video),
          index: {
            frameCount,
            width,
            height,
            nominalFps: index.nominalFps,
            durationSeconds: index.durationSeconds,
            warnings: index.warnings,
          },
          platform: options.platform,
          platformDiameter_cm: options.platformDiameter_cm,
          estimate,
          params,
          sampleIndices,
          contamination,
          summary: result.summary,
          timing: { ...timing, tracker: result.timing },
          contactFrameIndices: orderedContact,
          movingFrameIndices: movingSample,
          frames: result.frames,
          axes: result.axes,
          noseCues: result.noseCues,
          candidates: result.candidates,
        },
        null,
        1,
      ),
    );
    outputs.push(jsonPath);
  }

  return {
    video: options.video,
    index: {
      frameCount,
      width,
      height,
      nominalFps: index.nominalFps,
      durationSeconds: index.durationSeconds,
      warnings: index.warnings,
    },
    sampleIndices,
    estimate,
    platform: options.platform,
    contamination,
    result,
    contactFrameIndices: orderedContact,
    movingFrameIndices: movingSample,
    timing,
    outputs,
  };
}

/** Plain-language summary lines for the terminal and RESULTS.md. */
export function summaryLines(run: RunResult): string[] {
  const r = run.result;
  if (!r) return ['(not tracked: no platform circle given)'];
  const s = r.summary;
  const n = s.frameCount;
  const pct = (v: number) => `${((100 * v) / n).toFixed(1)} %`;
  const lines: string[] = [];
  lines.push(
    `frames ${n}; tracked ${s.stateCounts.tracked} (${pct(s.stateCounts.tracked)}), low_confidence ${s.stateCounts.low_confidence} (${pct(s.stateCounts.low_confidence)}), ambiguous ${s.stateCounts.ambiguous} (${pct(s.stateCounts.ambiguous)}), not_detected ${s.stateCounts.not_detected} (${pct(s.stateCounts.not_detected)})`,
  );
  lines.push(
    `reasons: ${Object.entries(s.reasonCounts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  lines.push(
    `threshold ${s.threshold.value} (${s.threshold.mode}); ${s.pxPerCm.toFixed(3)} px/cm; platform cx ${s.platform.cx.toFixed(1)} cy ${s.platform.cy.toFixed(1)} r ${s.platform.r.toFixed(1)}`,
  );
  lines.push(
    `expected blob area ${s.expectedBlobArea_px2 === null ? 'unavailable' : `${s.expectedBlobArea_px2.toFixed(0)} px² (${(s.expectedBlobArea_px2 / (s.pxPerCm * s.pxPerCm)).toFixed(1)} cm²)`} [${s.expectedBlobAreaSource}]; median tracked blob ${s.medianTrackedBlobArea_px2 === null ? 'n/a' : `${s.medianTrackedBlobArea_px2.toFixed(0)} px² (${s.medianTrackedBlobArea_cm2!.toFixed(1)} cm²)`}`,
  );
  const run0 = s.longestNotDetectedRun;
  lines.push(
    run0
      ? `longest not_detected run: frames ${run0.startFrame}–${run0.endFrame} (${run0.frames} frames, ${(r.frames[run0.endFrame]!.t_s - r.frames[run0.startFrame]!.t_s).toFixed(2)} s); last tracked point before it: ${run0.lastTrackedPoint ? `frame ${run0.lastTrackedPoint.frameIndex} at (${run0.lastTrackedPoint.x.toFixed(0)}, ${run0.lastTrackedPoint.y.toFixed(0)})` : 'none'}`
      : 'no not_detected run',
  );
  const nc = s.noseHeadingConfidenceCounts;
  const mc = s.movingNoseHeadingConfidenceCounts;
  lines.push(
    `nose heading confidence (frames with a blob): 1.0 ${nc.c1}, 0.5 ${nc.c05}, 0.0 ${nc.c0}; moving frames ${s.movingFrames}: 1.0 ${mc.c1}, 0.5 ${mc.c05}, 0.0 ${mc.c0}`,
  );
  lines.push(
    `timing: tracker ${run.timing.trackerFps.toFixed(0)} fps (compute only), ${run.timing.wallFps.toFixed(0)} fps including ffmpeg; sample pass ${run.timing.samplePassMs.toFixed(0)} ms, median ${run.timing.medianMs.toFixed(0)} ms, track pass ${run.timing.trackPassMs.toFixed(0)} ms, total ${run.timing.totalMs.toFixed(0)} ms`,
  );
  if (run.estimate) {
    const e = run.estimate;
    lines.push(
      `platform estimate (untuned): cx ${e.circle.cx.toFixed(1)} cy ${e.circle.cy.toFixed(1)} r ${e.circle.r.toFixed(1)} (rms ${e.rmsResidual_px.toFixed(2)} px over ${e.rimPointsAfterRejection} rim points) vs used cx ${s.platform.cx} cy ${s.platform.cy} r ${s.platform.r}`,
    );
  }
  if (run.contamination) {
    const c = run.contamination;
    const top = c.blobs
      .slice(0, 3)
      .map(
        (b) =>
          `${b.area_cm2.toFixed(1)} cm² at (${b.cx.toFixed(0)}, ${b.cy.toFixed(0)}) ×${b.areaRatio.toFixed(2)} e${b.elongation.toFixed(2)}${b.flagged ? ' FLAGGED' : ''}`,
      );
    lines.push(
      `background contamination check: dark below ${c.darkBelow}; ${c.blobs.length} dark blobs inside the mask; largest: ${top.join('; ')}; ${c.warnings.length === 0 ? 'no warnings' : `${c.warnings.length} warning(s), listed below`}`,
    );
  }
  for (const w of s.warnings) lines.push(`warning: ${w}`);
  return lines;
}
