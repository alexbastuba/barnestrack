/**
 * Parameter bounds and the clamp.
 *
 * `clampToBound` decides the value a pass actually runs with and therefore the
 * value that goes into `parametersHash` (D51), so its rounding rule is pinned
 * here. The bounds were written in `src/session/` by chunk 4 and folded into
 * the tracker's configuration module by chunk 6 without changing a value.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACKING_PARAMETERS,
  MANUAL_THRESHOLD_BOUND,
  TRACKING_PARAMETER_BOUNDS,
  clampToBound,
  type ParameterBound,
} from '../../../src/analysis/tracker/params.js';
import type { TrackingParameters } from '../../../src/contracts/parameters.js';

const COUNT = TRACKING_PARAMETER_BOUNDS.backgroundSampleCount;
const AREA = TRACKING_PARAMETER_BOUNDS.minBlobArea_cm2;

describe('clampToBound', () => {
  it('leaves a value inside the bound alone', () => {
    expect(clampToBound(50, COUNT)).toBe(50);
    expect(clampToBound(4.5, AREA)).toBe(4.5);
  });

  it('clamps to each end rather than rejecting', () => {
    expect(clampToBound(-10, COUNT)).toBe(COUNT.min);
    expect(clampToBound(10_000, COUNT)).toBe(COUNT.max);
    expect(clampToBound(0, AREA)).toBe(AREA.min);
  });

  it('rounds to a whole number only where the step says so', () => {
    expect(clampToBound(12.4, COUNT)).toBe(12);
    expect(clampToBound(12.6, COUNT)).toBe(13);
    // Half rounds up, and stays that way: it is part of the hashed value.
    expect(clampToBound(12.5, COUNT)).toBe(13);
    expect(clampToBound(4.25, AREA)).toBe(4.25);
  });

  it('clamps an infinity to the bound rather than passing it through', () => {
    expect(clampToBound(Number.POSITIVE_INFINITY, COUNT)).toBe(COUNT.max);
    expect(clampToBound(Number.NEGATIVE_INFINITY, COUNT)).toBe(COUNT.min);
  });

  it('cannot rescue a NaN, which is why every caller rejects one first', () => {
    // Documented, not desired: Math.min/max propagate NaN. The UI tests
    // Number.isFinite before calling, and this pins the reason it must.
    expect(Number.isNaN(clampToBound(Number.NaN, COUNT))).toBe(true);
  });
});

describe('the bounds themselves', () => {
  const all: [string, ParameterBound][] = [
    ...Object.entries(TRACKING_PARAMETER_BOUNDS),
    ['threshold.manualValue', MANUAL_THRESHOLD_BOUND],
  ];

  it('are ordered and give a reason', () => {
    for (const [name, bound] of all) {
      expect(bound.min, name).toBeLessThan(bound.max);
      expect(bound.reason.length, name).toBeGreaterThan(20);
    }
  });

  it('admit every default, so a fresh session is never silently clamped', () => {
    for (const [key, bound] of Object.entries(TRACKING_PARAMETER_BOUNDS)) {
      const value = DEFAULT_TRACKING_PARAMETERS[key as keyof TrackingParameters];
      if (typeof value !== 'number') continue; // expectedBlobArea_cm2 defaults to null
      expect(clampToBound(value, bound), key).toBe(value);
    }
    expect(
      clampToBound(DEFAULT_TRACKING_PARAMETERS.threshold.manualValue, MANUAL_THRESHOLD_BOUND),
    ).toBe(DEFAULT_TRACKING_PARAMETERS.threshold.manualValue);
  });

  it('cover every numeric tracking parameter, so none is unbounded', () => {
    const covered = new Set(Object.keys(TRACKING_PARAMETER_BOUNDS));
    for (const [key, value] of Object.entries(DEFAULT_TRACKING_PARAMETERS)) {
      if (key === 'threshold' || key === 'backgroundExcludeRanges') continue;
      // expectedBlobArea_cm2 is `number | null`; it still needs a bound.
      if (typeof value === 'number' || value === null) expect(covered, key).toContain(key);
    }
  });

  it('keeps the manual threshold inside what createTracker accepts', () => {
    expect(MANUAL_THRESHOLD_BOUND.min).toBeGreaterThanOrEqual(1);
    expect(MANUAL_THRESHOLD_BOUND.max).toBeLessThanOrEqual(255);
  });
});
