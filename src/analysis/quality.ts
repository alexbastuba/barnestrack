/**
 * The per-video quality report (D30): whether to trust a video before
 * building a figure on it. State fractions, gaps clustered by run length
 * with a location class, the longest gap, the nose-confidence histogram,
 * the timebase anomalies, the calibration, the parameters hash and a
 * GOOD / REVIEW / POOR tier (from the frames the tracker positioned — tracked or
 * low confidence — never from filled frames).
 *
 * Scope: the trial window when a trial start exists, the whole video
 * otherwise — an empty platform before the animal is placed is a property of
 * the recording, not of the tracking, and must not count against the video.
 * The timebase anomalies are properties of the file and are always counted
 * over the whole video, from the frame timestamps with the session's O11
 * factors (the MP4 index counts exact ties with its own factor).
 */
import type { Parameters } from '../contracts/parameters.js';
import type {
  GapLocationClass,
  GapRecord,
  HistogramBin,
  QualityReport,
  QualityTier,
  TimebaseAnomalies,
} from '../contracts/quality.js';
import type { DetectionState, TrackFrame } from '../contracts/track.js';
import type { TimebaseAnomalies as Mp4TimebaseAnomalies } from '../video/mp4-index.js';
import {
  distanceFromCentre_px,
  distanceToHole_px,
  nearestHoleIndex,
  type MazeGeometry,
} from './geometry.js';
import { ANALYSIS_MODEL } from './parameters.js';
import { STATE_BY_CODE, STATE_CODE, type TrackArrays } from './track-arrays.js';
import type { TrialBounds } from './trial.js';

export interface QualityInput {
  videoId: string;
  /** The corrected track before cleaning: gaps as the tracker (and the user) left them. */
  corrected: TrackArrays;
  /** The cleaned track: states after outlier marking, positions after filling. */
  cleaned: TrackArrays;
  /** The cleaned frames, for frame identity (D7). */
  frames: readonly TrackFrame[];
  g: MazeGeometry;
  p: Parameters;
  parametersHash: string;
  bounds: TrialBounds;
  /** The MP4 index's own anomaly record, when the video is attached; only its drift is used. */
  indexTimebase?: Mp4TimebaseAnomalies | null;
}

/** Duplicate and dropped-frame counts from the timestamps under the O11 factors; drift from the index when known. */
export function timebaseAnomalies(
  a: TrackArrays,
  p: Parameters,
  index?: Mp4TimebaseAnomalies | null,
): TimebaseAnomalies {
  const nominal = a.nominalDt_s;
  let duplicateTimestampCount = 0;
  let droppedFrameGapCount = 0;
  if (Number.isFinite(nominal)) {
    const dupBelow = p.kinematics.duplicateTimestampFactor * nominal;
    const dropAbove = p.kinematics.dropGapFactor * nominal;
    for (let i = 1; i < a.length; i++) {
      const dt = a.t[i]! - a.t[i - 1]!;
      if (dt < dupBelow) duplicateTimestampCount++;
      else if (dt > dropAbove) droppedFrameGapCount++;
    }
  }
  const driftSeconds =
    index && Number.isFinite(index.driftSeconds)
      ? index.driftSeconds
      : a.length > 1 && Number.isFinite(nominal)
        ? a.t[a.length - 1]! - a.t[0]! - (a.length - 1) * nominal
        : 0;
  return { duplicateTimestampCount, droppedFrameGapCount, driftSeconds };
}

function locationClass(
  a: TrackArrays,
  g: MazeGeometry,
  reference: number,
): { locationClass: GapLocationClass; holeIndex?: number } {
  const x = a.cx[reference]!;
  const y = a.cy[reference]!;
  const k = nearestHoleIndex(g, x, y);
  if (distanceToHole_px(g, x, y, k) <= g.investigationRadius_px)
    return { locationClass: 'hole', holeIndex: k };
  if (distanceFromCentre_px(g, x, y) > g.ringRadius_px) return { locationClass: 'rim' };
  return { locationClass: 'open_platform' };
}

/** Runs of unpositioned frames in [from, to], classed by where the animal was last (or next) seen; frame numbers are `frameIndex` (D7). */
export function findGaps(
  a: TrackArrays,
  frames: readonly TrackFrame[],
  g: MazeGeometry,
  from: number,
  to: number,
): GapRecord[] {
  const gaps: GapRecord[] = [];
  let i = from;
  while (i <= to) {
    if (a.cValid[i] === 1) {
      i++;
      continue;
    }
    const start = i;
    while (i <= to && a.cValid[i] === 0) i++;
    const end = i - 1;
    let reference = -1;
    for (let j = start - 1; j >= 0; j--) {
      if (a.cValid[j] === 1) {
        reference = j;
        break;
      }
    }
    if (reference < 0) {
      for (let j = end + 1; j < a.length; j++) {
        if (a.cValid[j] === 1) {
          reference = j;
          break;
        }
      }
    }
    const before = Math.max(0, start - 1);
    const after = Math.min(a.length - 1, end + 1);
    const where =
      reference >= 0 ? locationClass(a, g, reference) : { locationClass: 'open_platform' as const };
    gaps.push({
      startFrame: frames[start]!.frameIndex,
      endFrame: frames[end]!.frameIndex,
      durationSeconds: a.t[after]! - a.t[before]!,
      locationClass: where.locationClass,
      ...(where.holeIndex === undefined ? {} : { holeIndex: where.holeIndex }),
    });
  }
  return gaps;
}

export function noseConfidenceHistogram(
  a: TrackArrays,
  from: number,
  to: number,
  bins = ANALYSIS_MODEL.noseConfidenceHistogramBins,
): HistogramBin[] {
  const counts = new Array<number>(bins).fill(0);
  for (let i = from; i <= to; i++) {
    if (a.cValid[i] === 0) continue;
    const c = Math.min(1, Math.max(0, a.noseConf[i]!));
    counts[Math.min(bins - 1, Math.floor(c * bins))]!++;
  }
  return counts.map((count, b) => ({ min: b / bins, max: (b + 1) / bins, count }));
}

/** The D30 tier from the positioned fraction and the two `Parameters.quality` thresholds (D55). */
export function qualityTier(
  positionedFraction: number,
  thresholds: Parameters['quality'],
): QualityTier {
  if (!Number.isFinite(positionedFraction)) return 'POOR';
  if (positionedFraction >= thresholds.goodMinPositionedFraction) return 'GOOD';
  if (positionedFraction < thresholds.poorMaxPositionedFraction) return 'POOR';
  return 'REVIEW';
}

export function qualityReport(input: QualityInput): QualityReport {
  const { videoId, corrected, cleaned, frames, g, p, parametersHash, bounds } = input;
  const n = cleaned.length;
  const hasTrial = bounds.startFrame !== null && bounds.endFrame !== null;
  const from = hasTrial ? bounds.startFrame! : 0;
  const to = hasTrial ? bounds.endFrame! : n - 1;
  const count = Math.max(0, to - from + 1);

  // the tier counts frames the tracker positioned (tracked or low confidence); a filled frame is an
  // interpolation and must not raise the trust in a video (D16, D31)
  const stateCounts = [0, 0, 0, 0];
  let positioned = 0;
  for (let i = from; i <= to; i++) {
    const state = cleaned.state[i]!;
    stateCounts[state]!++;
    if (state === STATE_CODE.tracked || state === STATE_CODE.low_confidence) positioned++;
  }
  const fraction = (c: number): number => (count > 0 ? c / count : Number.NaN);
  const detectionStateFractions = {} as Record<DetectionState, number>;
  for (let code = 0; code < STATE_BY_CODE.length; code++) {
    detectionStateFractions[STATE_BY_CODE[code]!] = fraction(stateCounts[code]!);
  }

  const gaps = count > 0 ? findGaps(corrected, frames, g, from, to) : [];
  let longestGapSeconds = 0;
  for (const gap of gaps) longestGapSeconds = Math.max(longestGapSeconds, gap.durationSeconds);

  return {
    videoId,
    detectionStateFractions,
    gaps,
    longestGapSeconds,
    noseConfidenceHistogram:
      count > 0
        ? noseConfidenceHistogram(cleaned, from, to)
        : noseConfidenceHistogram(cleaned, 0, -1),
    timebaseAnomalies: timebaseAnomalies(cleaned, p, input.indexTimebase),
    platformDiameter_cm: g.platformDiameter_cm,
    pxPerCm: g.pxPerCm,
    parametersHash,
    tier: qualityTier(fraction(positioned), p.quality),
  };
}
