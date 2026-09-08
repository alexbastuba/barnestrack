import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Parameters } from '../../src/contracts/parameters.js';
import {
  ANALYSIS_MODEL,
  ANALYSIS_MODEL_DEFINITIONS,
  DEFAULT_PARAMETERS,
  MAZE_DEFAULTS,
  MAZE_DEFAULT_DEFINITIONS,
  PARAMETER_DECISIONS,
  PARAMETER_DEFINITIONS,
  PARAMETER_UNITS,
  assertValidParameters,
  canonicalJson,
  hashParameters,
  hashTrackingParameters,
  isRecorded,
  parameterAt,
  parameterPaths,
  validateParameters,
} from '../../src/analysis/parameters.js';
import {
  DEFAULT_TRACKING_PARAMETERS,
  TRACKING_PARAMETER_DEFINITIONS,
} from '../../src/analysis/tracker/params.js';
import {
  DEFAULT_HOLE_COUNT,
  DEFAULT_HOLE_DIAMETER_CM,
  DEFAULT_RING_RATIO,
  TYPICAL_PLATFORM_DIAMETER_CM,
} from '../../src/maze/ring.js';
import { DEFAULT_DROP_GAP_FACTOR } from '../../src/video/mp4-index.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('DEFAULT_PARAMETERS', () => {
  it('carries every O-default of decisions.md verbatim', () => {
    expect(DEFAULT_PARAMETERS.holeInvestigation).toEqual({
      radiusFactor: 1.5,
      minDuration_s: 0.2,
      mergeGap_s: 0.5,
    }); // O1
    expect(DEFAULT_PARAMETERS.escapeEntry).toEqual({
      radiusFactor: 1.0,
      minDuration_s: 1.0,
      persistCutoff_s: 3,
    }); // O4
    expect(DEFAULT_PARAMETERS.trialCutoff_s).toBe(180); // O5
    expect(DEFAULT_PARAMETERS.targetQuadrant).toEqual({ holeSpan: 2.5 }); // O6
    expect(DEFAULT_PARAMETERS.kinematicsSmoothingWindowFrames).toBe(3); // O9
    expect(DEFAULT_PARAMETERS.gapFilling).toEqual({ enabled: false, maxDuration_s: 0.1 }); // O10 → D60: off by default
    expect(DEFAULT_PARAMETERS.kinematics).toEqual({
      speedWindowFrames: 2,
      duplicateTimestampFactor: 0.25,
      dropGapFactor: 1.5,
    }); // O11
    expect(DEFAULT_PARAMETERS.noseConfidenceCutoff).toBe(0.5); // O16, revised 2026-09-05
    expect(DEFAULT_PARAMETERS.outlierVelocityThreshold_cmPerS).toBe(150); // O17
    expect(DEFAULT_PARAMETERS.trialCensoring).toEqual({ censorToCutoff: false }); // O5
    expect(DEFAULT_PARAMETERS.strategy).toEqual({
      spatialMaxErrors: 2,
      spatialMaxHoleDistance: 1,
      spatialMaxCentreCrossings: 0,
      serialMinRun: 2,
      centreZoneRadiusFraction: 0.5,
    }); // O7 → D58 (Gawel et al. 2019, Table 1), hashed since D55
    expect(DEFAULT_PARAMETERS.quality).toEqual({
      goodMinPositionedFraction: 0.9,
      poorMaxPositionedFraction: 0.7,
    }); // D30, hashed since D55
    expect(DEFAULT_PARAMETERS.tracking).toBe(DEFAULT_TRACKING_PARAMETERS); // D6, reused not copied
  });

  it('agrees with the drop-gap factor the MP4 index still defines for itself (O11)', () => {
    expect(DEFAULT_PARAMETERS.kinematics.dropGapFactor).toBe(DEFAULT_DROP_GAP_FACTOR);
  });

  it('is valid', () => {
    expect(validateParameters(DEFAULT_PARAMETERS)).toEqual([]);
    expect(() => assertValidParameters(DEFAULT_PARAMETERS)).not.toThrow();
  });
});

describe('definitions', () => {
  it('cover every leaf of the default parameters, and nothing else', () => {
    const paths = parameterPaths(DEFAULT_PARAMETERS);
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      expect(PARAMETER_DEFINITIONS[path], path).toMatch(/\S/);
      expect(PARAMETER_UNITS[path], path).toMatch(/\S/);
      expect(parameterAt(DEFAULT_PARAMETERS, path), path).not.toBeUndefined();
    }
    expect(new Set(Object.keys(PARAMETER_DEFINITIONS))).toEqual(new Set(paths));
    expect(new Set(Object.keys(PARAMETER_UNITS))).toEqual(new Set(paths));
  });

  it('end in their unit, name no decision number, and record the decision separately', () => {
    for (const path of parameterPaths(DEFAULT_PARAMETERS)) {
      if (path.startsWith('tracking.')) continue;
      // The sentence a user reads ends in the unit and nothing else: this project's decision
      // numbers mean nothing to them, and where a sentence needs a source it cites the paper.
      expect(PARAMETER_DEFINITIONS[path], path).toMatch(/\([^()]+\)\.$/);
      expect(PARAMETER_DEFINITIONS[path], path).not.toMatch(/\([OD]\d/);
      expect(PARAMETER_DEFINITIONS[path], path).not.toMatch(/; [OD]\d+\)/);
      // an open decision (O-number) or, for the D30 tier thresholds, a closed one
      expect(PARAMETER_DECISIONS[path], path).toMatch(/^[OD]\d+$/);
    }
    // the strategy rules cite Gawel et al. 2019, Table 1 rather than D58
    expect(PARAMETER_DEFINITIONS['strategy.serialMinRun']).toContain('Gawel et al. 2019, Table 1');
    expect(PARAMETER_DECISIONS['strategy.serialMinRun']).toBe('O7');
    expect(PARAMETER_DECISIONS['quality.goodMinPositionedFraction']).toBe('D30');
    expect(PARAMETER_DECISIONS['trialCensoring.censorToCutoff']).toBe('O5');
  });

  it('reuse the tracker definitions verbatim', () => {
    for (const key of Object.keys(
      TRACKING_PARAMETER_DEFINITIONS,
    ) as (keyof typeof TRACKING_PARAMETER_DEFINITIONS)[]) {
      expect(PARAMETER_DEFINITIONS[`tracking.${key}`]).toBe(TRACKING_PARAMETER_DEFINITIONS[key]);
      expect(PARAMETER_DECISIONS[`tracking.${key}`]).toBe('D6');
    }
  });

  it('exist for every model constant and maze default', () => {
    expect(new Set(Object.keys(ANALYSIS_MODEL_DEFINITIONS))).toEqual(
      new Set(Object.keys(ANALYSIS_MODEL)),
    );
    expect(new Set(Object.keys(MAZE_DEFAULT_DEFINITIONS))).toEqual(
      new Set(Object.keys(MAZE_DEFAULTS)),
    );
  });
});

describe('O8 defaults', () => {
  it('are the values ring.ts re-exports', () => {
    expect(MAZE_DEFAULTS).toEqual({
      holeCount: 20,
      ringRatio: 0.89,
      holeDiameter_cm: 5,
      typicalPlatformDiameter_cm: 92,
    });
    expect(DEFAULT_HOLE_COUNT).toBe(MAZE_DEFAULTS.holeCount);
    expect(DEFAULT_RING_RATIO).toBe(MAZE_DEFAULTS.ringRatio);
    expect(DEFAULT_HOLE_DIAMETER_CM).toBe(MAZE_DEFAULTS.holeDiameter_cm);
    expect(TYPICAL_PLATFORM_DIAMETER_CM).toBe(MAZE_DEFAULTS.typicalPlatformDiameter_cm);
  });
});

describe('canonicalJson and hashing (D51)', () => {
  it('sorts keys, keeps array order, drops undefined and writes no whitespace', () => {
    const value = { e: null, b: [{ d: 2, c: 3 }, 'x'], a: 1.5, u: undefined, s: 'q"t' };
    expect(canonicalJson(value)).toBe('{"a":1.5,"b":[{"c":3,"d":2},"x"],"e":null,"s":"q\\"t"}');
  });

  it('is the SHA-256 of the canonical JSON, byte for byte', () => {
    const expected = createHash('sha256')
      .update(canonicalJson(DEFAULT_PARAMETERS), 'utf8')
      .digest('hex');
    expect(hashParameters(DEFAULT_PARAMETERS)).toBe(expected);
    expect(hashParameters(DEFAULT_PARAMETERS)).toMatch(/^[0-9a-f]{64}$/);
    const expectedTracking = createHash('sha256')
      .update(canonicalJson(DEFAULT_PARAMETERS.tracking), 'utf8')
      .digest('hex');
    expect(hashTrackingParameters(DEFAULT_PARAMETERS.tracking)).toBe(expectedTracking);
    expect(hashTrackingParameters(DEFAULT_PARAMETERS.tracking)).not.toBe(
      hashParameters(DEFAULT_PARAMETERS),
    );
  });

  it('is stable across key order and a JSON round trip', () => {
    const reordered = {
      tracking: clone(DEFAULT_PARAMETERS.tracking),
      quality: { poorMaxPositionedFraction: 0.7, goodMinPositionedFraction: 0.9 },
      strategy: {
        centreZoneRadiusFraction: 0.5,
        serialMinRun: 2,
        spatialMaxCentreCrossings: 0,
        spatialMaxHoleDistance: 1,
        spatialMaxErrors: 2,
      },
      trialCensoring: { censorToCutoff: false },
      outlierVelocityThreshold_cmPerS: 150,
      noseConfidenceCutoff: 0.5,
      kinematics: { dropGapFactor: 1.5, duplicateTimestampFactor: 0.25, speedWindowFrames: 2 },
      gapFilling: { maxDuration_s: 0.1, enabled: false },
      kinematicsSmoothingWindowFrames: 3,
      targetQuadrant: { holeSpan: 2.5 },
      trialCutoff_s: 180,
      escapeEntry: { persistCutoff_s: 3, minDuration_s: 1.0, radiusFactor: 1.0 },
      holeInvestigation: { mergeGap_s: 0.5, minDuration_s: 0.2, radiusFactor: 1.5 },
    } satisfies Parameters;
    expect(hashParameters(reordered)).toBe(hashParameters(DEFAULT_PARAMETERS));
    expect(hashParameters(clone(DEFAULT_PARAMETERS))).toBe(hashParameters(DEFAULT_PARAMETERS));
  });

  it('changes when any value changes, but the tracking hash only for tracking values', () => {
    const eventChange = clone(DEFAULT_PARAMETERS);
    eventChange.holeInvestigation.radiusFactor = 2;
    expect(hashParameters(eventChange)).not.toBe(hashParameters(DEFAULT_PARAMETERS));
    expect(hashTrackingParameters(eventChange.tracking)).toBe(
      hashTrackingParameters(DEFAULT_PARAMETERS.tracking),
    );
    const trackingChange = clone(DEFAULT_PARAMETERS);
    trackingChange.tracking.minBlobArea_cm2 = 5;
    expect(hashTrackingParameters(trackingChange.tracking)).not.toBe(
      hashTrackingParameters(DEFAULT_PARAMETERS.tracking),
    );
  });
});

describe('validateParameters', () => {
  function withValue(path: string, value: unknown): Parameters {
    const p = clone(DEFAULT_PARAMETERS) as unknown as Record<string, unknown>;
    const keys = path.split('.');
    let node = p;
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[keys[keys.length - 1]!] = value;
    return p as unknown as Parameters;
  }

  it.each([
    ['holeInvestigation.radiusFactor', -1],
    ['holeInvestigation.minDuration_s', Number.NaN],
    ['escapeEntry.persistCutoff_s', -0.5],
    ['trialCutoff_s', 0],
    ['targetQuadrant.holeSpan', Number.POSITIVE_INFINITY],
    ['kinematicsSmoothingWindowFrames', 4],
    ['kinematics.speedWindowFrames', 0.5],
    ['kinematics.duplicateTimestampFactor', 1],
    ['kinematics.dropGapFactor', 1],
    ['noseConfidenceCutoff', 1.2],
    ['outlierVelocityThreshold_cmPerS', 0],
    ['strategy.spatialMaxErrors', 2.5],
    ['strategy.serialMinRun', 0],
    ['strategy.centreZoneRadiusFraction', 0],
    ['quality.goodMinPositionedFraction', 1.5],
    ['trialCensoring.censorToCutoff', 'yes'],
    ['tracking.backgroundSampleCount', 0],
    ['tracking.threshold.manualValue', 300],
    ['tracking.minBlobArea_cm2', Number.NaN],
    ['tracking.smallBlobFactor', 2],
  ])('rejects %s = %s naming the parameter', (path, value) => {
    const problems = validateParameters(withValue(path, value));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain(path);
    expect(() => assertValidParameters(withValue(path, value))).toThrow(path);
  });

  it('rejects a duplicate factor at or above the drop factor, and a min area above the max', () => {
    const p = clone(DEFAULT_PARAMETERS);
    p.kinematics.duplicateTimestampFactor = 0.9;
    p.kinematics.dropGapFactor = 1.5;
    expect(validateParameters(p)).toEqual([]);
    p.kinematics.duplicateTimestampFactor = 0.99;
    p.kinematics.dropGapFactor = 1.01;
    expect(validateParameters(p)).toEqual([]);
    const q = clone(DEFAULT_PARAMETERS);
    q.tracking.minBlobArea_cm2 = 90;
    expect(validateParameters(q).join('\n')).toContain('tracking.minBlobArea_cm2 must be below');
  });

  it('rejects a POOR threshold above the GOOD threshold, and accepts them equal', () => {
    const crossed = clone(DEFAULT_PARAMETERS);
    crossed.quality.poorMaxPositionedFraction = 0.95;
    expect(validateParameters(crossed).join('\n')).toContain(
      'quality.poorMaxPositionedFraction must not exceed quality.goodMinPositionedFraction',
    );
    const equal = clone(DEFAULT_PARAMETERS);
    equal.quality.poorMaxPositionedFraction = equal.quality.goodMinPositionedFraction;
    expect(validateParameters(equal)).toEqual([]);
  });

  it('accepts a null expected area and rejects a negative one; rejects a bad exclude range', () => {
    expect(validateParameters(withValue('tracking.expectedBlobArea_cm2', null))).toEqual([]);
    expect(validateParameters(withValue('tracking.expectedBlobArea_cm2', -3)).join()).toContain(
      'tracking.expectedBlobArea_cm2',
    );
    expect(
      validateParameters(
        withValue('tracking.backgroundExcludeRanges', [{ startFrame: 5, endFrame: 2 }]),
      ).join(),
    ).toContain('tracking.backgroundExcludeRanges[0]');
  });
});

describe('isRecorded', () => {
  it('is true for finite numbers only', () => {
    expect(isRecorded(0)).toBe(true);
    expect(isRecorded(-2.5)).toBe(true);
    expect(isRecorded(Number.NaN)).toBe(false);
    expect(isRecorded(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRecorded(null)).toBe(false);
    expect(isRecorded(undefined)).toBe(false);
  });
});
