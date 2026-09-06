/**
 * Tracking parameters (D6): defaults and the one-line definition the UI shows
 * verbatim next to each control. Spatial values are centimetres, converted per
 * video in `calibration.ts` and nowhere else (D14). The shape is part of the
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
  noseMovingSpeed_cmPerS: 2,
  rimContactMargin_cm: 1.0,
  proximityRadius_cm: 6,
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
    'Centroid speed below which the animal counts as stationary: the velocity cue is unavailable and the hole-proximity cue may apply (cm/s).',
  rimContactMargin_cm:
    'A blob with any pixel within this distance of the platform edge, or beyond it, is low_confidence / partial_at_rim (cm).',
  proximityRadius_cm:
    'With several plausible blobs, the frame is tracked only if exactly one lies within this distance of the last valid centroid (cm).',
};

/**
 * Fixed model constants of the tracker, with definitions. Not user-adjustable
 * (changing one is a tracker version change), but visible and documented so
 * no number is buried in code.
 */
export const CONFIDENCE_MODEL = {
  /** Body-axis cue agreement: a cue counts only when |cos(angle between body axis and cue direction)| is at least this. */
  noseCueMinCos: 0.5,
  /** The tail cue needs at least this many pixels removed by the opening. */
  noseTailMinPixels: 4,
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
  /** Largest components recorded per frame; smaller ones are counted only. */
  maxCandidatesPerFrame: 8,
  /** Background contamination: a dark blob at least this multiple of the median dark-blob area (≈ one hole) is warned about. */
  contaminationAreaFactor: 1.5,
  /** Background contamination: a mouse-sized dark blob with major ÷ minor axis at least this is warned about. */
  contaminationElongation: 1.8,
} as const;

export const CONFIDENCE_MODEL_DEFINITIONS: Record<keyof typeof CONFIDENCE_MODEL, string> = {
  noseCueMinCos:
    'A head-direction cue is used only when the angle between it and the body axis is within acos(this) (0.5 → 60°).',
  noseTailMinPixels: 'Fewer removed pixels than this and there is no tail cue.',
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
  maxCandidatesPerFrame: 'Per-frame cap on recorded candidate components (largest first).',
  contaminationAreaFactor:
    'Background check: dark blob area ÷ median dark blob area at or above this is a stationary object or animal, not a hole.',
  contaminationElongation:
    'Background check: a mouse-sized dark blob this elongated is a stationary animal, not a hole.',
};

/**
 * Constants of the dev-only platform estimator (`scripts/`), kept here so the
 * harness has no numbers of its own.
 */
export const PLATFORM_ESTIMATE_MODEL = {
  /** Only bright-region boundary pixels farther than this fraction of the area radius from the centre are rim points (excludes hole rims). */
  boundaryFraction: 0.8,
  /** Rim points farther than this from the fitted circle are dropped before the refit (px). */
  outlierResidual_px: 3,
} as const;

export const PLATFORM_ESTIMATE_MODEL_DEFINITIONS: Record<
  keyof typeof PLATFORM_ESTIMATE_MODEL,
  string
> = {
  boundaryFraction:
    'Fraction of the first-pass radius beyond which boundary pixels are taken as rim points.',
  outlierResidual_px:
    'Residual (px) beyond which a rim point is excluded from the second circle fit.',
};

export function isFrameExcluded(frameIndex: number, ranges: readonly FrameRange[]): boolean {
  for (const r of ranges) if (frameIndex >= r.startFrame && frameIndex <= r.endFrame) return true;
  return false;
}
