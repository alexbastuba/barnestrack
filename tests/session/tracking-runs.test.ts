/**
 * The tracking queue: what it writes, and what it must never write.
 *
 * This is the code that decides the automatic layer's contents and its
 * parameters hash, so it is tested in Node against a fake worker through the
 * `createWorker` option — no WebCodecs, no DOM. Two of these cover defects the
 * chunk-4 reviewer found: a layer stamped with the parameters in force when
 * the pass *ended*, and a destroyed runner leaving a video permanently
 * un-trackable.
 */
import { describe, expect, it, vi } from 'vitest';
import { hashTrackingParameters } from '../../src/analysis/parameters.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../src/analysis/tracker/params.js';
import type { MazeMapFile } from '../../src/contracts/mazeMap.js';
import type { AutoLayer } from '../../src/contracts/session.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { TrackingRunner, type RunState } from '../../src/session/tracking-runs.js';
import type { WorkerRequest, WorkerResponse } from '../../src/video/worker-protocol.js';
import { TOOL_VERSION, fingerprint, mazeMap } from './fixtures.js';

const WIDTH = 640;
const HEIGHT = 480;
const FRAME_COUNT = 20;

function frame(frameIndex: number): TrackFrame {
  return {
    frameIndex,
    t_s: frameIndex / 30,
    centroid: { x: 100, y: 120, confidence: 0.9, valid: true, source: 'auto' },
    nose: { x: 106, y: 114, confidence: 0.7, valid: true, source: 'auto' },
    detectionState: 'tracked',
    reason: 'single_blob',
    blobArea_px2: 800,
    boundingBox: { x: 90, y: 108, width: 30, height: 26 },
    noseHeadingConfidence: 0.7,
  };
}

/**
 * A worker that never decodes anything: it records what it was asked to do and
 * replies only when the test tells it to, which is what makes "the user edited
 * a parameter while the pass was running" expressible.
 */
class FakeWorker {
  static latest: FakeWorker | null = null;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(request: WorkerRequest): void {
    this.sent.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  finish(frames = FRAME_COUNT): void {
    this.reply({
      type: 'done',
      frameCount: frames,
      elapsedMs: 10,
      fps: 2000,
      track: {
        frames: Array.from({ length: frames }, (_, i) => frame(i)),
        summary: {
          frameCount: frames,
          stateCounts: { tracked: frames, not_detected: 0, ambiguous: 0, low_confidence: 0 },
          reasonCounts: {
            single_blob: frames,
            proximity_to_previous: 0,
            no_foreground: 0,
            multiple_blobs: 0,
            oversized_blob: 0,
            partial_at_rim: 0,
            small_blob: 0,
            fragmented: 0,
          },
          threshold: { value: 48, mode: 'otsu' },
          pxPerCm: 4.5,
          platform: { cx: 320, cy: 240, r: 205 },
          expectedBlobArea_px2: 800,
          expectedBlobAreaSource: 'learned',
          medianTrackedBlobArea_px2: 800,
          medianTrackedBlobArea_cm2: 40,
          longestNotDetectedRun: null,
          noseHeadingConfidenceCounts: { c0: 0, c05: 0, c1: frames },
          movingNoseHeadingConfidenceCounts: { c0: 0, c05: 0, c1: 0 },
          movingFrames: 0,
          warnings: [],
        },
        timing: { frames, elapsedMs: 10, fps: 2000 },
      },
    });
  }
}

/** A frame source that answers `getGray` instantly, so sampling is not the subject. */
function fakeAttachment() {
  return {
    file: new Blob([]) as unknown as File,
    index: { frameCount: FRAME_COUNT, width: WIDTH, height: HEIGHT } as never,
    frameSource: {
      getGray: () => Promise.resolve(new Uint8Array(WIDTH * HEIGHT)),
      close: () => {},
    } as never,
  };
}

interface Harness {
  store: SessionStore;
  runner: TrackingRunner;
  written: { videoId: string; auto: AutoLayer }[];
  states: RunState[];
}

function harness(): Harness {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.addVideo({
    filename: 'test53.mp4',
    fingerprint: fingerprint(),
    referenceResolution: { width: WIDTH, height: HEIGHT },
  });
  const map: MazeMapFile = mazeMap();
  store.setMazeMap(map);
  store.attach('vid_01', fakeAttachment());

  const written: { videoId: string; auto: AutoLayer }[] = [];
  const states: RunState[] = [];
  const runner = new TrackingRunner(store, {
    onChange: (state) => states.push({ ...state }),
    onComplete: (videoId, auto) => {
      written.push({ videoId, auto });
      store.setAutoLayer(videoId, auto);
    },
    createWorker: () => new FakeWorker() as unknown as Worker,
  });
  return { store, runner, written, states };
}

/** Lets the sampler's awaits settle so the worker has been posted to. */
async function settle(): Promise<void> {
  for (let i = 0; i < FRAME_COUNT + 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the parameters hash a run is stamped with (D51)', () => {
  it('is the hash of the parameters the pass ran with, not of a mid-pass edit', async () => {
    const { store, runner, written } = harness();
    const ranWith = hashTrackingParameters(store.trackingParameters);

    runner.enqueue('vid_01');
    await settle();

    // The user changes a threshold while the pass is running — the step's own
    // copy invites them to keep working, so this is ordinary use.
    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 42 });
    const afterEdit = hashTrackingParameters(store.trackingParameters);
    expect(afterEdit).not.toBe(ranWith);

    FakeWorker.latest?.finish();
    await settle();

    expect(written).toHaveLength(1);
    expect(written[0]?.auto.parametersHash).toBe(ranWith);
    expect(written[0]?.auto.parametersHash).not.toBe(afterEdit);
  });

  it('sends the worker the same parameters it hashes', async () => {
    const { store, runner, written } = harness();
    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 7 });
    runner.enqueue('vid_01');
    await settle();

    const sent = FakeWorker.latest?.sent[0];
    expect(sent?.type).toBe('start');
    if (sent?.type !== 'start' || sent.consumer !== 'track') throw new Error('no track start');
    expect(sent.track.params.minBlobArea_cm2).toBe(7);

    FakeWorker.latest?.finish();
    await settle();
    expect(written[0]?.auto.parametersHash).toBe(hashTrackingParameters(sent.track.params));
  });
});

describe('what reaches the session', () => {
  it('writes the layer with derived null and no corrections invented (D52)', async () => {
    const { store, runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.finish();
    await settle();

    const analysis = store.analysisFor('vid_01');
    expect(analysis?.auto.frames).toHaveLength(FRAME_COUNT);
    expect(analysis?.derived).toBeNull();
    expect(analysis?.corrections.entries).toEqual([]);
  });

  it('writes nothing at all when the pass is cancelled', async () => {
    const { store, runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.reply({ type: 'cancelled', frameCount: 7 });
    await settle();

    expect(store.current.analyses).toEqual({});
    expect(runner.stateFor('vid_01')?.phase).toBe('cancelled');
  });

  it('writes nothing at all when the pass fails', async () => {
    const { store, runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.reply({ type: 'error', name: 'DecodeOrderError', message: 'out of order' });
    await settle();

    expect(store.current.analyses).toEqual({});
    expect(runner.stateFor('vid_01')?.phase).toBe('failed');
  });

  it('explains an exhausted sample set rather than calling it a cancellation', async () => {
    const { store, runner } = harness();
    store.setTrackingParameters({
      ...DEFAULT_TRACKING_PARAMETERS,
      backgroundExcludeRanges: [{ startFrame: 0, endFrame: FRAME_COUNT }],
    });
    runner.enqueue('vid_01');
    await settle();

    const state = runner.stateFor('vid_01');
    expect(state?.phase).toBe('failed');
    expect(state?.error).toContain('background exclude ranges');
    expect(store.current.analyses).toEqual({});
  });
});

describe('destroy', () => {
  it('leaves the runner reusable rather than stranding the video', async () => {
    const { runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    expect(runner.isActive('vid_01')).toBe(true);

    runner.destroy();

    // A terminated worker never replies, so anything left behind is permanent.
    expect(runner.stateFor('vid_01')).toBeUndefined();
    expect(runner.isActive('vid_01')).toBe(false);
    expect(runner.busy).toBe(false);
  });

  it('lets the next session track its first video, which reuses the id vid_01', async () => {
    const { store, runner, written } = harness();
    runner.enqueue('vid_01');
    await settle();
    runner.destroy();

    // What replaceSession/reset do: ids restart, so the new vid_01 is a
    // different video that must not inherit the dead run.
    expect(runner.untracked()).toEqual(['vid_01']);
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.finish();
    await settle();

    expect(written).toHaveLength(1);
    expect(store.analysisFor('vid_01')?.auto.frames).toHaveLength(FRAME_COUNT);
  });
});

describe('the queue', () => {
  it('runs one video at a time and reports the rest as waiting', async () => {
    const { store, runner } = harness();
    store.addVideo({
      filename: 'test51.mp4',
      fingerprint: fingerprint({ sha256: 'b'.repeat(64) }),
      referenceResolution: { width: WIDTH, height: HEIGHT },
    });
    store.attach('vid_02', fakeAttachment());

    runner.enqueue('vid_01');
    runner.enqueue('vid_02');
    await settle();

    expect(runner.stateFor('vid_02')?.phase).toBe('queued');
    const first = FakeWorker.latest;
    first?.finish();
    await settle();

    expect(store.analysisFor('vid_01')?.auto.frames).toHaveLength(FRAME_COUNT);
    expect(FakeWorker.latest).not.toBe(first);
    expect(runner.stateFor('vid_02')?.phase).not.toBe('queued');
  });

  it('drops a waiting video when it is cancelled before it starts', async () => {
    const { store, runner } = harness();
    store.addVideo({
      filename: 'test51.mp4',
      fingerprint: fingerprint({ sha256: 'b'.repeat(64) }),
      referenceResolution: { width: WIDTH, height: HEIGHT },
    });
    store.attach('vid_02', fakeAttachment());

    runner.enqueue('vid_01');
    runner.enqueue('vid_02');
    runner.cancel('vid_02');

    expect(runner.stateFor('vid_02')?.phase).toBe('cancelled');
    await settle();
    expect(store.current.analyses).toEqual({});
  });

  it('offers only videos that can actually be tracked', async () => {
    const { store, runner } = harness();
    // Loaded but not attached: nothing to decode in this tab.
    store.addVideo({
      filename: 'test51.mp4',
      fingerprint: fingerprint({ sha256: 'b'.repeat(64) }),
      referenceResolution: { width: WIDTH, height: HEIGHT },
    });
    expect(runner.untracked()).toEqual(['vid_01']);

    runner.enqueue('vid_01');
    await settle();
    expect(runner.untracked()).toEqual([]);

    FakeWorker.latest?.finish();
    await settle();
    // Already tracked, so not offered again.
    expect(runner.untracked()).toEqual([]);
  });

  it('fails a video whose maze is not finished, without touching the session', async () => {
    const { store, runner } = harness();
    store.setMazeMap(null);
    runner.enqueue('vid_01');
    await settle();

    expect(runner.stateFor('vid_01')?.phase).toBe('failed');
    expect(runner.stateFor('vid_01')?.error).toContain('maze');
    expect(store.current.analyses).toEqual({});
  });
});

describe('re-tracking', () => {
  it('replaces the layer and leaves a corrections layer untouched (D9)', async () => {
    const { store, runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.finish();
    await settle();

    const correction = {
      kind: 'point' as const,
      id: 'corr_01',
      timestamp: '2026-09-06T12:00:00.000Z',
      source: 'user' as const,
      frameIndex: 3,
      point: 'nose' as const,
      value: { x: 1, y: 2, confidence: 1, valid: true },
    };
    store.current.analyses['vid_01'] = {
      ...store.current.analyses['vid_01']!,
      corrections: { entries: [correction] },
    };

    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 9 });
    runner.enqueue('vid_01');
    await settle();
    FakeWorker.latest?.finish(5);
    await settle();

    const after = store.analysisFor('vid_01');
    expect(after?.corrections.entries).toEqual([correction]);
    expect(after?.auto.frames).toHaveLength(5);
    expect(after?.auto.parametersHash).toBe(
      hashTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 9 }),
    );
    expect(after?.derived).toBeNull();
  });
});

describe('the worker is released', () => {
  it('terminates the worker when a run settles, however it settles', async () => {
    const { runner } = harness();
    runner.enqueue('vid_01');
    await settle();
    const worker = FakeWorker.latest;
    expect(worker?.terminated).toBe(false);

    worker?.finish();
    await settle();
    expect(worker?.terminated).toBe(true);
  });

  it('reports a worker that dies outright as a failure, not a silent stall', async () => {
    const { store, runner } = harness();
    runner.enqueue('vid_01');
    await settle();

    const worker = FakeWorker.latest;
    worker?.onerror?.({ message: 'the worker script threw' } as ErrorEvent);
    await settle();

    expect(runner.stateFor('vid_01')?.phase).toBe('failed');
    expect(runner.stateFor('vid_01')?.error).toContain('worker');
    expect(store.current.analyses).toEqual({});
  });
});

describe('progress never reaches the store', () => {
  it('keeps a running pass out of the session until it finishes', async () => {
    const { store, runner } = harness();
    const saves = vi.spyOn(store, 'setAutoLayer');
    runner.enqueue('vid_01');
    await settle();

    for (let i = 0; i < 5; i++) {
      FakeWorker.latest?.reply({ type: 'progress', presIndex: i, fps: 100, etaSeconds: 1 });
    }
    await settle();
    expect(saves).not.toHaveBeenCalled();
    expect(store.current.analyses).toEqual({});

    FakeWorker.latest?.finish();
    await settle();
    expect(saves).toHaveBeenCalledTimes(1);
  });
});
