/**
 * Overlay drawing shared by the maze and review steps (D26): labels with a
 * paper box behind them, the hole ring's holes with the target's second ring
 * and `T` label, and the named-point markers — automatic = filled shape,
 * corrected = diamond with a "user" badge, filled = hollow dashed. Every
 * distinction is a shape or a word as well as a colour, so the overlay reads
 * in grayscale and the DOM mirror can say the same thing.
 *
 * Coordinates are viewport CSS pixels. Colours are the stylesheet's tokens
 * written out, because a canvas cannot read a custom property.
 */
import type { Point } from '../maze/types.js';

export const INK = '#16191d';
export const INK_SOFT = '#4a5159';
export const ACCENT = '#0a4d8c';
export const DANGER = '#9a2417';
export const PAPER = 'rgba(255, 255, 255, 0.88)';

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  strong = false,
): void {
  ctx.font = `${strong ? '600 ' : ''}12px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const width = ctx.measureText(text).width;
  ctx.fillStyle = PAPER;
  ctx.fillRect(x - 2, y - 1, width + 4, 15);
  ctx.fillStyle = INK;
  ctx.fillText(text, x, y);
}

export interface HoleDrawOptions {
  isTarget: boolean;
  /** Corner brackets: the selection, distinguishable from the target ring without colour. */
  selected: boolean;
  /** Dashed until the hole size is known. */
  sized: boolean;
  /** Appended to the hole number, e.g. `*` for a nudged hole. */
  labelSuffix?: string;
  /** A wider ring, for the hole of the current event. */
  emphasised?: boolean;
}

export function drawHole(
  ctx: CanvasRenderingContext2D,
  p: Point,
  radius: number,
  holeIndex: number,
  options: HoleDrawOptions,
): void {
  const { isTarget, selected, sized } = options;
  ctx.strokeStyle = isTarget ? DANGER : INK;
  ctx.lineWidth = options.emphasised ? 3.5 : isTarget ? 3 : 1.5;
  ctx.setLineDash(sized ? [] : [3, 3]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (isTarget) {
    // Shape, not colour: the target carries a second ring and a "T" label (D26).
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    drawLabel(ctx, `T${holeIndex} target`, p.x + radius + 7, p.y - 8);
  } else {
    drawLabel(ctx, `${holeIndex}${options.labelSuffix ?? ''}`, p.x + radius + 3, p.y - 8);
  }

  if (selected) {
    const s = radius + 7;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(p.x + sx * s, p.y + sy * s - sy * 6);
      ctx.lineTo(p.x + sx * s, p.y + sy * s);
      ctx.lineTo(p.x + sx * s - sx * 6, p.y + sy * s);
      ctx.stroke();
    }
  }
}

export type MarkerSource = 'auto' | 'corrected' | 'filled' | 'imported';

function diamond(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x + r, p.y);
  ctx.lineTo(p.x, p.y + r);
  ctx.lineTo(p.x - r, p.y);
  ctx.closePath();
}

function triangle(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x + r * 0.87, p.y + r * 0.5);
  ctx.lineTo(p.x - r * 0.87, p.y + r * 0.5);
  ctx.closePath();
}

/**
 * The body centroid: a filled circle when automatic, a diamond outline with a
 * "user" badge when placed by hand, a hollow dashed circle when filled by the
 * cleaning step (D16, D26). The label names the point and its source.
 */
export function drawCentroidMarker(
  ctx: CanvasRenderingContext2D,
  p: Point,
  source: MarkerSource,
  label = 'centroid',
): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  if (source === 'corrected') {
    diamond(ctx, p, 8);
    ctx.stroke();
    drawLabel(ctx, `${label} · user`, p.x + 11, p.y - 7);
  } else if (source === 'filled') {
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    drawLabel(ctx, `${label} · filled`, p.x + 11, p.y - 7);
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ctx, label, p.x + 11, p.y - 7);
  }
}

/** The nose: a filled triangle when automatic, a diamond outline with a "user" badge when placed by hand. */
export function drawNoseMarker(
  ctx: CanvasRenderingContext2D,
  p: Point,
  source: MarkerSource,
  label = 'nose',
): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = DANGER;
  ctx.fillStyle = DANGER;
  if (source === 'corrected') {
    diamond(ctx, p, 8);
    ctx.stroke();
    drawLabel(ctx, `${label} · user`, p.x + 11, p.y + 4);
  } else {
    triangle(ctx, p, 7);
    ctx.fill();
    drawLabel(ctx, label, p.x + 11, p.y + 4);
  }
}

/** A crosshair where a click will place the armed point. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, p: Point, text: string): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - 12, p.y);
  ctx.lineTo(p.x + 12, p.y);
  ctx.moveTo(p.x, p.y - 12);
  ctx.lineTo(p.x, p.y + 12);
  ctx.stroke();
  drawLabel(ctx, text, p.x + 14, p.y + 8);
}
