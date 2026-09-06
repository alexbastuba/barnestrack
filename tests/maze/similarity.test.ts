import { describe, expect, it } from 'vitest';
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile, type SimilarityTransform } from '../../src/contracts/mazeMap.js';
import { holeCentres } from '../../src/maze/ring.js';
import {
  applyTransform,
  composeTransform,
  fitSimilarity,
  IDENTITY_TRANSFORM,
  invertTransform,
  rotationAbout,
  transformCircle,
  transformForResolution,
  transformFromCircles,
  transformMap,
  transformVector,
} from '../../src/maze/similarity.js';
import { distance, type Point } from '../../src/maze/types.js';

const KNOWN: SimilarityTransform = {
  translateX: -37.5,
  translateY: 112.25,
  rotationDeg: 23,
  scale: 1.35,
};

function sourceMap(): MazeMapFile {
  return {
    schemaVersion: MAZE_MAP_SCHEMA_VERSION,
    referenceResolution: { width: 640, height: 480 },
    platform: { cx: 320, cy: 240, r: 200 },
    holes: {
      n: 20,
      ringRatio: 0.89,
      holeRadius_px: 11,
      phase_deg: 9,
      offsets: [{ holeIndex: 4, dx_px: 6, dy_px: -3 }],
    },
    target: { holeIndex: 7 },
    calibration: { platformDiameter_cm: 92 },
    createdFrom: 'vid_01',
  };
}

describe('fitSimilarity', () => {
  it('recovers a known translate, rotate and scale from three correspondences', () => {
    const from: Point[] = [
      { x: 10, y: 20 },
      { x: 400, y: 35 },
      { x: 180, y: 460 },
    ];
    const to = from.map((p) => applyTransform(KNOWN, p));
    const fitted = fitSimilarity(from, to)!;
    expect(fitted.scale).toBeCloseTo(KNOWN.scale, 9);
    expect(fitted.rotationDeg).toBeCloseTo(KNOWN.rotationDeg, 9);
    expect(fitted.translateX).toBeCloseTo(KNOWN.translateX, 8);
    expect(fitted.translateY).toBeCloseTo(KNOWN.translateY, 8);
    for (const [i, p] of from.entries()) {
      expect(distance(applyTransform(fitted, p), to[i]!)).toBeLessThan(1e-9);
    }
  });

  it('is exact from two correspondences and least-squares from many', () => {
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const two = fitSimilarity(from, from.map((p) => applyTransform(KNOWN, p)))!;
    expect(two.scale).toBeCloseTo(KNOWN.scale, 9);
    expect(two.rotationDeg).toBeCloseTo(KNOWN.rotationDeg, 9);

    const many: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const perturbed = many.map((p, i) => {
      const exact = applyTransform(KNOWN, p);
      const wobble = [0.2, -0.15, 0.1, -0.05][i]!;
      return { x: exact.x + wobble, y: exact.y - wobble };
    });
    const fitted = fitSimilarity(many, perturbed)!;
    // A 0.2 px wobble on a 100 px square is worth about 0.1 degrees of rotation
    // and 0.2 % of scale: the fit absorbs the noise instead of chasing one point.
    expect(Math.abs(fitted.rotationDeg - KNOWN.rotationDeg)).toBeLessThan(0.1);
    expect(Math.abs(fitted.scale - KNOWN.scale)).toBeLessThan(0.005);
  });

  it('has no answer when the source points coincide or are too few', () => {
    expect(fitSimilarity([{ x: 1, y: 1 }], [{ x: 2, y: 2 }])).toBeNull();
    expect(fitSimilarity([{ x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 2, y: 2 }, { x: 3, y: 3 }])).toBeNull();
  });
});

describe('transform algebra', () => {
  it('inverts back to the original point', () => {
    const p = { x: 137.5, y: -22 };
    const there = applyTransform(KNOWN, p);
    const back = applyTransform(invertTransform(KNOWN), there);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('composes in apply-inner-first order', () => {
    const inner: SimilarityTransform = { translateX: 5, translateY: -7, rotationDeg: 15, scale: 0.8 };
    const p = { x: 12, y: 34 };
    const composed = applyTransform(composeTransform(KNOWN, inner), p);
    const stepwise = applyTransform(KNOWN, applyTransform(inner, p));
    expect(composed.x).toBeCloseTo(stepwise.x, 9);
    expect(composed.y).toBeCloseTo(stepwise.y, 9);
  });

  it('moves a displacement without the translation', () => {
    const moved = transformVector(KNOWN, { x: 10, y: 0 });
    expect(Math.hypot(moved.x, moved.y)).toBeCloseTo(10 * KNOWN.scale, 9);
    expect(transformVector(IDENTITY_TRANSFORM, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

describe('transformFromCircles (the "Adjust" fit)', () => {
  it('takes one platform circle onto another with no rotation', () => {
    const from = { cx: 320, cy: 240, r: 200 };
    const to = { cx: 280, cy: 250, r: 232 };
    const fitted = transformFromCircles(from, to)!;
    expect(fitted.rotationDeg).toBeCloseTo(0, 9);
    expect(fitted.scale).toBeCloseTo(232 / 200, 9);
    const moved = transformCircle(fitted, from);
    expect(moved.cx).toBeCloseTo(to.cx, 8);
    expect(moved.cy).toBeCloseTo(to.cy, 8);
    expect(moved.r).toBeCloseTo(to.r, 8);
  });

  it('keeps phase, target, offsets and calibration through an Adjust', () => {
    const map = sourceMap();
    const fitted = transformFromCircles(map.platform, { cx: 280, cy: 250, r: 232 })!;
    const adjusted = transformMap(map, fitted, { width: 720, height: 540 });
    expect(adjusted.holes.phase_deg).toBeCloseTo(map.holes.phase_deg, 9);
    expect(adjusted.target).toEqual(map.target);
    expect(adjusted.calibration).toEqual(map.calibration);
    expect(adjusted.holes.n).toBe(map.holes.n);
    expect(adjusted.holes.ringRatio).toBe(map.holes.ringRatio);
    expect(adjusted.holes.offsets).toHaveLength(1);
    expect(adjusted.holes.offsets![0]!.holeIndex).toBe(4);
    // The nudge is a length, so it scales with the platform.
    expect(Math.hypot(adjusted.holes.offsets![0]!.dx_px, adjusted.holes.offsets![0]!.dy_px)).toBeCloseTo(
      Math.hypot(6, 3) * (232 / 200),
      9,
    );
  });

  it('refuses a circle with no radius', () => {
    expect(transformFromCircles({ cx: 0, cy: 0, r: 0 }, { cx: 1, cy: 1, r: 5 })).toBeNull();
  });
});

describe('transformMap', () => {
  it('moves every hole exactly where the transform says', () => {
    const map = sourceMap();
    const moved = transformMap(map, KNOWN, { width: 1280, height: 960 });
    const expected = holeCentres(map).map((hole) => applyTransform(KNOWN, hole));
    const actual = holeCentres(moved);
    for (const [i, hole] of actual.entries()) {
      expect(distance(hole, expected[i]!)).toBeLessThan(1e-6);
    }
    expect(moved.holes.holeRadius_px).toBeCloseTo(11 * KNOWN.scale, 9);
    expect(moved.referenceResolution).toEqual({ width: 1280, height: 960 });
  });

  it('is the identity under the identity transform', () => {
    const map = sourceMap();
    const same = transformMap(map, IDENTITY_TRANSFORM, map.referenceResolution);
    expect(same.platform.cx).toBeCloseTo(map.platform.cx, 9);
    expect(same.platform.r).toBeCloseTo(map.platform.r, 9);
    expect(same.holes.phase_deg).toBeCloseTo(map.holes.phase_deg, 9);
  });
});

describe('transformForResolution', () => {
  it('scales by the width ratio and nothing else (D29)', () => {
    const t = transformForResolution({ width: 640, height: 480 }, { width: 1280, height: 720 });
    expect(t).toEqual({ translateX: 0, translateY: 0, rotationDeg: 0, scale: 2 });
  });

  it('is the identity at the same resolution', () => {
    expect(transformForResolution({ width: 640, height: 480 }, { width: 640, height: 480 })).toEqual(
      IDENTITY_TRANSFORM,
    );
  });
});

describe('rotationAbout (the per-video ring alignment)', () => {
  it('leaves the centre where it is and turns everything around it', () => {
    const centre = { x: 320, y: 240 };
    const spin = rotationAbout(30, centre);
    const fixed = applyTransform(spin, centre);
    expect(fixed.x).toBeCloseTo(centre.x, 9);
    expect(fixed.y).toBeCloseTo(centre.y, 9);
    expect(spin.scale).toBe(1);

    const arm = { x: centre.x + 100, y: centre.y };
    const turned = applyTransform(spin, arm);
    expect(distance(turned, centre)).toBeCloseTo(100, 9);
    expect(turned.x).toBeCloseTo(centre.x + 100 * Math.cos(Math.PI / 6), 9);
    expect(turned.y).toBeCloseTo(centre.y + 100 * Math.sin(Math.PI / 6), 9);
  });

  it('turns one video’s ring without moving its platform or another video’s', () => {
    const map = sourceMap();
    const centre = { x: map.platform.cx, y: map.platform.cy };
    const spun = composeTransform(rotationAbout(18, centre), IDENTITY_TRANSFORM);
    const turned = transformMap(map, spun, map.referenceResolution);

    expect(turned.platform.cx).toBeCloseTo(map.platform.cx, 8);
    expect(turned.platform.cy).toBeCloseTo(map.platform.cy, 8);
    expect(turned.platform.r).toBeCloseTo(map.platform.r, 9);
    // One hole step on a 20-hole ring: hole 1 lands where hole 0 was.
    const before = holeCentres(map);
    const after = holeCentres(turned);
    expect(distance(after[0]!, before[1]!)).toBeLessThan(1e-6);
    // The shared map itself is untouched, so every other video is untouched.
    expect(map.holes.phase_deg).toBe(sourceMap().holes.phase_deg);
  });
});
