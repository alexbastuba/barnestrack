import { describe, expect, it } from 'vitest';
import { pxPerCmFromPlatform, toPixelUnits } from '../../../src/analysis/tracker/calibration.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../../src/analysis/tracker/params.js';
import {
  DETECTION_REASONS,
  REASON_STATE,
  selectCandidate,
  type CandidateBlob,
} from '../../../src/analysis/tracker/select.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseAtRim,
  renderScene,
} from '../synthetic-frames.js';
import { setup, t_s, trackerFor } from './helpers.js';

const pxPerCm = pxPerCmFromPlatform(DEFAULT_SCENE.platform, PLATFORM_DIAMETER_CM);
const px = toPixelUnits(DEFAULT_TRACKING_PARAMETERS, DEFAULT_SCENE.platform, pxPerCm);
const expected = 400;
const blob = (over: Partial<CandidateBlob> = {}): CandidateBlob => ({
  area: 400,
  cx: 300,
  cy: 200,
  rimContact: false,
  ...over,
});

describe('selectCandidate on constructed candidate lists', () => {
  it('maps every reason to its state', () => {
    for (const r of DETECTION_REASONS)
      expect(['tracked', 'not_detected', 'ambiguous', 'low_confidence']).toContain(REASON_STATE[r]);
  });

  it('no candidate → not_detected / no_foreground', () => {
    expect(selectCandidate([], px, expected, null)).toMatchObject({
      state: 'not_detected',
      reason: 'no_foreground',
      index: -1,
    });
    expect(selectCandidate([blob({ area: 3 })], px, expected, null)).toMatchObject({
      reason: 'no_foreground',
    });
  });

  it('one plausible → tracked / single_blob', () => {
    expect(selectCandidate([blob()], px, expected, null)).toEqual({
      state: 'tracked',
      reason: 'single_blob',
      index: 0,
      byProximity: false,
    });
  });

  it('two plausible → ambiguous / multiple_blobs unless exactly one is near the previous position', () => {
    const two = [blob(), blob({ cx: 500, cy: 300 })];
    expect(selectCandidate(two, px, expected, null)).toMatchObject({
      state: 'ambiguous',
      reason: 'multiple_blobs',
      index: -1,
    });
    expect(selectCandidate(two, px, expected, { x: 495, y: 305 })).toEqual({
      state: 'tracked',
      reason: 'proximity_to_previous',
      index: 1,
      byProximity: true,
    });
    expect(selectCandidate(two, px, expected, { x: 400, y: 250 })).toMatchObject({
      reason: 'multiple_blobs',
    });
    const close = [blob(), blob({ cx: 310, cy: 205 })];
    expect(selectCandidate(close, px, expected, { x: 305, y: 202 })).toMatchObject({
      reason: 'multiple_blobs',
    });
  });

  it('an oversized component wins over everything else', () => {
    expect(selectCandidate([blob({ area: 3 * expected + 1 })], px, expected, null)).toMatchObject({
      state: 'ambiguous',
      reason: 'oversized_blob',
    });
    expect(
      selectCandidate(
        [blob(), blob({ area: px.maxBlobArea_px2 + 1, cx: 100, cy: 100 })],
        px,
        expected,
        null,
      ),
    ).toMatchObject({ reason: 'oversized_blob' });
    // above the maximum area even when no expected area is known
    expect(selectCandidate([blob({ area: px.maxBlobArea_px2 + 1 })], px, null, null)).toMatchObject(
      { reason: 'oversized_blob' },
    );
    expect(selectCandidate([blob({ area: 3 * expected + 1 })], px, null, null)).toMatchObject({
      state: 'tracked',
    });
  });

  it('rim contact and small blobs are low confidence', () => {
    expect(selectCandidate([blob({ rimContact: true })], px, expected, null)).toMatchObject({
      state: 'low_confidence',
      reason: 'partial_at_rim',
      index: 0,
    });
    expect(selectCandidate([blob({ area: 0.5 * expected - 1 })], px, expected, null)).toMatchObject(
      { state: 'low_confidence', reason: 'small_blob' },
    );
    expect(selectCandidate([blob({ area: 0.5 * expected - 1 })], px, null, null)).toMatchObject({
      state: 'tracked',
    });
  });
});

describe('selection on rendered frames', () => {
  const s = setup();
  const scene = s.spec;

  function runOne(
    objects: Parameters<typeof renderScene>[1],
    previous?: Parameters<typeof renderScene>[1],
  ) {
    const tracker = trackerFor(s, { params: { ...s.params, expectedBlobArea_cm2: 20 } });
    let i = 0;
    if (previous) tracker.onFrame(renderScene(scene, previous), i++, t_s(i));
    tracker.onFrame(renderScene(scene, objects), i, t_s(i));
    const result = tracker.finish();
    return result.frames[i]!;
  }

  it('no mouse → not_detected / no_foreground with invalid points', () => {
    const f = runOne({});
    expect(f.detectionState).toBe('not_detected');
    expect(f.reason).toBe('no_foreground');
    expect(f.centroid.valid).toBe(false);
    expect(f.boundingBox).toBeNull();
    expect(f.blobArea_px2).toBe(0);
  });

  it('one mouse → tracked / single_blob with the centroid on the body', () => {
    const mouse = { ...DEFAULT_MOUSE, x: 300, y: 220, heading: 1.0 };
    const f = runOne({ mouse });
    expect(f.detectionState).toBe('tracked');
    expect(f.reason).toBe('single_blob');
    expect(f.centroid.valid).toBe(true);
    expect(Math.hypot(f.centroid.x - mouse.x, f.centroid.y - mouse.y)).toBeLessThan(4);
    expect(f.blobArea_px2).toBeGreaterThan(Math.PI * 16 * 8 * 0.7);
    expect(f.blobArea_px2).toBeLessThan(Math.PI * 16 * 8 * 1.2);
  });

  it('two mice → ambiguous / multiple_blobs, resolved by proximity when a previous frame exists', () => {
    const a = { ...DEFAULT_MOUSE, x: 260, y: 200, heading: 0 };
    const b = { ...DEFAULT_MOUSE, x: 400, y: 300, heading: 2 };
    const two = renderScene(scene, { mouse: a });
    // draw the second mouse on top of the first render
    renderScene({ ...scene }, { mouse: b }, two, two);
    const tracker = trackerFor(s);
    tracker.onFrame(two, 0, 0);
    expect(tracker.finish().frames[0]).toMatchObject({
      detectionState: 'ambiguous',
      reason: 'multiple_blobs',
    });

    const tracker2 = trackerFor(s);
    tracker2.onFrame(renderScene(scene, { mouse: { ...a, x: 262 } }), 0, 0);
    tracker2.onFrame(two, 1, t_s(1));
    const frames = tracker2.finish().frames;
    expect(frames[1]).toMatchObject({ detectionState: 'tracked', reason: 'proximity_to_previous' });
    expect(Math.hypot(frames[1]!.centroid.x - a.x, frames[1]!.centroid.y - a.y)).toBeLessThan(4);
  });

  it("an experimenter's hand → ambiguous / oversized_blob", () => {
    const f = runOne({ hand: { x: 330, y: 250, radius: 40, darkness: 120 } });
    expect(f.detectionState).toBe('ambiguous');
    expect(f.reason).toBe('oversized_blob');
    const g = runOne({
      hand: { x: 330, y: 250, radius: 40, darkness: 120 },
      mouse: { ...DEFAULT_MOUSE, x: 250, y: 150, heading: 0 },
    });
    expect(g.reason).toBe('oversized_blob');
  });

  it('a mouse hanging over the rim → low_confidence / partial_at_rim', () => {
    const f = runOne({ mouse: mouseAtRim(scene, 0.3) });
    expect(f.detectionState).toBe('low_confidence');
    expect(f.reason).toBe('partial_at_rim');
    expect(f.centroid.valid).toBe(true);
    expect(f.centroid.confidence).toBeLessThan(0.75);
  });

  it('a mouse with its head hidden → low_confidence / small_blob', () => {
    const f = runOne({
      mouse: {
        ...DEFAULT_MOUSE,
        x: 300,
        y: 220,
        heading: 0,
        bodyLength: 8,
        bodyWidth: 5,
        tailLength: 0,
      },
    });
    expect(f.detectionState).toBe('low_confidence');
    expect(f.reason).toBe('small_blob');
  });
});
