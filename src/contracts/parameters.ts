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
  /** D6 · the tracking pass (background, threshold, blob selection, nose). */
  tracking: TrackingParameters;
}

/** Inclusive range of frame indices (presentation order, D7). */
export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export type ThresholdMode = 'otsu' | 'manual';

/**
 * Every threshold of the D6 tracking pass. Spatial values are centimetres
 * and converted per video with the platform calibration (D14); defaults and
 * one-line definitions live in `src/analysis/tracker/params.ts`.
 */
export interface TrackingParameters {
  /** Frames sampled uniformly across the video for the median background. */
  backgroundSampleCount: number;
  /** Frame ranges never used as background samples (e.g. a stationary animal). */
  backgroundExcludeRanges: FrameRange[];
  /** Platform disc grown outward by this margin; foreground is searched inside the grown disc, cm. */
  platformMaskMargin_cm: number;
  threshold: {
    mode: ThresholdMode;
    /** Smallest background-minus-frame difference (0–255) counted as foreground when `mode` is `manual`. */
    manualValue: number;
  };
  /** Components below this area are ignored, cm². */
  minBlobArea_cm2: number;
  /** Components above this area are never the animal, cm². */
  maxBlobArea_cm2: number;
  /** Expected body area, cm²; `null` learns it from the video's unambiguous frames (D29 seeds it from the first tracked video). */
  expectedBlobArea_cm2: number | null;
  /** A component larger than this multiple of the expected area marks the frame ambiguous (hand, start cylinder). */
  oversizedBlobFactor: number;
  /** A blob smaller than this fraction of the expected area is low confidence (`small_blob`). */
  smallBlobFactor: number;
  /** Radius of the disc structuring element of the opening that strips the tail, cm. */
  tailOpeningRadius_cm: number;
  /** Half-width of the centred velocity window used as a nose cue, frames. */
  noseCueWindowFrames: number;
  /** Below this centroid speed the velocity cue is unavailable and the hole cue may apply, cm/s. */
  noseMovingSpeed_cmPerS: number;
  /** A blob within this distance of the mask edge is `partial_at_rim`, cm. */
  rimContactMargin_cm: number;
  /** With several plausible blobs, the one within this distance of the previous position is kept, cm. */
  proximityRadius_cm: number;
}

/** Hash of a `Parameters` value, used to key the auto layer and stamp exports. */
export type ParametersHash = string;
