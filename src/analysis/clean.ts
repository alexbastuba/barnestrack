/**
 * Derived-layer cleaning (D16, D31): O17 outlier marking, then O10 gap
 * filling. Both are shown, counted and reversible — the automatic track is
 * never touched, and a point is never replaced: an outlier keeps its
 * coordinates behind `valid: false`, and a filled point is a new point with
 * `source: 'filled'`. Smoothing (O9) is not done here; it lives inside
 * kinematics and never reaches the stored track.
 */
import type { Parameters } from '../contracts/parameters.js';
import type { TrackFrame } from '../contracts/track.js';
import { nearestHoleIndex, distanceToHole_px, type MazeGeometry } from './geometry.js';
import type { TrackArrays } from './track-arrays.js';

/** Derived-layer reason of an O17 outlier frame (state `ambiguous`, both points invalid, coordinates kept). */
export const OUTLIER_REASON = 'outlier_velocity';

export interface GapRun {
  startFrame: number;
  endFrame: number;
  frames: number;
  /** Time between the positioned frames either side of the gap, seconds; NaN when unbounded. */
  durationSeconds: number;
}

export type UnfilledGapReason =
  'disabled' | 'unbounded' | 'touches_outlier' | 'corrected' | 'too_long' | 'hole_adjacent';

export interface UnfilledGap extends GapRun {
  reason: UnfilledGapReason;
}

export interface CleaningReport {
  filledFrames: number;
  outlierFrames: number;
  filledGaps: GapRun[];
  unfilledGaps: UnfilledGap[];
  outlierFrameIndices: number[];
}

export interface CleanedTrack {
  track: TrackFrame[];
  report: CleaningReport;
}

/**
 * O17: a positioned frame whose centroid moved faster than the threshold from
 * the previous positioned frame (outliers included as references, so a step
 * marks one frame and a spike marks two, and nothing cascades). Pairs closer
 * in time than the duplicate-stamp fraction are not tested. Hand-corrected
 * points are never outliers.
 */
export function findOutliers(
  a: TrackArrays,
  geometry: MazeGeometry,
  parameters: Parameters,
): Uint8Array {
  const outlier = new Uint8Array(a.length);
  const nominal = a.nominalDt_s;
  if (!Number.isFinite(nominal)) return outlier;
  const minDt = parameters.kinematics.duplicateTimestampFactor * nominal;
  const threshold_pxPerS = parameters.outlierVelocityThreshold_cmPerS * geometry.pxPerCm;
  let ref = -1;
  for (let i = 0; i < a.length; i++) {
    if (a.cValid[i] === 0) continue;
    if (ref >= 0 && a.cCorrected[i] === 0) {
      const dt = a.t[i]! - a.t[ref]!;
      if (dt >= minDt && dt > 0) {
        const speed = Math.hypot(a.cx[i]! - a.cx[ref]!, a.cy[i]! - a.cy[ref]!) / dt;
        if (speed > threshold_pxPerS) outlier[i] = 1;
      }
    }
    ref = i;
  }
  return outlier;
}

function nearHole(a: TrackArrays, g: MazeGeometry, i: number): boolean {
  const x = a.cx[i]!;
  const y = a.cy[i]!;
  const k = nearestHoleIndex(g, x, y);
  return distanceToHole_px(g, x, y, k) <= g.fillExclusionRadius_px;
}

export function cleanTrack(
  frames: readonly TrackFrame[],
  a: TrackArrays,
  geometry: MazeGeometry,
  parameters: Parameters,
): CleanedTrack {
  const n = frames.length;
  const outlier = findOutliers(a, geometry, parameters);
  const out: TrackFrame[] = new Array<TrackFrame>(n);
  const outlierFrameIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = frames[i]!;
    if (outlier[i] === 1) {
      outlierFrameIndices.push(f.frameIndex);
      out[i] = {
        ...f,
        centroid: { ...f.centroid, valid: false },
        nose: { ...f.nose, valid: false },
        detectionState: 'ambiguous',
        reason: OUTLIER_REASON,
      };
    } else {
      out[i] = f;
    }
  }

  const filledGaps: GapRun[] = [];
  const unfilledGaps: UnfilledGap[] = [];
  let filledFrames = 0;
  const gap = parameters.gapFilling;
  let i = 0;
  while (i < n) {
    if (a.cValid[i] === 1) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && a.cValid[i] === 0) i++;
    const end = i - 1;
    const before = start - 1;
    const after = end + 1;
    const bounded = before >= 0 && after < n;
    const run: GapRun = {
      startFrame: frames[start]!.frameIndex,
      endFrame: frames[end]!.frameIndex,
      frames: end - start + 1,
      durationSeconds: bounded ? a.t[after]! - a.t[before]! : Number.NaN,
    };
    let reason: UnfilledGapReason | null = null;
    if (!gap.enabled) reason = 'disabled';
    else if (!bounded) reason = 'unbounded';
    else if (outlier[before] === 1 || outlier[after] === 1) reason = 'touches_outlier';
    else {
      for (let j = start; j <= end; j++) {
        if (a.cCorrected[j] === 1) {
          reason = 'corrected';
          break;
        }
      }
      if (reason === null && run.durationSeconds > gap.maxDuration_s) reason = 'too_long';
      else if (reason === null && (nearHole(a, geometry, before) || nearHole(a, geometry, after)))
        reason = 'hole_adjacent';
    }
    if (reason !== null) {
      unfilledGaps.push({ ...run, reason });
      continue;
    }
    const t0 = a.t[before]!;
    const t1 = a.t[after]!;
    const span = t1 - t0;
    const confidence = Math.min(
      frames[before]!.centroid.confidence,
      frames[after]!.centroid.confidence,
    );
    for (let j = start; j <= end; j++) {
      const s = span > 0 ? (a.t[j]! - t0) / span : 0.5;
      out[j] = {
        ...frames[j]!,
        centroid: {
          x: a.cx[before]! + s * (a.cx[after]! - a.cx[before]!),
          y: a.cy[before]! + s * (a.cy[after]! - a.cy[before]!),
          confidence,
          valid: true,
          source: 'filled',
        },
      };
    }
    filledFrames += run.frames;
    filledGaps.push(run);
  }

  return {
    track: out,
    report: {
      filledFrames,
      outlierFrames: outlierFrameIndices.length,
      filledGaps,
      unfilledGaps,
      outlierFrameIndices,
    },
  };
}
