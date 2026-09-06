/**
 * The live thumbnail's downscaler (D17). It must keep a small dark animal
 * visible — a mouse is a few pixels across in a 240 px thumbnail — and must
 * not darken the last row or column when the size is not a multiple of the
 * scale factor.
 */
import { describe, expect, it } from 'vitest';
import { downscaleGray, previewScaleFactor } from '../../src/video/preview.js';

describe('previewScaleFactor', () => {
  it('leaves a plane that is already small enough alone', () => {
    expect(previewScaleFactor(240, 180, 240)).toBe(1);
    expect(previewScaleFactor(100, 50, 240)).toBe(1);
  });

  it('picks the smallest integer factor that fits the longest edge', () => {
    expect(previewScaleFactor(640, 480, 240)).toBe(3); // 640 / 3 = 214
    expect(previewScaleFactor(1280, 720, 240)).toBe(6); // 1280 / 6 = 214
    expect(previewScaleFactor(480, 480, 240)).toBe(2);
  });
});

describe('downscaleGray', () => {
  it('copies rather than aliasing when no downscale is needed', () => {
    const gray = new Uint8Array(4 * 4).fill(9);
    const plane = downscaleGray(gray, 4, 4, 240);
    expect(plane.scale).toBe(1);
    expect(plane.gray).not.toBe(gray);
    gray.fill(200);
    expect(plane.gray[0]).toBe(9);
  });

  it('averages each block', () => {
    // 4×2, factor 2: blocks [[0,10],[20,30]] and [[40,50],[60,70]].
    const gray = new Uint8Array([0, 10, 40, 50, 20, 30, 60, 70]);
    const plane = downscaleGray(gray, 4, 2, 2);
    expect(plane.width).toBe(2);
    expect(plane.height).toBe(1);
    expect([...plane.gray]).toEqual([15, 55]);
    expect(plane.scale).toBe(0.5);
  });

  it('averages only the pixels an edge block covers', () => {
    // 3×1, factor 2: the second block is one pixel wide, so it is 90, not 45.
    const gray = new Uint8Array([10, 20, 90]);
    const plane = downscaleGray(gray, 3, 1, 2);
    expect([...plane.gray]).toEqual([15, 90]);
  });

  it('keeps a small dark blob visible against a bright ground', () => {
    const width = 640;
    const height = 480;
    const gray = new Uint8Array(width * height).fill(220);
    // A 14 px mouse — about what a mouse measures in these videos.
    for (let y = 200; y < 214; y++) {
      for (let x = 300; x < 314; x++) gray[y * width + x] = 30;
    }
    const plane = downscaleGray(gray, width, height, 240);
    let darkest = 255;
    for (const v of plane.gray) darkest = Math.min(darkest, v);
    expect(darkest).toBeLessThan(60);
    expect(plane.width).toBeLessThanOrEqual(240);
  });

  it('rejects a plane whose length does not match its size', () => {
    expect(() => downscaleGray(new Uint8Array(10), 4, 4, 2)).toThrow(RangeError);
  });
});
