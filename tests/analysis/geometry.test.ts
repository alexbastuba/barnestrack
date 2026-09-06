import { describe, expect, it } from 'vitest';
import {
  cmToPx,
  distanceFromCentre_cm,
  distanceToHole_cm,
  holeIndexDistance,
  inCentreZone,
  inPlatform,
  inSector,
  mazeGeometry,
  nearestHole,
  nearestHoleIndex,
  pxToCm,
} from '../../src/analysis/geometry.js';
import { DEFAULT_ANALYSIS_OPTIONS, DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import { holeCentres, pxPerCm } from '../../src/maze/ring.js';
import { IDENTITY_TRANSFORM, transformMap } from '../../src/maze/similarity.js';
import {
  TEST_PLATFORM,
  TEST_PX_PER_CM,
  TEST_RESOLUTION,
  testGeometry,
  testMazeMap,
} from './maze-fixture.js';

const holeAt = (g: ReturnType<typeof testGeometry>, k: number, alongRadius_px = 0) => {
  const angle = Math.atan2(g.holeY[k]! - g.platform.cy, g.holeX[k]! - g.platform.cx);
  return {
    x: g.holeX[k]! + alongRadius_px * Math.cos(angle),
    y: g.holeY[k]! + alongRadius_px * Math.sin(angle),
  };
};

describe('mazeGeometry', () => {
  it('places holes exactly where the maze step does, under the identity and a fitted transform', () => {
    const map = testMazeMap();
    for (const transform of [
      IDENTITY_TRANSFORM,
      { translateX: -40, translateY: 12.5, rotationDeg: 33, scale: 1.085 },
    ]) {
      const g = mazeGeometry({
        map,
        transform,
        referenceResolution: TEST_RESOLUTION,
        parameters: DEFAULT_PARAMETERS,
        options: DEFAULT_ANALYSIS_OPTIONS,
      });
      const placed = transformMap(map, transform, TEST_RESOLUTION);
      const expected = holeCentres(placed);
      expect(g.holeCount).toBe(20);
      for (const h of expected) {
        expect(g.holeX[h.holeIndex]).toBeCloseTo(h.x, 9);
        expect(g.holeY[h.holeIndex]).toBeCloseTo(h.y, 9);
        expect(g.holes[h.holeIndex]).toEqual({ holeIndex: h.holeIndex, x: h.x, y: h.y });
      }
      expect(g.platform).toEqual(placed.platform);
      expect(g.pxPerCm).toBeCloseTo(pxPerCm(placed.platform, 92)!, 12);
      expect(g.holeRadius_px).toBeCloseTo(placed.holes.holeRadius_px, 12);
      expect(g.holeRadius_cm).toBeCloseTo(2.5, 9);
      expect(g.targetIndex).toBe(7);
    }
  });

  it('derives the event radii from the parameters and the centre zone from the options', () => {
    const g = testGeometry();
    expect(g.investigationRadius_px).toBeCloseTo(1.5 * g.holeRadius_px, 12);
    expect(g.escapeRadius_px).toBeCloseTo(1.0 * g.holeRadius_px, 12);
    expect(g.fillExclusionRadius_px).toBeCloseTo(g.holeRadius_px, 12);
    expect(g.centreZoneRadius_px).toBeCloseTo(0.5 * TEST_PLATFORM.r, 12);
    expect(g.sector.halfAngleDeg).toBeCloseTo(45, 12);
    expect(g.pxPerCm).toBeCloseTo(TEST_PX_PER_CM, 12);
  });

  it('centres the O6 sector on the transformed target hole', () => {
    const g = testGeometry({
      transform: { translateX: 10, translateY: -5, rotationDeg: 90, scale: 1 },
    });
    // hole 7 sits at 7 × 18° = 126° on the map; rotated by 90° it is at 216°
    expect(g.sector.centreAngleDeg).toBeCloseTo(216, 9);
    expect(inSector(g, ...(Object.values(holeAt(g, 7)) as [number, number]))).toBe(true);
    expect(inSector(g, ...(Object.values(holeAt(g, 9)) as [number, number]))).toBe(true); // 36° away
    expect(inSector(g, ...(Object.values(holeAt(g, 10)) as [number, number]))).toBe(false); // 54° away
    expect(inSector(g, g.platform.cx, g.platform.cy)).toBe(true);
  });

  it('tells sector membership at ±44° from ±46°, and centre-zone / platform membership by radius', () => {
    const g = testGeometry();
    const centre = g.sector.centreAngleDeg;
    const at = (deg: number, r: number) => ({
      x: g.platform.cx + r * Math.cos((deg * Math.PI) / 180),
      y: g.platform.cy + r * Math.sin((deg * Math.PI) / 180),
    });
    for (const off of [44, -44]) {
      const p = at(centre + off, 100);
      expect(inSector(g, p.x, p.y)).toBe(true);
    }
    for (const off of [46, -46]) {
      const p = at(centre + off, 100);
      expect(inSector(g, p.x, p.y)).toBe(false);
    }
    expect(inCentreZone(g, g.platform.cx + 0.49 * g.platform.r, g.platform.cy)).toBe(true);
    expect(inCentreZone(g, g.platform.cx + 0.51 * g.platform.r, g.platform.cy)).toBe(false);
    expect(inPlatform(g, g.platform.cx + g.platform.r, g.platform.cy)).toBe(true);
    expect(inPlatform(g, g.platform.cx + g.platform.r + 0.01, g.platform.cy)).toBe(false);
    expect(distanceFromCentre_cm(g, g.platform.cx + g.platform.r, g.platform.cy)).toBeCloseTo(
      46,
      9,
    );
  });

  it('finds the nearest hole and measures distances in cm', () => {
    const g = testGeometry();
    const p = holeAt(g, 12, cmToPx(g, 1.2));
    expect(nearestHoleIndex(g, p.x, p.y)).toBe(12);
    expect(nearestHole(g, p.x, p.y)).toEqual({
      holeIndex: 12,
      distance_cm: expect.closeTo(1.2, 9),
    });
    expect(distanceToHole_cm(g, p.x, p.y, 12)).toBeCloseTo(1.2, 9);
    expect(pxToCm(g, cmToPx(g, 3.3))).toBeCloseTo(3.3, 12);
    // lowest index on an exact tie
    const tied = { ...g, holeX: Float64Array.from(g.holeX), holeY: Float64Array.from(g.holeY) };
    tied.holeX[5] = tied.holeX[3]!;
    tied.holeY[5] = tied.holeY[3]!;
    expect(nearestHoleIndex(tied, tied.holeX[3]!, tied.holeY[3]!)).toBe(3);
  });

  it('measures hole-index distance around the ring', () => {
    const g = testGeometry();
    expect(holeIndexDistance(g, 0, 19)).toBe(1);
    expect(holeIndexDistance(g, 7, 7)).toBe(0);
    expect(holeIndexDistance(g, 2, 12)).toBe(10);
    expect(holeIndexDistance(g, 18, 3)).toBe(5);
  });

  it('refuses a map it cannot calibrate, naming the field', () => {
    expect(() =>
      testGeometry({ map: { holes: { n: 0, ringRatio: 0.89, holeRadius_px: 11, phase_deg: 0 } } }),
    ).toThrow(/holes\.n/);
    expect(() => testGeometry({ map: { target: { holeIndex: 20 } } })).toThrow(/target\.holeIndex/);
    expect(() => testGeometry({ map: { calibration: { platformDiameter_cm: 0 } } })).toThrow(
      /diameter/,
    );
    expect(() => testGeometry({ map: { platform: { cx: 1, cy: 1, r: -5 } } })).toThrow(/radius/);
    expect(() =>
      testGeometry({ transform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 0 } }),
    ).toThrow(/scale/);
  });
});
