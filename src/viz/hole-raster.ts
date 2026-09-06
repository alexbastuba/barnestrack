/**
 * Every hole visit on one time axis: a row per hole, time in seconds across
 * (D24, D32). An investigation is a bar, an escape-box entry is a diamond, and
 * a corrected event is hatched with the word "corrected" in the legend, so an
 * edited value never looks automatic (D26).
 *
 * The target row is marked twice over — a glyph in the margin and the word
 * "target" beside its number — because a row picked out only by colour would be
 * lost on a grayscale printer (D37).
 */
import type { EventRecord } from '../contracts/events.js';
import type { TrialSource } from './data.js';
import { trialLabel, trialSource } from './data.js';
import type { Rect } from './figure.js';
import {
  beginFigure,
  drawAxes,
  drawGlyph,
  drawLegend,
  drawUnavailable,
  endFigure,
  fillHatched,
  formatNumber,
  niceTicks,
} from './figure.js';
import { ANNOTATION_SIZE, figureFont } from './theme.js';
import { NO_DATA_SUMMARY, trialUnavailable } from './trial-figure.js';
import type { FigureDescription, FigureSpec } from './types.js';

const SIZE = { width: 660, height: 470 };
const TITLE = 'Hole visits over time';
const MARGINS = { top: 34, right: 24, bottom: 74, left: 62 };
const MIN_BAR_WIDTH = 2.5;

export interface RasterGeometry {
  plot: Rect;
  holeCount: number;
  startTime_s: number;
  endTime_s: number;
  /** Centre of the row for a hole, in figure pixels. */
  rowY(holeIndex: number): number;
  /** Height of one row, in figure pixels. */
  rowHeight: number;
  /** Position of a timestamp along the axis, in figure pixels. */
  timeX(t_s: number): number;
}

export function rasterGeometry(
  plot: Rect,
  holeCount: number,
  startTime_s: number,
  endTime_s: number,
): RasterGeometry {
  const rowHeight = plot.height / Math.max(1, holeCount);
  const span = Math.max(1e-6, endTime_s - startTime_s);
  return {
    plot,
    holeCount,
    startTime_s,
    endTime_s,
    rowHeight,
    rowY: (holeIndex) => plot.y + (holeIndex + 0.5) * rowHeight,
    timeX: (t_s) => plot.x + ((t_s - startTime_s) / span) * plot.width,
  };
}

function timeSpan(source: TrialSource): { start: number; end: number } {
  const track = source.analysis.derived.cleanedTrack;
  return {
    start: track[0]?.t_s ?? 0,
    end: track[track.length - 1]?.t_s ?? 1,
  };
}

/** Investigations and escape entries; a tracking failure is not a hole visit (O4). */
function holeEvents(source: TrialSource): EventRecord[] {
  return source.analysis.derived.events.filter(
    (event) => event.kind !== 'tracking_failure' && event.holeIndex !== null,
  );
}

export const holeRasterFigure: FigureSpec = {
  id: 'hole-raster',
  title: TITLE,
  scope: 'trial',
  defaultSize: SIZE,
  unavailable: trialUnavailable,

  draw(ctx, data, opts) {
    const frame = beginFigure(ctx, opts, { title: TITLE, defaultSize: SIZE, margins: MARGINS });
    const source = trialSource(data);
    if (!source) {
      drawUnavailable(frame, trialUnavailable(data) ?? NO_DATA_SUMMARY);
      endFigure(frame);
      return;
    }
    const { palette, plot } = frame;
    const span = timeSpan(source);
    const geometry = rasterGeometry(plot, source.map.holes.n, span.start, span.end);

    // Alternating row bands, so a bar can be traced back to its row number.
    ctx.save();
    for (let hole = 0; hole < geometry.holeCount; hole++) {
      if (hole % 2 === 1) continue;
      ctx.fillStyle = palette.panel;
      ctx.fillRect(plot.x, plot.y + hole * geometry.rowHeight, plot.width, geometry.rowHeight);
    }
    ctx.restore();

    drawAxes(frame, {
      xLabel: 'Time from the start of the clip (s)',
      yLabel: 'Hole',
      xTicks: niceTicks(span.start, span.end, 8).map((tick) => ({
        value: geometry.timeX(tick.value) - plot.x,
        label: tick.label,
      })),
    });

    // Row labels: the hole number, and the word "target" on the target row.
    ctx.save();
    ctx.font = figureFont(ANNOTATION_SIZE);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let hole = 0; hole < geometry.holeCount; hole++) {
      const y = geometry.rowY(hole);
      const isTarget = hole === source.targetIndex;
      ctx.fillStyle = isTarget ? palette.target : palette.inkSoft;
      ctx.font = figureFont(ANNOTATION_SIZE, isTarget ? 'bold' : 'normal');
      ctx.fillText(isTarget ? `${hole}  target` : String(hole), plot.x - 8, y);
      if (isTarget) {
        drawGlyph(ctx, 'square', plot.x - 54, y, 8, palette.target);
      }
    }
    ctx.restore();

    for (const event of holeEvents(source)) {
      const y = geometry.rowY(event.holeIndex ?? 0);
      const height = Math.max(4, geometry.rowHeight * 0.56);
      const x = geometry.timeX(event.startTime_s);
      const width = Math.max(MIN_BAR_WIDTH, geometry.timeX(event.endTime_s) - x);
      if (event.kind === 'escape_entry') {
        drawGlyph(ctx, 'diamond', x, y, Math.max(9, height), palette.target);
        continue;
      }
      const rect: Rect = { x, y: y - height / 2, width, height };
      if (event.source === 'corrected') {
        fillHatched(ctx, rect, palette.corrected, 3);
        ctx.save();
        ctx.strokeStyle = palette.corrected;
        ctx.lineWidth = 1.2 * palette.strokeScale;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = event.isTarget ? palette.target : palette.ink;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      }
    }

    drawLegend(
      frame,
      [
        { label: 'investigation', colour: palette.ink, glyph: 'bar' },
        { label: 'investigation of the target hole', colour: palette.target, glyph: 'bar' },
        { label: 'corrected by a reviewer', colour: palette.corrected, hatched: true },
        { label: 'escape-box entry', colour: palette.target, glyph: 'diamond' },
      ],
      plot.y + plot.height + 46,
    );
    endFigure(frame);
  },

  describe(data): FigureDescription {
    const source = trialSource(data);
    if (!source) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
    return {
      title: `${TITLE} — ${trialLabel(source.descriptor)}`,
      summary: `Every hole investigation and escape-box entry on one time axis; hole ${source.targetIndex} is the target. Corrected events are hatched.`,
      columns: ['Hole', 'Kind', 'Start (s)', 'Duration (s)', 'Source'],
      rows: holeEvents(source).map((event) => [
        event.isTarget ? `${event.holeIndex} (target)` : (event.holeIndex ?? '—'),
        event.kind === 'escape_entry' ? 'escape-box entry' : 'investigation',
        Number(formatNumber(event.startTime_s)),
        Number(formatNumber(event.durationSeconds)),
        event.source,
      ]),
    };
  },
};
