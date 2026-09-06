/**
 * Harness-only proposal of the platform circle from the median background:
 * Otsu bright threshold → largest bright component → centroid and radius
 * from area → least-squares refit on the outermost boundary pixel per angle
 * bin (two outlier-rejection passes). Not part of the product; a candidate seed for the
 * automatic maze map (D42). Constants live in `PLATFORM_ESTIMATE_MODEL`.
 */
import type { PlatformCircle } from '../../src/analysis/tracker/calibration.js';
import {
  createLabelScratch,
  labelComponents,
  type Component,
} from '../../src/analysis/tracker/components.js';
import { otsuSplit } from '../../src/analysis/tracker/foreground.js';
import { PLATFORM_ESTIMATE_MODEL } from '../../src/analysis/tracker/params.js';

export interface PlatformEstimate {
  /** Refit circle. */
  circle: PlatformCircle;
  /** Centroid + area radius of the bright component, before the refit. */
  firstPass: PlatformCircle;
  brightAbove: number;
  /** Boundary pixels of the bright component (before taking the outermost per angle bin). */
  boundaryPixels: number;
  rimPoints: number;
  rimPointsAfterRejection: number;
  rmsResidual_px: number;
}

interface Point {
  x: number;
  y: number;
}

/** Kåsa algebraic circle fit: minimises Σ (x² + y² + Dx + Ey + F)². */
function fitCircle(points: readonly Point[]): PlatformCircle {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  const n = points.length;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    syy += p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] · [D E F]ᵀ = −[sxz syz sz]ᵀ by Cramer's rule.
  const a = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [-sxz, -syz, -sz];
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(a);
  if (Math.abs(d) < 1e-9) throw new Error('circle fit is degenerate');
  const col = (k: number) => a.map((row, i) => row.map((v, j) => (j === k ? b[i]! : v)));
  const D = det(col(0)) / d;
  const E = det(col(1)) / d;
  const F = det(col(2)) / d;
  const cx = -D / 2;
  const cy = -E / 2;
  return { cx, cy, r: Math.sqrt(Math.max(0, cx * cx + cy * cy - F)) };
}

export function estimatePlatformCircle(
  background: Uint8Array,
  width: number,
  height: number,
): PlatformEstimate {
  const histogram = new Uint32Array(256);
  for (let p = 0; p < background.length; p++)
    histogram[background[p]!] = histogram[background[p]!]! + 1;
  const brightAbove = otsuSplit(histogram);
  const bright = new Uint8Array(width * height);
  for (let p = 0; p < background.length; p++) if (background[p]! > brightAbove) bright[p] = 1;

  const scratch = createLabelScratch(width, height);
  const components: Component[] = [];
  const count = labelComponents(
    bright,
    { x0: 0, y0: 0, x1: width, y1: height },
    scratch,
    null,
    0,
    0,
    components,
  );
  if (count === 0) throw new Error('no bright region found in the background');
  let largest = components[0]!;
  for (let i = 1; i < count; i++) if (components[i]!.area > largest.area) largest = components[i]!;
  const firstPass: PlatformCircle = {
    cx: largest.sumX / largest.area,
    cy: largest.sumY / largest.area,
    r: Math.sqrt(largest.area / Math.PI),
  };

  // Rim points: the outermost boundary pixel of the component in each angle bin
  // around the first-pass centre (hole rims are interior, never outermost).
  const labels = scratch.labels;
  const bins = PLATFORM_ESTIMATE_MODEL.angleBins;
  const farthest = new Float64Array(bins).fill(-1);
  const farX = new Float64Array(bins);
  const farY = new Float64Array(bins);
  let boundaryPixels = 0;
  for (let y = largest.minY; y <= largest.maxY; y++) {
    for (let x = largest.minX; x <= largest.maxX; x++) {
      const p = y * width + x;
      if (labels[p] !== largest.label) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        labels[p - 1] !== largest.label ||
        labels[p + 1] !== largest.label ||
        labels[p - width] !== largest.label ||
        labels[p + width] !== largest.label;
      if (!edge) continue;
      boundaryPixels++;
      const dx = x - firstPass.cx;
      const dy = y - firstPass.cy;
      const d = Math.hypot(dx, dy);
      const bin = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * bins) % bins;
      if (d > farthest[bin]!) {
        farthest[bin] = d;
        farX[bin] = x;
        farY[bin] = y;
      }
    }
  }
  const rim: Point[] = [];
  for (let b = 0; b < bins; b++) if (farthest[b]! >= 0) rim.push({ x: farX[b]!, y: farY[b]! });
  if (rim.length < 3) throw new Error('too few rim points for a circle fit');

  const residuals = (c: PlatformCircle, pts: readonly Point[]) =>
    pts.map((p) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r));
  const first = fitCircle(rim);
  const res1 = residuals(first, rim);
  const mad = Float64Array.from(res1).sort()[(res1.length - 1) >> 1]!;
  const cut1 = Math.max(
    PLATFORM_ESTIMATE_MODEL.outlierResidual_px,
    PLATFORM_ESTIMATE_MODEL.madFactor * mad,
  );
  const pass1 = rim.filter((_, i) => res1[i]! <= cut1);
  const second = pass1.length >= 3 ? fitCircle(pass1) : first;
  const res2 = residuals(second, pass1);
  const kept = pass1.filter((_, i) => res2[i]! <= PLATFORM_ESTIMATE_MODEL.outlierResidual_px);
  const circle = kept.length >= 3 ? fitCircle(kept) : second;
  let ss = 0;
  for (const e of residuals(circle, kept)) ss += e * e;
  return {
    circle,
    firstPass,
    brightAbove,
    boundaryPixels,
    rimPoints: rim.length,
    rimPointsAfterRejection: kept.length,
    rmsResidual_px: kept.length > 0 ? Math.sqrt(ss / kept.length) : NaN,
  };
}
