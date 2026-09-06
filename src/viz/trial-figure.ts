/**
 * The frame every per-trial spatial figure shares: resolve the trial, fit the
 * maze into the plot area, draw the backdrop, then hand over. A figure with no
 * data draws the reason on the canvas rather than leaving an empty box.
 */
import type { Colormap } from './colormaps.js';
import { colormapCss } from './colormaps.js';
import type { PathPoint, TrialSource } from './data.js';
import { pathRuns, trialSource } from './data.js';
import type { FigureFrame } from './figure.js';
import { beginFigure, drawUnavailable, endFigure } from './figure.js';
import type { MazeView } from './maze-backdrop.js';
import { drawMazeBackdrop, mazeView } from './maze-backdrop.js';
import type { FigureData, FigureOpts, FigureSize } from './types.js';

/** The one-line summary a DOM mirror shows when there is nothing to describe. */
export const NO_DATA_SUMMARY = 'This video has not been analysed yet.';

export const NO_TRIAL_MESSAGE =
  'No analysis for this video yet. Set the maze up on the Maze step, then track the video on the Track step.';

/** Spatial figures fill their square with the maze and need no y axis. */
export const SPATIAL_MARGINS = { top: 34, right: 16, bottom: 74, left: 16 };

export interface SpatialFigureOptions {
  title: string;
  defaultSize: FigureSize;
  /** Draw the numbered hole ring under the data. Default true. */
  backdrop?: boolean;
}

export function drawSpatialFigure(
  ctx: CanvasRenderingContext2D,
  data: FigureData,
  opts: FigureOpts,
  spec: SpatialFigureOptions,
  render: (frame: FigureFrame, source: TrialSource, view: MazeView) => void,
): void {
  const frame = beginFigure(ctx, opts, {
    title: spec.title,
    defaultSize: spec.defaultSize,
    margins: SPATIAL_MARGINS,
  });
  const source = trialSource(data);
  if (!source) {
    drawUnavailable(frame, NO_TRIAL_MESSAGE);
    endFigure(frame);
    return;
  }
  const view = mazeView(frame, source);
  if (spec.backdrop !== false) {
    drawMazeBackdrop(frame, view, { background: opts.background });
  }
  render(frame, source, view);
  endFigure(frame);
}

export function trialUnavailable(data: FigureData): string | null {
  return trialSource(data) ? null : NO_TRIAL_MESSAGE;
}

/**
 * A path whose colour carries a per-point quantity — elapsed time or speed.
 * Each segment takes the mean of its two endpoints, and runs are broken at gaps
 * so no colour is invented across frames that were never seen.
 */
export function drawColouredPath(
  frame: FigureFrame,
  view: MazeView,
  path: readonly PathPoint[],
  values: readonly number[],
  map: Colormap,
  domain: { min: number; max: number },
): void {
  const { ctx, palette } = frame;
  const span = domain.max - domain.min;
  const indexOf = new Map(path.map((point, index) => [point, index]));
  const runs = pathRuns(path);
  const width = 2.2 * palette.strokeScale;

  /*
   * A casing under the path. The bright end of viridis is almost white once
   * the colour is thrown away, so the fastest — or latest — segments would
   * disappear into the platform on a grayscale printer. A darker line beneath
   * keeps them visible without touching the scale itself.
   */
  ctx.save();
  ctx.strokeStyle = palette.platformEdge;
  ctx.lineWidth = width + 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const run of runs) {
    ctx.beginPath();
    run.forEach((point, index) => {
      const at = view.toFigure(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const from = view.toFigure(run[i - 1]!);
      const to = view.toFigure(run[i]!);
      const a = values[indexOf.get(run[i - 1]!) ?? 0] ?? 0;
      const b = values[indexOf.get(run[i]!) ?? 0] ?? 0;
      ctx.strokeStyle = colormapCss(map, span > 0 ? ((a + b) / 2 - domain.min) / span : 0);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
