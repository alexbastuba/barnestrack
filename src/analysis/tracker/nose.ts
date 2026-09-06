/**
 * Head-end assignment as a post-pass over the whole track (D6, D18). Three
 * cues pick which end of the body's major axis is the head: opposite the
 * tail; along the centred velocity over ± `noseCueWindowFrames` (needs
 * future frames, hence the post-pass); when nearly stationary and hole
 * centres are known, the end nearer a hole. Confidence is the agreement of
 * the available cues: 1.0 when all agree (two or more), 0.5 with a single
 * cue, 0.0 on any disagreement or with no cue at all.
 */
import type { TrackingParametersPx } from './calibration.js';
import { CONFIDENCE_MODEL } from './params.js';
import type { TailDirection } from './shape.js';

export interface HoleCircle {
  x: number;
  y: number;
  r: number;
}

/** Per-frame shape input; `null` when no blob was selected. */
export interface NoseShapeInput {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  /** Axis end farthest along +u. */
  ax: number;
  ay: number;
  /** Axis end farthest along −u. */
  bx: number;
  by: number;
  tail: TailDirection | null;
}

export interface NoseFrameInput {
  t_s: number;
  shape: NoseShapeInput | null;
}

export interface NoseResult {
  x: number;
  y: number;
  valid: boolean;
  /** 0, 0.5 or 1. */
  headingConfidence: number;
  /** Centroid speed over the window was measurable and at or above the moving threshold. */
  moving: boolean;
  /** Centroid speed over the window, px/s, or null when not measurable. */
  speed_pxPerS: number | null;
  /** Which cues were available (for the evidence tables). */
  cues: { tail: boolean; velocity: boolean; hole: boolean };
}

function endFor(sign: number, s: NoseShapeInput): { x: number; y: number } {
  return sign > 0 ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by };
}

function cueSign(ux: number, uy: number, dx: number, dy: number): number {
  const dot = ux * dx + uy * dy;
  if (Math.abs(dot) < CONFIDENCE_MODEL.noseCueMinCos) return 0;
  return dot > 0 ? 1 : -1;
}

export function assignNose(
  frames: readonly NoseFrameInput[],
  px: TrackingParametersPx,
  holes: readonly HoleCircle[] = [],
): NoseResult[] {
  const n = frames.length;
  const window = Math.max(1, Math.floor(px.noseCueWindowFrames));
  const out: NoseResult[] = new Array<NoseResult>(n);
  for (let i = 0; i < n; i++) {
    const s = frames[i]!.shape;
    const cues = { tail: false, velocity: false, hole: false };
    if (!s) {
      out[i] = {
        x: 0,
        y: 0,
        valid: false,
        headingConfidence: 0,
        moving: false,
        speed_pxPerS: null,
        cues,
      };
      continue;
    }

    // Tail cue: the head is opposite the tail.
    let tailSign = 0;
    if (s.tail) {
      tailSign = -cueSign(s.ux, s.uy, s.tail.dx, s.tail.dy);
      cues.tail = tailSign !== 0;
    }

    // Velocity cue: farthest valid frames on each side within the window.
    let velocitySign = 0;
    let moving = false;
    let stationary = false;
    let speedMeasured: number | null = null;
    let before = -1;
    for (let j = Math.max(0, i - window); j < i; j++) {
      if (frames[j]!.shape) {
        before = j;
        break;
      }
    }
    let after = -1;
    for (let j = Math.min(n - 1, i + window); j > i; j--) {
      if (frames[j]!.shape) {
        after = j;
        break;
      }
    }
    if (before >= 0 && after >= 0) {
      const a = frames[before]!;
      const b = frames[after]!;
      const dt = b.t_s - a.t_s;
      if (dt > 0) {
        const vx = (b.shape!.cx - a.shape!.cx) / dt;
        const vy = (b.shape!.cy - a.shape!.cy) / dt;
        const speed = Math.hypot(vx, vy);
        speedMeasured = speed;
        if (speed >= px.noseMovingSpeed_pxPerS) {
          moving = true;
          velocitySign = cueSign(s.ux, s.uy, vx / speed, vy / speed);
          cues.velocity = velocitySign !== 0;
        } else {
          stationary = true;
        }
      }
    }

    // Hole cue: when stationary, the end nearer a hole centre within reach.
    let holeSign = 0;
    if (stationary && holes.length > 0) {
      let bestD = Infinity;
      let bestHole: HoleCircle | null = null;
      for (const h of holes) {
        const reach = CONFIDENCE_MODEL.noseHoleRadiusFactor * h.r;
        const dA = Math.hypot(s.ax - h.x, s.ay - h.y);
        const dB = Math.hypot(s.bx - h.x, s.by - h.y);
        const d = Math.min(dA, dB);
        if (d <= reach && d < bestD) {
          bestD = d;
          bestHole = h;
        }
      }
      if (bestHole) {
        const dx = bestHole.x - s.cx;
        const dy = bestHole.y - s.cy;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          holeSign = cueSign(s.ux, s.uy, dx / len, dy / len);
          cues.hole = holeSign !== 0;
        }
      }
    }

    const signs = [tailSign, velocitySign, holeSign].filter((v) => v !== 0);
    if (signs.length === 0) {
      // No cue at all: no coordinate is offered (D16), not even an axis end.
      out[i] = {
        x: 0,
        y: 0,
        valid: false,
        headingConfidence: 0,
        moving,
        speed_pxPerS: speedMeasured,
        cues,
      };
      continue;
    }
    const first = signs[0]!;
    const agree = signs.every((v) => v === first);
    const headingConfidence = !agree ? 0 : signs.length >= 2 ? 1 : 0.5;
    const end = endFor(first, s);
    out[i] = {
      x: end.x,
      y: end.y,
      valid: true,
      headingConfidence,
      moving,
      speed_pxPerS: speedMeasured,
      cues,
    };
  }
  return out;
}
