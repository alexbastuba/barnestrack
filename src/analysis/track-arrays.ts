/**
 * A track as parallel typed arrays, built once per derive run and read by
 * every hot loop (D22: 5,539 frames must derive in well under 50 ms, so no
 * per-frame objects after this point). Coordinates of invalid points are
 * carried as stored but must never be read: check `cValid` / `nValid` first.
 */
import type { DetectionState, TrackFrame } from '../contracts/track.js';
import { inPlatform, type MazeGeometry } from './geometry.js';

export const STATE_CODE: Record<DetectionState, number> = {
  tracked: 0,
  not_detected: 1,
  ambiguous: 2,
  low_confidence: 3,
};

export const STATE_BY_CODE: readonly DetectionState[] = [
  'tracked',
  'not_detected',
  'ambiguous',
  'low_confidence',
];

export interface TrackArrays {
  length: number;
  t: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  /** `noseHeadingConfidence` per frame. */
  noseConf: Float64Array;
  blobArea: Float64Array;
  /** 1 when the centroid / nose is valid. */
  cValid: Uint8Array;
  nValid: Uint8Array;
  /** 1 when the centroid / nose has `source: 'corrected'`. */
  cCorrected: Uint8Array;
  nCorrected: Uint8Array;
  /** `STATE_CODE[detectionState]`. */
  state: Uint8Array;
  /** 1 when the centroid is valid and inside the platform circle. */
  inPlatform: Uint8Array;
  /** Median of the positive timestamp differences over the whole track; NaN with fewer than two distinct stamps. */
  nominalDt_s: number;
}

/** Median of the positive consecutive differences of `t` (the nominal frame interval, O11). */
export function nominalDt(t: Float64Array): number {
  const diffs: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const d = t[i]! - t[i - 1]!;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return Number.NaN;
  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  return diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
}

export function buildTrackArrays(
  frames: readonly TrackFrame[],
  geometry: MazeGeometry,
): TrackArrays {
  const n = frames.length;
  const t = new Float64Array(n);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const noseConf = new Float64Array(n);
  const blobArea = new Float64Array(n);
  const cValid = new Uint8Array(n);
  const nValid = new Uint8Array(n);
  const cCorrected = new Uint8Array(n);
  const nCorrected = new Uint8Array(n);
  const state = new Uint8Array(n);
  const onPlatform = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = frames[i]!;
    t[i] = f.t_s;
    cx[i] = f.centroid.x;
    cy[i] = f.centroid.y;
    nx[i] = f.nose.x;
    ny[i] = f.nose.y;
    noseConf[i] = f.noseHeadingConfidence;
    blobArea[i] = f.blobArea_px2;
    cValid[i] = f.centroid.valid ? 1 : 0;
    nValid[i] = f.nose.valid ? 1 : 0;
    cCorrected[i] = f.centroid.source === 'corrected' ? 1 : 0;
    nCorrected[i] = f.nose.source === 'corrected' ? 1 : 0;
    state[i] = STATE_CODE[f.detectionState];
    onPlatform[i] = f.centroid.valid && inPlatform(geometry, f.centroid.x, f.centroid.y) ? 1 : 0;
  }
  return {
    length: n,
    t,
    cx,
    cy,
    nx,
    ny,
    noseConf,
    blobArea,
    cValid,
    nValid,
    cCorrected,
    nCorrected,
    state,
    inPlatform: onPlatform,
    nominalDt_s: nominalDt(t),
  };
}
