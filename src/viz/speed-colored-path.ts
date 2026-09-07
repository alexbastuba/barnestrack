/**
 * The path coloured by speed on a viridis scale, with the bar numbered in cm/s
 * (D32). Speed comes from the centred window and the frames' own timestamps
 * (O9, O11), and the scale tops out at the 95th percentile so a single jump
 * cannot flatten the whole figure — the bar says so.
 */
import { colormapByName } from './colormaps.js';
import { centroidPath, percentile, speedsCmPerS, trialLabel, trialSource } from './data.js';
import { drawColorBar, drawLegend, formatNumber } from './figure.js';
import { targetLabel } from './maze-backdrop.js';
import {
  drawColouredPath,
  drawSpatialFigure,
  NO_DATA_SUMMARY,
  trialUnavailable,
} from './trial-figure.js';
import type { FigureDescription, FigureSpec } from './types.js';

const SIZE = { width: 470, height: 500 };
const TITLE = 'Path coloured by speed';
const SCALE_PERCENTILE = 0.95;

function speedOf(data: Parameters<FigureSpec['describe']>[0]) {
  const source = trialSource(data);
  if (!source) return null;
  const path = centroidPath(source.analysis);
  // O11's centred window. The fallback is unreachable once chunk 5 stamps the
  // parameters before any derived layer exists (D51); TODO(chunk 5): take the
  // default from the defaults module rather than restating O11 here.
  const windowFrames = data.session.parameters?.kinematics.speedWindowFrames ?? 2;
  const speeds = speedsCmPerS(path, source.pixelsPerCm, windowFrames);
  return { source, path, speeds, top: percentile(speeds, SCALE_PERCENTILE) };
}

export const speedColoredPathFigure: FigureSpec = {
  id: 'speed-colored-path',
  title: TITLE,
  scope: 'trial',
  defaultSize: SIZE,
  unavailable: trialUnavailable,
  options: ['colormap'],

  draw(ctx, data, opts) {
    drawSpatialFigure(
      ctx,
      data,
      opts,
      { title: TITLE, defaultSize: SIZE },
      (frame, source, view) => {
        const computed = speedOf(data);
        if (!computed) return;
        const top = Math.max(1, computed.top);
        const map = colormapByName(opts.colormap, 'viridis');
        drawColouredPath(frame, view, computed.path, computed.speeds, map, {
          min: 0,
          max: top,
        });

        const bottom = frame.plot.y + frame.plot.height;
        drawColorBar(frame, {
          map,
          min: 0,
          max: top,
          label: `Speed (cm/s), scale to the ${SCALE_PERCENTILE * 100}th percentile`,
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

  describe(data, options): FigureDescription {
    const computed = speedOf(data);
    if (!computed) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
    const { source, speeds } = computed;
    const finite = speeds.filter((speed) => Number.isFinite(speed));
    const map = colormapByName(options?.colormap, 'viridis');
    return {
      title: `${TITLE} — ${trialLabel(source.descriptor)}`,
      summary: `The body centroid coloured by speed in cm/s on the ${map.name} scale, computed over a centred window using each frame’s own timestamp.`,
      columns: ['Quantity', 'Value'],
      rows: [
        ['Mean speed (cm/s)', source.analysis.derived.metrics.meanSpeed_cmPerS],
        ['Median speed (cm/s)', Number(formatNumber(percentile(finite, 0.5)))],
        ['95th percentile speed (cm/s)', Number(formatNumber(computed.top))],
        // A reduce, not a spread: one argument per tracked frame would blow the
        // call-argument limit on a long enough clip.
        ['Fastest speed (cm/s)', Number(formatNumber(finite.reduce((a, b) => Math.max(a, b), 0)))],
        ['Target hole', source.targetIndex],
      ],
    };
  },
};
