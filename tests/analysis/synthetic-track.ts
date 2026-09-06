/**
 * Scripted trajectories of known answer (D22, D35): a list of segments is
 * turned into a contract-valid track over a chosen timebase. Positions are
 * video pixels of the shared test maze; distances in the script are cm.
 */
import type { MazeGeometry } from '../../src/analysis/geometry.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { buildFrame, timebase, type FrameInput, type FrameSpec } from './track-builder.js';

export type Segment =
  | { kind: 'empty'; seconds: number }
  | { kind: 'oversized'; seconds: number }
  | { kind: 'ambiguous'; seconds: number }
  | { kind: 'lost'; seconds: number }
  /** Straight line from the current position to a point, px. */
  | { kind: 'moveTo'; x: number; y: number; seconds: number }
  /** Straight line to a point `offset_cm` inward of a hole centre (default 1 cm). */
  | { kind: 'moveToHole'; hole: number; seconds: number; offset_cm?: number }
  | { kind: 'moveToCentre'; seconds: number }
  /** Stay where we are (or at a hole) with the nose pointing at the hole. */
  | {
      kind: 'dwell';
      seconds: number;
      hole?: number;
      offset_cm?: number;
      /** Nose heading confidence; 0.5 is usable under the O16 default. */
      noseConf?: number;
      /** `null` → the nose is invalid on these frames. */
      nose?: 'hole' | 'away' | null;
      /** Blob area per frame, or a linear ramp [from, to]. */
      area?: number | [number, number];
      state?: 'tracked' | 'low_confidence';
      reason?: string;
    };

export interface ScriptOptions {
  g: MazeGeometry;
  fps?: number;
  /** Starting position, px; default: the platform centre. */
  start?: { x: number; y: number };
  /** Explicit timestamps; otherwise nominal `1/fps` with the given anomalies. */
  t?: Float64Array;
  duplicatesAt?: number[];
  dropsAt?: number[];
  /** Nose offset from the centroid, px. */
  noseOffset_px?: number;
}

export interface Scripted {
  frames: TrackFrame[];
  /** Frame position at which each segment starts. */
  segmentStarts: number[];
}

export function holePoint(g: MazeGeometry, hole: number, offset_cm = 1): { x: number; y: number } {
  const hx = g.holeX[hole]!;
  const hy = g.holeY[hole]!;
  const dx = g.platform.cx - hx;
  const dy = g.platform.cy - hy;
  const len = Math.hypot(dx, dy);
  const d = offset_cm * g.pxPerCm;
  return { x: hx + (dx / len) * d, y: hy + (dy / len) * d };
}

export function scriptTrack(segments: readonly Segment[], options: ScriptOptions): Scripted {
  const { g } = options;
  const fps = options.fps ?? 30;
  const noseOffset = options.noseOffset_px ?? 8;
  let pos = options.start ?? { x: g.platform.cx, y: g.platform.cy };
  let heading = { x: 1, y: 0 };
  const inputs: FrameInput[] = [];
  const segmentStarts: number[] = [];
  const frameCount = (seconds: number): number => Math.max(1, Math.round(seconds * fps));

  const tracked = (
    x: number,
    y: number,
    dir: { x: number; y: number },
    extra: Partial<FrameSpec> = {},
  ): FrameSpec => ({
    x,
    y,
    nose: { x: x + noseOffset * dir.x, y: y + noseOffset * dir.y },
    noseConf: 0.5,
    ...extra,
  });

  for (const seg of segments) {
    segmentStarts.push(inputs.length);
    switch (seg.kind) {
      case 'empty':
      case 'lost':
        for (let i = 0; i < frameCount(seg.seconds); i++) inputs.push(null);
        break;
      case 'oversized':
        for (let i = 0; i < frameCount(seg.seconds); i++) inputs.push('oversized');
        break;
      case 'ambiguous':
        for (let i = 0; i < frameCount(seg.seconds); i++) inputs.push('ambiguous');
        break;
      case 'moveTo':
      case 'moveToHole':
      case 'moveToCentre': {
        const to =
          seg.kind === 'moveTo'
            ? { x: seg.x, y: seg.y }
            : seg.kind === 'moveToHole'
              ? holePoint(g, seg.hole, seg.offset_cm)
              : { x: g.platform.cx, y: g.platform.cy };
        const n = frameCount(seg.seconds);
        const dx = to.x - pos.x;
        const dy = to.y - pos.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) heading = { x: dx / len, y: dy / len };
        for (let i = 1; i <= n; i++) {
          const s = i / n;
          inputs.push(tracked(pos.x + dx * s, pos.y + dy * s, heading));
        }
        pos = to;
        break;
      }
      case 'dwell': {
        if (seg.hole !== undefined) pos = holePoint(g, seg.hole, seg.offset_cm);
        let dir = heading;
        if (seg.hole !== undefined && seg.nose !== 'away') {
          const dx = g.holeX[seg.hole]! - pos.x;
          const dy = g.holeY[seg.hole]! - pos.y;
          const len = Math.hypot(dx, dy);
          dir = len > 0 ? { x: dx / len, y: dy / len } : heading;
        } else if (seg.nose === 'away') {
          dir = { x: -heading.x, y: -heading.y };
        }
        const n = frameCount(seg.seconds);
        for (let i = 0; i < n; i++) {
          const area =
            seg.area === undefined
              ? undefined
              : Array.isArray(seg.area)
                ? seg.area[0] + ((seg.area[1] - seg.area[0]) * i) / Math.max(1, n - 1)
                : seg.area;
          const spec = tracked(pos.x, pos.y, dir, {
            noseConf: seg.noseConf ?? 0.5,
            ...(seg.nose === null ? { nose: null } : {}),
            ...(area === undefined ? {} : { area }),
            ...(seg.state === undefined ? {} : { state: seg.state }),
            ...(seg.reason === undefined ? {} : { reason: seg.reason }),
          });
          inputs.push(spec);
        }
        break;
      }
    }
  }
  const t =
    options.t ??
    timebase(inputs.length, fps, { duplicatesAt: options.duplicatesAt, dropsAt: options.dropsAt });
  return { frames: inputs.map((input, i) => buildFrame(input, i, t[i]!)), segmentStarts };
}

/** Investigations of a list of holes in order, walking between them; `dwell_s` at each. */
export function visitHoles(holes: readonly number[], dwell_s = 0.5, walk_s = 0.5): Segment[] {
  const out: Segment[] = [];
  for (const hole of holes) {
    out.push({ kind: 'moveToHole', hole, seconds: walk_s });
    out.push({ kind: 'dwell', seconds: dwell_s, hole });
  }
  return out;
}
