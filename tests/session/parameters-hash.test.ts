/**
 * The parameters hash (D51). Two implementations that disagree by a byte
 * would silently invalidate every stored layer, so the canonicalisation is
 * pinned here: keys sorted, no whitespace, array order preserved.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKING_PARAMETERS } from '../../src/analysis/tracker/params.js';
import type { TrackingParameters } from '../../src/contracts/parameters.js';
import {
  canonicalJson,
  hashTrackingParameters,
} from '../../src/session/parameters-hash.js';

describe('canonicalJson', () => {
  it('sorts object keys and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it('keeps array order, which is part of the value', () => {
    expect(canonicalJson({ r: [{ b: 1, a: 2 }, 3] })).toBe('{"r":[{"a":2,"b":1},3]}');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('keeps null, and drops undefined the way JSON.stringify does', () => {
    expect(canonicalJson({ a: null, b: undefined, c: 1 })).toBe('{"a":null,"c":1}');
  });

  it('is insensitive to how the source object was written', () => {
    const written = JSON.parse('{ "b" : 1 ,\n  "a" : { "y" : 2, "x" : 3 } }') as unknown;
    expect(canonicalJson(written)).toBe(canonicalJson({ a: { x: 3, y: 2 }, b: 1 }));
  });
});

describe('hashTrackingParameters', () => {
  it('is a 64-character hex SHA-256', () => {
    expect(hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order or on whitespace in the source', () => {
    // The same value with every key inserted in the opposite order, nested
    // objects included, and round-tripped through indented JSON.
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_TRACKING_PARAMETERS).reverse()) {
      const value = (DEFAULT_TRACKING_PARAMETERS as unknown as Record<string, unknown>)[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const inner: Record<string, unknown> = {};
        for (const k of Object.keys(value).reverse()) inner[k] = (value as Record<string, unknown>)[k];
        reversed[key] = inner;
      } else {
        reversed[key] = value;
      }
    }
    const reordered = JSON.parse(JSON.stringify(reversed, null, 4)) as TrackingParameters;

    expect(Object.keys(reordered)).not.toEqual(Object.keys(DEFAULT_TRACKING_PARAMETERS));
    expect(hashTrackingParameters(reordered)).toBe(hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS));
  });

  it('changes when any threshold changes', () => {
    const base = hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS);
    expect(hashTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 5 })).not.toBe(base);
    expect(
      hashTrackingParameters({
        ...DEFAULT_TRACKING_PARAMETERS,
        threshold: { mode: 'manual', manualValue: 40 },
      }),
    ).not.toBe(base);
    expect(
      hashTrackingParameters({
        ...DEFAULT_TRACKING_PARAMETERS,
        backgroundExcludeRanges: [{ startFrame: 0, endFrame: 74 }],
      }),
    ).not.toBe(base);
  });

  it('tells a learned expected area from an explicit one', () => {
    const learned = hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS);
    const explicit = hashTrackingParameters({
      ...DEFAULT_TRACKING_PARAMETERS,
      expectedBlobArea_cm2: 12,
    });
    expect(explicit).not.toBe(learned);
  });

  it('is stable across calls, so re-running with the same parameters is a no-op', () => {
    expect(hashTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS })).toBe(
      hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS),
    );
  });
});
