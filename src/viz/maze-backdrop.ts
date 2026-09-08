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

/**
 * Room left outside the platform rim for the hole numbers, in figure pixels per
 * side. The numbers sit *outside* the disc — inside it they land on the path,
 * the heat cells and the hole discs themselves — so the fit has to reserve the
 * space rather than discover it: `LABEL_OFFSET` puts a label's centre this far
 * past the rim, and the gutter covers that plus half a line of text.
 *
 * One constant, applied here where every figure's view is built, so no figure
 * can leave the ring room its neighbours do not.
 */
const LABEL_OFFSET = 10;
const LABEL_GUTTER = ANNOTATION_SIZE + 12;

export function mazeView(frame: FigureFrame, source: TrialSource): MazeView {
  const { plot } = frame;
  const platform = source.map.platform;
  const half = Math.min(plot.width, plot.height) / 2;
  const pixelScale = Math.max(half - LABEL_GUTTER, 1) / platform.r;
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

/**
 * Where the number for one hole is drawn: on the ray from the platform centre
 * through the hole, just outside the rim — not just outside the hole. A hole is
 * inset from the edge, so "hole radius + a few pixels" put the number back
 * inside the disc, on top of whatever the figure was drawing there. Pure, so
 * the fit and the placement can be checked without a canvas.
 */
export function holeLabelPoint(view: MazeView, hole: Point): Point {
  const at = view.toFigure(hole);
  const away = Math.hypot(at.x - view.centre.x, at.y - view.centre.y) || 1;
  const outward = (view.radius + LABEL_OFFSET) / away;
  return {
    x: view.centre.x + (at.x - view.centre.x) * outward,
    y: view.centre.y + (at.y - view.centre.y) * outward,
  };
}

export interface PlatformOptions {
  /** A still from the video, drawn inside the platform disc when supplied. */
  background?: CanvasImageSource;
}

/** The platform disc, and the video's own still inside it when there is one. */
export function drawPlatform(
  frame: FigureFrame,
  view: MazeView,
  options: PlatformOptions = {},
): void {
  const { ctx, palette } = frame;
  ctx.save();
  ctx.beginPath();
  ctx.arc(view.centre.x, view.centre.y, view.radius, 0, Math.PI * 2);
  ctx.fillStyle = palette.platform;
  ctx.fill();

  if (options.background) {
    const resolution = view.source.descriptor.referenceResolution;
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
}

export interface HoleRingOptions {
  /** Number every hole. Default true. */
  holeNumbers?: boolean;
}

/**
 * The hole ring over whatever is already there. Drawn separately from the
 * platform so a figure that paints inside the disc — the heatmap — can put its
 * data between the two instead of having the disc repainted over it.
 */
export function drawHoleRing(
  frame: FigureFrame,
  view: MazeView,
  options: HoleRingOptions = {},
): void {
  const { ctx, palette } = frame;
  const { source } = view;
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
      const label = holeLabelPoint(view, hole);
      ctx.fillStyle = isTarget ? palette.target : palette.inkSoft;
      ctx.font = figureFont(ANNOTATION_SIZE, isTarget ? 'bold' : 'normal');
      ctx.fillText(String(hole.holeIndex), label.x, label.y);
    }
  }
  ctx.restore();
}

export type BackdropOptions = PlatformOptions & HoleRingOptions;

/** The platform and the ring together: what every spatial figure but the heatmap wants. */
export function drawMazeBackdrop(
  frame: FigureFrame,
  view: MazeView,
  options: BackdropOptions = {},
): void {
  drawPlatform(frame, view, options);
  drawHoleRing(frame, view, options);
}

/** The words that name the target in a legend or caption. */
export function targetLabel(source: TrialSource): string {
  return `target · hole ${source.targetIndex}`;
}
