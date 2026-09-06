/**
 * Synthetic Barnes-maze frames for the tracker tests (D35): a bright disc on
 * a dark ground, twenty dark holes on a ring, a dark Gaussian-profile mouse
 * body with a thin tail, an optional oversized blob (a hand), optional
 * placement at the rim, and a seeded noise field. Everything is
 * deterministic for a given seed.
 */
import type { PlatformCircle } from '../../src/analysis/tracker/calibration.js';

export interface SceneSpec {
  width: number;
  height: number;
  platform: PlatformCircle;
  holeCount: number;
  holeRingRatio: number;
  holeRadius_px: number;
  groundLevel: number;
  platformLevel: number;
  holeLevel: number;
  /** Standard deviation of the added noise, gray levels (0 = none). */
  noise: number;
}

export interface MouseSpec {
  x: number;
  y: number;
  /** Direction the head points, radians, y down. */
  heading: number;
  /** Semi-axes of the body ellipse, px. */
  bodyLength: number;
  bodyWidth: number;
  tailLength: number;
  tailWidth: number;
  /** Gray levels subtracted at the body centre. */
  darkness: number;
}

export interface HandSpec {
  x: number;
  y: number;
  radius: number;
  darkness: number;
}

export interface SceneObjects {
  mouse?: MouseSpec | null;
  hand?: HandSpec | null;
  /** Seed for this frame's noise field. */
  seed?: number;
}

/** 640 × 480, platform of radius 205 px at (322, 240) ≈ 4.46 px/cm for a 92 cm platform. */
export const DEFAULT_SCENE: SceneSpec = {
  width: 640,
  height: 480,
  platform: { cx: 322, cy: 240, r: 205 },
  holeCount: 20,
  holeRingRatio: 0.89,
  holeRadius_px: 11,
  groundLevel: 40,
  platformLevel: 200,
  holeLevel: 70,
  noise: 0,
};

export const PLATFORM_DIAMETER_CM = 92;

export const DEFAULT_MOUSE: Omit<MouseSpec, 'x' | 'y' | 'heading'> = {
  bodyLength: 16,
  bodyWidth: 8,
  tailLength: 32,
  tailWidth: 2.5,
  darkness: 160,
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** The static scene (ground, platform, holes) without any object or noise. */
export function renderStaticScene(spec: SceneSpec = DEFAULT_SCENE, out?: Uint8Array): Uint8Array {
  const { width, height, platform } = spec;
  const buf = out ?? new Uint8Array(width * height);
  buf.fill(spec.groundLevel);
  const r2 = platform.r * platform.r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - platform.cx;
      const dy = y - platform.cy;
      if (dx * dx + dy * dy <= r2) buf[y * width + x] = spec.platformLevel;
    }
  }
  const ring = spec.holeRingRatio * platform.r;
  const hr2 = spec.holeRadius_px * spec.holeRadius_px;
  for (let k = 0; k < spec.holeCount; k++) {
    const a = (2 * Math.PI * k) / spec.holeCount;
    const hx = platform.cx + ring * Math.cos(a);
    const hy = platform.cy + ring * Math.sin(a);
    for (
      let y = Math.floor(hy - spec.holeRadius_px);
      y <= Math.ceil(hy + spec.holeRadius_px);
      y++
    ) {
      for (
        let x = Math.floor(hx - spec.holeRadius_px);
        x <= Math.ceil(hx + spec.holeRadius_px);
        x++
      ) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if ((x - hx) * (x - hx) + (y - hy) * (y - hy) <= hr2) buf[y * width + x] = spec.holeLevel;
      }
    }
  }
  return buf;
}

/** Hole centres of the static scene, for the nose hole cue. */
export function sceneHoles(spec: SceneSpec = DEFAULT_SCENE): { x: number; y: number; r: number }[] {
  const ring = spec.holeRingRatio * spec.platform.r;
  const holes: { x: number; y: number; r: number }[] = [];
  for (let k = 0; k < spec.holeCount; k++) {
    const a = (2 * Math.PI * k) / spec.holeCount;
    holes.push({
      x: spec.platform.cx + ring * Math.cos(a),
      y: spec.platform.cy + ring * Math.sin(a),
      r: spec.holeRadius_px,
    });
  }
  return holes;
}

function darken(
  buf: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  amount: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  buf[p] = clampByte(buf[p]! - amount);
}

function drawMouse(buf: Uint8Array, spec: SceneSpec, m: MouseSpec): void {
  const { width, height } = spec;
  const cos = Math.cos(m.heading);
  const sin = Math.sin(m.heading);
  const reach = Math.max(m.bodyLength, m.bodyWidth) + 2;
  for (let y = Math.floor(m.y - reach); y <= Math.ceil(m.y + reach); y++) {
    for (let x = Math.floor(m.x - reach); x <= Math.ceil(m.x + reach); x++) {
      const dx = x - m.x;
      const dy = y - m.y;
      const u = (dx * cos + dy * sin) / m.bodyLength;
      const v = (-dx * sin + dy * cos) / m.bodyWidth;
      const d2 = u * u + v * v;
      if (d2 <= 1) darken(buf, width, height, x, y, m.darkness * (1 - 0.25 * d2));
      else if (d2 <= 1.3) darken(buf, width, height, x, y, m.darkness * 0.75 * ((1.3 - d2) / 0.3));
    }
  }
  if (m.tailLength > 0 && m.tailWidth > 0) {
    const rearX = m.x - m.bodyLength * cos;
    const rearY = m.y - m.bodyLength * sin;
    const half = m.tailWidth / 2;
    for (let t = 0; t <= m.tailLength; t += 0.5) {
      const bend = 0.15 * m.tailLength * Math.sin((Math.PI * t) / m.tailLength);
      const px = rearX - t * cos - bend * sin;
      const py = rearY - t * sin + bend * cos;
      for (let y = Math.floor(py - half); y <= Math.ceil(py + half); y++) {
        for (let x = Math.floor(px - half); x <= Math.ceil(px + half); x++) {
          if ((x - px) * (x - px) + (y - py) * (y - py) <= half * half) {
            const p = y * width + x;
            if (x >= 0 && y >= 0 && x < width && y < height) {
              buf[p] = Math.min(buf[p]!, clampByte(spec.platformLevel - m.darkness * 0.9));
            }
          }
        }
      }
    }
  }
}

function drawHand(buf: Uint8Array, spec: SceneSpec, h: HandSpec): void {
  const r2 = h.radius * h.radius;
  for (let y = Math.floor(h.y - h.radius); y <= Math.ceil(h.y + h.radius); y++) {
    for (let x = Math.floor(h.x - h.radius); x <= Math.ceil(h.x + h.radius); x++) {
      if ((x - h.x) * (x - h.x) + (y - h.y) * (y - h.y) <= r2) {
        darken(buf, spec.width, spec.height, x, y, h.darkness);
      }
    }
  }
}

/** Renders the static scene plus objects plus noise into `out` (allocated when absent). */
export function renderScene(
  spec: SceneSpec,
  objects: SceneObjects = {},
  out?: Uint8Array,
  staticScene?: Uint8Array,
): Uint8Array {
  const buf = out ?? new Uint8Array(spec.width * spec.height);
  if (staticScene) buf.set(staticScene);
  else renderStaticScene(spec, buf);
  if (objects.hand) drawHand(buf, spec, objects.hand);
  if (objects.mouse) drawMouse(buf, spec, objects.mouse);
  if (spec.noise > 0) {
    const rand = mulberry32(objects.seed ?? 1);
    for (let p = 0; p < buf.length; p++) {
      // Box–Muller
      const u1 = rand() || 1e-9;
      const u2 = rand();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      buf[p] = clampByte(buf[p]! + g * spec.noise);
    }
  }
  return buf;
}

/** Position and heading of a mouse running a circle of radius `ratio × r` at angular speed `omega` (rad/s). */
export function mouseOnCircle(
  spec: SceneSpec,
  t_s: number,
  ratio = 0.55,
  omega = 0.6,
  phase = 0,
): { x: number; y: number; heading: number } {
  const a = phase + omega * t_s;
  const rr = ratio * spec.platform.r;
  return {
    x: spec.platform.cx + rr * Math.cos(a),
    y: spec.platform.cy + rr * Math.sin(a),
    // tangent direction of motion (y down, counter-clockwise on screen for omega > 0)
    heading: a + Math.PI / 2,
  };
}

/** True nose tip and rear tip of a mouse spec. */
export function mouseTips(m: MouseSpec): {
  nose: { x: number; y: number };
  rear: { x: number; y: number };
} {
  const cos = Math.cos(m.heading);
  const sin = Math.sin(m.heading);
  return {
    nose: { x: m.x + m.bodyLength * cos, y: m.y + m.bodyLength * sin },
    rear: { x: m.x - m.bodyLength * cos, y: m.y - m.bodyLength * sin },
  };
}

/** A mouse whose centre sits on the platform rim (half the body outside). */
export function mouseAtRim(spec: SceneSpec, angle: number): MouseSpec {
  return {
    ...DEFAULT_MOUSE,
    x: spec.platform.cx + spec.platform.r * Math.cos(angle),
    y: spec.platform.cy + spec.platform.r * Math.sin(angle),
    heading: angle,
  };
}
