/**
 * The same path as the trajectory figure, with elapsed time carried by colour
 * on a viridis scale (D32). The colour bar is numbered in seconds, so the
 * direction of travel is readable without an animation and without relying on
 * hue: viridis rises in lightness from start to finish, so it still reads dark
 * to light on a grayscale printer.
 */
import { VIRIDIS } from './colormaps.js';
import { centroidPath, trialLabel, trialSource } from './data.js';
import { drawColorBar, drawLegend } from './figure.js';
import { targetLabel } from './maze-backdrop.js';
import {
  drawColouredPath,
  drawSpatialFigure,
  NO_DATA_SUMMARY,
  trialUnavailable,
} from './trial-figure.js';
import type { FigureDescription, FigureSpec } from './types.js';

const SIZE = { width: 470, height: 500 };
const TITLE = 'Path coloured by time';

export const timeColoredPathFigure: FigureSpec = {
  id: 'time-colored-path',
  title: TITLE,
  scope: 'trial',
  defaultSize: SIZE,
  unavailable: trialUnavailable,

  draw(ctx, data, opts) {
    drawSpatialFigure(
      ctx,
      data,
      opts,
      { title: TITLE, defaultSize: SIZE },
      (frame, source, view) => {
        const path = centroidPath(source.analysis);
        const first = path[0]?.t_s ?? 0;
        const last = path[path.length - 1]?.t_s ?? 0;
        drawColouredPath(
          frame,
          view,
          path,
          path.map((point) => point.t_s),
          VIRIDIS,
          { min: first, max: last },
        );

        const bottom = frame.plot.y + frame.plot.height;
        drawColorBar(frame, {
          map: VIRIDIS,
          min: 0,
          max: Math.round((last - first) * 10) / 10,
          label: 'Time from the start of the clip (s)',
          rect: { x: frame.plot.x + 40, y: bottom + 12, width: frame.plot.width - 80, height: 10 },
        });
        drawLegend(
          frame,
          [{ label: targetLabel(source), colour: frame.palette.target, glyph: 'square' }],
          bottom + 46,
        );
      },
    );
  },

  describe(data): FigureDescription {
    const source = trialSource(data);
    if (!source) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
    const path = centroidPath(source.analysis);
    const first = path[0]?.t_s ?? 0;
    const last = path[path.length - 1]?.t_s ?? 0;
    const quarters = [0.25, 0.5, 0.75].map((fraction) => {
      const point = path[Math.floor(fraction * (path.length - 1))];
      const hole = nearestHoleIndex(source, point);
      return [
        `${Math.round(fraction * 100)}% through the clip`,
        `${(point?.t_s ?? 0).toFixed(1)} s, nearest hole ${hole}`,
      ];
    });
    return {
      title: `${TITLE} — ${trialLabel(source.descriptor)}`,
      summary:
        'The body centroid coloured by elapsed time on a viridis scale: dark at the start of the clip, light at the end.',
      columns: ['Point in the clip', 'Where the animal was'],
      rows: [
        ['Start', `${first.toFixed(1)} s, nearest hole ${nearestHoleIndex(source, path[0])}`],
        ...quarters,
        [
          'Last seen',
          `${last.toFixed(1)} s, nearest hole ${nearestHoleIndex(source, path[path.length - 1])}`,
        ],
      ],
    };
  },
};

function nearestHoleIndex(
  source: NonNullable<ReturnType<typeof trialSource>>,
  point: { x: number; y: number } | undefined,
): number | string {
  if (!point) return '—';
  let best = source.holes[0];
  let bestDistance = Infinity;
  for (const hole of source.holes) {
    const distance = Math.hypot(hole.x - point.x, hole.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hole;
    }
  }
  return best?.holeIndex ?? '—';
}
