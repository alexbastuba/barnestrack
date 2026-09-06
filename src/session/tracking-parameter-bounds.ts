/**
 * The admissible range of every numeric tracking parameter, in one place.
 *
 * These are not presentation: a value typed outside its bounds is clamped, and
 * the clamped value is what the pass runs with and what gets hashed into the
 * automatic layer (D51). A number that decides an outcome must not be buried
 * in a form handler, so it lives here beside its reason.
 *
 * These belong next to `DEFAULT_TRACKING_PARAMETERS` and
 * `TRACKING_PARAMETER_DEFINITIONS` in `src/analysis/tracker/params.ts`, which
 * is the configuration module for the tracking pass. They are here instead
 * only because chunk 4 does not own `src/analysis/`; chunk 5, which owns the
 * configuration module, should fold them in and delete this file.
 */
import type { TrackingParameters } from '../contracts/parameters.js';

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
