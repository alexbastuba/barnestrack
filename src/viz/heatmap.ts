/**
 * Where the animal spent its time: occupancy on a square grid measured in
 * centimetres, on the cividis scale (D32), with the numbered hole ring drawn
 * over the top so a hot cell can be named.
 *
 * Occupancy is summed in seconds using each frame's own interval, not a nominal
 * frame rate, so an irregular timebase does not weight some frames more than
 * others (D7, O11). Cells with nothing in them are left as platform, so an
 * empty region reads as empty rather than as the bottom of the scale.
 */
import { colormapByName, colormapCss, reverseColormap } from './colormaps.js';
import type { Colormap, ColormapName } from './colormaps.js';
import type { TrialSource } from './data.js';
import { centroidPath, trialLabel, trialSource } from './data.js';
import { drawColorBar, drawLegend, formatNumber } from './figure.js';
import { drawHoleRing, drawPlatform, targetLabel } from './maze-backdrop.js';
import { drawSpatialFigure, NO_DATA_SUMMARY, trialUnavailable } from './trial-figure.js';
import type { FigureData, FigureDescription, FigureOptions, FigureSpec } from './types.js';

const SIZE = { width: 470, height: 500 };
const TITLE = 'Occupancy heatmap';
/**
 * Heatmap bin size, cm — the default, and a figure option the user can change.
 *
 * Chunk 8 left a TODO here to move it into `Parameters`, so that it would reach
 * `parameters.json` and `parameters_hash`. D53 settled it the other way: the bin
 * size changes no number in `trials.csv` or `events.csv`, only pixels, so it is
 * a figure option and must *not* enter the hash — a different bin size must not
 * make two otherwise identical analyses look like different runs. It travels in
 * the figure's caption, its description table and its PNG filename instead, so
 * a heatmap is still reproducible from what is printed on it.
 */
export const DEFAULT_CELL_CM = 4;

/** The bin sizes the UI offers; any positive number works. */
export const CELL_CM_RANGE = { min: 1, max: 12, step: 1 };

/**
 * The occupancy map is read from light to dark, so an empty cell is the
 * lightest thing on the platform and a busy one the darkest. Read the usual way
 * round, the busiest cells would be almost as pale as the platform they sit on
 * — the one place a perceptually uniform map still needs turning around.
 */
function occupancyMap(name: ColormapName | undefined): Colormap {
  return reverseColormap(colormapByName(name, 'cividis'));
}

/**
 * The bin size in force: the option clamped to the offered range and its step,
 * or the default when there is no usable number.
 *
 * Clamped here rather than at the control, so every consumer agrees on one
 * value — the drawing, the `describe()` table and the PNG filename. The grid
 * allocates cells as the square of the span, so an unclamped 0.001 cm asks for
 * 3.4 million cells on a 46 cm platform and throws `Invalid array length` from
 * inside `draw()`; and an unrounded 4.001 and 4.002 would produce two different
 * figures under one filename.
 */
export function cellSizeCm(options: FigureOptions | undefined): number {
  const chosen = options?.heatmapCellSize_cm;
  if (typeof chosen !== 'number' || !Number.isFinite(chosen) || chosen <= 0) return DEFAULT_CELL_CM;
  const stepped = Math.round(chosen / CELL_CM_RANGE.step) * CELL_CM_RANGE.step;
  return Math.min(CELL_CM_RANGE.max, Math.max(CELL_CM_RANGE.min, stepped));
}

export interface OccupancyGrid {
  cellSize_cm: number;
  /** Cells across and down; the grid spans the platform's bounding square. */
  columns: number;
  rows: number;
  /** Tracked positions per cell, row-major. */
  counts: number[];
  /** Seconds spent in each cell, row-major. */
  seconds: number[];
  /** Platform radius in centimetres — the grid spans −radius to +radius. */
  radius_cm: number;
  totalCounted: number;
  totalSeconds: number;
  busiest: { column: number; row: number; seconds: number } | null;
}

/**
 * Bin the tracked path into square cells. Every tracked position lands in
 * exactly one cell, so `totalCounted` equals the number of tracked positions —
 * nothing is dropped at the rim by rounding.
 */
export function occupancyGrid(source: TrialSource, cellSize_cm = DEFAULT_CELL_CM): OccupancyGrid {
  const path = centroidPath(source.analysis);
  const radius_cm = source.map.platform.r / source.pixelsPerCm;
  const span = Math.max(1, Math.ceil((radius_cm * 2) / cellSize_cm));
  const counts = new Array<number>(span * span).fill(0);
  const seconds = new Array<number>(span * span).fill(0);

  /**
   * How long a position stands for: the step to the next frame when that frame
   * is the very next one, otherwise the step from the previous one. Time inside
   * a gap belongs to no cell — the animal was not seen there (O9, O10).
   */
  const durationAt = (index: number): number => {
    const point = path[index]!;
    const next = path[index + 1];
    if (next && next.frame.frameIndex === point.frame.frameIndex + 1) {
      return Math.max(0, next.t_s - point.t_s);
    }
    const previous = path[index - 1];
    if (previous && point.frame.frameIndex === previous.frame.frameIndex + 1) {
      return Math.max(0, point.t_s - previous.t_s);
    }
    return 0;
  };

  let totalCounted = 0;
  let totalSeconds = 0;
  path.forEach((point, index) => {
    const x_cm = (point.x - source.map.platform.cx) / source.pixelsPerCm;
    const y_cm = (point.y - source.map.platform.cy) / source.pixelsPerCm;
    const column = clampIndex(Math.floor((x_cm + radius_cm) / cellSize_cm), span);
    const row = clampIndex(Math.floor((y_cm + radius_cm) / cellSize_cm), span);
    const cell = row * span + column;
    const interval = durationAt(index);
    counts[cell]!++;
    seconds[cell]! += interval;
    totalCounted++;
    totalSeconds += interval;
  });

  let busiest: OccupancyGrid['busiest'] = null;
  seconds.forEach((value, cell) => {
    if (value > 0 && (!busiest || value > busiest.seconds)) {
      busiest = { column: cell % span, row: Math.floor(cell / span), seconds: value };
    }
  });

  return {
    cellSize_cm,
    columns: span,
    rows: span,
    counts,
    seconds,
    radius_cm,
    totalCounted,
    totalSeconds,
    busiest,
  };
}

function clampIndex(value: number, span: number): number {
  return Math.min(span - 1, Math.max(0, value));
}

export const heatmapFigure: FigureSpec = {
  options: ['colormap', 'heatmapCellSize_cm'],
  id: 'heatmap',
  title: TITLE,
  scope: 'trial',
  defaultSize: SIZE,
  unavailable: trialUnavailable,

  draw(ctx, data, opts) {
    drawSpatialFigure(
      ctx,
      data,
      opts,
      { title: TITLE, defaultSize: SIZE, backdrop: false },
      (frame, source, view) => {
        const { palette } = frame;
        // The platform, then the cells inside it, then the ring over the top.
        // The disc is never repainted, or it would cover its own data.
        drawPlatform(frame, view, { background: opts.background });

        const grid = occupancyGrid(source, cellSizeCm(opts));
        const map = occupancyMap(opts.colormap);
        // reduce, not a spread: the cell count grows as 1/cellSize² and a fine
        // grid would put tens of thousands of arguments on one call.
        const hottest = grid.seconds.reduce((most, value) => Math.max(most, value), 0);
        const cellPx = grid.cellSize_cm * view.cmScale;

        ctx.save();
        ctx.beginPath();
        ctx.arc(view.centre.x, view.centre.y, view.radius, 0, Math.PI * 2);
        ctx.clip();
        for (let row = 0; row < grid.rows; row++) {
          for (let column = 0; column < grid.columns; column++) {
            const value = grid.seconds[row * grid.columns + column]!;
            if (value <= 0) continue;
            ctx.fillStyle = colormapCss(map, hottest > 0 ? value / hottest : 0);
            ctx.fillRect(
              view.centre.x + (column * grid.cellSize_cm - grid.radius_cm) * view.cmScale,
              view.centre.y + (row * grid.cellSize_cm - grid.radius_cm) * view.cmScale,
              cellPx + 0.5,
              cellPx + 0.5,
            );
          }
        }
        ctx.restore();

        drawHoleRing(frame, view);

        const bottom = frame.plot.y + frame.plot.height;
        drawColorBar(frame, {
          map,
          min: 0,
          max: Math.round(hottest * 10) / 10,
          label: `Time in a ${grid.cellSize_cm} cm cell (s)`,
          rect: { x: frame.plot.x + 40, y: bottom + 12, width: frame.plot.width - 80, height: 10 },
        });
        drawLegend(
          frame,
          [
            // The platform fill is near-white, so the swatch needs its outline.
            {
              label: 'no time spent here',
              colour: palette.platform,
              glyph: 'square',
              border: true,
            },
            { label: targetLabel(source), colour: palette.target, glyph: 'square' },
          ],
          bottom + 46,
        );
      },
    );
  },

  describe(data, options): FigureDescription {
    return describeHeatmap(data, options);
  },
};

function describeHeatmap(data: FigureData, options?: FigureOptions): FigureDescription {
  const source = trialSource(data);
  if (!source) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
  const grid = occupancyGrid(source, cellSizeCm(options));
  const map = occupancyMap(options?.colormap);
  const occupied = grid.counts.filter((count) => count > 0).length;
  return {
    title: `${TITLE} — ${trialLabel(source.descriptor)}`,
    summary: `Seconds spent in each ${grid.cellSize_cm} cm cell of the platform, on the ${map.name} scale so a busy cell is the darkest thing on the platform, with the hole ring over the top.`,
    columns: ['Quantity', 'Value'],
    rows: [
      ['Cell size (cm)', grid.cellSize_cm],
      ['Cells with any time in them', occupied],
      ['Tracked positions binned', grid.totalCounted],
      ['Time accounted for (s)', Number(formatNumber(grid.totalSeconds))],
      ['Longest time in one cell (s)', Number(formatNumber(grid.busiest?.seconds ?? 0))],
      ['Target hole', source.targetIndex],
    ],
  };
}
