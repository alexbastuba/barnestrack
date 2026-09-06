/**
 * Whether this video can be trusted, at a glance (D30): the detection state of
 * every frame as one horizontal strip along the clip's time axis, so a run of
 * lost frames is visible as a band rather than as a number.
 *
 * Each state has its own fill *and* its own hatch direction, and the legend
 * names each one in words with its percentage, so the strip reads on a
 * grayscale printer and through a screen reader (D26, D37).
 */
import type { DetectionState } from '../contracts/track.js';
import { trialLabel, trialSource } from './data.js';
import type { FigureFrame, Rect } from './figure.js';
import {
  beginFigure,
  drawAxes,
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

const SIZE = { width: 660, height: 260 };
const TITLE = 'Tracking quality over the clip';
const MARGINS = { top: 34, right: 24, bottom: 114, left: 62 };

/** The order the states are stacked in the legend and the description. */
const STATES: readonly DetectionState[] = [
  'tracked',
  'low_confidence',
  'ambiguous',
  'not_detected',
];

const STATE_WORDS: Record<DetectionState, string> = {
  tracked: 'tracked',
  low_confidence: 'low confidence',
  ambiguous: 'ambiguous',
  not_detected: 'not detected',
};

export interface StateRun {
  state: DetectionState;
  startFrame: number;
  endFrame: number;
  startTime_s: number;
  endTime_s: number;
}

/** Consecutive frames sharing a detection state, run-length clustered (D30). */
export function stateRuns(
  frames: readonly { frameIndex: number; t_s: number; detectionState: DetectionState }[],
): StateRun[] {
  const runs: StateRun[] = [];
  for (const frame of frames) {
    const last = runs[runs.length - 1];
    if (last && last.state === frame.detectionState) {
      last.endFrame = frame.frameIndex;
      last.endTime_s = frame.t_s;
      continue;
    }
    runs.push({
      state: frame.detectionState,
      startFrame: frame.frameIndex,
      endFrame: frame.frameIndex,
      startTime_s: frame.t_s,
      endTime_s: frame.t_s,
    });
  }
  return runs;
}

function paintState(frame: FigureFrame, state: DetectionState, rect: Rect): void {
  const { ctx, palette } = frame;
  ctx.save();
  switch (state) {
    case 'tracked':
      ctx.fillStyle = palette.panel;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      break;
    case 'low_confidence':
      ctx.fillStyle = palette.paper;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      fillHatched(ctx, rect, palette.filled, 4);
      break;
    case 'ambiguous':
      ctx.fillStyle = palette.paper;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      fillHatched(ctx, rect, palette.warn, 2);
      break;
    case 'not_detected':
      ctx.fillStyle = palette.ink;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      break;
  }
  ctx.restore();
}

export const qualityStripFigure: FigureSpec = {
  id: 'quality-strip',
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
    const track = source.analysis.derived.cleanedTrack;
    const start = track[0]?.t_s ?? 0;
    const end = track[track.length - 1]?.t_s ?? 1;
    const span = Math.max(1e-6, end - start);
    const timeX = (t: number): number => plot.x + ((t - start) / span) * plot.width;
    // The strip fills the plot area, so the time axis sits directly beneath it.
    const stripY = plot.y;
    const stripHeight = plot.height;

    for (const run of stateRuns(track)) {
      const x = timeX(run.startTime_s);
      const width = Math.max(1, timeX(run.endTime_s) - x + plot.width / Math.max(1, track.length));
      paintState(frame, run.state, { x, y: stripY, width, height: stripHeight });
    }

    ctx.save();
    ctx.strokeStyle = palette.lineStrong;
    ctx.lineWidth = palette.strokeScale;
    ctx.strokeRect(plot.x, stripY, plot.width, stripHeight);
    ctx.restore();

    const quality = source.analysis.derived.quality;
    ctx.save();
    ctx.font = figureFont(ANNOTATION_SIZE, 'bold');
    ctx.fillStyle = palette.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      `Tier ${quality.tier} · ${(quality.detectionStateFractions.tracked * 100).toFixed(1)}% tracked · ` +
        `${quality.gaps.length} gap${quality.gaps.length === 1 ? '' : 's'}, longest ${formatNumber(quality.longestGapSeconds)} s`,
      plot.x,
      plot.y + plot.height + 52,
    );
    ctx.restore();

    drawAxes(frame, {
      xLabel: 'Time from the start of the clip (s)',
      yLabel: 'Detection',
      xTicks: niceTicks(start, end, 8).map((tick) => ({
        value: timeX(tick.value) - plot.x,
        label: tick.label,
      })),
    });

    drawLegend(
      frame,
      STATES.map((state) => ({
        label: `${STATE_WORDS[state]} · ${(quality.detectionStateFractions[state] * 100).toFixed(1)}%`,
        colour:
          state === 'not_detected'
            ? palette.ink
            : state === 'ambiguous'
              ? palette.warn
              : palette.filled,
        glyph: state === 'tracked' ? 'square' : 'bar',
        hatched: state === 'low_confidence' || state === 'ambiguous',
      })),
      plot.y + plot.height + 70,
    );
    endFigure(frame);
  },

  describe(data): FigureDescription {
    const source = trialSource(data);
    if (!source) return { title: TITLE, summary: NO_DATA_SUMMARY, columns: ['Detail'], rows: [] };
    const quality = source.analysis.derived.quality;
    return {
      title: `${TITLE} — ${trialLabel(source.descriptor)}`,
      summary: `Detection state for every frame of the clip. Quality tier ${quality.tier}; ${quality.gaps.length} gap${quality.gaps.length === 1 ? '' : 's'}, the longest ${formatNumber(quality.longestGapSeconds)} s.`,
      columns: ['Detection state', 'Fraction of frames'],
      rows: [
        ...STATES.map((state) => [STATE_WORDS[state], quality.detectionStateFractions[state]]),
        ['gaps', quality.gaps.length],
        ['longest gap (s)', quality.longestGapSeconds],
        ['quality tier', quality.tier],
      ],
    };
  },
};
