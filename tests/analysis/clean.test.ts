import { describe, expect, it } from 'vitest';
import { OUTLIER_REASON, cleanTrack, findOutliers } from '../../src/analysis/clean.js';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { TEST_PLATFORM, TEST_PX_PER_CM, testGeometry } from './maze-fixture.js';
import { buildTrack, deepFreeze, timebase, type FrameInput } from './track-builder.js';

const g = testGeometry();
const cx = TEST_PLATFORM.cx;
const cy = TEST_PLATFORM.cy;

function clean(frames: readonly TrackFrame[], parameters: Parameters = DEFAULT_PARAMETERS) {
  return cleanTrack(frames, buildTrackArrays(frames, g), g, parameters);
}

function withGapFilling(enabled: boolean, maxDuration_s = 0.1): Parameters {
  return { ...DEFAULT_PARAMETERS, gapFilling: { enabled, maxDuration_s } };
}

describe('gap filling (O10)', () => {
  it('fills a short gap away from holes linearly in time, marked filled, nose left invalid', () => {
    const frames = deepFreeze(
      buildTrack([[cx, cy], [cx + 10, cy], null, null, [cx + 40, cy + 30], [cx + 50, cy + 30]]),
    );
    const { track, report } = clean(frames);
    expect(report.filledFrames).toBe(2);
    expect(report.outlierFrames).toBe(0);
    expect(report.filledGaps).toEqual([
      { startFrame: 2, endFrame: 3, frames: 2, durationSeconds: expect.closeTo(0.1, 12) },
    ]);
    expect(report.unfilledGaps).toEqual([]);
    expect(track[2]!.centroid).toEqual({
      x: cx + 20,
      y: cy + 10,
      confidence: 0.9,
      valid: true,
      source: 'filled',
    });
    expect(track[3]!.centroid).toEqual({
      x: cx + 30,
      y: cy + 20,
      confidence: 0.9,
      valid: true,
      source: 'filled',
    });
    for (const i of [2, 3]) {
      expect(track[i]!.nose.valid).toBe(false);
      expect(track[i]!.detectionState).toBe('not_detected');
      expect(track[i]!.reason).toBe('no_foreground');
    }
    // untouched frames are the same objects; the input is unchanged
    for (const i of [0, 1, 4, 5]) expect(track[i]).toBe(frames[i]);
    expect(frames[2]!.centroid.valid).toBe(false);
  });

  it('uses the smaller confidence of the two bounding frames and interpolates by timestamp, not frame count', () => {
    const t = timebase(5, 30, { dropsAt: [3] }); // frame 3 sits 2/30 after frame 2: t = 0, 1/30, 2/30, 4/30, 5/30
    const frames = buildTrack(
      [
        { x: cx, y: cy, confidence: 0.4 },
        { x: cx, y: cy, confidence: 0.6 },
        null,
        { x: cx + 9, y: cy, confidence: 0.8 },
        [cx + 10, cy],
      ],
      t,
    );
    const { track, report } = clean(frames);
    expect(report.filledGaps).toHaveLength(1);
    expect(report.filledGaps[0]!.durationSeconds).toBeCloseTo(3 / 30, 12);
    // frame 2 is 1/30 into a 3/30 span between frames 1 (x = cx) and 3 (x = cx + 9)
    expect(track[2]!.centroid.x).toBeCloseTo(cx + 3, 9);
    expect(track[2]!.centroid.confidence).toBe(0.6);
  });

  it('does not fill a gap longer than maxDuration_s, and says so', () => {
    const frames = buildTrack([[cx, cy], null, null, null, [cx + 40, cy]]); // 4/30 s between the bounds
    const { track, report } = clean(frames);
    expect(report.filledFrames).toBe(0);
    expect(report.unfilledGaps).toEqual([
      {
        startFrame: 1,
        endFrame: 3,
        frames: 3,
        durationSeconds: expect.closeTo(4 / 30, 12),
        reason: 'too_long',
      },
    ]);
    expect(track[2]!.centroid.valid).toBe(false);
    const wider = clean(frames, withGapFilling(true, 0.2));
    expect(wider.report.filledFrames).toBe(3);
  });

  it('never fills a gap when either bounding frame is within one hole radius of a hole', () => {
    // points along the line from hole 3 towards the platform centre, in hole radii from the hole centre
    const inward = (holeRadii: number): FrameInput => {
      const dx = cx - g.holeX[3]!;
      const dy = cy - g.holeY[3]!;
      const len = Math.hypot(dx, dy);
      const d = holeRadii * g.holeRadius_px;
      return { x: g.holeX[3]! + (dx / len) * d, y: g.holeY[3]! + (dy / len) * d };
    };
    const nearHole = inward(0.9);
    const farEnough = inward(2.5); // more than one hole radius from hole 3 and from its neighbours
    const before = clean(buildTrack([nearHole, null, farEnough]));
    expect(before.report.unfilledGaps.map((u) => u.reason)).toEqual(['hole_adjacent']);
    const after = clean(buildTrack([farEnough, null, nearHole]));
    expect(after.report.unfilledGaps.map((u) => u.reason)).toEqual(['hole_adjacent']);
    const ok = clean(buildTrack([inward(1.1), null, farEnough]));
    expect(ok.report.filledFrames).toBe(1);
  });

  it('reports disabled, unbounded and corrected gaps without filling them', () => {
    const frames = buildTrack([null, [cx, cy], null, [cx + 5, cy], null]);
    const off = clean(frames, withGapFilling(false));
    expect(off.report.filledFrames).toBe(0);
    expect(off.report.unfilledGaps.map((u) => u.reason)).toEqual([
      'disabled',
      'disabled',
      'disabled',
    ]);
    const on = clean(frames);
    expect(on.report.filledFrames).toBe(1);
    expect(on.report.unfilledGaps.map((u) => [u.startFrame, u.reason])).toEqual([
      [0, 'unbounded'],
      [4, 'unbounded'],
    ]);
    expect(Number.isNaN(on.report.unfilledGaps[0]!.durationSeconds)).toBe(true);

    const corrected = buildTrack([[cx, cy], { x: 0, y: 0, source: 'corrected' }, [cx + 5, cy]]);
    corrected[1] = {
      ...corrected[1]!,
      centroid: { x: 0, y: 0, confidence: 0, valid: false, source: 'corrected' },
    };
    const c = clean(corrected);
    expect(c.report.filledFrames).toBe(0);
    expect(c.report.unfilledGaps.map((u) => u.reason)).toEqual(['corrected']);
  });
});

describe('outliers (O17)', () => {
  const jump_px = 30 * TEST_PX_PER_CM; // 30 cm in one frame at 30 fps = 900 cm/s

  it('marks a frame that jumps faster than the threshold, keeps its coordinates and invalidates both points', () => {
    const frames = deepFreeze(
      buildTrack([
        [cx, cy],
        [cx + 1, cy],
        [cx + 1 + jump_px, cy],
        [cx + 2, cy],
        [cx + 3, cy],
      ]),
    );
    const { track, report } = clean(frames);
    // the jump out marks frame 2; the jump back, measured from frame 2, marks frame 3 (a spike marks two frames)
    expect(report.outlierFrameIndices).toEqual([2, 3]);
    expect(report.outlierFrames).toBe(2);
    for (const i of [2, 3]) {
      expect(track[i]!.centroid.valid).toBe(false);
      expect(track[i]!.centroid.x).toBe(frames[i]!.centroid.x);
      expect(track[i]!.centroid.source).toBe('auto');
      expect(track[i]!.nose.valid).toBe(false);
      expect(track[i]!.detectionState).toBe('ambiguous');
      expect(track[i]!.reason).toBe(OUTLIER_REASON);
    }
    expect(track[4]!.centroid.valid).toBe(true);
    expect(track[0]).toBe(frames[0]);
    expect(frames[2]!.centroid.valid).toBe(true);
  });

  it('marks one frame for a step, and none below the threshold', () => {
    const step = clean(
      buildTrack([
        [cx, cy],
        [cx, cy],
        [cx + jump_px, cy],
        [cx + jump_px + 1, cy],
      ]),
    );
    expect(step.report.outlierFrameIndices).toEqual([2]);
    const slow = clean(
      buildTrack([
        [cx, cy],
        [cx + 4 * TEST_PX_PER_CM, cy],
        [cx + 8 * TEST_PX_PER_CM, cy],
      ]),
    ); // 120 cm/s
    expect(slow.report.outlierFrameIndices).toEqual([]);
  });

  it('never tests a duplicate-stamp pair (Δt below the duplicate fraction), and never marks a corrected point', () => {
    const t = timebase(4, 30, { duplicatesAt: [2] }); // frames 1 and 2 share a stamp
    const dup = clean(
      buildTrack(
        [
          [cx, cy],
          [cx, cy],
          [cx + 3, cy],
          [cx + 4, cy],
        ],
        t,
      ),
    );
    expect(dup.report.outlierFrameIndices).toEqual([]);
    const a = buildTrackArrays(
      buildTrack(
        [
          [cx, cy],
          [cx, cy],
          [cx + jump_px, cy],
          [cx + jump_px, cy],
        ],
        t,
      ),
      g,
    );
    // the same jump with Δt = 0 between frames 1 and 2 is not tested; frame 3 (Δt = 1/30 from frame 2, no jump) passes
    expect(Array.from(findOutliers(a, g, DEFAULT_PARAMETERS))).toEqual([0, 0, 0, 0]);

    const corrected = clean(
      buildTrack([
        [cx, cy],
        [cx, cy],
        { x: cx + jump_px, y: cy, source: 'corrected' },
        [cx + jump_px + 1, cy],
      ]),
    );
    expect(corrected.report.outlierFrameIndices).toEqual([]);
  });

  it('does not fill a gap that touches an outlier, and skips the test without a nominal interval', () => {
    const frames = buildTrack([
      [cx, cy],
      [cx + jump_px, cy],
      null,
      [cx + jump_px + 1, cy],
      [cx + jump_px + 2, cy],
    ]);
    const { report } = clean(frames);
    expect(report.outlierFrameIndices).toEqual([1]);
    expect(report.unfilledGaps.map((u) => u.reason)).toEqual(['touches_outlier']);
    const one = clean(buildTrack([[cx, cy]]));
    expect(one.report.outlierFrames).toBe(0);
  });
});
