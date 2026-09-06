/**
 * Learning across a cohort: one line per animal, the chosen metric against day
 * or trial (D32). The x axis is day when the cohort spans more than one day and
 * trial otherwise, because that is the axis the data actually varies along.
 *
 * Every animal gets its own marker shape and its own dash pattern as well as
 * its own colour, and the legend names it, so the lines can be told apart on a
 * grayscale printer (D26, D37). A trial with no value for the metric — no
 * escape, so no total latency — leaves a break rather than a zero.
 */
import type { SessionFile } from '../contracts/session.js';
import type { TrialPoint } from './cohort.js';
import {
  DEFAULT_METRIC,
  METRIC_LABELS,
  NO_METADATA_MESSAGE,
  SERIES_DASHES,
  SERIES_GLYPHS,
  trialPoints,
} from './cohort.js';
import type { GlyphKind, LegendEntry } from './figure.js';
import {
  beginFigure,
  drawAxes,
  drawGlyph,
  drawLegend,
  drawUnavailable,
  endFigure,
  formatNumber,
  niceTicks,
} from './figure.js';
import { seriesColour } from './theme.js';
import type { FigureDescription, FigureSpec, PlottableMetric } from './types.js';

const SIZE = { width: 620, height: 420 };
const TITLE = 'Learning curve';
const MARGINS = { top: 34, right: 20, bottom: 84, left: 68 };

export interface CurvePoint {
  x: number;
  xLabel: string;
  value: number | null;
  videoId: string;
}

export interface CurveSeries {
  animal: string;
  points: CurvePoint[];
}

export interface LearningCurve {
  metric: PlottableMetric;
  metricLabel: string;
  /** Whether trials are laid out by day or by trial number. */
  xAxis: 'day' | 'trial';
  /** The distinct x values, in order, as they are labelled on the axis. */
  xLabels: string[];
  series: CurveSeries[];
}

/**
 * One series per animal, ordered by animal name, with the metric read off each
 * trial. Trials sharing an animal and an x value are averaged, so two trials on
 * the same day give one point rather than a vertical pair.
 */
export function learningCurveSeries(
  session: SessionFile,
  metric: PlottableMetric = DEFAULT_METRIC,
): LearningCurve {
  const points = trialPoints(session, metric);
  const days = new Set(points.map((point) => point.day).filter(Boolean));
  const xAxis: 'day' | 'trial' = days.size > 1 ? 'day' : 'trial';
  const keyOf = (point: TrialPoint): string => (xAxis === 'day' ? point.day : point.trial) || '—';

  const xLabels = [...new Set(points.map(keyOf))].sort(compareLabels);
  const byAnimal = new Map<string, TrialPoint[]>();
  for (const point of points) {
    const list = byAnimal.get(point.animal) ?? [];
    list.push(point);
    byAnimal.set(point.animal, list);
  }

  const series: CurveSeries[] = [...byAnimal.entries()]
    .sort(([a], [b]) => compareLabels(a, b))
    .map(([animal, animalPoints]) => ({
      animal,
      points: xLabels
        .map((label, index) => {
          const matching = animalPoints.filter((point) => keyOf(point) === label);
          if (matching.length === 0) return null;
          const values = matching
            .map((point) => point.value)
            .filter((value): value is number => value !== null);
          return {
            x: index,
            xLabel: label,
            value:
              values.length === 0
                ? null
                : values.reduce((sum, value) => sum + value, 0) / values.length,
            videoId: matching[0]!.videoId,
          };
        })
        .filter((point): point is CurvePoint => point !== null),
    }));

  return { metric, metricLabel: METRIC_LABELS[metric], xAxis, xLabels, series };
}

/** Numeric labels sort numerically; anything else sorts as text. */
function compareLabels(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export const learningCurveFigure: FigureSpec = {
  id: 'learning-curve',
  title: TITLE,
  scope: 'cohort',
  defaultSize: SIZE,

  unavailable(data) {
    const curve = learningCurveSeries(data.session, data.metric ?? DEFAULT_METRIC);
    return curve.series.length === 0 ? NO_METADATA_MESSAGE : null;
  },

  draw(ctx, data, opts) {
    const frame = beginFigure(ctx, opts, { title: TITLE, defaultSize: SIZE, margins: MARGINS });
    const curve = learningCurveSeries(data.session, data.metric ?? DEFAULT_METRIC);
    if (curve.series.length === 0) {
      drawUnavailable(frame, NO_METADATA_MESSAGE);
      endFigure(frame);
      return;
    }
    const { palette, plot } = frame;
    const values = curve.series.flatMap((series) =>
      series.points.map((point) => point.value).filter((value): value is number => value !== null),
    );
    const top = Math.max(1, ...values);
    const yTicks = niceTicks(0, top, 5);
    const highest = Math.max(top, ...yTicks.map((tick) => tick.value));
    const xOf = (x: number): number =>
      plot.x + ((x + 0.5) / Math.max(1, curve.xLabels.length)) * plot.width;
    const yOf = (value: number): number => plot.y + plot.height * (1 - value / highest);

    drawAxes(frame, {
      xLabel: curve.xAxis === 'day' ? 'Day' : 'Trial',
      yLabel: curve.metricLabel,
      xTicks: curve.xLabels.map((label, index) => ({ value: xOf(index) - plot.x, label })),
      yTicks: yTicks.map((tick) => ({ value: yOf(tick.value) - plot.y, label: tick.label })),
      gridY: true,
    });

    const legend: LegendEntry[] = [];
    curve.series.forEach((series, index) => {
      const glyph: GlyphKind = SERIES_GLYPHS[index % SERIES_GLYPHS.length]!;
      const dash = SERIES_DASHES[index % SERIES_DASHES.length]!;
      const colour = seriesColour(index, opts.theme);
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.8 * palette.strokeScale;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (const point of series.points) {
        if (point.value === null) {
          pen = false;
          continue;
        }
        const x = xOf(point.x);
        const y = yOf(point.value);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();

      for (const point of series.points) {
        if (point.value === null) continue;
        drawGlyph(ctx, glyph, xOf(point.x), yOf(point.value), 9, colour);
      }
      legend.push({ label: series.animal, colour, glyph });
    });

    drawLegend(frame, legend, plot.y + plot.height + 54);
    endFigure(frame);
  },

  describe(data): FigureDescription {
    const curve = learningCurveSeries(data.session, data.metric ?? DEFAULT_METRIC);
    if (curve.series.length === 0) {
      return { title: TITLE, summary: NO_METADATA_MESSAGE, columns: ['Detail'], rows: [] };
    }
    return {
      title: `${TITLE} — ${curve.metricLabel}`,
      summary: `${curve.metricLabel} for each animal against ${curve.xAxis}. A blank cell is a trial with no value for this measure, not a zero.`,
      columns: ['Animal', ...curve.xLabels.map((label) => `${curve.xAxis} ${label}`)],
      rows: curve.series.map((series) => [
        series.animal,
        ...curve.xLabels.map((label) => {
          const point = series.points.find((candidate) => candidate.xLabel === label);
          return point?.value === null || point === undefined
            ? null
            : Number(formatNumber(point.value));
        }),
      ]),
    };
  },
};
