import { describe, expect, it } from 'vitest';
import { circleFitResidual, fitCircle } from '../../src/maze/circle-fit.js';
import type { Point } from '../../src/maze/types.js';

/** A deterministic, reproducible pseudo-random sequence: a test must not flake. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  };
}

function onCircle(cx: number, cy: number, r: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

describe('fitCircle', () => {
  it('recovers the exact circle from three points on it', () => {
    const circle = fitCircle([
      onCircle(320.5, 240.25, 200.75, 20),
      onCircle(320.5, 240.25, 200.75, 155),
      onCircle(320.5, 240.25, 200.75, 280),
    ]);
    expect(circle).not.toBeNull();
    expect(circle!.cx).toBeCloseTo(320.5, 9);
    expect(circle!.cy).toBeCloseTo(240.25, 9);
    expect(circle!.r).toBeCloseTo(200.75, 9);
  });

  it('recovers three clicks in the rim positions a user would actually pick', () => {
    // Three rim clicks bunched into a 90-degree arc: the worst realistic case.
    const circle = fitCircle([
      onCircle(300, 250, 190, 200),
      onCircle(300, 250, 190, 245),
      onCircle(300, 250, 190, 290),
    ]);
    expect(circle!.cx).toBeCloseTo(300, 6);
    expect(circle!.cy).toBeCloseTo(250, 6);
    expect(circle!.r).toBeCloseTo(190, 6);
  });

  it('fits six noisy rim points to within half a pixel of radius', () => {
    const jitter = noise(20260906);
    const points = [15, 70, 130, 195, 260, 320].map((degrees) => {
      const p = onCircle(320.5, 240.25, 200.75, degrees);
      return { x: p.x + jitter(), y: p.y + jitter() };
    });
    const circle = fitCircle(points);
    expect(circle).not.toBeNull();
    expect(Math.abs(circle!.r - 200.75)).toBeLessThan(0.5);
    expect(Math.hypot(circle!.cx - 320.5, circle!.cy - 240.25)).toBeLessThan(0.5);
    expect(circleFitResidual(points, circle!)).toBeLessThan(0.5);
  });

  it('returns null rather than a NaN circle for degenerate input', () => {
    expect(fitCircle([])).toBeNull();
    expect(fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(fitCircle([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }])).toBeNull();
    expect(fitCircle([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull();
  });

  it('is unchanged by the order the rim points were clicked in', () => {
    const points = [onCircle(100, 100, 50, 10), onCircle(100, 100, 50, 140), onCircle(100, 100, 50, 250)];
    const forwards = fitCircle(points)!;
    const backwards = fitCircle([...points].reverse())!;
    expect(backwards.cx).toBeCloseTo(forwards.cx, 9);
    expect(backwards.cy).toBeCloseTo(forwards.cy, 9);
    expect(backwards.r).toBeCloseTo(forwards.r, 9);
  });
});
