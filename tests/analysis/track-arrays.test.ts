import { describe, expect, it } from 'vitest';
import type { TrackFrame } from '../../src/contracts/track.js';
import {
  STATE_BY_CODE,
  STATE_CODE,
  buildTrackArrays,
  nominalDt,
} from '../../src/analysis/track-arrays.js';
import { testGeometry } from './maze-fixture.js';

function frame(over: Partial<TrackFrame> & { i: number }): TrackFrame {
  const { i, ...rest } = over;
  return {
    frameIndex: i,
    t_s: i / 30,
    centroid: { x: 322, y: 240, confidence: 0.9, valid: true, source: 'auto' },
    nose: { x: 330, y: 240, confidence: 0.5, valid: true, source: 'auto' },
    detectionState: 'tracked',
    reason: 'single_blob',
    blobArea_px2: 500,
    boundingBox: null,
    noseHeadingConfidence: 0.5,
    ...rest,
  };
}

describe('nominalDt', () => {
  it('is the median of the positive differences, ignoring duplicates', () => {
    const t = Float64Array.from([0, 1 / 30, 1 / 30, 2 / 30, 4 / 30, 5 / 30, 5 / 30 + 1e-5]);
    // positive diffs: 1/30, 1/30, 2/30, 1/30, 1e-5 → sorted [1e-5, 1/30, 1/30, 1/30, 2/30] → median 1/30
    expect(nominalDt(t)).toBeCloseTo(1 / 30, 12);
    expect(nominalDt(Float64Array.from([0, 0.1, 0.3, 0.6]))).toBeCloseTo(0.2, 12);
  });

  it('is NaN without two distinct stamps', () => {
    expect(nominalDt(new Float64Array(0))).toBeNaN();
    expect(nominalDt(Float64Array.from([3]))).toBeNaN();
    expect(nominalDt(Float64Array.from([3, 3, 3]))).toBeNaN();
  });
});

describe('buildTrackArrays', () => {
  it('copies every field into parallel arrays and codes the states', () => {
    const g = testGeometry();
    const frames = [
      frame({ i: 0 }),
      frame({
        i: 1,
        centroid: { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' },
        nose: { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' },
        detectionState: 'not_detected',
        reason: 'no_foreground',
        blobArea_px2: 0,
        noseHeadingConfidence: 0,
      }),
      frame({
        i: 2,
        centroid: { x: 900, y: 240, confidence: 0.4, valid: true, source: 'corrected' },
        nose: { x: 910, y: 240, confidence: 0.4, valid: true, source: 'corrected' },
        detectionState: 'low_confidence',
        reason: 'partial_at_rim',
        noseHeadingConfidence: 1,
      }),
      frame({ i: 3, detectionState: 'ambiguous', reason: 'multiple_blobs' }),
    ];
    const a = buildTrackArrays(frames, g);
    expect(a.length).toBe(4);
    expect(Array.from(a.t)).toEqual([0, 1 / 30, 2 / 30, 3 / 30]);
    expect(Array.from(a.cx)).toEqual([322, 0, 900, 322]);
    expect(Array.from(a.nx)).toEqual([330, 0, 910, 330]);
    expect(Array.from(a.cValid)).toEqual([1, 0, 1, 1]);
    expect(Array.from(a.nValid)).toEqual([1, 0, 1, 1]);
    expect(Array.from(a.cCorrected)).toEqual([0, 0, 1, 0]);
    expect(Array.from(a.nCorrected)).toEqual([0, 0, 1, 0]);
    expect(Array.from(a.state)).toEqual([0, 1, 3, 2]);
    expect(Array.from(a.inPlatform)).toEqual([1, 0, 0, 1]);
    expect(Array.from(a.noseConf)).toEqual([0.5, 0, 1, 0.5]);
    expect(Array.from(a.blobArea)).toEqual([500, 0, 500, 500]);
    expect(a.nominalDt_s).toBeCloseTo(1 / 30, 12);
    for (const [state, code] of Object.entries(STATE_CODE)) expect(STATE_BY_CODE[code]).toBe(state);
  });
});
