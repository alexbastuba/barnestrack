/**
 * Shared geometry types for `src/maze/`. Every coordinate in here is a native
 * video pixel with y pointing down (D15); zoom and pan are a view transform
 * only and never reach stored data.
 */
export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Degrees folded into [0, 360). */
export function normaliseDeg(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Signed difference `a − b` folded into (−180, 180]. */
export function angleDifferenceDeg(a: number, b: number): number {
  const difference = normaliseDeg(a - b);
  return difference > 180 ? difference - 360 : difference;
}
