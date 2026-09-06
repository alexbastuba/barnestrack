/**
 * Foreground = max(0, background − frame) inside the platform mask, binarised
 * at one threshold per video: Otsu over the difference histogram accumulated
 * across the background sample frames, or the manual value (D6).
 */
import type { PlatformMask, PixelRect } from './mask.js';
import type { ThresholdMode, TrackingParameters } from './params.js';

export interface ThresholdChoice {
  /** Smallest background-minus-frame difference (1–255) counted as foreground. */
  value: number;
  mode: ThresholdMode;
}

/** Adds the masked `max(0, background − frame)` values of one frame to a 256-bin histogram. */
export function accumulateDiffHistogram(
  background: Uint8Array,
  frame: Uint8Array,
  mask: PlatformMask,
  histogram: Uint32Array,
): void {
  const { width, spans } = mask;
  for (let y = mask.bbox.y0; y < mask.bbox.y1; y++) {
    const x0 = spans[2 * y]!;
    const x1 = spans[2 * y + 1]!;
    const row = y * width;
    for (let p = row + x0; p < row + x1; p++) {
      const d = background[p]! - frame[p]!;
      const bin = d > 0 ? d : 0;
      histogram[bin] = histogram[bin]! + 1;
    }
  }
}

/**
 * Otsu's split of a 256-bin histogram: the largest `t` maximising the
 * between-class variance of classes [0..t] and [t+1..255]; ties go to the
 * lowest `t`. Returns 0 for a degenerate histogram.
 */
export function otsuSplit(histogram: Uint32Array): number {
  let total = 0;
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    total += histogram[v]!;
    sum += v * histogram[v]!;
  }
  if (total === 0) return 0;
  let weightBelow = 0;
  let sumBelow = 0;
  let best = -1;
  let bestT = 0;
  for (let t = 0; t < 255; t++) {
    weightBelow += histogram[t]!;
    sumBelow += t * histogram[t]!;
    const weightAbove = total - weightBelow;
    if (weightBelow === 0) continue;
    if (weightAbove === 0) break;
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) * (meanBelow - meanAbove);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

/** The smallest difference counted as foreground under Otsu: split + 1 (always ≥ 1). */
export function otsuThreshold(histogram: Uint32Array): number {
  return otsuSplit(histogram) + 1;
}

/** One threshold per video from the sample frames (Otsu) or the parameters (manual). */
export function chooseThreshold(
  background: Uint8Array,
  samples: readonly Uint8Array[],
  mask: PlatformMask,
  params: TrackingParameters,
): ThresholdChoice {
  if (params.threshold.mode === 'manual') {
    const value = Math.round(params.threshold.manualValue);
    if (!(value >= 1 && value <= 255)) {
      throw new RangeError(`manual threshold must be 1–255, got ${params.threshold.manualValue}`);
    }
    return { value, mode: 'manual' };
  }
  const histogram = new Uint32Array(256);
  for (const frame of samples) accumulateDiffHistogram(background, frame, mask, histogram);
  return { value: otsuThreshold(histogram), mode: 'otsu' };
}

export interface ForegroundExtent {
  /** Foreground pixels inside the mask. */
  count: number;
  /** Bounding rectangle of the foreground pixels; empty when `count` is 0. */
  bbox: PixelRect;
}

/**
 * Writes `diff = max(0, background − frame)` and `fg = diff ≥ threshold` for
 * every masked pixel (both buffers are fully rewritten inside the mask and
 * must be zero outside it, which they are once allocated).
 */
export function binarizeForeground(
  background: Uint8Array,
  frame: Uint8Array,
  mask: PlatformMask,
  threshold: number,
  diff: Uint8Array,
  fg: Uint8Array,
): ForegroundExtent {
  const { width, spans } = mask;
  let count = 0;
  let bx0 = width;
  let bx1 = 0;
  let by0 = mask.height;
  let by1 = 0;
  for (let y = mask.bbox.y0; y < mask.bbox.y1; y++) {
    const x0 = spans[2 * y]!;
    const x1 = spans[2 * y + 1]!;
    const row = y * width;
    let rowHit = false;
    for (let x = x0; x < x1; x++) {
      const p = row + x;
      const d = background[p]! - frame[p]!;
      if (d >= threshold) {
        diff[p] = d;
        fg[p] = 1;
        count++;
        rowHit = true;
        if (x < bx0) bx0 = x;
        if (x + 1 > bx1) bx1 = x + 1;
      } else {
        diff[p] = d > 0 ? d : 0;
        fg[p] = 0;
      }
    }
    if (rowHit) {
      if (y < by0) by0 = y;
      by1 = y + 1;
    }
  }
  return count > 0
    ? { count, bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 } }
    : { count: 0, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } };
}
