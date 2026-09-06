/**
 * Body shape from the opened mask: centroid, second-moment ellipse (major
 * axis direction and lengths), the two contour extremes along the major axis,
 * and the tail direction from the pixels the opening removed.
 */
import type { Component } from './components.js';

export interface BodyEllipse {
  cx: number;
  cy: number;
  /** Unit vector along the major axis; `angle_rad` is in (−π/2, π/2], y down. */
  ux: number;
  uy: number;
  angle_rad: number;
  /** Semi-axis lengths, px (2 × the standard deviation along each axis). */
  major: number;
  minor: number;
}

export function ellipseFromComponent(c: Component): BodyEllipse {
  const n = c.area;
  const cx = c.sumX / n;
  const cy = c.sumY / n;
  // Central second moments plus the 1/12 extent of a unit pixel so that a
  // single pixel is not a degenerate ellipse.
  const cxx = c.sumXX / n - cx * cx + 1 / 12;
  const cyy = c.sumYY / n - cy * cy + 1 / 12;
  const cxy = c.sumXY / n - cx * cy;
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const half = (cxx + cyy) / 2;
  const spread = Math.sqrt(((cxx - cyy) / 2) * ((cxx - cyy) / 2) + cxy * cxy);
  const l1 = half + spread;
  const l2 = Math.max(0, half - spread);
  return {
    cx,
    cy,
    ux: Math.cos(angle),
    uy: Math.sin(angle),
    angle_rad: angle,
    major: 2 * Math.sqrt(l1),
    minor: 2 * Math.sqrt(l2),
  };
}

/** Contour extremes along the major axis: A farthest along +u, B farthest along −u. */
export interface AxisEnds {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export function axisExtremes(
  labels: Int32Array,
  width: number,
  c: Component,
  e: BodyEllipse,
): AxisEnds {
  let maxS = -Infinity;
  let minS = Infinity;
  let ax = e.cx;
  let ay = e.cy;
  let bx = e.cx;
  let by = e.cy;
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      if (labels[y * width + x] !== c.label) continue;
      const s = (x - e.cx) * e.ux + (y - e.cy) * e.uy;
      if (s > maxS) {
        maxS = s;
        ax = x;
        ay = y;
      }
      if (s < minS) {
        minS = s;
        bx = x;
        by = y;
      }
    }
  }
  return { ax, ay, bx, by };
}

/**
 * Unit direction from the body centroid to the centroid of the removed (tail)
 * pixels; null when too few pixels were removed or their centroid sits too
 * close to the body centroid (edge pixels removed all round, not a tail).
 */
export interface TailDirection {
  dx: number;
  dy: number;
  pixels: number;
}

export function tailDirection(
  bodyCx: number,
  bodyCy: number,
  tailSumX: number,
  tailSumY: number,
  pixels: number,
  minPixels: number,
  minOffset_px: number,
): TailDirection | null {
  if (pixels < minPixels || pixels <= 0) return null;
  const dx = tailSumX / pixels - bodyCx;
  const dy = tailSumY / pixels - bodyCy;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || len < minOffset_px) return null;
  return { dx: dx / len, dy: dy / len, pixels };
}

/** Contour extremes along `e`'s major axis over the union of several components (D48). */
export function axisExtremesMulti(
  labels: Int32Array,
  width: number,
  components: readonly Component[],
  e: BodyEllipse,
): AxisEnds {
  let maxS = -Infinity;
  let minS = Infinity;
  let ax = e.cx;
  let ay = e.cy;
  let bx = e.cx;
  let by = e.cy;
  for (const c of components) {
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        if (labels[y * width + x] !== c.label) continue;
        const s = (x - e.cx) * e.ux + (y - e.cy) * e.uy;
        if (s > maxS) {
          maxS = s;
          ax = x;
          ay = y;
        }
        if (s < minS) {
          minS = s;
          bx = x;
          by = y;
        }
      }
    }
  }
  return { ax, ay, bx, by };
}
