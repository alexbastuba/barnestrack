/**
 * Platform disc mask: the circle grown by the mask margin, as a byte image
 * plus per-row spans so the per-frame loops touch only masked pixels.
 */
import type { PlatformCircle } from './calibration.js';

/** Half-open pixel rectangle: x in [x0, x1), y in [y0, y1). */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlatformMask {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius_px: number;
  /** 1 inside the grown disc, 0 outside. */
  bytes: Uint8Array;
  /** Per row `y`: `spans[2y]` = first x inside, `spans[2y + 1]` = one past the last; equal when the row is empty. */
  spans: Int32Array;
  /** Bounding rectangle of the masked pixels (empty when `pixelCount` is 0). */
  bbox: PixelRect;
  pixelCount: number;
}

export function platformMask(
  width: number,
  height: number,
  platform: PlatformCircle,
  radius_px: number,
): PlatformMask {
  if (!(radius_px > 0)) throw new RangeError(`mask radius must be positive, got ${radius_px}`);
  const bytes = new Uint8Array(width * height);
  const spans = new Int32Array(height * 2);
  const r2 = radius_px * radius_px;
  let pixelCount = 0;
  let bx0 = width;
  let bx1 = 0;
  let by0 = height;
  let by1 = 0;
  for (let y = 0; y < height; y++) {
    const dy = y - platform.cy;
    const hw2 = r2 - dy * dy;
    let x0 = 0;
    let x1 = 0;
    if (hw2 >= 0) {
      const hw = Math.sqrt(hw2);
      x0 = Math.max(0, Math.ceil(platform.cx - hw));
      x1 = Math.min(width, Math.floor(platform.cx + hw) + 1);
      if (x1 <= x0) {
        x0 = 0;
        x1 = 0;
      }
    }
    spans[2 * y] = x0;
    spans[2 * y + 1] = x1;
    if (x1 > x0) {
      bytes.fill(1, y * width + x0, y * width + x1);
      pixelCount += x1 - x0;
      if (x0 < bx0) bx0 = x0;
      if (x1 > bx1) bx1 = x1;
      if (y < by0) by0 = y;
      by1 = y + 1;
    }
  }
  const bbox: PixelRect =
    pixelCount > 0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    width,
    height,
    cx: platform.cx,
    cy: platform.cy,
    radius_px,
    bytes,
    spans,
    bbox,
    pixelCount,
  };
}

export function intersectRects(a: PixelRect, b: PixelRect): PixelRect {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

export function growRect(r: PixelRect, by: number, width: number, height: number): PixelRect {
  if (r.x1 <= r.x0 || r.y1 <= r.y0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.max(0, r.x0 - by),
    y0: Math.max(0, r.y0 - by),
    x1: Math.min(width, r.x1 + by),
    y1: Math.min(height, r.y1 + by),
  };
}

export function isEmptyRect(r: PixelRect): boolean {
  return r.x1 <= r.x0 || r.y1 <= r.y0;
}

/** Zeroes `buf` inside `rect` (row-major image of `width` columns). */
export function clearRect(buf: Uint8Array | Int32Array, width: number, rect: PixelRect): void {
  for (let y = rect.y0; y < rect.y1; y++) buf.fill(0, y * width + rect.x0, y * width + rect.x1);
}
