/**
 * Path length, speed and target-quadrant time (O6, O9, O11) over the trial
 * window, from the centroid of every positioned frame (automatic, corrected
 * or filled). The O9 median filter is applied here to a private copy of the
 * positions; the stored track is never smoothed. All timing comes from each
 * frame's own timestamp: duplicate stamps are skipped for speed, dropped-frame
 * gaps are counted, and neither is ever guessed from a nominal frame rate.
 */
import type { Parameters } from '../contracts/parameters.js';
import { inSector, type MazeGeometry } from './geometry.js';
import type { TrackArrays } from './track-arrays.js';

/** Inclusive frame positions of the trial. */
export interface FrameWindow {
  startFrame: number;
  endFrame: number;
}

export interface KinematicsSummary {
  /** Sum of the segments between consecutive positioned frames, raw centroid, cm. */
  pathLength_cm: number;
  /** The same over the median-filtered positions, cm (O9). */
  pathLengthSmoothed_cm: number;
  /** Time covered by consecutive positioned frame pairs, s. */
  trackedTime_s: number;
  /** Trial time not covered by consecutive positioned pairs, s. */
  gapTime_s: number;
  /** `gapTime_s ÷ trial duration`; NaN for an empty trial. */
  gapFraction: number;
  /** `pathLengthSmoothed_cm ÷ trackedTime_s`; NaN with no tracked time (O9). */
  meanSpeed_cmPerS: number;
  targetQuadrantTime_s: number;
  /** `targetQuadrantTime_s ÷ trackedTime_s`; NaN with no tracked time (O6). */
  targetQuadrantFraction: number;
  /** Speed per frame over the whole track, cm/s; NaN outside the trial or where no window can be formed (O11). */
  speed_cmPerS: Float64Array;
  /** Median-filtered centroid per frame, px; NaN where the frame is not positioned or outside the trial. */
  smoothedX: Float64Array;
  smoothedY: Float64Array;
  /** Consecutive frame pairs inside the trial closer in time than the duplicate fraction (O11). */
  duplicateStampPairs: number;
  /** Consecutive frame pairs inside the trial farther apart than the drop factor (O11). */
  droppedFrameGaps: number;
  nominalDt_s: number;
}

function emptySummary(a: TrackArrays): KinematicsSummary {
  const nan = (): Float64Array => new Float64Array(a.length).fill(Number.NaN);
  return {
    pathLength_cm: Number.NaN,
    pathLengthSmoothed_cm: Number.NaN,
    trackedTime_s: 0,
    gapTime_s: Number.NaN,
    gapFraction: Number.NaN,
    meanSpeed_cmPerS: Number.NaN,
    targetQuadrantTime_s: Number.NaN,
    targetQuadrantFraction: Number.NaN,
    speed_cmPerS: nan(),
    smoothedX: nan(),
    smoothedY: nan(),
    duplicateStampPairs: 0,
    droppedFrameGaps: 0,
    nominalDt_s: a.nominalDt_s,
  };
}

function median(values: Float64Array, count: number): number {
  const sorted = values.subarray(0, count).slice().sort();
  const mid = count >> 1;
  return count % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * O9 median filter over each run of consecutive positioned frames inside the
 * window. Frames without a full window on both sides (the first and last
 * half-window frames of a run) keep their raw position, so run endpoints are
 * exact.
 */
export function smoothPositions(
  a: TrackArrays,
  window: FrameWindow,
  windowFrames: number,
): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(a.length).fill(Number.NaN);
  const y = new Float64Array(a.length).fill(Number.NaN);
  const half = Math.max(0, Math.floor(windowFrames / 2));
  const scratchX = new Float64Array(2 * half + 1);
  const scratchY = new Float64Array(2 * half + 1);
  let i = window.startFrame;
  while (i <= window.endFrame) {
    if (a.cValid[i] === 0) {
      i++;
      continue;
    }
    const runStart = i;
    while (i <= window.endFrame && a.cValid[i] === 1) i++;
    const runEnd = i - 1;
    for (let j = runStart; j <= runEnd; j++) {
      if (half === 0 || j - half < runStart || j + half > runEnd) {
        x[j] = a.cx[j]!;
        y[j] = a.cy[j]!;
        continue;
      }
      let count = 0;
      for (let k = j - half; k <= j + half; k++) {
        scratchX[count] = a.cx[k]!;
        scratchY[count] = a.cy[k]!;
        count++;
      }
      x[j] = median(scratchX, count);
      y[j] = median(scratchY, count);
    }
  }
  return { x, y };
}

export function computeKinematics(
  a: TrackArrays,
  g: MazeGeometry,
  p: Parameters,
  window: FrameWindow | null,
): KinematicsSummary {
  if (window === null || a.length === 0 || window.endFrame < window.startFrame)
    return emptySummary(a);
  const { startFrame: s, endFrame: e } = window;
  const nominal = a.nominalDt_s;
  const dupBelow = Number.isFinite(nominal) ? p.kinematics.duplicateTimestampFactor * nominal : 0;
  const dropAbove = Number.isFinite(nominal)
    ? p.kinematics.dropGapFactor * nominal
    : Number.POSITIVE_INFINITY;
  const smoothed = smoothPositions(a, window, p.kinematicsSmoothingWindowFrames);

  let pathRaw = 0;
  let pathSmoothed = 0;
  let trackedTime = 0;
  let quadrantTime = 0;
  let duplicateStampPairs = 0;
  let droppedFrameGaps = 0;
  for (let i = s; i < e; i++) {
    const dt = a.t[i + 1]! - a.t[i]!;
    if (dt < dupBelow) duplicateStampPairs++;
    else if (dt > dropAbove) droppedFrameGaps++;
    if (a.cValid[i] === 1 && a.cValid[i + 1] === 1) {
      pathRaw += Math.hypot(a.cx[i + 1]! - a.cx[i]!, a.cy[i + 1]! - a.cy[i]!);
      pathSmoothed += Math.hypot(
        smoothed.x[i + 1]! - smoothed.x[i]!,
        smoothed.y[i + 1]! - smoothed.y[i]!,
      );
      trackedTime += dt;
      if (inSector(g, a.cx[i]!, a.cy[i]!)) quadrantTime += dt;
    }
  }
  const trialDuration = a.t[e]! - a.t[s]!;
  const gapTime = Math.max(0, trialDuration - trackedTime);

  // Speed per frame over ± speedWindowFrames within the run, duplicate stamps skipped (O11).
  const speed = new Float64Array(a.length).fill(Number.NaN);
  const w = p.kinematics.speedWindowFrames;
  const pxPerCm = g.pxPerCm;
  for (let i = s; i <= e; i++) {
    if (a.cValid[i] === 0) continue;
    let lo = i;
    while (lo > s && lo > i - w && a.cValid[lo - 1] === 1) lo--;
    let hi = i;
    while (hi < e && hi < i + w && a.cValid[hi + 1] === 1) hi++;
    let path = 0;
    let kept = lo;
    let count = 1;
    for (let j = lo + 1; j <= hi; j++) {
      if (a.t[j]! - a.t[j - 1]! < dupBelow) continue;
      path += Math.hypot(smoothed.x[j]! - smoothed.x[kept]!, smoothed.y[j]! - smoothed.y[kept]!);
      kept = j;
      count++;
    }
    const span = a.t[kept]! - a.t[lo]!;
    if (count >= 2 && span > 0) speed[i] = path / pxPerCm / span;
  }

  return {
    pathLength_cm: pathRaw / pxPerCm,
    pathLengthSmoothed_cm: pathSmoothed / pxPerCm,
    trackedTime_s: trackedTime,
    gapTime_s: gapTime,
    gapFraction: trialDuration > 0 ? gapTime / trialDuration : Number.NaN,
    meanSpeed_cmPerS: trackedTime > 0 ? pathSmoothed / pxPerCm / trackedTime : Number.NaN,
    targetQuadrantTime_s: quadrantTime,
    targetQuadrantFraction: trackedTime > 0 ? quadrantTime / trackedTime : Number.NaN,
    speed_cmPerS: speed,
    smoothedX: smoothed.x,
    smoothedY: smoothed.y,
    duplicateStampPairs,
    droppedFrameGaps,
    nominalDt_s: nominal,
  };
}
