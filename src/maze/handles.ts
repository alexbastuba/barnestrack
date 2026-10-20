/**
 * The maze's drag handles. D69 (refines D13, D15, D49, D50).
 *
 * Three handles sit on the maze overlay: `centre` moves the platform, the ring,
 * the holes and the target together; `platformRim` sits on the platform circle
 * and resizes it about the centre; `ringRim` sits on the hole ring and sets the
 * ring ratio. Everything here is a pure function over native video pixels
 * (D15, D22's pattern): the canvas layer turns pointer events into video
 * pixels, asks these functions what the gesture means, and routes the answer to
 * the shared map or to the video's transform — `src/ui/maze-step.ts` does the
 * routing and says which object each handle edits.
 *
 * Bearings are degrees from the platform centre with y pointing down, as in
 * `ring.ts`: 270° is straight up, 360° straight right. Both rim handles sit in
 * the up-right quadrant, 20° apart, so they never overlap whatever the ring
 * ratio, and so that "right or up" means outward for both under the arrow keys.
 *
 * A rim drag changes the radius by how much the pointer's distance from the
 * centre changed since the press, not to that distance outright: the press can
 * land anywhere inside the hit tolerance, and the handle must then move with
 * the pointer rather than jump under it. When the press is exactly on the
 * handle the two readings are the same number.
 */
import type { HoleRing, PlatformCircle } from '../contracts/mazeMap.js';
import { distance, type Point } from './types.js';

export type HandleKind = 'centre' | 'platformRim' | 'ringRim';

/**
 * Every handle, in the order `hitTestHandle` breaks exact ties: the centre
 * first, then the ring — the one handle with no typed field of its own that
 * means the same thing — then the platform rim.
 */
export const HANDLE_KINDS: readonly HandleKind[] = ['centre', 'ringRim', 'platformRim'];

/** Up and to the right: half a hole off a 20-hole ring at phase 0, so it starts between holes. */
export const PLATFORM_HANDLE_BEARING_DEG = 315;
/** 20° further round towards straight up, so the two rim handles never coincide. */
export const RING_HANDLE_BEARING_DEG = 295;
/** A platform smaller than this is a mis-drag, not a platform. */
export const MIN_PLATFORM_RADIUS_PX = 10;
/** The ring-ratio field's bounds; the ring handle is clamped to the same range. */
export const RING_RATIO_MIN = 0.1;
export const RING_RATIO_MAX = 1;

/** Names as the controls and the live region say them. */
export const HANDLE_NAMES: Record<HandleKind, string> = {
  centre: 'Centre',
  platformRim: 'Platform edge',
  ringRim: 'Ring edge',
};

export type HandlePositions = Record<HandleKind, Point>;

/** What a handle gesture produces: the platform circle and the ring ratio, both in the caller's pixels. */
export interface HandleGeometry {
  platform: PlatformCircle;
  ringRatio: number;
}

function unitVector(bearingDeg: number): Point {
  const radians = (bearingDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function pointAt(platform: PlatformCircle, radius: number, bearingDeg: number): Point {
  const u = unitVector(bearingDeg);
  return { x: platform.cx + radius * u.x, y: platform.cy + radius * u.y };
}

function bearingOf(handle: Exclude<HandleKind, 'centre'>): number {
  return handle === 'platformRim' ? PLATFORM_HANDLE_BEARING_DEG : RING_HANDLE_BEARING_DEG;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Where the three handles sit, in the same pixels as `platform`. */
export function handlePositions(
  platform: PlatformCircle,
  ring: Pick<HoleRing, 'ringRatio'>,
): HandlePositions {
  return {
    centre: { x: platform.cx, y: platform.cy },
    platformRim: pointAt(platform, platform.r, PLATFORM_HANDLE_BEARING_DEG),
    ringRim: pointAt(platform, platform.r * ring.ringRatio, RING_HANDLE_BEARING_DEG),
  };
}

/**
 * The handle nearest `point` within `tolerance_px`, or null. An exact tie goes
 * to the earlier entry of `HANDLE_KINDS`, so the centre always wins one.
 */
export function hitTestHandle(
  point: Point,
  positions: HandlePositions,
  tolerance_px: number,
): HandleKind | null {
  let best: HandleKind | null = null;
  let bestDistance = Infinity;
  for (const kind of HANDLE_KINDS) {
    const d = distance(point, positions[kind]);
    if (d <= tolerance_px && d < bestDistance) {
      best = kind;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * What dragging `handle` from `from` to `to` means. A centre drag translates
 * the platform (and with it the ring, the holes and the target); a platform-rim
 * drag changes the radius by the pointer's change in distance from the centre,
 * never below `MIN_PLATFORM_RADIUS_PX`, leaving the ratio alone so the ring
 * scales with the platform; a ring-rim drag changes the ring radius the same
 * way and expresses it as a ratio clamped to the field's bounds. A zero-length
 * drag is the identity from any starting point.
 */
export function applyHandleDrag(
  handle: HandleKind,
  from: Point,
  to: Point,
  platform: PlatformCircle,
  ring: Pick<HoleRing, 'ringRatio'>,
): HandleGeometry {
  const centre = { x: platform.cx, y: platform.cy };
  if (handle === 'centre') {
    return {
      platform: { cx: platform.cx + (to.x - from.x), cy: platform.cy + (to.y - from.y), r: platform.r },
      ringRatio: ring.ringRatio,
    };
  }
  const radialDelta = distance(to, centre) - distance(from, centre);
  if (handle === 'platformRim') {
    return {
      platform: { ...platform, r: Math.max(MIN_PLATFORM_RADIUS_PX, platform.r + radialDelta) },
      ringRatio: ring.ringRatio,
    };
  }
  if (!(platform.r > 0)) return { platform: { ...platform }, ringRatio: ring.ringRatio };
  const ringRadius = ring.ringRatio * platform.r + radialDelta;
  return {
    platform: { ...platform },
    ringRatio: clamp(ringRadius / platform.r, RING_RATIO_MIN, RING_RATIO_MAX),
  };
}

/**
 * The arrow keys, through the same path as a drag. The centre moves by
 * (`dx`, `dy`). A rim handle moves along its own radius by `dx − dy` pixels:
 * both handles sit up and to the right, so right or up is outward and left or
 * down is inward, and the radius changes by exactly the step.
 */
export function nudgeHandle(
  handle: HandleKind,
  dx: number,
  dy: number,
  platform: PlatformCircle,
  ring: Pick<HoleRing, 'ringRatio'>,
): HandleGeometry {
  if (handle === 'centre') {
    return applyHandleDrag('centre', { x: 0, y: 0 }, { x: dx, y: dy }, platform, ring);
  }
  const from = handlePositions(platform, ring)[handle];
  const u = unitVector(bearingOf(handle));
  const step = dx - dy;
  return applyHandleDrag(handle, from, { x: from.x + step * u.x, y: from.y + step * u.y }, platform, ring);
}
