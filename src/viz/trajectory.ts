/**
 * The path the animal took, over the video's own still when one is supplied and
 * a plain platform disc when not (D32, D33). Start and end are different shapes,
 * gap-filled positions are hollow and dashed (D26, O10), and a break in the
 * track is a break in the line — never a straight line across a gap.
 */
import { centroidPath, pathRuns, trialLabel, trialSource } from './data.js';
import { drawGlyph, drawLegend } from './figure.js';
import { targetLabel } from './maze-backdrop.js';
import { drawSpatialFigure, NO_DATA_SUMMARY, trialUnavailable } from './trial-figure.js';
import type { FigureData, FigureDescription, FigureSpec } from './types.js';

const SIZE = { width: 470, height: 500 };

export const trajectoryFigure: FigureSpec = {
  id: 'trajectory',
  title: 'Trajectory',
  scope: 'trial',
  defaultSize: SIZE,
  unavailable: trialUnavailable,

  draw(ctx, data, opts) {
    drawSpatialFigure(
      ctx,
      data,
      opts,
      { title: 'Trajectory', defaultSize: SIZE },
      (frame, source, view) => {
        const { palette } = frame;
        const path = centroidPath(source.analysis);
        const runs = pathRuns(path);

        ctx.save();
        ctx.strokeStyle = palette.path;
        ctx.lineWidth = 1.4 * palette.strokeScale;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
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

        for (const point of path) {
          if (!point.filled) continue;
          const at = view.toFigure(point);
          drawGlyph(ctx, 'ring', at.x, at.y, 7, palette.filled, true);
        }

        const first = path[0];
        const last = path[path.length - 1];
        if (first) {
          const at = view.toFigure(first);
          drawGlyph(ctx, 'triangle', at.x, at.y, 11, palette.ok);
        }
        if (last) {
          const at = view.toFigure(last);
          drawGlyph(ctx, 'diamond', at.x, at.y, 11, palette.corrected);
        }

        const filledCount = path.filter((point) => point.filled).length;
        drawLegend(frame, [
          { label: 'path (body centroid)', colour: palette.path, glyph: 'bar' },
          { label: 'start', colour: palette.ok, glyph: 'triangle' },
          { label: 'last seen', colour: palette.corrected, glyph: 'diamond' },
          // Only when there is one: a key to a mark the figure does not carry
          // invites the reader to hunt for something that is not there.
          ...(filledCount > 0
            ? [
                {
                  label: `gap-filled position (${filledCount})`,
                  colour: palette.filled,
                  glyph: 'ring' as const,
                  hollow: true,
                },
              ]
            : []),
          { label: targetLabel(source), colour: palette.target, glyph: 'square' },
        ]);
      },
    );
  },

  describe(data) {
    return describeTrajectory(data);
  },
};

function describeTrajectory(data: FigureData): FigureDescription {
  const source = trialSource(data);
  if (!source) {
    return { title: 'Trajectory', summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
  }
  const metrics = source.analysis.derived.metrics;
  const path = centroidPath(source.analysis);
  const runs = pathRuns(path);
  return {
    title: `Trajectory — ${trialLabel(source.descriptor)}`,
    summary:
      'The body centroid over the whole clip, in the video’s own pixels, on a 20-hole Barnes platform. Breaks in the line are frames with no detection.',
    columns: ['Quantity', 'Value'],
    rows: [
      ['Target hole', source.targetIndex],
      ['Path length (cm)', metrics.pathLength_cm],
      ['Smoothed path length (cm)', metrics.pathLengthSmoothed_cm],
      ['Mean speed (cm/s)', metrics.meanSpeed_cmPerS],
      ['Tracked positions', path.length],
      ['Unbroken runs', runs.length],
      ['Gap-filled positions', path.filter((point) => point.filled).length],
      ['Tracked fraction', metrics.trackedFraction],
    ],
  };
}
