/**
 * Whether this video can be trusted, before anyone builds a figure on it
 * (D30, D54).
 *
 * The tier, the fractions, the gap list, the timebase anomalies, the
 * calibration and the parameters hash — and the quality strip from
 * `src/viz/quality-strip.ts` with the DOM table that mirrors it, so a screen
 * reader and a grayscale reader get the same facts the picture carries (D37).
 *
 * One subtlety about the strip. `qualityStripFigure` reads
 * `session.analyses[videoId].derived`, which is the *persisted* layer — a cache
 * (D55) that is stale the moment a parameter changes. Drawing straight from it
 * would put a strip beside numbers it disagrees with. So the panel builds its
 * own `FigureData` from a shallow clone whose derived layer is the analysis it
 * was handed, and the picture and the numbers cannot come apart.
 *
 * The canvas context is injected rather than taken from the element, because
 * the panel has to work where there is no 2D context at all (a DOM test
 * environment): it then says the strip could not be drawn and shows the mirror
 * table, which is the part that carries the facts anyway.
 */
import { toDerivedLayer, type DerivedAnalysis } from '../../analysis/derive.js';
import type { GapRecord } from '../../contracts/quality.js';
import type { DetectionState } from '../../contracts/track.js';
import type { SessionFile } from '../../contracts/session.js';
import { qualityStripFigure } from '../../viz/quality-strip.js';
import type { FigureData } from '../../viz/types.js';
import { button, disclosure, el, replaceChildren, uniqueId } from '../dom.js';
import {
  formatCount,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatTimeAndFrame,
} from './format.js';
import {
  noseJudgedEventFraction,
  wholeClipStateFractions,
  wholeClipTrackedFraction,
} from './quality-summary.js';
import type { Component, SeekCallbacks } from './types.js';
import './review-components.css';

export interface QualityPanelProps {
  session: SessionFile;
  videoId: string;
  analysis: DerivedAnalysis;
}

export interface QualityPanelOptions {
  /** How the panel gets a 2D context; overridden in tests. */
  getContext?(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null;
  /** Figure scale; 2 gives a crisp strip on an ordinary display. */
  scale?: number;
}

/** Text *and* shape, so the tier never rests on the colour of a badge (D26). */
const TIER_GLYPH = { GOOD: '●', REVIEW: '▲', POOR: '■' } as const;

const STATE_WORDS: Record<DetectionState, string> = {
  tracked: 'tracked',
  low_confidence: 'low confidence',
  ambiguous: 'ambiguous',
  not_detected: 'not detected',
};

const STATE_ORDER: readonly DetectionState[] = [
  'tracked',
  'low_confidence',
  'ambiguous',
  'not_detected',
];

const LOCATION_WORDS: Record<GapRecord['locationClass'], string> = {
  hole: 'at a hole',
  open_platform: 'on the open platform',
  rim: 'at the rim',
};

/**
 * A session whose derived layer for this video is the analysis on screen, so
 * the figure draws what the panel says.
 */
export function figureDataFor(props: QualityPanelProps): FigureData {
  const { session, videoId, analysis } = props;
  const existing = session.analyses[videoId];
  if (!existing) return { session, videoId };
  return {
    session: {
      ...session,
      analyses: {
        ...session.analyses,
        [videoId]: { ...existing, derived: toDerivedLayer(analysis) },
      },
    },
    videoId,
  };
}

export function createQualityPanel(
  container: HTMLElement,
  props: QualityPanelProps,
  callbacks: SeekCallbacks,
  options: QualityPanelOptions = {},
): Component<QualityPanelProps> {
  let current = props;
  const scale = options.scale ?? 2;
  const getContext = options.getContext ?? ((canvas: HTMLCanvasElement) => canvas.getContext('2d'));

  const root = el('section', { class: 'review-panel quality-panel' });
  const headingId = uniqueId('quality-heading');
  root.setAttribute('aria-labelledby', headingId);
  root.append(
    el('h3', { id: headingId, text: 'Tracking quality' }),
    el('p', {
      class: 'what',
      text: 'Whether this video can be trusted before a figure is built on it. The tier, the gaps and the headline fraction are judged over the trial window — frames before the animal is placed are not tracking failures (D54).',
    }),
  );

  const tierLine = el('p', { class: 'quality-tier' });
  const figures = el('div', { class: 'quality-figures' });
  const stripHost = el('div', { class: 'quality-strip' });
  const gapsHost = el('div', { class: 'quality-gaps' });
  const provenance = el('div', { class: 'quality-provenance' });
  root.append(tierLine, figures, stripHost, gapsHost, provenance);
  container.append(root);

  function figure(term: string, value: string, note?: string): HTMLElement {
    return el('div', { class: 'quality-figure' }, [
      el('dt', { text: term }),
      el('dd', { text: value }),
      note && el('dd', { class: 'metric-note', text: note }),
    ]);
  }

  function renderTier(): void {
    const { tier } = current.analysis.quality;
    replaceChildren(tierLine, [
      el('span', {
        class: `tier-badge tier-${tier}`,
        // The glyph is inside the text, so it reaches a screen reader through
        // the sentence and survives a grayscale print on its own.
        text: `${TIER_GLYPH[tier]} ${tier}`,
      }),
      ' ',
      el('span', {
        class: 'metric-note',
        text:
          tier === 'GOOD'
            ? 'Enough of the trial was positioned by the tracker to trust the measures.'
            : tier === 'REVIEW'
              ? 'Some of the trial was not positioned by the tracker. Look at the gaps before using this trial.'
              : 'Too little of the trial was positioned by the tracker to trust the measures.',
      }),
    ]);
  }

  function renderFigures(): void {
    const { analysis } = current;
    const { quality, metrics, cleanedTrack, events } = analysis;
    const wholeClip = wholeClipStateFractions(cleanedTrack);

    const children: HTMLElement[] = [
      figure(
        'Tracked (trial window)',
        formatPercent(metrics.trackedFraction),
        'the headline (D54)',
      ),
      figure(
        'Tracked (whole clip)',
        formatPercent(wholeClipTrackedFraction(cleanedTrack)),
        'secondary; includes frames before the animal was placed',
      ),
      figure(
        'Events judged on the nose',
        formatPercent(noseJudgedEventFraction(events)),
        `${events.filter((e) => e.pointUsed === 'nose').length} of ${events.length} (O16)`,
      ),
      figure('Gaps in the trial', formatCount(quality.gaps.length)),
      figure('Longest gap', formatSeconds(quality.longestGapSeconds)),
    ];

    for (const state of STATE_ORDER) {
      children.push(
        figure(
          `${STATE_WORDS[state]} (trial)`,
          formatPercent(quality.detectionStateFractions[state]),
          `whole clip ${formatPercent(wholeClip[state])}`,
        ),
      );
    }

    replaceChildren(figures, [el('dl', { class: 'quality-figures' }, children)]);
  }

  function renderStrip(): void {
    const data = figureDataFor(current);
    const description = qualityStripFigure.describe(data);
    const { width, height } = qualityStripFigure.defaultSize;

    const canvas = el('canvas', { class: 'quality-strip-canvas' });
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${description.title}. ${description.summary}`);

    const ctx = getContext(canvas);
    let drawn = false;
    if (ctx) {
      qualityStripFigure.draw(ctx, data, { scale, theme: 'light' });
      drawn = true;
    }

    replaceChildren(stripHost, [
      drawn
        ? canvas
        : el('p', {
            class: 'empty',
            text: 'The quality strip could not be drawn here — this browser gave no 2D canvas. The table below carries the same facts.',
          }),
      // The mirror is always rendered, drawn or not: it is what a screen reader
      // and a grayscale reader actually read (D37).
      el('section', { class: 'mirror' }, [
        el('h4', { text: 'What the strip is drawing' }),
        el('p', { class: 'mirror-summary', text: description.summary }),
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'mirror-table' }, [
            el('caption', { text: description.title }),
            el('thead', {}, [
              el(
                'tr',
                {},
                description.columns.map((column) =>
                  el('th', { text: column, attrs: { scope: 'col' } }),
                ),
              ),
            ]),
            el(
              'tbody',
              {},
              description.rows.map((row) =>
                el(
                  'tr',
                  {},
                  row.map((cell, i) =>
                    i === 0
                      ? el('th', { text: String(cell ?? '—'), attrs: { scope: 'row' } })
                      : el('td', {
                          text:
                            cell === null
                              ? '—'
                              : typeof cell === 'number'
                                ? formatNumber(cell, 4)
                                : String(cell),
                        }),
                  ),
                ),
              ),
            ),
          ]),
        ]),
      ]),
    ]);
  }

  /**
   * The nose-heading-confidence distribution D30 asks for. Bars would carry the
   * shape in colour alone, so it is a table: the bin, its share, and a run of
   * blocks whose length is the share — readable in grayscale and by a screen
   * reader (D26, D37).
   */
  function renderHistogram(): HTMLElement {
    const bins = current.analysis.quality.noseConfidenceHistogram;
    const total = bins.reduce((sum, bin) => sum + bin.count, 0);
    return disclosure('Nose-heading confidence distribution', [
      el('p', {
        class: 'metric-note',
        text: `How confident the tracker was about which end of the body is the nose, over the ${formatCount(total)} frames of the trial window. Events use the nose only above the cutoff (O16).`,
      }),
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'mirror-table' }, [
          el('caption', { text: 'Nose-heading confidence' }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Confidence', attrs: { scope: 'col' } }),
              el('th', { text: 'Frames', attrs: { scope: 'col' } }),
              el('th', { text: 'Share', attrs: { scope: 'col' } }),
            ]),
          ]),
          el(
            'tbody',
            {},
            bins.map((bin) =>
              el('tr', {}, [
                el('th', {
                  text: `${bin.min.toFixed(1)}–${bin.max.toFixed(1)}`,
                  attrs: { scope: 'row' },
                }),
                el('td', { text: formatCount(bin.count) }),
                el('td', { text: formatPercent(total === 0 ? Number.NaN : bin.count / total) }),
              ]),
            ),
          ),
        ]),
      ]),
    ]);
  }

  function renderGaps(): void {
    const { gaps } = current.analysis.quality;
    const track = current.analysis.cleanedTrack;
    const timeOf = (frameIndex: number): number | null =>
      track.find((frame) => frame.frameIndex === frameIndex)?.t_s ?? null;

    if (gaps.length === 0) {
      replaceChildren(gapsHost, [
        el('h4', { text: 'Gaps' }),
        el('p', {
          class: 'empty',
          text: 'No gaps in the trial window: every frame was positioned.',
        }),
      ]);
      return;
    }

    const body = el(
      'tbody',
      {},
      gaps.map((gap) =>
        el('tr', {}, [
          el('th', { attrs: { scope: 'row' } }, [
            button(
              formatTimeAndFrame(timeOf(gap.startFrame), gap.startFrame),
              () => {
                callbacks.onSeek(gap.startFrame);
                callbacks.onAnnounce?.(`Moved to frame ${gap.startFrame}, the start of this gap.`);
              },
              {
                class: 'seek-cell',
                attrs: { 'aria-label': `Go to frame ${gap.startFrame}, the start of this gap` },
              },
            ),
          ]),
          el('td', { text: formatSeconds(gap.durationSeconds) }),
          el('td', { text: LOCATION_WORDS[gap.locationClass] }),
          el('td', { text: gap.holeIndex === undefined ? '—' : `hole ${gap.holeIndex}` }),
        ]),
      ),
    );

    replaceChildren(gapsHost, [
      el('h4', { text: 'Gaps' }),
      el('p', {
        class: 'metric-note',
        text: 'Runs of frames with no position, clustered and located. Selecting one moves the video to where it starts.',
      }),
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'mirror-table' }, [
          el('caption', { text: 'Gaps in the trial window' }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Starts', attrs: { scope: 'col' } }),
              el('th', { text: 'Duration', attrs: { scope: 'col' } }),
              el('th', { text: 'Where', attrs: { scope: 'col' } }),
              el('th', { text: 'Hole', attrs: { scope: 'col' } }),
            ]),
          ]),
          body,
        ]),
      ]),
    ]);
  }

  function renderProvenance(): void {
    const { quality, parametersHash, trackingParametersHash } = current.analysis;
    const anomalies = quality.timebaseAnomalies;
    replaceChildren(provenance, [
      el('h4', { text: 'Calibration and provenance' }),
      el('dl', { class: 'quality-figures' }, [
        figure('Platform diameter', `${formatNumber(quality.platformDiameter_cm)} cm`),
        figure('Scale', `${formatNumber(quality.pxPerCm)} px/cm`),
        figure('Duplicate timestamps', formatCount(anomalies.duplicateTimestampCount)),
        figure('Dropped-frame gaps', formatCount(anomalies.droppedFrameGapCount)),
        figure('Timebase drift', formatSeconds(anomalies.driftSeconds, 3)),
      ]),
      renderHistogram(),
      disclosure('Hashes', [
        el('p', { class: 'metric-note', text: `Parameters hash: ${parametersHash}` }),
        el('p', { class: 'metric-note', text: `Tracking hash: ${trackingParametersHash}` }),
        el('p', {
          text: 'Every export carries the parameters hash, so a figure can be traced back to the exact thresholds that produced it (D51).',
        }),
      ]),
    ]);
  }

  function render(): void {
    renderTier();
    renderFigures();
    renderStrip();
    renderGaps();
    renderProvenance();
  }

  render();

  return {
    update(nextProps) {
      current = nextProps;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}
