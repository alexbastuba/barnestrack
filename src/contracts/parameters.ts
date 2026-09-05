/**
 * Every threshold that defines an event or a cleaning step, as one type.
 * Defaults live in a single configuration module (chunk 5) — never inline
 * in analysis code — and this shape is what gets hashed into
 * `parametersHash` and embedded in every export. O1, O2, O4–O6, O9–O11,
 * O16, O17.
 */
export interface Parameters {
  /** O1 · hole investigation. */
  holeInvestigation: {
    /** Multiple of hole radius counted as "at the hole". */
    radiusFactor: number;
    minDuration_s: number;
    /** Bouts at the same hole closer together than this merge into one investigation. */
    mergeGap_s: number;
  };
  /** O4 · escape-box entry. */
  escapeEntry: {
    radiusFactor: number;
    minDuration_s: number;
    /** A loss persisting this long (or to end of video) ends the trial. */
    persistCutoff_s: number;
  };
  /** O5 · trial cutoff, seconds. */
  trialCutoff_s: number;
  /** O6 · target quadrant, in hole-ring units either side of the target. */
  targetQuadrant: {
    holeSpan: number;
  };
  /** O9 · path length / speed smoothing window, frames. */
  kinematicsSmoothingWindowFrames: number;
  /** O10 · gap filling. */
  gapFilling: {
    enabled: boolean;
    maxDuration_s: number;
  };
  /** O11 · irregular frame timing. */
  kinematics: {
    speedWindowFrames: number;
    /** Below this fraction of nominal Δt, treat as a duplicate timestamp and skip for speed. */
    duplicateTimestampFactor: number;
    /** Above this fraction of nominal Δt, flag as a dropped-frame gap. */
    dropGapFactor: number;
  };
  /** O16 · nose-heading confidence below which events fall back to the centroid. */
  noseConfidenceCutoff: number;
  /** O17 · centroid velocity jump marking a frame invalid for kinematics, cm/s. */
  outlierVelocityThreshold_cmPerS: number;
}

/** Hash of a `Parameters` value, used to key the auto layer and stamp exports. */
export type ParametersHash = string;
