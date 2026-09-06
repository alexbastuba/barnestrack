import { describe, expect, it } from 'vitest';
import {
  createLabelScratch,
  labelComponents,
  type Component,
} from '../../../src/analysis/tracker/components.js';

const width = 40;
const height = 30;

function rect(img: Uint8Array, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) img.fill(1, y * width + x0, y * width + x0 + w);
}

describe('labelComponents', () => {
  it('reports area, bbox, centroid, summed diff and rim distance per component', () => {
    const img = new Uint8Array(width * height);
    rect(img, 2, 3, 4, 2); // 8 px
    rect(img, 20, 10, 5, 5); // 25 px
    const diff = new Uint8Array(width * height).fill(10);
    const scratch = createLabelScratch(width, height);
    const out: Component[] = [];
    const n = labelComponents(
      img,
      { x0: 0, y0: 0, x1: width, y1: height },
      scratch,
      diff,
      0,
      0,
      out,
    );
    expect(n).toBe(2);
    const a = out[0]!;
    expect([a.area, a.minX, a.minY, a.maxX, a.maxY]).toEqual([8, 2, 3, 5, 4]);
    expect(a.sumX / a.area).toBeCloseTo(3.5);
    expect(a.sumY / a.area).toBeCloseTo(3.5);
    expect(a.sumDiff).toBe(80);
    expect(a.maxDist2).toBe(5 * 5 + 4 * 4);
    const b = out[1]!;
    expect([b.area, b.minX, b.minY, b.maxX, b.maxY]).toEqual([25, 20, 10, 24, 14]);
    expect(b.sumX / b.area).toBeCloseTo(22);
    expect(b.sumY / b.area).toBeCloseTo(12);
    expect(scratch.labels[3 * width + 2]).toBe(1);
    expect(scratch.labels[12 * width + 22]).toBe(2);
  });

  it('is 8-connected', () => {
    const img = new Uint8Array(width * height);
    img[5 * width + 5] = 1;
    img[6 * width + 6] = 1; // diagonal neighbour
    img[8 * width + 8] = 1; // separate
    const out: Component[] = [];
    const n = labelComponents(
      img,
      { x0: 0, y0: 0, x1: width, y1: height },
      createLabelScratch(width, height),
      null,
      0,
      0,
      out,
    );
    expect(n).toBe(2);
    expect(out[0]!.area).toBe(2);
    expect(out[1]!.area).toBe(1);
  });

  it('reuses its output and label map across calls', () => {
    const scratch = createLabelScratch(width, height);
    const out: Component[] = [];
    const a = new Uint8Array(width * height);
    rect(a, 1, 1, 3, 3);
    rect(a, 10, 10, 2, 2);
    rect(a, 20, 20, 2, 2);
    expect(
      labelComponents(a, { x0: 0, y0: 0, x1: width, y1: height }, scratch, null, 0, 0, out),
    ).toBe(3);
    const b = new Uint8Array(width * height);
    rect(b, 5, 5, 4, 4);
    expect(labelComponents(b, { x0: 5, y0: 5, x1: 9, y1: 9 }, scratch, null, 0, 0, out)).toBe(1);
    expect(out[0]!.area).toBe(16);
    expect(out.length).toBe(3); // stale entries stay allocated but are not counted
    expect(scratch.labels[6 * width + 6]).toBe(1);
  });
});
