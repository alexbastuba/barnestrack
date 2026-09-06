import { describe, expect, it } from 'vitest';
import {
  assignNose,
  type NoseFrameInput,
  type NoseShapeInput,
} from '../../../src/analysis/tracker/nose.js';
import { pxPerCmFromPlatform, toPixelUnits } from '../../../src/analysis/tracker/calibration.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../../src/analysis/tracker/params.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseOnCircle,
  mouseTips,
  renderScene,
  renderStaticScene,
  sceneHoles,
  type MouseSpec,
} from '../synthetic-frames.js';
import { setup, t_s, trackerFor } from './helpers.js';

const pxPerCm = pxPerCmFromPlatform(DEFAULT_SCENE.platform, PLATFORM_DIAMETER_CM);
const px = toPixelUnits(DEFAULT_TRACKING_PARAMETERS, DEFAULT_SCENE.platform, pxPerCm);

/** Horizontal body at (cx, cy): end A at +x, end B at −x. */
function shape(cx: number, cy: number, tail: { dx: number; dy: number } | null): NoseShapeInput {
  return {
    cx,
    cy,
    ux: 1,
    uy: 0,
    ax: cx + 16,
    ay: cy,
    bx: cx - 16,
    by: cy,
    tail: tail ? { ...tail, pixels: 20 } : null,
  };
}

describe('assignNose on constructed inputs', () => {
  it('uses the tail alone at 0.5 and tail + velocity agreeing at 1.0', () => {
    // moving +x at 60 px/s (> 2 cm/s), tail pointing −x → head is end A
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++)
      frames.push({ t_s: i / 30, shape: shape(100 + 2 * i, 50, { dx: -1, dy: 0 }) });
    const out = assignNose(frames, px);
    expect(out[4]).toMatchObject({
      valid: true,
      headingConfidence: 1,
      moving: true,
      x: 108 + 16,
      cues: { tail: true, velocity: true, hole: false },
    });
    // first frame: no earlier frame → velocity unavailable → tail only
    expect(out[0]).toMatchObject({ valid: true, headingConfidence: 0.5, moving: false });
  });

  it('is 0 on disagreement and picks the tail end', () => {
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++)
      frames.push({ t_s: i / 30, shape: shape(100 + 2 * i, 50, { dx: 1, dy: 0 }) });
    const out = assignNose(frames, px);
    expect(out[4]).toMatchObject({ valid: true, headingConfidence: 0, x: 108 - 16 });
  });

  it('is invalid with confidence 0 when no cue exists', () => {
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++) frames.push({ t_s: i / 30, shape: shape(100, 50, null) });
    const out = assignNose(frames, px);
    expect(out[4]).toMatchObject({ valid: false, headingConfidence: 0, moving: false });
    expect(out[4]!.cues).toEqual({ tail: false, velocity: false, hole: false });
  });

  it('ignores a cue that is perpendicular to the body axis', () => {
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++)
      frames.push({ t_s: i / 30, shape: shape(100, 50 + 2 * i, { dx: 0, dy: 1 }) });
    expect(assignNose(frames, px)[4]).toMatchObject({
      valid: false,
      headingConfidence: 0,
      moving: true,
    });
  });

  it('uses the hole cue when stationary and a hole is within reach of an end', () => {
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++) frames.push({ t_s: i / 30, shape: shape(100, 50, null) });
    const holes = [{ x: 100 + 16 + 5, y: 50, r: 11 }];
    const out = assignNose(frames, px, holes);
    expect(out[4]).toMatchObject({
      valid: true,
      headingConfidence: 0.5,
      x: 116,
      cues: { tail: false, velocity: false, hole: true },
    });
    // a far hole does not count; frames without a measurable speed do not use the hole cue
    expect(assignNose(frames, px, [{ x: 300, y: 50, r: 11 }])[4]!.valid).toBe(false);
    expect(out[0]!.valid).toBe(false);
  });

  it('treats a zero time span as no velocity cue', () => {
    const frames: NoseFrameInput[] = [];
    for (let i = 0; i < 9; i++) frames.push({ t_s: 0, shape: shape(100 + 2 * i, 50, null) });
    expect(assignNose(frames, px)[4]!.valid).toBe(false);
  });

  it('skips frames without a shape', () => {
    const frames: NoseFrameInput[] = [{ t_s: 0, shape: null }];
    expect(assignNose(frames, px)[0]).toMatchObject({ valid: false, headingConfidence: 0 });
  });
});

describe('assignNose through the tracker on a synthetic moving mouse', () => {
  it('puts the nose on the head end in at least 95 % of frames', () => {
    const s = setup();
    const staticScene = renderStaticScene(s.spec);
    const tracker = trackerFor(s);
    const specs: MouseSpec[] = [];
    const buf = new Uint8Array(s.spec.width * s.spec.height);
    const n = 120;
    for (let i = 0; i < n; i++) {
      const m: MouseSpec = { ...DEFAULT_MOUSE, ...mouseOnCircle(s.spec, t_s(i)) };
      specs.push(m);
      renderScene(s.spec, { mouse: m }, buf, staticScene);
      tracker.onFrame(buf, i, t_s(i));
    }
    const { frames, summary } = tracker.finish();
    let correct = 0;
    let validCount = 0;
    for (let i = 0; i < n; i++) {
      const f = frames[i]!;
      expect(f.detectionState).toBe('tracked');
      if (!f.nose.valid) continue;
      validCount++;
      const tips = mouseTips(specs[i]!);
      const dNose = Math.hypot(f.nose.x - tips.nose.x, f.nose.y - tips.nose.y);
      const dRear = Math.hypot(f.nose.x - tips.rear.x, f.nose.y - tips.rear.y);
      if (dNose < dRear) correct++;
    }
    expect(validCount).toBeGreaterThan(n * 0.95);
    expect(correct / validCount).toBeGreaterThanOrEqual(0.95);
    expect(summary.movingFrames).toBeGreaterThan(n * 0.9);
    expect(summary.movingNoseHeadingConfidenceCounts.c1).toBeGreaterThan(n * 0.8);
  });

  it('is invalid with confidence 0 for a stationary mouse without a tail and no holes', () => {
    const s = setup();
    const tracker = trackerFor(s);
    const frame = renderScene(s.spec, {
      mouse: { ...DEFAULT_MOUSE, x: 300, y: 230, heading: 0.7, tailLength: 0 },
    });
    for (let i = 0; i < 12; i++) tracker.onFrame(frame, i, t_s(i));
    const { frames } = tracker.finish();
    for (const f of frames) {
      expect(f.detectionState).toBe('tracked');
      expect(f.nose.valid).toBe(false);
      expect(f.nose.confidence).toBe(0);
      expect(f.noseHeadingConfidence).toBe(0);
    }
  });

  it('uses the hole cue for a stationary mouse facing a hole', () => {
    const s = setup();
    const holes = sceneHoles(s.spec);
    const hole = holes[3]!;
    const heading = Math.atan2(hole.y - s.spec.platform.cy, hole.x - s.spec.platform.cx);
    const m: MouseSpec = {
      ...DEFAULT_MOUSE,
      x: hole.x - (16 + 12) * Math.cos(heading),
      y: hole.y - (16 + 12) * Math.sin(heading),
      heading,
      tailLength: 0,
    };
    const tracker = trackerFor(s, { holes });
    const frame = renderScene(s.spec, { mouse: m });
    for (let i = 0; i < 12; i++) tracker.onFrame(frame, i, t_s(i));
    const f = tracker.finish().frames[6]!;
    const tips = mouseTips(m);
    expect(f.nose.valid).toBe(true);
    expect(f.noseHeadingConfidence).toBe(0.5);
    expect(Math.hypot(f.nose.x - tips.nose.x, f.nose.y - tips.nose.y)).toBeLessThan(6);
  });
});
