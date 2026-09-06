/**
 * The live thumbnail of a running pass (D17): a downscaled copy of the current
 * luma plane, small enough to post from the worker several times a second.
 *
 * Box-averaged rather than nearest-neighbour, because a mouse a few pixels
 * across survives averaging and vanishes under point sampling — the thumbnail
 * exists so a person can see the animal moving.
 */

export interface PreviewPlane {
  gray: Uint8Array;
  width: number;
  height: number;
  /** Preview pixels per video pixel; multiply a video coordinate by this. */
  scale: number;
}

/** Integer downscale factor putting the longest edge at or below `maxEdge`. */
export function previewScaleFactor(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || maxEdge <= 0) return 1;
  return Math.ceil(longest / maxEdge);
}

/**
 * Averages each `factor` × `factor` block. Edge blocks average whatever pixels
 * they cover, so a size that is not a multiple of the factor does not darken
 * the last row or column.
 */
export function downscaleGray(
  gray: Uint8Array,
  width: number,
  height: number,
  maxEdge: number,
): PreviewPlane {
  if (gray.length !== width * height) {
    throw new RangeError(`plane has ${gray.length} bytes, expected ${width * height}`);
  }
  const factor = previewScaleFactor(width, height, maxEdge);
  if (factor === 1) {
    return { gray: gray.slice(), width, height, scale: 1 };
  }
  const outWidth = Math.ceil(width / factor);
  const outHeight = Math.ceil(height / factor);
  const out = new Uint8Array(outWidth * outHeight);

  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = oy * factor;
    const y1 = Math.min(y0 + factor, height);
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = ox * factor;
      const x1 = Math.min(x0 + factor, width);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) sum += gray[row + x]!;
      }
      out[oy * outWidth + ox] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { gray: out, width: outWidth, height: outHeight, scale: 1 / factor };
}
