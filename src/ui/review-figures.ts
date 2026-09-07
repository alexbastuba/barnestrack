/**
 * The Review step's figures (D32): six per-video figures for the video on
 * screen, then the two cohort figures, each with the caption `describe()`
 * writes, the same content as a table (D37), and a PNG at 2× or 3×.
 *
 * The colour map, the occupancy bin size and the export scale are *figure
 * options*, not parameters (D53): they change pixels, never a number in
 * `trials.csv` or `events.csv`, so they never touch `Parameters` or
 * `parametersHash`. They travel in each figure's caption, in its table and in
 * its PNG filename instead, which is what keeps a figure reproducible without
 * being part of the analysis's identity.
 *
 * The quality strip is not here: it belongs to the quality panel, next to the
 * numbers it explains.
 */
import {
  CELL_CM_RANGE,
  COLORMAP_NAMES,
  DEFAULT_CELL_CM,
  FIGURES,
  figurePngName,
  isAnalysed,
  renderFigureToPng,
  type ColormapName,
  type FigureData,
  type FigureOptions,
  type FigureSpec,
} from '../viz/index.js';
import type { SessionFile } from '../contracts/session.js';
import type { Component } from './components/index.js';
import { button, disclosure, el, replaceChildren } from './dom.js';
import { downloadBlob } from './download.js';

/**
 * The six per-video figures, in registry order. The quality strip is a trial
 * figure too, but the quality panel already draws it beside the numbers it
 * explains, so it is filtered out here rather than shown twice.
 */
export const TRIAL_FIGURES: readonly FigureSpec[] = FIGURES.filter(
  (figure) => figure.scope === 'trial' && figure.id !== 'quality-strip',
);

/** The two cohort figures, which need two videos carrying metadata (D32, O12). */
export const COHORT_FIGURES: readonly FigureSpec[] = FIGURES.filter((figure) => figure.scope === 'cohort');

/** The export scales D32 names. */
export const EXPORT_SCALES: readonly number[] = [2, 3];

export interface NotAnalysedCount {
  notAnalysed: number;
  total: number;
}

export function notAnalysedCount(session: SessionFile): NotAnalysedCount {
  const total = session.videos.length;
  const analysed = session.videos.filter((video) => {
    const analysis = session.analyses[video.id];
    return analysis !== undefined && isAnalysed(analysis);
  }).length;
  return { notAnalysed: total - analysed, total };
}

/**
 * "N of M videos not analysed yet — they are not in these figures", or null
 * when every video is in. Chunk 7a recorded the silent omission this closes:
 * an unanalysed video was simply absent from the cohort figures and the
 * exports, with nothing on screen to say so.
 */
export function notAnalysedInFigures(session: SessionFile): string | null {
  const { notAnalysed, total } = notAnalysedCount(session);
  if (notAnalysed === 0) return null;
  return `${notAnalysed} of ${total} video${total === 1 ? '' : 's'} not analysed yet — ${notAnalysed === 1 ? 'it is' : 'they are'} not in these figures.`;
}

/** The screen preview's pixel ratio: crisp on a retina display, never absurd. */
export function previewRatio(devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(3, Math.max(1, ratio));
}

export interface ReviewFiguresProps {
  session: SessionFile;
  /** The video on screen; null when none can be shown. */
  videoId: string | null;
}

export interface ReviewFiguresCallbacks {
  onAnnounce(message: string): void;
  /** Send the user to the Track step to analyse what is missing. */
  onGoToTrack(): void;
}

export interface ReviewFigures extends Component<ReviewFiguresProps> {
  /** Wall-clock ms of the last redraw, for the reflow measurement. */
  readonly lastDrawMs: number;
}

interface Card {
  figure: FigureSpec;
  canvas: HTMLCanvasElement;
  caption: HTMLElement;
  note: HTMLParagraphElement;
  table: HTMLElement;
  save: HTMLButtonElement;
}

export function createReviewFigures(
  container: HTMLElement,
  props: ReviewFiguresProps,
  callbacks: ReviewFiguresCallbacks,
): ReviewFigures {
  let current = props;
  let options: FigureOptions = {};
  let exportScale = EXPORT_SCALES[0]!;
  let drawMs = 0;

  const root = el('section', { id: 'review-figures', class: 'review-figures' });
  const heading = el('h3', { id: 'review-figures-heading', text: 'Figures' });
  root.setAttribute('aria-labelledby', heading.id);

  const colormapSelect = el('select', { id: 'review-figure-colormap' });
  for (const name of COLORMAP_NAMES) colormapSelect.append(el('option', { text: name, attrs: { value: name } }));
  colormapSelect.value = COLORMAP_NAMES[0]!;
  colormapSelect.addEventListener('change', () => {
    options = { ...options, colormap: colormapSelect.value as ColormapName };
    draw();
    callbacks.onAnnounce(`Figures drawn on the ${colormapSelect.value} colour map. A figure option, not a parameter: no number changed.`);
  });

  const binInput = el('input', { id: 'review-figure-bin', class: 'number-input' });
  binInput.type = 'number';
  binInput.min = String(CELL_CM_RANGE.min);
  binInput.max = String(CELL_CM_RANGE.max);
  binInput.step = String(CELL_CM_RANGE.step);
  binInput.value = String(DEFAULT_CELL_CM);
  binInput.addEventListener('change', () => {
    const value = Number(binInput.value);
    if (!Number.isFinite(value) || value <= 0) {
      binInput.value = String(options.heatmapCellSize_cm ?? DEFAULT_CELL_CM);
      callbacks.onAnnounce('The heatmap bin size needs a positive number of centimetres.');
      return;
    }
    options = { ...options, heatmapCellSize_cm: value };
    draw();
    callbacks.onAnnounce(`Occupancy heatmap binned at ${value} cm. A figure option, not a parameter: no number changed.`);
  });

  const scaleSelect = el('select', { id: 'review-figure-scale' });
  for (const scale of EXPORT_SCALES) scaleSelect.append(el('option', { text: `${scale}×`, attrs: { value: String(scale) } }));
  scaleSelect.value = String(exportScale);
  scaleSelect.addEventListener('change', () => {
    exportScale = Number(scaleSelect.value);
    for (const card of cards) card.save.textContent = `Save PNG (${exportScale}×)`;
    callbacks.onAnnounce(`Figures will be saved at ${exportScale}×.`);
  });

  const controls = el('div', { class: 'figure-options field-row' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Colour map', attrs: { for: colormapSelect.id } }), colormapSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'Heatmap bin (cm)', attrs: { for: binInput.id } }), binInput]),
    el('div', { class: 'field' }, [el('label', { text: 'PNG scale', attrs: { for: scaleSelect.id } }), scaleSelect]),
  ]);

  const optionsNote = el('p', {
    class: 'hint',
    text: 'These change how a figure is drawn, never a number. They are figure options, not parameters, so they are not in the parameters hash or the export (D53); each figure names the ones it uses in its caption and in the PNG’s filename.',
  });

  const trialHeading = el('h4', { text: 'This video' });
  const trialGrid = el('div', { class: 'figure-grid' });
  const cohortHeading = el('h4', { text: 'The cohort' });
  const cohortGrid = el('div', { class: 'figure-grid' });
  const missingLine = el('p', { class: 'figure-missing' });
  const trackButton = button('Go to the Track step', () => callbacks.onGoToTrack());
  const missing = el('div', { class: 'figure-missing-block' }, [missingLine, trackButton]);

  const cards: Card[] = [];

  function makeCard(figure: FigureSpec): Card {
    const canvas = el('canvas', { class: 'figure-canvas' });
    const caption = el('figcaption', { class: 'figure-caption' });
    const note = el('p', { class: 'hint figure-note' });
    const table = el('div', { class: 'table-scroll' });
    const save = button(`Save PNG (${exportScale}×)`, () => {
      void savePng(figure);
    });
    const card = el('figure', { class: 'figure-card' }, [
      el('h5', { text: figure.title }),
      canvas,
      caption,
      note,
      disclosure('The same figure as a table', [table]),
      save,
    ]);
    (figure.scope === 'cohort' ? cohortGrid : trialGrid).append(card);
    return { figure, canvas, caption, note, table, save };
  }

  for (const figure of [...TRIAL_FIGURES, ...COHORT_FIGURES]) cards.push(makeCard(figure));

  async function savePng(figure: FigureSpec): Promise<void> {
    const data = dataFor();
    const name = figurePngName(figure, data, exportScale, options);
    try {
      const blob = await renderFigureToPng(
        figure,
        data,
        { ...options, scale: exportScale, theme: 'light' },
        exportScale,
      );
      downloadBlob(name, blob);
      callbacks.onAnnounce(`Saved ${name} (${Math.round(blob.size / 1024)} kB).`);
    } catch (error) {
      callbacks.onAnnounce(`${figure.title} could not be saved: ${(error as Error).message}`);
    }
  }

  /**
   * A cohort figure reads the whole session and ignores `videoId`; a trial
   * figure needs one, and falls back to the first video so the card explains
   * why it is empty rather than drawing an empty box.
   */
  function dataFor(): FigureData {
    return { session: current.session, videoId: current.videoId ?? current.session.videos[0]?.id ?? '' };
  }

  /**
   * Redraws every figure. Called on every recompute and on resize; the figures
   * have fixed logical sizes, so the only thing a resize can change is the
   * device pixel ratio (a window moved to another display).
   */
  function draw(): void {
    const started = performance.now();
    const ratio = previewRatio(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
    for (const card of cards) {
      const data = dataFor();
      const { width, height } = card.figure.defaultSize;
      card.canvas.width = Math.round(width * ratio);
      card.canvas.height = Math.round(height * ratio);
      card.canvas.style.width = `${width}px`;
      card.canvas.style.height = `${height}px`;

      const description = card.figure.describe(data, options);
      card.caption.textContent = description.summary;
      // The canvas says the same thing to a screen reader as the caption says
      // on screen; the table below repeats the content in full (D37).
      card.canvas.setAttribute('role', 'img');
      card.canvas.setAttribute('aria-label', `${description.title}. ${description.summary}`);

      const reason = card.figure.unavailable(data);
      card.note.textContent = reason ?? '';
      card.note.hidden = reason === null;
      card.save.disabled = reason !== null;

      const ctx = card.canvas.getContext('2d');
      if (ctx) card.figure.draw(ctx, data, { ...options, scale: ratio, theme: 'light', width, height });
      else {
        // happy-dom and any browser refusing a context: the caption and the
        // table still carry everything, so the figure is not simply missing.
        card.note.hidden = false;
        card.note.textContent = `${reason ?? ''} This figure could not be drawn here; the table below carries the same content.`.trim();
      }

      renderTable(card, description.columns, description.rows);
    }
    drawMs = performance.now() - started;
  }

  function renderTable(card: Card, columns: string[], rows: (string | number | null)[][]): void {
    replaceChildren(card.table, [
      el('table', { class: 'mirror-table' }, [
        el('caption', { text: `${card.figure.title}, as a table.` }),
        el('thead', {}, [el('tr', {}, columns.map((text) => el('th', { text, attrs: { scope: 'col' } })))]),
        el(
          'tbody',
          {},
          rows.map((row) =>
            el(
              'tr',
              {},
              row.map((cell, index) =>
                index === 0
                  ? el('th', { text: String(cell ?? '—'), attrs: { scope: 'row' } })
                  : el('td', { text: cell === null || cell === undefined ? '—' : String(cell) }),
              ),
            ),
          ),
        ),
      ]),
    ]);
  }

  function renderMissing(): void {
    const line = notAnalysedInFigures(current.session);
    missing.hidden = line === null;
    missingLine.textContent = line ?? '';
    const { notAnalysed, total } = notAnalysedCount(current.session);
    trackButton.setAttribute(
      'aria-label',
      `Go to the Track step to analyse the ${notAnalysed} of ${total} videos that are not in these figures`,
    );
  }

  root.append(heading, controls, optionsNote, trialHeading, trialGrid, cohortHeading, cohortGrid, missing);
  container.append(root);

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  function onResize(): void {
    // Debounced, and a plain window listener rather than a ResizeObserver: the
    // figures have fixed logical sizes, and chunk 6 hit Chrome's "loop
    // completed with undelivered notifications" resizing a canvas inside an
    // observer's own delivery.
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      draw();
    }, 150);
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  renderMissing();
  draw();

  return {
    get lastDrawMs() {
      return drawMs;
    },
    update(next: ReviewFiguresProps): void {
      current = next;
      renderMissing();
      draw();
    },
    destroy(): void {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}
