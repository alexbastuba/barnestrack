/**
 * The maze under a spatial figure: the platform disc (or the video's own still),
 * the hole ring with every hole numbered as text, and the target hole marked by
 * a shape *and* a word — never by colour alone (D26, D37).
 */
import type { Point } from '../maze/types.js';
import type { TrialSource } from './data.js';
import type { FigureFrame } from './figure.js';
import { drawGlyph } from './figure.js';
import { ANNOTATION_SIZE, figureFont } from './theme.js';

export interface MazeView {
  source: TrialSource;
  /** Video pixels to figure pixels. */
  toFigure(point: Point): Point;
  /** Multiply a length in video pixels by this to get figure pixels. */
  pixelScale: number;
  /** Multiply a length in centimetres by this to get figure pixels. */
  cmScale: number;
  centre: Point;
  radius: number;
}

/** Room left outside the platform rim for the hole numbers. */
const LABEL_MARGIN = 1.16;

export function mazeView(frame: FigureFrame, source: TrialSource): MazeView {
  const { plot } = frame;
  const platform = source.map.platform;
  const pixelScale = Math.min(plot.width, plot.height) / (platform.r * 2 * LABEL_MARGIN);
  const centre = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
  return {
    source,
    pixelScale,
    cmScale: pixelScale * source.pixelsPerCm,
    centre,
    radius: platform.r * pixelScale,
    toFigure: (point) => ({
      x: centre.x + (point.x - platform.cx) * pixelScale,
      y: centre.y + (point.y - platform.cy) * pixelScale,
    }),
  };
}

export interface BackdropOptions {
  /** A still from the video, drawn inside the platform disc when supplied. */
  background?: CanvasImageSource;
  /** Draw the hole ring over whatever else is there. Default true. */
  holes?: boolean;
  /** Number every hole. Default true. */
  holeNumbers?: boolean;
}

export function drawMazeBackdrop(
  frame: FigureFrame,
  view: MazeView,
  options: BackdropOptions = {},
): void {
  const { ctx, palette } = frame;
  const { source } = view;

  ctx.save();
  ctx.beginPath();
  ctx.arc(view.centre.x, view.centre.y, view.radius, 0, Math.PI * 2);
  ctx.fillStyle = palette.platform;
  ctx.fill();

  if (options.background) {
    const resolution = source.descriptor.referenceResolution;
    const origin = view.toFigure({ x: 0, y: 0 });
    ctx.save();
    ctx.clip();
    ctx.drawImage(
      options.background,
      origin.x,
      origin.y,
      resolution.width * view.pixelScale,
      resolution.height * view.pixelScale,
    );
    ctx.restore();
  }

  ctx.lineWidth = 1.5 * palette.strokeScale;
  ctx.strokeStyle = palette.platformEdge;
  ctx.stroke();
  ctx.restore();

  if (options.holes === false) return;

  const holeRadius = source.map.holes.holeRadius_px * view.pixelScale;
  ctx.save();
  ctx.font = figureFont(ANNOTATION_SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const hole of source.holes) {
    const at = view.toFigure(hole);
    const isTarget = hole.holeIndex === source.targetIndex;
    ctx.beginPath();
    ctx.arc(at.x, at.y, holeRadius, 0, Math.PI * 2);
    ctx.fillStyle = palette.hole;
    ctx.fill();
    ctx.lineWidth = (isTarget ? 2.4 : 1) * palette.strokeScale;
    ctx.strokeStyle = isTarget ? palette.target : palette.holeEdge;
    ctx.stroke();

    // The target also gets a shape of its own, so it is found without colour.
    if (isTarget) {
      drawGlyph(ctx, 'square', at.x, at.y, holeRadius * 1.1, palette.target);
    }

    if (options.holeNumbers !== false) {
      const away = Math.hypot(at.x - view.centre.x, at.y - view.centre.y) || 1;
      const outward = (away + holeRadius + 9) / away;
      ctx.fillStyle = isTarget ? palette.target : palette.inkSoft;
      ctx.font = figureFont(ANNOTATION_SIZE, isTarget ? 'bold' : 'normal');
      ctx.fillText(
        String(hole.holeIndex),
        view.centre.x + (at.x - view.centre.x) * outward,
        view.centre.y + (at.y - view.centre.y) * outward,
      );
    }
  }
  ctx.restore();
}

/** The words that name the target in a legend or caption. */
export function targetLabel(source: TrialSource): string {
  return `target · hole ${source.targetIndex}`;
}
