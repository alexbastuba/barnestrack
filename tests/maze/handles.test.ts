import { describe, expect, it } from 'vitest';
import type { PlatformCircle } from '../../src/contracts/mazeMap.js';
import {
  applyHandleDrag,
  HANDLE_KINDS,
  handlePositions,
  hitTestHandle,
  MIN_PLATFORM_RADIUS_PX,
  nudgeHandle,
  PLATFORM_HANDLE_BEARING_DEG,
  RING_HANDLE_BEARING_DEG,
  RING_RATIO_MAX,
  RING_RATIO_MIN,
  type HandleKind,
} from '../../src/maze/handles.js';
import { distance, type Point } from '../../src/maze/types.js';

/** test53's platform, off-centre and with a fractional radius, so nothing cancels by luck. */
const PLATFORM: PlatformCircle = { cx: 327.8, cy: 239.7, r: 208.5 };
const RING = { ringRatio: 0.89 };
const CENTRE: Point = { x: PLATFORM.cx, y: PLATFORM.cy };

const bearingDeg = (p: Point): number => {
  const deg = (Math.atan2(p.y - CENTRE.y, p.x - CENTRE.x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
};

describe('handlePositions', () => {
  const positions = handlePositions(PLATFORM, RING);

  it('puts the centre handle on the centre', () => {
    expect(positions.centre).toEqual(CENTRE);
  });

  it('puts the platform handle on the platform circle at its bearing', () => {
    expect(distance(positions.platformRim, CENTRE)).toBeCloseTo(PLATFORM.r, 9);
    expect(bearingDeg(positions.platformRim)).toBeCloseTo(PLATFORM_HANDLE_BEARING_DEG, 9);
  });

  it('puts the ring handle on the hole ring at its own bearing', () => {
    expect(distance(positions.ringRim, CENTRE)).toBeCloseTo(PLATFORM.r * RING.ringRatio, 9);
    expect(bearingDeg(positions.ringRim)).toBeCloseTo(RING_HANDLE_BEARING_DEG, 9);
  });

  it('keeps both rim handles up and to the right, 20° apart, so they never coincide', () => {
    for (const bearing of [PLATFORM_HANDLE_BEARING_DEG, RING_HANDLE_BEARING_DEG]) {
      expect(bearing).toBeGreaterThan(270);
      expect(bearing).toBeLessThan(360);
    }
    expect(Math.abs(PLATFORM_HANDLE_BEARING_DEG - RING_HANDLE_BEARING_DEG)).toBeGreaterThanOrEqual(20);
    // Even with the ring on the platform edge the two are a chord apart.
    const coincident = handlePositions(PLATFORM, { ringRatio: RING_RATIO_MAX });
    expect(distance(coincident.platformRim, coincident.ringRim)).toBeGreaterThan(
      2 * PLATFORM.r * Math.sin((19 * Math.PI) / 360),
    );
  });
});

describe('hitTestHandle', () => {
  const positions = handlePositions(PLATFORM, RING);

  it('finds a handle inside the tolerance and nothing outside it', () => {
    for (const kind of HANDLE_KINDS) {
      const p = positions[kind];
      expect(hitTestHandle({ x: p.x + 6, y: p.y - 7 }, positions, 10)).toBe(kind);
      expect(hitTestHandle({ x: p.x + 8, y: p.y - 8 }, positions, 10)).toBeNull();
    }
  });

  it('returns the nearest when two are in range', () => {
    // Between the two rim handles, 2 px nearer the ring one.
    const a = positions.ringRim;
    const b = positions.platformRim;
    const t = 0.5 - 2 / distance(a, b);
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    expect(hitTestHandle(p, positions, 1000)).toBe('ringRim');
  });

  // Hand-built positions for the ties: with a real ring the ring handle is
  // nearer the centre–platform midpoint than either of them, which is the
  // nearest-wins rule working, not a tie.
  it('gives an exact tie to the centre', () => {
    const tied = { centre: { x: 0, y: 0 }, platformRim: { x: 10, y: 0 }, ringRim: { x: 100, y: 100 } };
    expect(hitTestHandle({ x: 5, y: 0 }, tied, 5)).toBe('centre');
  });

  it('gives a tie between the rims to the ring', () => {
    const tied = { centre: { x: -1000, y: -1000 }, ringRim: { x: 0, y: 0 }, platformRim: { x: 10, y: 0 } };
    expect(hitTestHandle({ x: 5, y: 0 }, tied, 5)).toBe('ringRim');
  });
});

describe('applyHandleDrag', () => {
  it('moves everything with the centre by the pointer’s displacement', () => {
    const from = { x: CENTRE.x + 3, y: CENTRE.y - 2 };
    const to = { x: from.x + 40, y: from.y + 25 };
    const result = applyHandleDrag('centre', from, to, PLATFORM, RING);
    expect(result.platform).toEqual({ cx: PLATFORM.cx + 40, cy: PLATFORM.cy + 25, r: PLATFORM.r });
    expect(result.ringRatio).toBe(RING.ringRatio);
  });

  it('changes the radius by the pointer’s change in distance from the centre, and leaves the ratio', () => {
    const positions = handlePositions(PLATFORM, RING);
    const outward = (p: Point, by: number): Point => {
      const d = distance(p, CENTRE);
      return { x: CENTRE.x + ((p.x - CENTRE.x) * (d + by)) / d, y: CENTRE.y + ((p.y - CENTRE.y) * (d + by)) / d };
    };
    const onHandle = applyHandleDrag('platformRim', positions.platformRim, outward(positions.platformRim, 12.5), PLATFORM, RING);
    expect(onHandle.platform.r).toBeCloseTo(PLATFORM.r + 12.5, 9);
    expect(onHandle.platform.cx).toBe(PLATFORM.cx);
    expect(onHandle.platform.cy).toBe(PLATFORM.cy);
    expect(onHandle.ringRatio).toBe(RING.ringRatio);

    // A press 5 px inside the handle produces the same radius: the grab offset is kept.
    const insideGrab = outward(positions.platformRim, -5);
    const offHandle = applyHandleDrag('platformRim', insideGrab, outward(insideGrab, 12.5), PLATFORM, RING);
    expect(offHandle.platform.r).toBeCloseTo(onHandle.platform.r, 9);

    // The bearing of the pointer is irrelevant: only its distance counts.
    const sideways = { x: CENTRE.x, y: CENTRE.y - (PLATFORM.r + 12.5) };
    const swung = applyHandleDrag('platformRim', positions.platformRim, sideways, PLATFORM, RING);
    expect(swung.platform.r).toBeCloseTo(PLATFORM.r + 12.5, 9);
  });

  it('never shrinks the platform below the minimum radius', () => {
    const positions = handlePositions(PLATFORM, RING);
    const result = applyHandleDrag('platformRim', positions.platformRim, CENTRE, PLATFORM, RING);
    expect(result.platform.r).toBe(MIN_PLATFORM_RADIUS_PX);
  });

  it('sets the ring ratio from the ring handle’s change in distance, and leaves the platform', () => {
    const positions = handlePositions(PLATFORM, RING);
    const inward = {
      x: CENTRE.x + (positions.ringRim.x - CENTRE.x) * 0.9,
      y: CENTRE.y + (positions.ringRim.y - CENTRE.y) * 0.9,
    };
    const result = applyHandleDrag('ringRim', positions.ringRim, inward, PLATFORM, RING);
    expect(result.ringRatio).toBeCloseTo(RING.ringRatio * 0.9, 9);
    expect(result.platform).toEqual(PLATFORM);
  });

  it('clamps the ring ratio to the field’s bounds at both ends', () => {
    const positions = handlePositions(PLATFORM, RING);
    const farOut = { x: CENTRE.x + 10 * PLATFORM.r, y: CENTRE.y };
    expect(applyHandleDrag('ringRim', positions.ringRim, farOut, PLATFORM, RING).ringRatio).toBe(RING_RATIO_MAX);
    expect(applyHandleDrag('ringRim', positions.ringRim, CENTRE, PLATFORM, RING).ringRatio).toBe(RING_RATIO_MIN);
  });

  it('is the identity for a zero-length drag from any press point', () => {
    const positions = handlePositions(PLATFORM, RING);
    for (const kind of HANDLE_KINDS) {
      for (const from of [positions[kind], { x: positions[kind].x - 4, y: positions[kind].y + 6 }]) {
        const result = applyHandleDrag(kind, from, { ...from }, PLATFORM, RING);
        expect(result.platform).toEqual(PLATFORM);
        expect(result.ringRatio).toBe(RING.ringRatio);
      }
    }
  });
});

describe('nudgeHandle', () => {
  it('moves the centre by the arrow step', () => {
    const result = nudgeHandle('centre', 10, 0, PLATFORM, RING);
    expect(result.platform).toEqual({ cx: PLATFORM.cx + 10, cy: PLATFORM.cy, r: PLATFORM.r });
    const up = nudgeHandle('centre', 0, -1, PLATFORM, RING);
    expect(up.platform.cy).toBe(PLATFORM.cy - 1);
  });

  it('grows a rim handle’s radius by exactly the step on right or up, and shrinks it on left or down', () => {
    const cases: [HandleKind, (g: { platform: PlatformCircle; ringRatio: number }) => number, number][] = [
      ['platformRim', (g) => g.platform.r, PLATFORM.r],
      ['ringRim', (g) => g.ringRatio * g.platform.r, PLATFORM.r * RING.ringRatio],
    ];
    for (const [kind, radiusOf, before] of cases) {
      expect(radiusOf(nudgeHandle(kind, 1, 0, PLATFORM, RING))).toBeCloseTo(before + 1, 9);
      expect(radiusOf(nudgeHandle(kind, 0, -1, PLATFORM, RING))).toBeCloseTo(before + 1, 9);
      expect(radiusOf(nudgeHandle(kind, -1, 0, PLATFORM, RING))).toBeCloseTo(before - 1, 9);
      expect(radiusOf(nudgeHandle(kind, 0, 1, PLATFORM, RING))).toBeCloseTo(before - 1, 9);
      expect(radiusOf(nudgeHandle(kind, 10, 0, PLATFORM, RING))).toBeCloseTo(before + 10, 9);
    }
  });

  it('leaves the other quantity alone', () => {
    expect(nudgeHandle('platformRim', 10, 0, PLATFORM, RING).ringRatio).toBe(RING.ringRatio);
    expect(nudgeHandle('ringRim', 10, 0, PLATFORM, RING).platform).toEqual(PLATFORM);
  });
});
