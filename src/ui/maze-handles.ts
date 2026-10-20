/**
 * Drawing the maze's drag handles on the overlay (D69). Shape and text, never
 * colour alone (D26, D37): the centre is a square with a dot, the platform
 * edge a circle, the ring edge a diamond; the selected one is filled, with a
 * halo; every one carries its name. Coordinates are viewport CSS pixels, as in
 * `overlay-draw.ts`, which lends its colours and its label box. The geometry
 * that says where a handle is and what dragging it means lives in
 * `src/maze/handles.ts`; nothing here decides anything.
 */
import type { HandleKind } from '../maze/handles.js';
import type { Point } from '../maze/types.js';
import { ACCENT, PAPER, drawLabel } from './overlay-draw.js';

/** Half the handle's extent on screen, in CSS pixels, at any zoom. */
export const HANDLE_SIZE_PX = 7;
/** How near a press must be to a handle, in CSS pixels at any zoom, to pick it up. */
export const HANDLE_HIT_PX = 10;
/** The halo's width either side of the selected handle's outline. */
const HALO_PX = 2;
const OUTLINE_PX = 2;

export interface HandleDrawOptions {
  selected: boolean;
  hovered: boolean;
  /** The text beside the handle: its name, and for the ring what else it changes. */
  label: string;
}

function outline(ctx: CanvasRenderingContext2D, p: Point, kind: HandleKind, s: number): void {
  ctx.beginPath();
  if (kind === 'centre') {
    ctx.rect(p.x - s, p.y - s, 2 * s, 2 * s);
  } else if (kind === 'platformRim') {
    ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
  } else {
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x + s, p.y);
    ctx.lineTo(p.x, p.y + s);
    ctx.lineTo(p.x - s, p.y);
    ctx.closePath();
  }
}

export function drawHandle(
  ctx: CanvasRenderingContext2D,
  p: Point,
  kind: HandleKind,
  options: HandleDrawOptions,
): void {
  const s = HANDLE_SIZE_PX;
  ctx.setLineDash([]);
  if (options.selected) {
    // The halo is a paper stroke under the outline, wider by the halo on each side.
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = OUTLINE_PX + 2 * HALO_PX;
    outline(ctx, p, kind, s);
    ctx.stroke();
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = OUTLINE_PX;
  ctx.fillStyle = options.selected ? ACCENT : PAPER;
  outline(ctx, p, kind, s);
  ctx.fill();
  ctx.stroke();
  if (kind === 'centre') {
    ctx.fillStyle = options.selected ? PAPER : ACCENT;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  drawLabel(ctx, options.label, p.x + s + 4, p.y - s, options.selected || options.hovered);
}
