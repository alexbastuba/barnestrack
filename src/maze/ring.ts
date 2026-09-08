/**
 * The parametric hole ring. D10, D13, D44, O8.
 *
 * Twenty holes on sixty videos must not be twelve hundred clicks, so holes are
 * *generated* from the platform circle — count, ring ratio, hole radius and one
 * phase angle — and only nudged individually when a maze is visibly irregular.
 *
 * Angles are degrees measured from the platform centre with `x = cx + R·cos θ`,
 * `y = cy + R·sin θ`. Video pixels have y pointing down, so an increasing angle
 * runs clockwise on screen. Hole 0 sits at `phase_deg`.
 */
import { MAZE_DEFAULTS } from '../analysis/parameters.js';
import type { HoleRing, MazeMapFile, PlatformCircle } from '../contracts/mazeMap.js';
import { angleDifferenceDeg, distance, normaliseDeg, type Point } from './types.js';

// The O8 defaults live in the single configuration module (D20); these names
// are kept for the maze step and its tests.
/** O8 · hole diameter default, centimetres. The one hole dimension a user may change. */
export const DEFAULT_HOLE_DIAMETER_CM: number = MAZE_DEFAULTS.holeDiameter_cm;
/** O8 · hole-ring radius as a fraction of the platform radius, measured on the sample videos. */
export const DEFAULT_RING_RATIO: number = MAZE_DEFAULTS.ringRatio;
/** O8 · hole count. */
export const DEFAULT_HOLE_COUNT: number = MAZE_DEFAULTS.holeCount;
/** O8 · the hint shown beside the calibration field; the user must enter the real value. */
export const TYPICAL_PLATFORM_DIAMETER_CM: number = MAZE_DEFAULTS.typicalPlatformDiameter_cm;

export interface HolePosition extends Point {
  holeIndex: number;
  /** True when a per-hole offset moved this hole off the generated ring. */
  nudged: boolean;
}

export function ringRadius(platform: PlatformCircle, holes: Pick<HoleRing, 'ringRatio'>): number {
  return platform.r * holes.ringRatio;
}

export function holeAngleDeg(holes: Pick<HoleRing, 'n' | 'phase_deg'>, holeIndex: number): number {
  return normaliseDeg(holes.phase_deg + (holeIndex * 360) / holes.n);
}

/** Every hole centre in the map's own pixels, offsets applied. */
export function holeCentres(map: Pick<MazeMapFile, 'platform' | 'holes'>): HolePosition[] {
  const radius = ringRadius(map.platform, map.holes);
  const offsets = new Map(map.holes.offsets?.map((o) => [o.holeIndex, o]) ?? []);
  const positions: HolePosition[] = [];
  for (let holeIndex = 0; holeIndex < map.holes.n; holeIndex++) {
    const angle = (holeAngleDeg(map.holes, holeIndex) * Math.PI) / 180;
    const offset = offsets.get(holeIndex);
    positions.push({
      holeIndex,
      x: map.platform.cx + radius * Math.cos(angle) + (offset?.dx_px ?? 0),
      y: map.platform.cy + radius * Math.sin(angle) + (offset?.dy_px ?? 0),
      nudged: offset !== undefined && (offset.dx_px !== 0 || offset.dy_px !== 0),
    });
  }
  return positions;
}

export interface NearestHole {
  hole: HolePosition;
  distance_px: number;
}

export function nearestHole(
  map: Pick<MazeMapFile, 'platform' | 'holes'>,
  point: Point,
): NearestHole | null {
  let best: NearestHole | null = null;
  for (const hole of holeCentres(map)) {
    const d = distance(hole, point);
    if (best === null || d < best.distance_px) best = { hole, distance_px: d };
  }
  return best;
}

/**
 * The `phase_deg` that slides the ring so the hole currently nearest the click
 * lands on it. One click aligns twenty holes (D13).
 */
export function phaseForClick(
  map: Pick<MazeMapFile, 'platform' | 'holes'>,
  point: Point,
): number | null {
  const clickAngle = angleAt(map.platform, point);
  if (clickAngle === null) return null;
  const step = 360 / map.holes.n;
  // Which generated hole is nearest in angle, ignoring per-hole nudges.
  const k = Math.round(angleDifferenceDeg(clickAngle, map.holes.phase_deg) / step);
  return normaliseDeg(clickAngle - k * step);
}

/**
 * How far the ring must turn, in degrees, for the hole currently nearest the
 * click to land on it. The same answer as `phaseForClick`, expressed as a
 * change rather than an absolute angle, so it can be applied to one video's
 * transform instead of to the shared map's phase.
 */
export function ringRotationForClick(
  map: Pick<MazeMapFile, 'platform' | 'holes'>,
  point: Point,
): number | null {
  const phase = phaseForClick(map, point);
  return phase === null ? null : angleDifferenceDeg(phase, map.holes.phase_deg);
}

/**
 * What clicking a hole means when the user is naming the target (D49).
 *
 * The target hole *number* is a property of the maze and is shared by the whole
 * cohort; which physical hole carries it in a given video is that video's
 * business, because Gawel's protocol turns the platform between trials. So the
 * first video to name a target sets the shared number, and every later click on
 * a different hole turns *that video's* ring by whole holes until the shared
 * number lands on the clicked hole. Whole holes only: the ring must stay on the
 * physical holes it was aligned to.
 */
export type TargetClickOutcome =
  /** No target had been named yet: the clicked hole becomes the shared target number. */
  | { kind: 'set'; holeIndex: number }
  /** Turn this video's ring by `holes` holes, `degrees` degrees, so the target lands on the click. */
  | { kind: 'turn'; holes: number; degrees: number }
  /** The clicked hole already carries the target number in this video. */
  | { kind: 'unchanged' };

export function targetClickOutcome(
  n: number,
  currentTarget: number | null,
  clickedIndex: number,
): TargetClickOutcome {
  if (currentTarget === null) return { kind: 'set', holeIndex: clickedIndex };
  if (currentTarget === clickedIndex) return { kind: 'unchanged' };
  // The short way round: turning 18 of 20 holes forward and 2 back land the
  // ring in the same place, and 2 is what the user watches happen — so it is
  // also what the announcement must say (D37).
  const half = Math.floor(n / 2);
  const holes = ((((clickedIndex - currentTarget) % n) + n + half) % n) - half;
  return { kind: 'turn', holes, degrees: (holes * 360) / n };
}

/** The angle of `point` seen from the platform centre, or null at the centre itself. */
export function angleAt(platform: PlatformCircle, point: Point): number | null {
  const dx = point.x - platform.cx;
  const dy = point.y - platform.cy;
  if (dx === 0 && dy === 0) return null;
  return normaliseDeg((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * This video's pixels per centimetre, from the platform circle it was fitted to
 * and the one calibration input. D14, D44 — never entered separately.
 */
export function pxPerCm(platform: PlatformCircle, platformDiameter_cm: number): number | null {
  if (!(platformDiameter_cm > 0) || !(platform.r > 0)) return null;
  return (2 * platform.r) / platformDiameter_cm;
}

export function holeRadiusPx(holeDiameter_cm: number, pixelsPerCm: number): number {
  return (holeDiameter_cm / 2) * pixelsPerCm;
}

/** The hole diameter in centimetres implied by a stored `holeRadius_px`. */
export function holeDiameterCm(holeRadius_px: number, pixelsPerCm: number): number {
  return (2 * holeRadius_px) / pixelsPerCm;
}
