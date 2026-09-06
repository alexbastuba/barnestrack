import { describe, expect, it } from 'vitest';
import {
  CIVIDIS,
  colormapCss,
  luminanceMonotone,
  relativeLuminance,
  sampleColormap,
  VIRIDIS,
} from '../../src/viz/colormaps.js';

describe('sampleColormap', () => {
  it('returns the first and last anchors at the ends', () => {
    expect(sampleColormap(VIRIDIS, 0)).toEqual([68, 1, 84]);
    expect(sampleColormap(VIRIDIS, 1)).toEqual([253, 231, 37]);
    expect(sampleColormap(CIVIDIS, 0)).toEqual([0, 34, 78]);
    expect(sampleColormap(CIVIDIS, 1)).toEqual([254, 232, 56]);
  });

  it('clamps out-of-range and non-finite positions instead of throwing', () => {
    expect(sampleColormap(VIRIDIS, -3)).toEqual(sampleColormap(VIRIDIS, 0));
    expect(sampleColormap(VIRIDIS, 7)).toEqual(sampleColormap(VIRIDIS, 1));
    expect(sampleColormap(VIRIDIS, Number.NaN)).toEqual(sampleColormap(VIRIDIS, 0));
  });

  it('writes a CSS colour', () => {
    expect(colormapCss(VIRIDIS, 0)).toBe('rgb(68, 1, 84)');
  });
});

describe('luminanceMonotone', () => {
  it('holds for viridis, so a speed scale still reads in grayscale (D32)', () => {
    const check = luminanceMonotone(VIRIDIS);
    expect(check.monotone).toBe(true);
    expect(check.worstDrop).toBeLessThan(0.002);
  });

  it('holds for cividis, so an occupancy heatmap still reads in grayscale (D32)', () => {
    expect(luminanceMonotone(CIVIDIS).monotone).toBe(true);
  });

  it('spans a wide enough luminance range to be distinguishable in grayscale', () => {
    for (const map of [VIRIDIS, CIVIDIS]) {
      const low = relativeLuminance(sampleColormap(map, 0));
      const high = relativeLuminance(sampleColormap(map, 1));
      expect(high - low).toBeGreaterThan(0.5);
    }
  });

  it('catches a map whose luminance dips', () => {
    const dipping = {
      name: 'dipping',
      anchors: [
        [0, 0, 0],
        [255, 255, 255],
        [0, 0, 0],
      ] as const,
    };
    const check = luminanceMonotone(dipping);
    expect(check.monotone).toBe(false);
    expect(check.worstAt).toBeGreaterThan(0.5);
  });
});
