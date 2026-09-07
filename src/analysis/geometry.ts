/**
 * Everything spatial the analysis needs about one video, computed once from
 * the shared maze map and this video's transform (D10, D44, D49): platform
 * circle and hole centres in video pixels, px/cm, the target, the O6 target
 * sector, the O7 centre zone and the event radii in pixels. Nothing else under
 * `src/analysis/` recomputes any of this.
 *
 * Hole centres are `holeCentres(transformMap(map, transform))`, exactly as the
 * maze step draws them; px/cm is `pxPerCm` of the transformed platform circle.
 */
import type {
  MazeMapFile,
  PlatformCircle,
  Resolution,
  SimilarityTransform,
} from '../contracts/mazeMap.js';
import type { Parameters } from '../contracts/parameters.js';
import { holeCentres, pxPerCm as platformPxPerCm, ringRadius } from '../maze/ring.js';
import { transformMap } from '../maze/similarity.js';
import { angleDifferenceDeg, normaliseDeg } from '../maze/types.js';

export interface HoleCentre {
  holeIndex: number;
  x: number;
  y: number;
}

export interface TargetSector {
  /** Angle of the target hole from the platform centre, degrees, y down. */
  centreAngleDeg: number;
  /** Half the sector's opening: `holeSpan × 360 / n` degrees (O6). */
  halfAngleDeg: number;
}

export interface MazeGeometry {
  /** Platform circle in this video's pixels. */
  platform: PlatformCircle;
  holeCount: number;
  /** Hole centres in video pixels, indexed by hole number. */
  holeX: Float64Array;
  holeY: Float64Array;
  holes: readonly HoleCentre[];
  targetIndex: number;
  holeRadius_px: number;
  holeRadius_cm: number;
  ringRadius_px: number;
  pxPerCm: number;
  platformDiameter_cm: number;
  sector: TargetSector;
  /** O7 centre zone radius, px. */
  centreZoneRadius_px: number;
  /** O1 `holeInvestigation.radiusFactor × holeRadius`, px. */
  investigationRadius_px: number;
  /** O4 `escapeEntry.radiusFactor × holeRadius`, px. */
  escapeRadius_px: number;
  /** O10 hole-adjacent rule: one hole radius, px. */
  fillExclusionRadius_px: number;
}

export interface GeometryInput {
  map: MazeMapFile;
  transform: SimilarityTransform;
  referenceResolution: Resolution;
  parameters: Parameters;
}

export function mazeGeometry(input: GeometryInput): MazeGeometry {
  const { map, transform, referenceResolution, parameters } = input;
  if (!Number.isInteger(map.holes.n) || map.holes.n < 1) {
    throw new RangeError(
      `maze map holes.n must be a whole number of at least 1, got ${map.holes.n}`,
    );
  }
  if (
    !Number.isInteger(map.target.holeIndex) ||
    map.target.holeIndex < 0 ||
    map.target.holeIndex >= map.holes.n
  ) {
    throw new RangeError(
      `maze map target.holeIndex must name one of ${map.holes.n} holes, got ${map.target.holeIndex}`,
    );
  }
  if (!(transform.scale > 0) || !Number.isFinite(transform.scale)) {
    throw new RangeError(`maze transform scale must be positive, got ${transform.scale}`);
  }
  const placed = transformMap(map, transform, referenceResolution);
  const pxPerCm = platformPxPerCm(placed.platform, placed.calibration.platformDiameter_cm);
  if (pxPerCm === null || !Number.isFinite(pxPerCm)) {
    throw new RangeError(
      `cannot calibrate: platform radius ${placed.platform.r} px and diameter ${placed.calibration.platformDiameter_cm} cm must both be positive`,
    );
  }
  if (!(placed.holes.holeRadius_px > 0)) {
    throw new RangeError(`maze map holeRadius_px must be positive, got ${map.holes.holeRadius_px}`);
  }
  const centres = holeCentres(placed);
  const holeX = new Float64Array(centres.length);
  const holeY = new Float64Array(centres.length);
  const holes: HoleCentre[] = [];
  for (const c of centres) {
    holeX[c.holeIndex] = c.x;
    holeY[c.holeIndex] = c.y;
    holes.push({ holeIndex: c.holeIndex, x: c.x, y: c.y });
  }
  const target = placed.target.holeIndex;
  const platform = placed.platform;
  const centreAngleDeg = normaliseDeg(
    (Math.atan2(holeY[target]! - platform.cy, holeX[target]! - platform.cx) * 180) / Math.PI,
  );
  const holeRadius_px = placed.holes.holeRadius_px;
  return {
    platform,
    holeCount: placed.holes.n,
    holeX,
    holeY,
    holes,
    targetIndex: target,
    holeRadius_px,
    holeRadius_cm: holeRadius_px / pxPerCm,
    ringRadius_px: ringRadius(platform, placed.holes),
    pxPerCm,
    platformDiameter_cm: placed.calibration.platformDiameter_cm,
    sector: {
      centreAngleDeg,
      halfAngleDeg: (parameters.targetQuadrant.holeSpan * 360) / placed.holes.n,
    },
    centreZoneRadius_px: parameters.strategy.centreZoneRadiusFraction * platform.r,
    investigationRadius_px: parameters.holeInvestigation.radiusFactor * holeRadius_px,
    escapeRadius_px: parameters.escapeEntry.radiusFactor * holeRadius_px,
    fillExclusionRadius_px: holeRadius_px,
  };
}

/** Index of the hole centre nearest to a video-pixel point (the lowest index on a tie). */
export function nearestHoleIndex(g: MazeGeometry, x: number, y: number): number {
  let best = 0;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let k = 0; k < g.holeCount; k++) {
    const dx = x - g.holeX[k]!;
    const dy = y - g.holeY[k]!;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = k;
    }
  }
  return best;
}

export function distanceToHole_px(
  g: MazeGeometry,
  x: number,
  y: number,
  holeIndex: number,
): number {
  return Math.hypot(x - g.holeX[holeIndex]!, y - g.holeY[holeIndex]!);
}

export function distanceToHole_cm(
  g: MazeGeometry,
  x: number,
  y: number,
  holeIndex: number,
): number {
  return distanceToHole_px(g, x, y, holeIndex) / g.pxPerCm;
}

/** Nearest hole and the distance to it, in cm. */
export function nearestHole(
  g: MazeGeometry,
  x: number,
  y: number,
): { holeIndex: number; distance_cm: number } {
  const holeIndex = nearestHoleIndex(g, x, y);
  return { holeIndex, distance_cm: distanceToHole_cm(g, x, y, holeIndex) };
}

/** Number of holes between two hole indices around the ring, the short way. */
export function holeIndexDistance(
  g: Pick<MazeGeometry, 'holeCount'>,
  a: number,
  b: number,
): number {
  const d = Math.abs(a - b) % g.holeCount;
  return Math.min(d, g.holeCount - d);
}

export function distanceFromCentre_px(g: MazeGeometry, x: number, y: number): number {
  return Math.hypot(x - g.platform.cx, y - g.platform.cy);
}

export function distanceFromCentre_cm(g: MazeGeometry, x: number, y: number): number {
  return distanceFromCentre_px(g, x, y) / g.pxPerCm;
}

export function inPlatform(g: MazeGeometry, x: number, y: number): boolean {
  return distanceFromCentre_px(g, x, y) <= g.platform.r;
}

export function inCentreZone(g: MazeGeometry, x: number, y: number): boolean {
  return distanceFromCentre_px(g, x, y) < g.centreZoneRadius_px;
}

/** True inside the O6 target sector (any distance from the centre; the centre itself counts). */
export function inSector(g: MazeGeometry, x: number, y: number): boolean {
  const dx = x - g.platform.cx;
  const dy = y - g.platform.cy;
  if (dx === 0 && dy === 0) return true;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.abs(angleDifferenceDeg(angle, g.sector.centreAngleDeg)) <= g.sector.halfAngleDeg;
}

export function pxToCm(g: Pick<MazeGeometry, 'pxPerCm'>, px: number): number {
  return px / g.pxPerCm;
}

export function cmToPx(g: Pick<MazeGeometry, 'pxPerCm'>, cm: number): number {
  return cm * g.pxPerCm;
}
