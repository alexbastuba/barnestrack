import { describe, expect, it } from 'vitest';
import {
  createLabelScratch,
  labelComponents,
  type Component,
} from '../../../src/analysis/tracker/components.js';
import {
  axisExtremes,
  ellipseFromComponent,
  tailDirection,
} from '../../../src/analysis/tracker/shape.js';

const width = 120;
const height = 120;

function ellipseMask(cx: number, cy: number, a: number, b: number, theta: number): Uint8Array {
  const img = new Uint8Array(width * height);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = ((x - cx) * cos + (y - cy) * sin) / a;
      const v = (-(x - cx) * sin + (y - cy) * cos) / b;
      if (u * u + v * v <= 1) img[y * width + x] = 1;
    }
  }
  return img;
}

function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) * 180) / Math.PI;
  d = ((d % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

describe('ellipseFromComponent and axisExtremes', () => {
  it.each([0, 25, 60, 90, 135, 170])(
    'recovers a %i° heading within 5° and finds the tips',
    (deg) => {
      const theta = (deg * Math.PI) / 180;
      const img = ellipseMask(60, 60, 18, 8, theta);
      const scratch = createLabelScratch(width, height);
      const out: Component[] = [];
      expect(
        labelComponents(img, { x0: 0, y0: 0, x1: width, y1: height }, scratch, null, 0, 0, out),
      ).toBe(1);
      const e = ellipseFromComponent(out[0]!);
      expect(e.cx).toBeCloseTo(60, 0);
      expect(e.cy).toBeCloseTo(60, 0);
      expect(angleDiffDeg(e.angle_rad, theta)).toBeLessThan(5);
      expect(e.major / e.minor).toBeGreaterThan(1.8);
      expect(e.major).toBeCloseTo(18, -1);
      const ends = axisExtremes(scratch.labels, width, out[0]!, e);
      const tipA = { x: 60 + 18 * Math.cos(theta), y: 60 + 18 * Math.sin(theta) };
      const tipB = { x: 60 - 18 * Math.cos(theta), y: 60 - 18 * Math.sin(theta) };
      const dA = Math.min(
        Math.hypot(ends.ax - tipA.x, ends.ay - tipA.y),
        Math.hypot(ends.ax - tipB.x, ends.ay - tipB.y),
      );
      const dB = Math.min(
        Math.hypot(ends.bx - tipA.x, ends.by - tipA.y),
        Math.hypot(ends.bx - tipB.x, ends.by - tipB.y),
      );
      expect(dA).toBeLessThan(3);
      expect(dB).toBeLessThan(3);
      // the two ends are on opposite tips
      expect(Math.hypot(ends.ax - ends.bx, ends.ay - ends.by)).toBeGreaterThan(30);
    },
  );
});

describe('tailDirection', () => {
  it('points from the body centroid to the removed pixels, or is null', () => {
    const t = tailDirection(10, 10, 5 * 4, 5 * 10, 5, 4, 3)!; // tail centroid at (4, 10)
    expect(t.dx).toBeCloseTo(-1);
    expect(t.dy).toBeCloseTo(0);
    expect(t.pixels).toBe(5);
    expect(tailDirection(10, 10, 12, 30, 3, 4, 3)).toBeNull(); // too few pixels
    expect(tailDirection(10, 10, 20, 20, 2, 1, 3)).toBeNull(); // coincident with the body centroid
    expect(tailDirection(10, 10, 5 * 12, 5 * 10, 5, 4, 3)).toBeNull(); // 2 px off: rounded edges, not a tail
  });
});
