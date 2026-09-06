import { describe, expect, it } from 'vitest';
import { discOffsets, openBinary } from '../../../src/analysis/tracker/morphology.js';

function image(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height);
}

function fillRect(
  img: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  for (let y = y0; y < y0 + h; y++) img.fill(1, y * width + x0, y * width + x0 + w);
}

describe('discOffsets', () => {
  it('lists every offset inside the rounded radius, centre first', () => {
    const d = discOffsets(3.6);
    expect(d.radius).toBe(4);
    expect(d.count).toBe(49);
    expect([d.dx[0], d.dy[0]]).toEqual([0, 0]);
    const has = (x: number, y: number) => {
      for (let k = 0; k < d.count; k++) if (d.dx[k] === x && d.dy[k] === y) return true;
      return false;
    };
    expect(has(4, 0)).toBe(true);
    expect(has(0, -4)).toBe(true);
    expect(has(3, 3)).toBe(false);
    expect(discOffsets(0).count).toBe(1);
  });
});

describe('openBinary', () => {
  const width = 100;
  const height = 60;

  it('removes a tail thinner than the disc and keeps the body', () => {
    const src = image(width, height);
    fillRect(src, width, 40, 20, 24, 14); // body
    fillRect(src, width, 10, 26, 30, 2); // 2-px tail joined to the body's left side
    const disc = discOffsets(3);
    const eroded = image(width, height);
    const dst = image(width, height);
    const box = openBinary(
      src,
      width,
      height,
      { x0: 10, y0: 20, x1: 64, y1: 34 },
      disc,
      eroded,
      dst,
    );
    // a stub of the tail base survives next to the body; the rest of the tail is gone
    expect(box.x0).toBeGreaterThanOrEqual(38);
    expect(box.x1).toBeLessThanOrEqual(64);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < 38; x++) expect(dst[y * width + x]).toBe(0);
    // the result is inside the body and keeps its interior
    let kept = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (dst[y * width + x]) {
          expect(src[y * width + x]).toBe(1);
          if (x >= 40) kept++;
        }
      }
    }
    expect(kept).toBeGreaterThan(24 * 14 * 0.85);
    for (let y = 23; y < 31; y++) for (let x = 43; x < 61; x++) expect(dst[y * width + x]).toBe(1);
  });

  it('returns an empty extent when nothing survives', () => {
    const src = image(width, height);
    fillRect(src, width, 10, 10, 30, 3);
    const disc = discOffsets(3);
    const box = openBinary(
      src,
      width,
      height,
      { x0: 10, y0: 10, x1: 40, y1: 13 },
      disc,
      image(width, height),
      image(width, height),
    );
    expect(box.x1).toBeLessThanOrEqual(box.x0);
  });
});
