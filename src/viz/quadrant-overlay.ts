/**
 * The target quadrant (O6): the sector centred on the target hole, spanning
 * `targetQuadrant.holeSpan` holes either side. The path inside it is drawn at
 * full strength and the rest is dimmed, so the measure behind
 * `target_quadrant_time_s` is visible rather than asserted — and the sector is
 * outlined and labelled in words, so it survives being dimmed in grayscale.
 */
import { angleAt } from '../maze/ring.js';
import type { Point } from '../maze/types.js';
import { normaliseDeg } from '../maze/types.js';
import type { TrialSource } from './data.js';
import { centroidPath, pathRuns, trialLabel, trialSource } from './data.js';
import { drawLegend } from './figure.js';
import { targetLabel } from './maze-backdrop.js';
import { drawSpatialFigure, NO_DATA_SUMMARY, trialUnavailable } from './trial-figure.js';
import type { FigureData, FigureDescription, FigureSpec } from './types.js';

const SIZE = { width: 470, height: 500 };
const TITLE = 'Target quadrant';
const DEFAULT_HOLE_SPAN = 2.5;
const OUTSIDE_ALPHA = 0.22;

interface Sector {
  /** Degrees, measured the way `src/maze/ring.ts` measures them. */
  centreDeg: number;
  halfWidthDeg: number;
  holeSpan: number;
}

function sectorFor(source: TrialSource, data: FigureData): Sector {
  const holeSpan = data.session.parameters?.targetQuadrant.holeSpan ?? DEFAULT_HOLE_SPAN;
  const target = source.holes[source.targetIndex];
  return {
    centreDeg: target ? (angleAt(source.map.platform, target) ?? 0) : 0,
    halfWidthDeg: (holeSpan * 360) / source.map.holes.n,
    holeSpan,
  };
}

function insideSector(source: TrialSource, sector: Sector, point: Point): boolean {
  const angle = angleAt(source.map.platform, point);
  if (angle === null) return false;
  const delta = ((normaliseDeg(angle - sector.centreDeg) + 180) % 360) - 180;
  return Math.abs(delta) <= sector.halfWidthDeg;
}

export const quadrantOverlayFigure: FigureSpec = {
  id: 'quadrant-overlay',
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
        const { palette } = frame;
        const sector = sectorFor(source, data);
        const from = ((sector.centreDeg - sector.halfWidthDeg) * Math.PI) / 180;
        const to = ((sector.centreDeg + sector.halfWidthDeg) * Math.PI) / 180;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(view.centre.x, view.centre.y);
        ctx.arc(view.centre.x, view.centre.y, view.radius, from, to);
        ctx.closePath();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = palette.target;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6 * palette.strokeScale;
        ctx.strokeStyle = palette.target;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();

        const path = centroidPath(source.analysis);
        ctx.save();
        ctx.lineWidth = 1.5 * palette.strokeScale;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const run of pathRuns(path)) {
          for (let i = 1; i < run.length; i++) {
            const previous = run[i - 1]!;
            const current = run[i]!;
            const inside =
              insideSector(source, sector, current) && insideSector(source, sector, previous);
            ctx.globalAlpha = inside ? 1 : OUTSIDE_ALPHA;
            ctx.strokeStyle = inside ? palette.target : palette.path;
            const a = view.toFigure(previous);
            const b = view.toFigure(current);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        ctx.restore();

        drawLegend(frame, [
          {
            label: `target quadrant · ±${sector.holeSpan} holes either side (O6)`,
            colour: palette.target,
            glyph: 'square',
          },
          { label: 'path inside the quadrant', colour: palette.target, glyph: 'bar' },
          { label: 'path outside it, dimmed', colour: palette.line, glyph: 'bar' },
          { label: targetLabel(source), colour: palette.target, glyph: 'diamond' },
        ]);
      },
    );
  },

  describe(data): FigureDescription {
    const source = trialSource(data);
    if (!source) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
    const sector = sectorFor(source, data);
    const path = centroidPath(source.analysis);
    const inside = path.filter((point) => insideSector(source, sector, point)).length;
    return {
      title: `${TITLE} — ${trialLabel(source.descriptor)}`,
      summary: `The sector centred on hole ${source.targetIndex}, ${sector.holeSpan} holes either side, with the path inside it drawn at full strength (O6).`,
      columns: ['Quantity', 'Value'],
      rows: [
        ['Target hole', source.targetIndex],
        ['Quadrant width (holes either side)', sector.holeSpan],
        ['Quadrant width (degrees)', Math.round(sector.halfWidthDeg * 2)],
        ['Time in the target quadrant (s)', source.analysis.derived.metrics.targetQuadrantTime_s],
        ['Tracked positions inside the quadrant', inside],
        ['Tracked positions in total', path.length],
      ],
    };
  },
};
