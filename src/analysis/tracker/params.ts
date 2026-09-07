/**
 * Tracking parameters (D6): defaults, the one-line definition the UI shows
 * verbatim next to each control, and the admissible range of every numeric
 * field. Spatial values are centimetres, converted per video in
 * `calibration.ts` and nowhere else (D14). The shape is part of the
 * `Parameters` contract (`src/contracts/parameters.ts`) and is hashed into
 * `parametersHash` with everything else.
 *
 * Every other number the tracker uses — cue-agreement cutoffs, confidence
 * weights, contamination heuristics — lives in `CONFIDENCE_MODEL` below with
 * its own definition. Nothing is hard-coded in the pipeline modules.
 */
import type { FrameRange, TrackingParameters } from '../../contracts/parameters.js';

export type { FrameRange, ThresholdMode, TrackingParameters } from '../../contracts/parameters.js';

export const DEFAULT_TRACKING_PARAMETERS: TrackingParameters = {
  backgroundSampleCount: 150,
  backgroundExcludeRanges: [],
  platformMaskMargin_cm: 1.5,
  threshold: { mode: 'otsu', manualValue: 40 },
  minBlobArea_cm2: 4,
  maxBlobArea_cm2: 80,
  expectedBlobArea_cm2: null,
  oversizedBlobFactor: 3,
  smallBlobFactor: 0.5,
  tailOpeningRadius_cm: 0.8,
  noseCueWindowFrames: 3,
  noseMovingSpeed_cmPerS: 8,
  rimContactMargin_cm: 1.0,
  proximityRadius_cm: 6,
  fragmentMergeDistance_cm: 8,
};

/** Shown verbatim in the UI next to each parameter (chunk 4). */
export const TRACKING_PARAMETER_DEFINITIONS: Record<keyof TrackingParameters, string> = {
  backgroundSampleCount:
    'Number of frames, spaced uniformly across the video, whose per-pixel median is the background.',
  backgroundExcludeRanges:
    'Frame ranges never used as background samples, for a stationary animal or object that would otherwise be baked in.',
  platformMaskMargin_cm:
    'Platform disc grown outward by this margin; foreground is searched only inside the grown disc (cm).',
  threshold:
    'Otsu: the threshold is chosen once per video from the background-minus-frame histogram of the sample frames; manual: the given smallest difference (0–255) counted as foreground.',
  minBlobArea_cm2: 'Foreground components smaller than this are ignored (cm²).',
  maxBlobArea_cm2:
    'Foreground components larger than this are never the animal; the frame is ambiguous / oversized_blob (cm²).',
  expectedBlobArea_cm2:
    'Expected body area after the tail is removed (cm²); leave empty to learn it as the median of the video’s unambiguous frames.',
  oversizedBlobFactor:
    'A component larger than this multiple of the expected area marks the frame ambiguous / oversized_blob (hand, start cylinder).',
  smallBlobFactor:
    'A selected blob smaller than this fraction of the expected area is low_confidence / small_blob (head in a hole, partial occlusion).',
  tailOpeningRadius_cm:
    'Radius of the disc used for the morphological opening that strips the tail before the centroid is taken (cm); anything thinner than twice this radius is removed.',
  noseCueWindowFrames:
    'Half-width, in frames, of the centred window over which the centroid velocity is measured as a head-direction cue.',
  noseMovingSpeed_cmPerS:
    'Centroid speed below which the animal counts as stationary: the velocity cue is unavailable and the hole-proximity cue may apply (cm/s). Below walking speed the centroid direction is jitter, not heading.',
  rimContactMargin_cm:
    'A blob with any pixel within this distance of the platform edge, or beyond it, is low_confidence / partial_at_rim (cm).',
  proximityRadius_cm:
    'With several plausible blobs, the frame is tracked only if exactly one lies within this distance of the last valid centroid (cm).',
  fragmentMergeDistance_cm:
    'Foreground pieces whose centroids all lie within this distance of each other are merged into one animal. Default 8 cm, about one mouse body length.',
};

/**
 * The admissible range of a numeric tracking parameter. Not presentation: a
 * value typed outside its bounds is clamped, and the clamped value is what the
 * pass runs with and what gets hashed into the automatic layer (D51), so the
 * range lives here beside the default and the definition, with its reason.
 */
export interface ParameterBound {
  min: number;
  max: number;
  /** Input step; `'1'` means the value is rounded to a whole number. */
  step: string;
  /** Why the range is what it is, for anyone changing it. */
  reason: string;
}

/**
 * Keyed by the numeric fields of `TrackingParameters`. `threshold` and
 * `backgroundExcludeRanges` are compound and carry their own bounds below.
 */
export const TRACKING_PARAMETER_BOUNDS: Record<
  Exclude<keyof TrackingParameters, 'threshold' | 'backgroundExcludeRanges'>,
  ParameterBound
> = {
  backgroundSampleCount: {
    min: 3,
    max: 500,
    step: '1',
    reason: 'A median needs at least three samples; beyond a few hundred it costs time and buys nothing.',
  },
  platformMaskMargin_cm: {
    min: 0,
    max: 20,
    step: '0.1',
    reason: 'A negative margin would shrink the platform; beyond 20 cm the mask stops excluding the surround.',
  },
  minBlobArea_cm2: {
    min: 0.1,
    max: 200,
    step: '0.5',
    reason: 'Zero would admit single-pixel noise as an animal.',
  },
  maxBlobArea_cm2: {
    min: 1,
    max: 1000,
    step: '1',
    reason: 'Above the platform area the rule can never fire.',
  },
  expectedBlobArea_cm2: {
    min: 0.5,
    max: 500,
    step: '0.5',
    reason: 'Empty means "learn it from the video"; a value must still be a plausible body.',
  },
  oversizedBlobFactor: {
    min: 1,
    max: 20,
    step: '0.1',
    reason: 'Below 1 the expected body would itself count as oversized.',
  },
  smallBlobFactor: {
    min: 0.05,
    max: 1,
    step: '0.05',
    reason: 'At 1 every blob is small; at 0 the rule never fires.',
  },
  tailOpeningRadius_cm: {
    min: 0,
    max: 10,
    step: '0.1',
    reason: 'Zero disables the opening; a radius past the body half-width would erase the animal.',
  },
  noseCueWindowFrames: {
    min: 1,
    max: 60,
    step: '1',
    reason: 'A centred window needs at least one frame either side; two seconds of it is no longer a heading.',
  },
  noseMovingSpeed_cmPerS: {
    min: 0,
    max: 100,
    step: '0.5',
    reason: 'Zero treats every frame as moving; a mouse does not exceed a metre a second.',
  },
  rimContactMargin_cm: {
    min: 0,
    max: 20,
    step: '0.1',
    reason: 'Zero flags only blobs past the edge; beyond 20 cm the whole platform is rim.',
  },
  proximityRadius_cm: {
    min: 0.5,
    max: 100,
    step: '0.5',
    reason: 'Zero could never match the previous position; past the platform width it matches everything.',
  },
  fragmentMergeDistance_cm: {
    min: 0,
    max: 100,
    step: '0.5',
    reason: 'Zero disables the D48 merge; beyond a body length or two it would merge two animals.',
  },
};

/** `threshold.manualValue`. The tracker rejects anything outside 1–255. */
export const MANUAL_THRESHOLD_BOUND: ParameterBound = {
  min: 1,
  max: 255,
  step: '1',
  reason:
    'A difference of 0 would call every pixel foreground, and `createTracker` rejects a threshold outside 1–255.',
};

/** Clamps to the bound, rounding to a whole number when the step says so. */
export function clampToBound(value: number, bound: ParameterBound): number {
  const stepped = bound.step === '1' ? Math.round(value) : value;
  return Math.min(bound.max, Math.max(bound.min, stepped));
}

/**
 * Fixed model constants of the tracker, with definitions. Not user-adjustable
 * (changing one is a tracker version change), but visible and documented so
 * no number is buried in code.
 */
export const CONFIDENCE_MODEL = {
  /** Body-axis cue agreement: a cue counts only when |cos(angle between body axis and cue direction)| is at least this. */
  noseCueMinCos: 0.5,
  /** The tail cue needs at least this many pixels removed by the opening; a detached piece needs at least this many pixels to be attached at all. */
  noseTailMinPixels: 4,
  /** A foreground piece with no body of its own is attributed as tail to the one body whose bounding box lies within this × the opening radius of it (the re-encoded tail base often falls below threshold and detaches). */
  tailAttachGapFactor: 2,
  /** A detached piece is attached only when its own second-moment ellipse is at least this elongated (a tail is a line; a shadow is a blob). */
  tailPieceMinElongation: 2.5,
  /** The removed pixels' centroid must lie at least this fraction of the body's major semi-axis from the body centroid to be a tail (rounded edges removed all round are not). */
  noseTailMinOffsetFraction: 0.5,
  /** The hole cue applies when a hole centre lies within this multiple of the hole radius of either axis end. */
  noseHoleRadiusFactor: 1.5,
  /** Area confidence is 1 while |area ÷ expected − 1| ≤ this, falling linearly to 0 at twice it. */
  areaTolerance: 0.5,
  /** Contrast confidence = mean difference inside the blob ÷ (this × threshold), clamped to 1. */
  contrastReference: 2,
  /** Confidence multiplier when the blob was chosen by proximity among several plausible blobs. */
  proximityCandidateFactor: 0.7,
  /** Confidence multiplier when the blob touches the rim zone. */
  rimContactFactor: 0.7,
  /** Confidence multiplier when the blob is the union of fragments (D48). */
  fragmentedFactor: 0.7,
  /** Largest components recorded per frame; smaller ones are counted only. */
  maxCandidatesPerFrame: 8,
  /** Background contamination: a dark blob at least this multiple of the median dark-blob area (≈ one hole) is warned about. */
  contaminationAreaFactor: 1.5,
  /** Background contamination: a dark blob at least hole-sized (≥ the median) and no larger than maxBlobArea with major ÷ minor axis at least this is warned about. */
  contaminationElongation: 1.8,
} as const;

export const CONFIDENCE_MODEL_DEFINITIONS: Record<keyof typeof CONFIDENCE_MODEL, string> = {
  noseCueMinCos:
    'A head-direction cue is used only when the angle between it and the body axis is within acos(this) (0.5 → 60°).',
  noseTailMinPixels:
    'Fewer removed pixels than this and there is no tail cue; a detached piece smaller than this is never attached.',
  tailAttachGapFactor:
    'Detached foreground pieces within this × the opening radius of exactly one body count as that body’s tail.',
  tailPieceMinElongation:
    'Detached pieces are attached as tail only when at least this elongated (major ÷ minor axis).',
  noseTailMinOffsetFraction:
    'Tail cue: the removed pixels’ centroid must be at least this × the major semi-axis away from the body centroid.',
  noseHoleRadiusFactor:
    'Hole cue: the axis end nearer a hole centre within this × hole radius is the head, when stationary and holes are known.',
  areaTolerance: 'Blob-area confidence tolerance around the expected area, as a fraction of it.',
  contrastReference:
    'Blob contrast that earns full confidence, as a multiple of the foreground threshold.',
  proximityCandidateFactor:
    'Confidence multiplier for a blob chosen by proximity to the previous position.',
  rimContactFactor: 'Confidence multiplier for a blob in the rim zone.',
  fragmentedFactor: 'Confidence multiplier for a blob merged from fragments.',
  maxCandidatesPerFrame: 'Per-frame cap on recorded candidate components (largest first).',
  contaminationAreaFactor:
    'Background check: dark blob area ÷ median dark blob area at or above this is a stationary object or animal, not a hole.',
  contaminationElongation:
    'Background check: a dark blob at least hole-sized and this elongated is a stationary animal, not a hole.',
};

/**
 * Constants of the dev-only platform estimator (`scripts/`), kept here so the
 * harness has no numbers of its own.
 */
export const PLATFORM_ESTIMATE_MODEL = {
  /** Angle bins around the first-pass centre; the outermost boundary pixel of each bin is a rim point (hole rims are never outermost). */
  angleBins: 720,
  /** First rejection: rim points with a residual above this multiple of the median absolute residual are dropped. */
  madFactor: 3,
  /** Final rejection: rim points farther than this from the fitted circle are dropped before the last refit (px). */
  outlierResidual_px: 3,
} as const;

export const PLATFORM_ESTIMATE_MODEL_DEFINITIONS: Record<
  keyof typeof PLATFORM_ESTIMATE_MODEL,
  string
> = {
  angleBins:
    'Number of angle bins; each contributes its outermost bright-boundary pixel as a rim point.',
  madFactor: 'Rim points beyond this × the median absolute residual of the first fit are dropped.',
  outlierResidual_px:
    'Residual (px) beyond which a rim point is excluded from the final circle fit.',
};

export function isFrameExcluded(frameIndex: number, ranges: readonly FrameRange[]): boolean {
  for (const r of ranges) if (frameIndex >= r.startFrame && frameIndex <= r.endFrame) return true;
  return false;
}
