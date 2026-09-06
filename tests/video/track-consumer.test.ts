/**
 * The `track` frame consumer end to end: sample frames in, a background and a
 * threshold built from them, a `TrackFrame` per decoded frame out, and a live
 * preview along the way.
 *
 * This drives `createTrackConsumer` directly rather than the worker, because a
 * worker cannot run in Node — `VideoDecoder` does not exist there. The worker
 * is a thin wrapper around this consumer (it adds only postMessage plumbing),
 * and the worker path itself is covered by `tests/browser/`.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKING_PARAMETERS } from '../../src/analysis/tracker/params.js';
import type { GrayFrame } from '../../src/video/decoder.js';
import { createTrackConsumer } from '../../src/video/track-consumer.js';
import type { TrackStartConfig } from '../../src/video/worker-protocol.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseOnCircle,
  renderScene,
  renderStaticScene,
} from '../analysis/synthetic-frames.js';

const spec = { ...DEFAULT_SCENE, noise: 2 };
const FRAMES = 60;

/** Background samples: the mouse in a different place in each, as the real sampler gives. */
function samples(count = 12): Uint8Array[] {
  const staticScene = renderStaticScene({ ...spec, noise: 0 });
  const out: Uint8Array[] = [];
  for (let k = 0; k < count; k++) {
    const mouse = { ...DEFAULT_MOUSE, ...mouseOnCircle(spec, (k * 10) / count) };
    out.push(renderScene(spec, { mouse, seed: 100 + k }, undefined, staticScene));
  }
  return out;
}

/**
 * A decoded sequence, delivered the way `createSequentialDecoder` delivers it:
 * one reused buffer, refilled per frame. If the consumer retained the plane
 * this would corrupt every earlier frame, so it is the honest shape to test.
 */
function* decodedFrames(count = FRAMES): Generator<GrayFrame> {
  const staticScene = renderStaticScene({ ...spec, noise: 0 });
  const reused = new Uint8Array(spec.width * spec.height);
  for (let i = 0; i < count; i++) {
    const mouse = { ...DEFAULT_MOUSE, ...mouseOnCircle(spec, i / 30) };
    reused.set(renderScene(spec, { mouse, seed: 20 + i }, undefined, staticScene));
    yield {
      presIndex: i,
      t_s: i / 30,
      width: spec.width,
      height: spec.height,
      gray: reused,
    };
  }
}

function config(overrides: Partial<TrackStartConfig> = {}): TrackStartConfig {
  return {
    platform: spec.platform,
    platformDiameter_cm: PLATFORM_DIAMETER_CM,
    holes: [],
    params: DEFAULT_TRACKING_PARAMETERS,
    samples: samples(),
    previewEvery: 15,
    previewMaxEdge: 240,
    ...overrides,
  };
}

function run(overrides: Partial<TrackStartConfig> = {}) {
  const consumer = createTrackConsumer({ ...config(overrides), width: spec.width, height: spec.height });
  const previews = [];
  for (const frame of decodedFrames()) {
    consumer.onFrame(frame);
    const preview = consumer.takePreview();
    if (preview) previews.push({ presIndex: frame.presIndex, preview });
  }
  return { consumer, previews, result: consumer.finish() };
}

describe('createTrackConsumer', () => {
  it('prepares a background, a threshold and a scale before the first frame', () => {
    const consumer = createTrackConsumer({
      ...config(),
      width: spec.width,
      height: spec.height,
    });
    expect(consumer.preparation.background).toHaveLength(spec.width * spec.height);
    expect(consumer.preparation.threshold.value).toBeGreaterThan(0);
    expect(consumer.preparation.threshold.value).toBeLessThanOrEqual(255);
    expect(consumer.preparation.threshold.mode).toBe('otsu');
    expect(consumer.preparation.pxPerCm).toBeCloseTo((2 * spec.platform.r) / PLATFORM_DIAMETER_CM, 6);
    // A clean synthetic scene has nothing baked into the background.
    expect(consumer.preparation.warnings).toEqual([]);
  });

  it('produces one frame per decoded frame, in order, and tracks the animal', () => {
    const { result } = run();
    expect(result.frames).toHaveLength(FRAMES);
    expect(result.frames.map((f) => f.frameIndex)).toEqual([...Array(FRAMES).keys()]);
    expect(result.summary.frameCount).toBe(FRAMES);

    const tracked = result.frames.filter((f) => f.detectionState === 'tracked');
    expect(tracked.length / FRAMES).toBeGreaterThan(0.9);
    for (const frame of tracked) {
      expect(frame.centroid.valid).toBe(true);
      expect(frame.centroid.source).toBe('auto');
    }
  });

  it('never retains the decoder’s reused plane', () => {
    // Every frame above shares one buffer; a retained plane would make the
    // whole track collapse onto the last frame's position.
    const { result } = run();
    const xs = result.frames.filter((f) => f.centroid.valid).map((f) => f.centroid.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });

  it('emits no interpolated point: the automatic layer is never filled (D8, D16)', () => {
    const { result } = run();
    for (const frame of result.frames) {
      expect(frame.centroid.source).not.toBe('filled');
      expect(frame.nose.source).not.toBe('filled');
      expect(frame.reason).toMatch(/^[a-z_]+$/);
    }
  });

  it('hands out a downscaled preview on the frames where one is due', () => {
    const { previews } = run({ previewEvery: 15 });
    expect(previews.map((p) => p.presIndex)).toEqual([0, 15, 30, 45]);
    for (const { preview } of previews) {
      expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(240);
      expect(preview.gray).toHaveLength(preview.width * preview.height);
      expect(preview.centroid).not.toBeNull();
      // Preview coordinates, not video coordinates.
      expect(preview.centroid!.x).toBeLessThanOrEqual(preview.width);
      expect(preview.centroid!.y).toBeLessThanOrEqual(preview.height);
      expect(preview.candidateCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('makes no preview at all when previewEvery is 0', () => {
    const { previews } = run({ previewEvery: 0 });
    expect(previews).toEqual([]);
  });

  it('gives the same frames whether or not previews are switched on', () => {
    const withPreview = run({ previewEvery: 15 }).result;
    const without = run({ previewEvery: 0 }).result;
    expect(without.frames).toEqual(withPreview.frames);
    expect(without.summary).toEqual(withPreview.summary);
  });

  it('drops candidates, axes and nose cues: only frames and the summary travel', () => {
    const { result } = run();
    expect(Object.keys(result).sort()).toEqual(['frames', 'summary', 'timing']);
  });

  it('keeps only the newest preview, so a slow reader drops rather than lags', () => {
    const consumer = createTrackConsumer({
      ...config({ previewEvery: 1 }),
      width: spec.width,
      height: spec.height,
    });
    const frames = [...decodedFrames(4)];
    for (const frame of frames) consumer.onFrame({ ...frame, gray: frame.gray.slice() });
    const preview = consumer.takePreview();
    expect(preview).not.toBeNull();
    expect(consumer.takePreview()).toBeNull();
  });
});
