import { describe, expect, it } from 'vitest';
import { computeKinematics, smoothPositions } from '../../src/analysis/kinematics.js';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import { TEST_PLATFORM, TEST_PX_PER_CM, testGeometry } from './maze-fixture.js';
import { buildTrack, timebase, type FrameInput } from './track-builder.js';

const g = testGeometry();
const cx = TEST_PLATFORM.cx;
const cy = TEST_PLATFORM.cy;
const cm = (px: number): number => px / TEST_PX_PER_CM;

function kin(
  inputs: FrameInput[],
  t?: Float64Array,
  p: Parameters = DEFAULT_PARAMETERS,
  window?: { startFrame: number; endFrame: number },
) {
  const frames = buildTrack(inputs, t);
  const a = buildTrackArrays(frames, g);
  return computeKinematics(a, g, p, window ?? { startFrame: 0, endFrame: frames.length - 1 });
}

const noSmoothing: Parameters = { ...DEFAULT_PARAMETERS, kinematicsSmoothingWindowFrames: 1 };

describe('path length (O9)', () => {
  it('sums the segments of a known polyline in cm, raw and smoothed alike on a straight line', () => {
    const k = kin([
      [cx, cy],
      [cx + 10, cy],
      [cx + 20, cy],
      [cx + 20, cy + 15],
      [cx + 20, cy + 30],
    ]);
    expect(k.pathLength_cm).toBeCloseTo(cm(50), 9);
    expect(k.pathLengthSmoothed_cm).toBeCloseTo(cm(50), 9);
    expect(k.trackedTime_s).toBeCloseTo(4 / 30, 12);
    expect(k.gapTime_s).toBeCloseTo(0, 12);
    expect(k.gapFraction).toBeCloseTo(0, 12);
    expect(k.meanSpeed_cmPerS).toBeCloseTo(cm(50) / (4 / 30), 9);
    expect(k.duplicateStampPairs).toBe(0);
    expect(k.droppedFrameGaps).toBe(0);
    expect(k.nominalDt_s).toBeCloseTo(1 / 30, 12);
  });

  it('shortens a jittery path when smoothed, and keeps run endpoints exact', () => {
    const zig: FrameInput[] = [];
    for (let i = 0; i < 12; i++) zig.push([cx + 5 * i, cy + (i % 2 === 0 ? 4 : -4)]);
    const k = kin(zig);
    expect(k.pathLengthSmoothed_cm).toBeLessThan(k.pathLength_cm);
    expect(k.smoothedX[0]).toBe(cx);
    expect(k.smoothedY[0]).toBe(cy + 4);
    expect(k.smoothedY[11]).toBe(cy - 4);
    expect(k.smoothedY[5]).toBe(cy + 4); // median of (+4, −4, +4)
    expect(Number.isNaN(k.smoothedX[12] ?? Number.NaN)).toBe(true);
  });

  it('excludes gaps from the path and reports them as a fraction of the trial', () => {
    const k = kin([[cx, cy], [cx + 10, cy], null, null, [cx + 40, cy], [cx + 50, cy]]);
    expect(k.pathLength_cm).toBeCloseTo(cm(20), 9); // the 10 px segments either side of the gap only
    expect(k.trackedTime_s).toBeCloseTo(2 / 30, 12);
    expect(k.gapTime_s).toBeCloseTo(3 / 30, 12);
    expect(k.gapFraction).toBeCloseTo(0.6, 12);
    expect(Number.isNaN(k.smoothedX[2]!)).toBe(true);
    expect(Number.isNaN(k.speed_cmPerS[2]!)).toBe(true);
  });

  it('keeps the straight segment across a dropped-frame gap and counts it', () => {
    const t = timebase(4, 30, { dropsAt: [2] });
    const k = kin(
      [
        [cx, cy],
        [cx + 10, cy],
        [cx + 30, cy],
        [cx + 40, cy],
      ],
      t,
    );
    expect(k.droppedFrameGaps).toBe(1);
    expect(k.pathLength_cm).toBeCloseTo(cm(40), 9);
    expect(k.trackedTime_s).toBeCloseTo(4 / 30, 12);
  });
});

describe('speed under irregular timing (O11)', () => {
  it('skips a duplicate-stamp frame inside the speed window and counts the pair', () => {
    const t = timebase(5, 30, { duplicatesAt: [2] });
    const p: Parameters = {
      ...noSmoothing,
      kinematics: { ...noSmoothing.kinematics, speedWindowFrames: 1 },
    };
    const k = kin(
      [
        [cx, cy],
        [cx + 10, cy],
        [cx + 10, cy + 50],
        [cx + 20, cy],
        [cx + 30, cy],
      ],
      t,
      p,
    );
    expect(k.duplicateStampPairs).toBe(1);
    // window of frame 2 is frames 1–3; frame 2 carries frame 1's stamp and is skipped: 10 px over 1/30 s
    expect(k.speed_cmPerS[2]).toBeCloseTo(cm(10) * 30, 9);
    // raw path still walks through the duplicate frame's position
    expect(k.pathLength_cm).toBeCloseTo(cm(10 + 50 + Math.hypot(10, 50) + 10), 9);
  });

  it('measures speed over the centred window using the frames own timestamps', () => {
    const t = timebase(7, 30, { dropsAt: [4] });
    const k = kin(
      [
        [cx, cy],
        [cx + 3, cy],
        [cx + 6, cy],
        [cx + 9, cy],
        [cx + 15, cy],
        [cx + 18, cy],
        [cx + 21, cy],
      ],
      t,
      noSmoothing,
    );
    // frame 3: frames 1–5 span 3 + 3 + 6 + 3 = 15 px over t[5] − t[1] = 5/30 s
    expect(k.speed_cmPerS[3]).toBeCloseTo(cm(15) / (5 / 30), 9);
    // frame 0: frames 0–2, 6 px over 2/30 s
    expect(k.speed_cmPerS[0]).toBeCloseTo(cm(6) / (2 / 30), 9);
  });

  it('has no speed for an isolated positioned frame', () => {
    const k = kin([null, [cx, cy], null], undefined, noSmoothing);
    expect(Number.isNaN(k.speed_cmPerS[1]!)).toBe(true);
    expect(k.trackedTime_s).toBe(0);
    expect(Number.isNaN(k.meanSpeed_cmPerS)).toBe(true);
  });
});

describe('target quadrant time (O6)', () => {
  it('sums the time of positioned frames inside the sector, as seconds and as a fraction of tracked time', () => {
    const angle = (g.sector.centreAngleDeg * Math.PI) / 180;
    const inside: FrameInput = [cx + 100 * Math.cos(angle), cy + 100 * Math.sin(angle)];
    const outside: FrameInput = [cx - 100 * Math.cos(angle), cy - 100 * Math.sin(angle)];
    const k = kin([inside, inside, inside, outside, outside, outside]);
    // frame-holding: pairs (0,1), (1,2), (2,3) start inside → 3/30 s of 5/30 s tracked
    expect(k.targetQuadrantTime_s).toBeCloseTo(3 / 30, 12);
    expect(k.targetQuadrantFraction).toBeCloseTo(0.6, 12);
  });
});

describe('the trial window', () => {
  it('ignores frames after the trial end (time after escape) and before the start', () => {
    const k = kin(
      [
        [cx, cy],
        [cx + 10, cy],
        [cx + 20, cy],
        [cx + 30, cy],
        [cx + 40, cy],
      ],
      undefined,
      DEFAULT_PARAMETERS,
      { startFrame: 1, endFrame: 3 },
    );
    expect(k.pathLength_cm).toBeCloseTo(cm(20), 9);
    expect(k.trackedTime_s).toBeCloseTo(2 / 30, 12);
    expect(Number.isNaN(k.speed_cmPerS[0]!)).toBe(true);
    expect(Number.isNaN(k.speed_cmPerS[4]!)).toBe(true);
    expect(Number.isNaN(k.smoothedX[4]!)).toBe(true);
  });

  it('is all NaN without a trial', () => {
    const frames = buildTrack([
      [cx, cy],
      [cx + 1, cy],
    ]);
    const k = computeKinematics(buildTrackArrays(frames, g), g, DEFAULT_PARAMETERS, null);
    expect(Number.isNaN(k.pathLength_cm)).toBe(true);
    expect(Number.isNaN(k.meanSpeed_cmPerS)).toBe(true);
    expect(k.trackedTime_s).toBe(0);
    expect(Array.from(k.speed_cmPerS).every(Number.isNaN)).toBe(true);
  });

  it('smoothPositions leaves the half-window at each run end raw', () => {
    const frames = buildTrack([
      [0, 0],
      [10, 9],
      [20, 0],
      [30, 9],
      [40, 0],
    ]);
    const s = smoothPositions(buildTrackArrays(frames, g), { startFrame: 0, endFrame: 4 }, 3);
    expect(Array.from(s.y)).toEqual([0, 0, 9, 0, 0]);
    expect(Array.from(s.x)).toEqual([0, 10, 20, 30, 40]);
  });
});
