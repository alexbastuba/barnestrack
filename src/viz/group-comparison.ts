/**
 * One measure compared across groups: the group mean with every individual
 * trial shown beside it, so a difference between two means is read against the
 * spread it came from rather than on its own (D32).
 *
 * Groups come from the O12 metadata typed on the Videos step. With fewer than
 * two trials carrying metadata there is nothing to compare, and the figure says
 * exactly that instead of drawing an empty axis.
 */
import type { SessionFile } from '../contracts/session.js';
import {
  DEFAULT_METRIC,
  mean,
  METRIC_LABELS,
  NO_METADATA_MESSAGE,
  standardDeviation,
  trialPoints,
} from './cohort.js';
import {
  beginFigure,
  drawAxes,
  drawGlyph,
  drawLegend,
  drawUnavailable,
  endFigure,
  formatNumber,
  niceScale,
} from './figure.js';
import { seriesColour } from './theme.js';
import type { FigureDescription, FigureSpec, PlottableMetric } from './types.js';

const SIZE = { width: 560, height: 420 };
const TITLE = 'Group comparison';
const MARGINS = { top: 34, right: 20, bottom: 84, left: 68 };
/** Enough trials to have something to compare. */
const MINIMUM_TRIALS = 2;

export interface GroupSummary {
  group: string;
  values: number[];
  mean: number;
  standardDeviation: number;
  /** Trials in the group that have no value for this metric. */
  missing: number;
}

export interface GroupComparison {
  metric: PlottableMetric;
  metricLabel: string;
  groups: GroupSummary[];
  /** Trials carrying metadata, whether or not they have a value. */
  trialCount: number;
}

export function groupComparison(
  session: SessionFile,
  metric: PlottableMetric = DEFAULT_METRIC,
): GroupComparison {
  const points = trialPoints(session, metric);
  const byGroup = new Map<string, { values: number[]; missing: number }>();
  for (const point of points) {
    const entry = byGroup.get(point.group) ?? { values: [], missing: 0 };
    if (point.value === null) entry.missing++;
    else entry.values.push(point.value);
    byGroup.set(point.group, entry);
  }
  return {
    metric,
    metricLabel: METRIC_LABELS[metric],
    trialCount: points.length,
    groups: [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, entry]) => ({
        group,
        values: entry.values,
        mean: mean(entry.values),
        standardDeviation: standardDeviation(entry.values),
        missing: entry.missing,
      })),
  };
}

/** A repeatable sideways nudge, so overlapping points separate without moving. */
function jitter(index: number, count: number, width: number): number {
  if (count <= 1) return 0;
  return (index / (count - 1) - 0.5) * width;
}

export const groupComparisonFigure: FigureSpec = {
  id: 'group-comparison',
  title: TITLE,
  scope: 'cohort',
  defaultSize: SIZE,

  unavailable(data) {
    const comparison = groupComparison(data.session, data.metric ?? DEFAULT_METRIC);
    return comparison.trialCount < MINIMUM_TRIALS ? NO_METADATA_MESSAGE : null;
  },

  draw(ctx, data, opts) {
    const frame = beginFigure(ctx, opts, { title: TITLE, defaultSize: SIZE, margins: MARGINS });
    const comparison = groupComparison(data.session, data.metric ?? DEFAULT_METRIC);
    if (comparison.trialCount < MINIMUM_TRIALS) {
      drawUnavailable(frame, NO_METADATA_MESSAGE);
      endFigure(frame);
      return;
    }
    const { palette, plot } = frame;
    const all = comparison.groups.flatMap((group) => group.values);
    const scale = niceScale(Math.max(1, ...all));
    const yTicks = scale.ticks;
    const highest = scale.top;
    const slot = plot.width / Math.max(1, comparison.groups.length);
    const centreOf = (index: number): number => plot.x + slot * (index + 0.5);
    const yOf = (value: number): number => plot.y + plot.height * (1 - value / highest);

    drawAxes(frame, {
      xLabel: 'Group',
      yLabel: comparison.metricLabel,
      xTicks: comparison.groups.map((group, index) => ({
        value: centreOf(index) - plot.x,
        label: group.group,
      })),
      yTicks: yTicks.map((tick) => ({ value: yOf(tick.value) - plot.y, label: tick.label })),
      gridY: true,
    });

    comparison.groups.forEach((group, index) => {
      const colour = seriesColour(index, opts.theme);
      const x = centreOf(index);
      const barWidth = Math.min(64, slot * 0.42);

      if (group.values.length > 0) {
        // The mean as a wide rule, with one standard deviation either side.
        const y = yOf(group.mean);
        ctx.save();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2.6 * palette.strokeScale;
        ctx.beginPath();
        ctx.moveTo(x - barWidth, y);
        ctx.lineTo(x + barWidth, y);
        ctx.stroke();
        if (group.standardDeviation > 0) {
          ctx.lineWidth = 1.2 * palette.strokeScale;
          const high = yOf(Math.min(highest, group.mean + group.standardDeviation));
          const low = yOf(Math.max(0, group.mean - group.standardDeviation));
          ctx.beginPath();
          ctx.moveTo(x, high);
          ctx.lineTo(x, low);
          ctx.moveTo(x - barWidth / 3, high);
          ctx.lineTo(x + barWidth / 3, high);
          ctx.moveTo(x - barWidth / 3, low);
          ctx.lineTo(x + barWidth / 3, low);
          ctx.stroke();
        }
        ctx.restore();
      }

      group.values.forEach((value, pointIndex) => {
        drawGlyph(
          ctx,
          'ring',
          x + jitter(pointIndex, group.values.length, barWidth * 1.2),
          yOf(value),
          8,
          colour,
        );
      });
    });

    drawLegend(
      frame,
      [
        { label: 'group mean', colour: palette.ink, glyph: 'bar' },
        { label: '± 1 standard deviation', colour: palette.ink, glyph: 'cross' },
        { label: 'one trial', colour: palette.ink, glyph: 'ring' },
      ],
      plot.y + plot.height + 54,
    );
    endFigure(frame);
  },

  describe(data): FigureDescription {
    const comparison = groupComparison(data.session, data.metric ?? DEFAULT_METRIC);
    if (comparison.trialCount < MINIMUM_TRIALS) {
      return { title: TITLE, summary: NO_METADATA_MESSAGE, columns: ['Detail'], rows: [] };
    }
    return {
      title: `${TITLE} — ${comparison.metricLabel}`,
      summary: `${comparison.metricLabel} by group: the mean, one standard deviation, and every trial behind it.`,
      columns: ['Group', 'Trials', 'Mean', 'SD', 'Trials with no value'],
      rows: comparison.groups.map((group) => [
        group.group,
        group.values.length,
        Number(formatNumber(group.mean)),
        Number(formatNumber(group.standardDeviation)),
        group.missing,
      ]),
    };
  },
};
