/**
 * Least-squares circle through three or more rim clicks. D13.
 *
 * Algebraic (Kåsa) fit: with the points centred on their mean, minimising
 * `Σ (xᵢ² + yᵢ² + A·xᵢ + B·yᵢ + C)²` is a 3×3 normal-equation system whose
 * first two rows decouple from the third, so the whole fit is one 2×2 solve.
 * Exact for three non-collinear points, which is the common case: the user
 * clicks three points on the platform rim and expects the circle through them.
 */
import type { PlatformCircle } from '../contracts/mazeMap.js';
import type { Point } from './types.js';

/** Relative determinant below which the points are treated as collinear. */
const DEGENERACY_RATIO = 1e-12;

/**
 * The circle through (or nearest to) `points`, or null when they are collinear,
 * coincident, or fewer than three — never a NaN circle.
 */
export function fitCircle(points: readonly Point[]): PlatformCircle | null {
  if (points.length < 3) return null;

  const n = points.length;
  let meanX = 0;
  let meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxs = 0;
  let sys = 0;
  let ss = 0;
  for (const p of points) {
    const x = p.x - meanX;
    const y = p.y - meanY;
    const s = x * x + y * y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxs += x * s;
    sys += y * s;
    ss += s;
  }

  const determinant = sxx * syy - sxy * sxy;
  // Scale-free degeneracy test: `sxx * syy` is the determinant's own magnitude.
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= DEGENERACY_RATIO * (sxx * syy + 1e-300)) {
    return null;
  }

  // Centre of the fitted circle in the centred frame: 2·(cx, cy) solves the 2×2 system.
  const cx = (syy * sxs - sxy * sys) / (2 * determinant);
  const cy = (sxx * sys - sxy * sxs) / (2 * determinant);
  const radiusSquared = cx * cx + cy * cy + ss / n;
  if (!(radiusSquared > 0) || !Number.isFinite(radiusSquared)) return null;

  return { cx: cx + meanX, cy: cy + meanY, r: Math.sqrt(radiusSquared) };
}

/** Root-mean-square distance of the points from the circle, in pixels. */
export function circleFitResidual(points: readonly Point[], circle: PlatformCircle): number {
  if (points.length === 0) return 0;
  let sum = 0;
  for (const p of points) {
    const error = Math.hypot(p.x - circle.cx, p.y - circle.cy) - circle.r;
    sum += error * error;
  }
  return Math.sqrt(sum / points.length);
}
