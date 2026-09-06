/**
 * Reusing one maze map across a cohort. D10, D28, D29.
 *
 * The session holds one shared map — the physical maze — plus a
 * `SimilarityTransform` per video saying where that maze sits in that video's
 * pixels. Hole 7 is therefore hole 7 in every video, and a second video costs
 * a handful of clicks instead of twenty.
 *
 * A transform maps a point as `p' = T + s · R(θ) · p`, with θ in degrees and
 * y pointing down, so a positive θ turns clockwise on screen.
 */
import type { MazeMapFile, PlatformCircle, Resolution, SimilarityTransform } from '../contracts/mazeMap.js';
import { normaliseDeg, type Point } from './types.js';

export const IDENTITY_TRANSFORM: SimilarityTransform = {
  translateX: 0,
  translateY: 0,
  rotationDeg: 0,
  scale: 1,
};

function sinCos(rotationDeg: number): { sin: number; cos: number } {
  const radians = (rotationDeg * Math.PI) / 180;
  return { sin: Math.sin(radians), cos: Math.cos(radians) };
}

export function applyTransform(transform: SimilarityTransform, point: Point): Point {
  const { sin, cos } = sinCos(transform.rotationDeg);
  return {
    x: transform.scale * (cos * point.x - sin * point.y) + transform.translateX,
    y: transform.scale * (sin * point.x + cos * point.y) + transform.translateY,
  };
}

/** The rotation and scale only: what a displacement (a per-hole nudge) is subject to. */
export function transformVector(transform: SimilarityTransform, vector: Point): Point {
  const { sin, cos } = sinCos(transform.rotationDeg);
  return {
    x: transform.scale * (cos * vector.x - sin * vector.y),
    y: transform.scale * (sin * vector.x + cos * vector.y),
  };
}

export function invertTransform(transform: SimilarityTransform): SimilarityTransform {
  const scale = 1 / transform.scale;
  const rotationDeg = -transform.rotationDeg;
  const { sin, cos } = sinCos(rotationDeg);
  return {
    scale,
    rotationDeg: normaliseDeg(rotationDeg),
    translateX: -scale * (cos * transform.translateX - sin * transform.translateY),
    translateY: -scale * (sin * transform.translateX + cos * transform.translateY),
  };
}

/** `outer ∘ inner`: apply `inner` first, then `outer`. */
export function composeTransform(
  outer: SimilarityTransform,
  inner: SimilarityTransform,
): SimilarityTransform {
  const translated = applyTransform(outer, { x: inner.translateX, y: inner.translateY });
  return {
    scale: outer.scale * inner.scale,
    rotationDeg: normaliseDeg(outer.rotationDeg + inner.rotationDeg),
    translateX: translated.x,
    translateY: translated.y,
  };
}

/**
 * The least-squares similarity taking `from` onto `to` (Umeyama, reflection
 * excluded). Two correspondences determine it exactly; three or more are fitted.
 * Returns null when the source points coincide, so there is nothing to scale.
 */
export function fitSimilarity(
  from: readonly Point[],
  to: readonly Point[],
): SimilarityTransform | null {
  const n = Math.min(from.length, to.length);
  if (n < 2) return null;

  let fromMeanX = 0;
  let fromMeanY = 0;
  let toMeanX = 0;
  let toMeanY = 0;
  for (let i = 0; i < n; i++) {
    fromMeanX += from[i]!.x;
    fromMeanY += from[i]!.y;
    toMeanX += to[i]!.x;
    toMeanY += to[i]!.y;
  }
  fromMeanX /= n;
  fromMeanY /= n;
  toMeanX /= n;
  toMeanY /= n;

  // `dot` and `cross` are the two independent parts of the 2×2 cross-covariance
  // that a rotation-plus-scale can express; their angle is θ and their magnitude
  // over the source variance is s.
  let dot = 0;
  let cross = 0;
  let fromVariance = 0;
  for (let i = 0; i < n; i++) {
    const ax = from[i]!.x - fromMeanX;
    const ay = from[i]!.y - fromMeanY;
    const bx = to[i]!.x - toMeanX;
    const by = to[i]!.y - toMeanY;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    fromVariance += ax * ax + ay * ay;
  }
  if (!(fromVariance > 0)) return null;

  const magnitude = Math.hypot(dot, cross);
  if (!(magnitude > 0)) return null;

  const rotationDeg = normaliseDeg((Math.atan2(cross, dot) * 180) / Math.PI);
  const scale = magnitude / fromVariance;
  const rotatedMean = applyTransform(
    { scale, rotationDeg, translateX: 0, translateY: 0 },
    { x: fromMeanX, y: fromMeanY },
  );
  return {
    scale,
    rotationDeg,
    translateX: toMeanX - rotatedMean.x,
    translateY: toMeanY - rotatedMean.y,
  };
}

/**
 * A rotation about a fixed point, as a similarity. Rotating a video's maze
 * transform about its own platform centre turns the hole ring where it stands,
 * which is what "align the ring on this video" means (D10: the map is shared,
 * the fit onto each video is the per-video transform).
 */
export function rotationAbout(degrees: number, centre: Point): SimilarityTransform {
  const spun = applyTransform(
    { scale: 1, rotationDeg: degrees, translateX: 0, translateY: 0 },
    centre,
  );
  return {
    scale: 1,
    rotationDeg: normaliseDeg(degrees),
    translateX: centre.x - spun.x,
    translateY: centre.y - spun.y,
  };
}

/**
 * The transform taking circle `from` onto circle `to`. Built from three
 * correspondences so there is one fitting routine, not two: a circle carries no
 * orientation, so the fit comes back with rotation 0 and the map's `phase_deg`,
 * `target` and `offsets` survive an "Adjust" untouched (D10).
 */
export function transformFromCircles(
  from: PlatformCircle,
  to: PlatformCircle,
): SimilarityTransform | null {
  if (!(from.r > 0) || !(to.r > 0)) return null;
  return fitSimilarity(
    [
      { x: from.cx, y: from.cy },
      { x: from.cx + from.r, y: from.cy },
      { x: from.cx, y: from.cy + from.r },
    ],
    [
      { x: to.cx, y: to.cy },
      { x: to.cx + to.r, y: to.cy },
      { x: to.cx, y: to.cy + to.r },
    ],
  );
}

export function transformCircle(
  transform: SimilarityTransform,
  circle: PlatformCircle,
): PlatformCircle {
  const centre = applyTransform(transform, { x: circle.cx, y: circle.cy });
  return { cx: centre.x, cy: centre.y, r: circle.r * transform.scale };
}

/**
 * The shared map expressed in one video's pixels. Everything that is a length
 * scales, the phase turns with the rotation, and the per-hole nudges move as
 * displacements.
 */
export function transformMap(
  map: MazeMapFile,
  transform: SimilarityTransform,
  referenceResolution: Resolution,
): MazeMapFile {
  const offsets = map.holes.offsets?.map((offset) => {
    const moved = transformVector(transform, { x: offset.dx_px, y: offset.dy_px });
    return { holeIndex: offset.holeIndex, dx_px: moved.x, dy_px: moved.y };
  });
  return {
    ...map,
    referenceResolution,
    platform: transformCircle(transform, map.platform),
    holes: {
      ...map.holes,
      holeRadius_px: map.holes.holeRadius_px * transform.scale,
      phase_deg: normaliseDeg(map.holes.phase_deg + transform.rotationDeg),
      ...(offsets ? { offsets } : {}),
    },
  };
}

/**
 * The starting transform when a map made at one resolution is applied to a video
 * at another: scale by the width ratio, no rotation, no translation (D29). The
 * user adjusts from there with three rim clicks if the rig moved.
 */
export function transformForResolution(from: Resolution, to: Resolution): SimilarityTransform {
  const scale = from.width > 0 ? to.width / from.width : 1;
  return { ...IDENTITY_TRANSFORM, scale };
}
