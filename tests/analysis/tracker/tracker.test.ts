import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../../../src/contracts/track.js';
import {
  DETECTION_REASONS,
  REASON_STATE,
  type DetectionReason,
} from '../../../src/analysis/tracker/select.js';
import { backgroundSampleIndices } from '../../../src/analysis/tracker/background.js';
import {
  DEFAULT_TRACKING_PARAMETERS,
  TRACKING_PARAMETER_DEFINITIONS,
} from '../../../src/analysis/tracker/params.js';
import {
  longestNotDetectedRun,
  prepareTracking,
  trackFrames,
  type FrameInput,
} from '../../../src/analysis/tracker/tracker.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseAtRim,
  mouseOnCircle,
  renderScene,
  renderStaticScene,
  type SceneObjects,
} from '../synthetic-frames.js';
import { circleSamples, setup, t_s, trackerFor } from './helpers.js';

/** A mixed sequence: empty start, hand placing the mouse, running, two mice, rim, empty end. */
function mixedSequence(spec = DEFAULT_SCENE): SceneObjects[] {
  const seq: SceneObjects[] = [];
  for (let i = 0; i < 5; i++) seq.push({ seed: i });
  for (let i = 0; i < 4; i++)
    seq.push({ hand: { x: 320, y: 240, radius: 40, darkness: 120 }, seed: 10 + i });
  for (let i = 0; i < 40; i++)
    seq.push({ mouse: { ...DEFAULT_MOUSE, ...mouseOnCircle(spec, t_s(i)) }, seed: 20 + i });
  for (let i = 0; i < 3; i++) seq.push({ mouse: mouseAtRim(spec, 1.2 + 0.05 * i), seed: 60 + i });
  for (let i = 0; i < 3; i++) seq.push({ seed: 70 + i });
  return seq;
}

function renderSequence(spec = DEFAULT_SCENE, seq = mixedSequence(spec)): FrameInput[] {
  const staticScene = renderStaticScene({ ...spec, noise: 0 });
  return seq.map((objects, i) => ({
    gray: renderScene(spec, objects, undefined, staticScene),
    presIndex: i,
    t_s: t_s(i),
  }));
}

describe('createTracker output contract', () => {
  const s = setup({ spec: { noise: 2 } });
  const frames = renderSequence(s.spec);
  const result = trackFrames(frames, s.options);

  it('emits one contract-exact TrackFrame per input frame, never a bare point, never filled', () => {
    expect(result.frames.length).toBe(frames.length);
    result.frames.forEach((f: TrackFrame, i) => {
      expect(f.frameIndex).toBe(i);
      expect(f.t_s).toBe(t_s(i));
      for (const p of [f.centroid, f.nose]) {
        expect(typeof p.x).toBe('number');
        expect(typeof p.y).toBe('number');
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
        expect(typeof p.valid).toBe('boolean');
        expect(p.source).toBe('auto');
      }
      expect(['tracked', 'not_detected', 'ambiguous', 'low_confidence']).toContain(
        f.detectionState,
      );
      expect(DETECTION_REASONS).toContain(f.reason);
      expect(REASON_STATE[f.reason as DetectionReason]).toBe(f.detectionState);
      expect(f.boundingBox === null).toBe(!f.centroid.valid);
      expect(f.blobArea_px2 === 0).toBe(!f.centroid.valid);
      expect(f.nose.valid && !f.centroid.valid).toBe(false);
      expect(f.noseHeadingConfidence).toBeGreaterThanOrEqual(0);
      expect(f.noseHeadingConfidence).toBeLessThanOrEqual(1);
      if (!f.nose.valid) expect(f.nose.confidence).toBe(0);
    });
  });

  it('classifies the mixed sequence as built', () => {
    const states = result.frames.map((f) => `${f.detectionState}/${f.reason}`);
    expect(states.slice(0, 5).every((x) => x === 'not_detected/no_foreground')).toBe(true);
    expect(states.slice(5, 9).every((x) => x === 'ambiguous/oversized_blob')).toBe(true);
    expect(states.slice(9, 49).every((x) => x === 'tracked/single_blob')).toBe(true);
    expect(states.slice(49, 52).every((x) => x === 'low_confidence/partial_at_rim')).toBe(true);
    expect(states.slice(52).every((x) => x === 'not_detected/no_foreground')).toBe(true);
    expect(result.summary.stateCounts).toEqual({
      tracked: 40,
      not_detected: 8,
      ambiguous: 4,
      low_confidence: 3,
    });
    expect(result.summary.reasonCounts.oversized_blob).toBe(4);
  });

  it('learns the expected blob area from the unambiguous frames', () => {
    expect(result.summary.expectedBlobAreaSource).toBe('learned');
    const body = Math.PI * DEFAULT_MOUSE.bodyLength * DEFAULT_MOUSE.bodyWidth;
    expect(result.summary.expectedBlobArea_px2).toBeGreaterThan(body * 0.75);
    expect(result.summary.expectedBlobArea_px2).toBeLessThan(body * 1.15);
    expect(result.summary.medianTrackedBlobArea_cm2).toBeGreaterThan(12);
    expect(result.summary.medianTrackedBlobArea_cm2).toBeLessThan(24);
    expect(result.summary.longestNotDetectedRun).toMatchObject({
      startFrame: 0,
      endFrame: 4,
      frames: 5,
      lastTrackedPoint: null,
    });
  });

  it('reports the threshold, calibration and timing', () => {
    expect(result.summary.threshold).toEqual(s.threshold);
    expect(result.summary.pxPerCm).toBeCloseTo(s.pxPerCm);
    expect(result.timing.frames).toBe(frames.length);
    expect(result.timing.fps).toBeGreaterThan(0);
  });
});

describe('createTracker invariants', () => {
  it('is deterministic: two runs give deep-equal frames and summary', () => {
    const s = setup({ spec: { noise: 2 } });
    const frames = renderSequence(s.spec);
    const a = trackFrames(frames, s.options);
    const b = trackFrames(frames, s.options);
    expect(b.frames).toEqual(a.frames);
    expect(b.summary).toEqual(a.summary);
    expect(JSON.stringify(b.frames)).toBe(JSON.stringify(a.frames));
  });

  it('never keeps a reference to the frame buffer', () => {
    const s = setup({ spec: { noise: 2 } });
    const frames = renderSequence(s.spec);
    const fresh = trackFrames(frames, s.options);
    const tracker = trackerFor(s);
    const shared = new Uint8Array(s.spec.width * s.spec.height);
    for (const f of frames) {
      shared.set(f.gray);
      tracker.onFrame(shared, f.presIndex, f.t_s);
      shared.fill(0); // the decoder reuses its buffer; the tracker must have copied what it needs
    }
    expect(tracker.finish().frames).toEqual(fresh.frames);
  });

  it('rejects out-of-order frames, wrong sizes and reuse after finish', () => {
    const s = setup();
    const tracker = trackerFor(s);
    const frame = renderScene(s.spec, {});
    expect(() => tracker.onFrame(frame, 1, 0)).toThrow(/in order/);
    expect(() => tracker.onFrame(new Uint8Array(10), 0, 0)).toThrow(/bytes/);
    tracker.onFrame(frame, 0, 0);
    tracker.finish();
    expect(() => tracker.onFrame(frame, 1, 0)).toThrow(/finished/);
  });

  it('uses the expected area parameter when given and warns when it cannot learn one', () => {
    const s = setup({ params: { expectedBlobArea_cm2: 20 } });
    const result = trackFrames(renderSequence(s.spec).slice(0, 12), s.options);
    expect(result.summary.expectedBlobAreaSource).toBe('parameter');
    expect(result.summary.expectedBlobArea_px2).toBeCloseTo(20 * s.pxPerCm * s.pxPerCm);
    const empty = setup();
    const none = trackFrames(renderSequence(empty.spec).slice(0, 5), empty.options);
    expect(none.summary.expectedBlobAreaSource).toBe('unavailable');
    expect(none.summary.warnings.some((w) => /could not be learned/.test(w))).toBe(true);
  });

  it('runs at a useful rate on 640 × 480 frames (informational)', () => {
    const s = setup();
    const staticScene = renderStaticScene(s.spec);
    const buf = new Uint8Array(s.spec.width * s.spec.height);
    const tracker = trackerFor(s);
    const n = 200;
    for (let i = 0; i < n; i++) {
      renderScene(
        s.spec,
        { mouse: { ...DEFAULT_MOUSE, ...mouseOnCircle(s.spec, t_s(i)) } },
        buf,
        staticScene,
      );
      tracker.onFrame(buf, i, t_s(i));
    }
    const { timing } = tracker.finish();
    console.info(
      `tracker throughput: ${timing.fps.toFixed(0)} fps over ${n} synthetic 640×480 frames (criterion ≥ 150 fps, informational)`,
    );
    expect(timing.fps).toBeGreaterThan(0);
  });
});

describe('prepareTracking', () => {
  it('builds the background, threshold, calibration and contamination warnings from sample frames', () => {
    const samples = circleSamples(DEFAULT_SCENE, 15);
    const prep = prepareTracking({
      width: DEFAULT_SCENE.width,
      height: DEFAULT_SCENE.height,
      platform: DEFAULT_SCENE.platform,
      platformDiameter_cm: PLATFORM_DIAMETER_CM,
      params: DEFAULT_TRACKING_PARAMETERS,
      samples,
    });
    expect(prep.pxPerCm).toBeCloseTo((2 * 205) / 92);
    expect(prep.threshold.mode).toBe('otsu');
    expect(prep.warnings).toEqual([]);
    expect(prep.background).toEqual(renderStaticScene(DEFAULT_SCENE));
    const baked = prepareTracking({
      width: DEFAULT_SCENE.width,
      height: DEFAULT_SCENE.height,
      platform: DEFAULT_SCENE.platform,
      platformDiameter_cm: PLATFORM_DIAMETER_CM,
      params: DEFAULT_TRACKING_PARAMETERS,
      samples: samples.map(() =>
        renderScene(DEFAULT_SCENE, { mouse: { ...DEFAULT_MOUSE, x: 330, y: 250, heading: 0.2 } }),
      ),
    });
    expect(baked.warnings.length).toBe(1);
    expect(backgroundSampleIndices(100, 15).length).toBe(15);
  });
});

describe('longestNotDetectedRun', () => {
  it('finds the longest run and the last valid centroid before it', () => {
    const mk = (i: number, state: TrackFrame['detectionState'], valid: boolean): TrackFrame => ({
      frameIndex: i,
      t_s: i / 30,
      centroid: { x: i, y: 2 * i, confidence: valid ? 1 : 0, valid, source: 'auto' },
      nose: { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' },
      detectionState: state,
      reason: valid ? 'single_blob' : 'no_foreground',
      blobArea_px2: 0,
      boundingBox: null,
      noseHeadingConfidence: 0,
    });
    const frames = [
      mk(0, 'not_detected', false),
      mk(1, 'tracked', true),
      mk(2, 'not_detected', false),
      mk(3, 'not_detected', false),
      mk(4, 'ambiguous', false),
      mk(5, 'not_detected', false),
      mk(6, 'not_detected', false),
      mk(7, 'not_detected', false),
    ];
    expect(longestNotDetectedRun(frames)).toEqual({
      startFrame: 5,
      endFrame: 7,
      frames: 3,
      lastTrackedPoint: { frameIndex: 1, x: 1, y: 2 },
    });
    expect(longestNotDetectedRun([mk(0, 'tracked', true)])).toBeNull();
  });
});

describe('parameter definitions', () => {
  it('has a one-line definition for every tracking parameter', () => {
    for (const key of Object.keys(
      DEFAULT_TRACKING_PARAMETERS,
    ) as (keyof typeof DEFAULT_TRACKING_PARAMETERS)[]) {
      expect(TRACKING_PARAMETER_DEFINITIONS[key].length).toBeGreaterThan(20);
      expect(TRACKING_PARAMETER_DEFINITIONS[key]).not.toMatch(/\n/);
    }
  });
});
