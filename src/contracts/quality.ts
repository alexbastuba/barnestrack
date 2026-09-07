/**
 * Per-video quality report: whether to trust a video before building a
 * figure on it. D30.
 */
import type { DetectionState, FrameIndex } from './track.js';
import type { ParametersHash } from './parameters.js';

export type GapLocationClass = 'hole' | 'open_platform' | 'rim';

export interface GapRecord {
  startFrame: FrameIndex;
  endFrame: FrameIndex;
  durationSeconds: number;
  locationClass: GapLocationClass;
  holeIndex?: number;
}

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

export interface TimebaseAnomalies {
  duplicateTimestampCount: number;
  droppedFrameGapCount: number;
  /** Seconds of drift versus nominal-rate arithmetic by the end of the clip. D7. */
  driftSeconds: number;
}

export type QualityTier = 'GOOD' | 'REVIEW' | 'POOR';

export interface QualityReport {
  videoId: string;
  /** Over the trial window when a trial start exists, else the whole clip (D54). */
  detectionStateFractions: Record<DetectionState, number>;
  /**
   * The headline: the fraction of trial-window frames the tracker positioned
   * (`tracked` or `low_confidence`; filled frames never count), which is what
   * the tier is judged on (D30, D54).
   */
  positionedFraction: number;
  /** The same fraction over the whole clip, shown as a secondary number (D54). */
  wholeClipPositionedFraction: number;
  gaps: readonly GapRecord[];
  longestGapSeconds: number;
  noseConfidenceHistogram: readonly HistogramBin[];
  /**
   * Fraction of the investigations and escape entries judged on the nose
   * rather than the centroid (O16, D54). `NaN` — `null` in JSON, never 0 —
   * when the trial has no such event.
   */
  noseJudgedEventFraction: number;
  timebaseAnomalies: TimebaseAnomalies;
  platformDiameter_cm: number;
  /**
   * This video's pixels-per-centimetre, derived from the maze map's platform
   * radius after this video's transform. Calibration lives only in the maze
   * map (D44); this is the one place the derived, per-video value is
   * recorded, alongside `quality.csv`.
   */
  pxPerCm: number;
  parametersHash: ParametersHash;
  tier: QualityTier;
}
