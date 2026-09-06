/**
 * Binary opening with a disc structuring element (erode then dilate): the
 * tail-removal step of D6. Everything thinner than the disc's diameter
 * disappears; the body survives with its outline slightly smoothed.
 */
import { clearRect, growRect, type PixelRect } from './mask.js';

export interface DiscOffsets {
  radius: number;
  count: number;
  dx: Int32Array;
  dy: Int32Array;
}

/** Offsets `(dx, dy)` with `dx² + dy² ≤ r²`, `r = round(radius_px)`; the centre first. */
export function discOffsets(radius_px: number): DiscOffsets {
  const r = Math.max(0, Math.round(radius_px));
  const dx: number[] = [0];
  const dy: number[] = [0];
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x === 0 && y === 0) continue;
      if (x * x + y * y <= r * r) {
        dx.push(x);
        dy.push(y);
      }
    }
  }
  return { radius: r, count: dx.length, dx: Int32Array.from(dx), dy: Int32Array.from(dy) };
}

/**
 * `dst[p] = 1` where every disc offset around `p` is set in `src` (offsets
 * outside the image count as unset). Only pixels inside `bbox` are written;
 * `dst` must already be zero there.
 */
export function erodeBinary(
  src: Uint8Array,
  width: number,
  height: number,
  bbox: PixelRect,
  disc: DiscOffsets,
  dst: Uint8Array,
): PixelRect {
  const { dx, dy, count } = disc;
  let bx0 = width;
  let bx1 = 0;
  let by0 = height;
  let by1 = 0;
  for (let y = bbox.y0; y < bbox.y1; y++) {
    let rowHit = false;
    for (let x = bbox.x0; x < bbox.x1; x++) {
      const p = y * width + x;
      if (src[p] === 0) continue;
      let keep = true;
      for (let k = 1; k < count; k++) {
        const xx = x + dx[k]!;
        const yy = y + dy[k]!;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || src[yy * width + xx] === 0) {
          keep = false;
          break;
        }
      }
      if (keep) {
        dst[p] = 1;
        rowHit = true;
        if (x < bx0) bx0 = x;
        if (x + 1 > bx1) bx1 = x + 1;
      }
    }
    if (rowHit) {
      if (y < by0) by0 = y;
      by1 = y + 1;
    }
  }
  return bx1 > bx0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** Paints the disc around every set pixel of `src` inside `bbox` into `dst`. */
export function dilateBinary(
  src: Uint8Array,
  width: number,
  height: number,
  bbox: PixelRect,
  disc: DiscOffsets,
  dst: Uint8Array,
): PixelRect {
  const { dx, dy, count } = disc;
  for (let y = bbox.y0; y < bbox.y1; y++) {
    for (let x = bbox.x0; x < bbox.x1; x++) {
      if (src[y * width + x] === 0) continue;
      for (let k = 0; k < count; k++) {
        const xx = x + dx[k]!;
        const yy = y + dy[k]!;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height) dst[yy * width + xx] = 1;
      }
    }
  }
  return growRect(bbox, disc.radius, width, height);
}

/**
 * Opening restricted to `bbox` (the extent of the set pixels of `src`).
 * `eroded` and `dst` are scratch/output images that must be zero over the
 * region this call writes (`bbox` grown by the disc radius); the caller
 * clears the previous frame's region with `clearRect`.
 * Returns the extent of the result (empty when nothing survived).
 */
export function openBinary(
  src: Uint8Array,
  width: number,
  height: number,
  bbox: PixelRect,
  disc: DiscOffsets,
  eroded: Uint8Array,
  dst: Uint8Array,
): PixelRect {
  const erodedBox = erodeBinary(src, width, height, bbox, disc, eroded);
  if (erodedBox.x1 <= erodedBox.x0) return erodedBox;
  return dilateBinary(eroded, width, height, erodedBox, disc, dst);
}

export { clearRect };
