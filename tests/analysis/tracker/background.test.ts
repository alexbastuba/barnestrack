import { describe, expect, it } from 'vitest';
import {
  backgroundSampleIndices,
  checkBackgroundContamination,
  medianBackground,
} from '../../../src/analysis/tracker/background.js';
import { pxPerCmFromPlatform, toPixelUnits } from '../../../src/analysis/tracker/calibration.js';
import { platformMask } from '../../../src/analysis/tracker/mask.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../../src/analysis/tracker/params.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseOnCircle,
  renderScene,
  renderStaticScene,
} from '../synthetic-frames.js';

describe('backgroundSampleIndices', () => {
  it('spaces the samples uniformly and deterministically', () => {
    const a = backgroundSampleIndices(1000, 10);
    expect(a).toEqual([50, 150, 250, 350, 450, 550, 650, 750, 850, 950]);
    expect(backgroundSampleIndices(1000, 10)).toEqual(a);
  });

  it('honours excluded ranges and never exceeds the eligible count', () => {
    const idx = backgroundSampleIndices(100, 20, [{ startFrame: 0, endFrame: 49 }]);
    expect(idx.length).toBe(20);
    expect(idx.every((i) => i >= 50 && i < 100)).toBe(true);
    expect(backgroundSampleIndices(5, 150)).toEqual([0, 1, 2, 3, 4]);
    expect(backgroundSampleIndices(10, 3, [{ startFrame: 0, endFrame: 9 }])).toEqual([]);
  });
});

describe('medianBackground', () => {
  it('takes the lower median per pixel and rejects mismatched sizes', () => {
    const s = (v: number) => Uint8Array.of(v, 255 - v);
    expect(Array.from(medianBackground([s(10), s(30), s(20)], 2, 1))).toEqual([20, 235]);
    expect(Array.from(medianBackground([s(10), s(30), s(20), s(40)], 2, 1))).toEqual([20, 225]);
    expect(() => medianBackground([new Uint8Array(3)], 2, 1)).toThrow(/expected 2/);
    expect(() => medianBackground([], 2, 1)).toThrow();
  });

  it('ignores a moving mouse: the median equals the clean scene', () => {
    const spec = DEFAULT_SCENE;
    const clean = renderStaticScene(spec);
    const samples: Uint8Array[] = [];
    for (let k = 0; k < 21; k++) {
      const m = mouseOnCircle(spec, k * 0.5);
      samples.push(renderScene(spec, { mouse: { ...DEFAULT_MOUSE, ...m } }, undefined, clean));
    }
    const bg = medianBackground(samples, spec.width, spec.height);
    let maxDiff = 0;
    for (let p = 0; p < bg.length; p++) maxDiff = Math.max(maxDiff, Math.abs(bg[p]! - clean[p]!));
    expect(maxDiff).toBe(0);
  });

  it('stays within the noise of the clean scene when the frames are noisy', () => {
    const spec = { ...DEFAULT_SCENE, noise: 3 };
    const clean = renderStaticScene({ ...spec, noise: 0 });
    const samples: Uint8Array[] = [];
    for (let k = 0; k < 15; k++) {
      const m = mouseOnCircle(spec, k * 0.7);
      samples.push(
        renderScene(spec, { mouse: { ...DEFAULT_MOUSE, ...m }, seed: k + 1 }, undefined, clean),
      );
    }
    const bg = medianBackground(samples, spec.width, spec.height);
    let maxDiff = 0;
    for (let p = 0; p < bg.length; p++) maxDiff = Math.max(maxDiff, Math.abs(bg[p]! - clean[p]!));
    expect(maxDiff).toBeLessThanOrEqual(8);
  });
});

describe('checkBackgroundContamination', () => {
  const spec = DEFAULT_SCENE;
  const pxPerCm = pxPerCmFromPlatform(spec.platform, PLATFORM_DIAMETER_CM);
  const px = toPixelUnits(DEFAULT_TRACKING_PARAMETERS, spec.platform, pxPerCm);
  const mask = platformMask(spec.width, spec.height, spec.platform, px.maskRadius_px);

  it('does not flag the twenty holes of a clean background', () => {
    const check = checkBackgroundContamination(renderStaticScene(spec), mask, px);
    expect(check.blobs.length).toBe(20);
    expect(check.warnings).toEqual([]);
  });

  it('warns about a stationary mouse baked into the background, naming the remedy', () => {
    const baked = renderScene(spec, {
      mouse: { ...DEFAULT_MOUSE, x: spec.platform.cx + 40, y: spec.platform.cy - 30, heading: 0.4 },
    });
    const check = checkBackgroundContamination(baked, mask, px);
    expect(check.warnings.length).toBe(1);
    expect(check.warnings[0]).toMatch(/stationary animal/);
    expect(check.warnings[0]).toMatch(/backgroundExcludeRanges/);
    expect(check.warnings[0]).toMatch(/cm²/);
    const flagged = check.blobs.filter((b) => b.flagged);
    expect(flagged.length).toBe(1);
    // the baked-in blob includes the tail, which pulls its centroid backwards
    expect(Math.abs(flagged[0]!.cx - (spec.platform.cx + 40))).toBeLessThan(12);
    expect(Math.abs(flagged[0]!.cy - (spec.platform.cy - 30))).toBeLessThan(12);
  });

  it('warns about a large object such as a start cylinder', () => {
    const baked = renderScene(spec, {
      hand: { x: spec.platform.cx, y: spec.platform.cy, radius: 26, darkness: 90 },
    });
    const check = checkBackgroundContamination(baked, mask, px);
    expect(check.warnings.length).toBe(1);
    expect(check.blobs.find((b) => b.flagged)!.areaRatio).toBeGreaterThan(1.5);
  });
});
