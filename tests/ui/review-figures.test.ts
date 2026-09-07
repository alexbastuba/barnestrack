// @vitest-environment happy-dom
/**
 * The Review step's figures section: which figures it shows, what it says when
 * a video is not analysed, and the D53 rule that a figure option never reaches
 * the parameter set.
 *
 * happy-dom gives no 2D context, so nothing here checks pixels — the point is
 * that the caption, the aria-label and the table are still written when the
 * canvas cannot be drawn, which is also what a browser refusing a context gets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import type { SessionFile } from '../../src/contracts/session.js';
import {
  COHORT_FIGURES,
  EXPORT_SCALES,
  TRIAL_FIGURES,
  createReviewFigures,
  notAnalysedCount,
  notAnalysedInFigures,
  previewRatio,
} from '../../src/ui/review-figures.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { fakeContext } from '../viz/fake-context.js';

function withOneUnanalysed(session: SessionFile): SessionFile {
  const last = session.videos[session.videos.length - 1]!;
  return {
    ...session,
    analyses: { ...session.analyses, [last.id]: { ...session.analyses[last.id]!, derived: null } },
  };
}

describe('which figures the Review step shows', () => {
  it('shows the six per-video figures D32 names, and not the quality strip', () => {
    expect(TRIAL_FIGURES.map((figure) => figure.id)).toEqual([
      'trajectory',
      'time-colored-path',
      'speed-colored-path',
      'heatmap',
      'hole-raster',
      'quadrant-overlay',
    ]);
    // The strip is a trial figure too, but it belongs to the quality panel,
    // beside the numbers it explains; showing it twice would be worse.
    expect(TRIAL_FIGURES.some((figure) => figure.id === 'quality-strip')).toBe(false);
  });

  it('shows the two cohort figures', () => {
    expect(COHORT_FIGURES.map((figure) => figure.id)).toEqual(['learning-curve', 'group-comparison']);
  });

  it('offers 2× and 3× PNGs (D32)', () => {
    expect(EXPORT_SCALES).toEqual([2, 3]);
  });
});

describe('the "N of M not analysed" line', () => {
  it('says nothing when every video is in the figures', () => {
    expect(notAnalysedInFigures(syntheticSession())).toBeNull();
  });

  it('counts a tracked-but-unanalysed video and says it is left out', () => {
    const session = withOneUnanalysed(syntheticSession());
    expect(notAnalysedCount(session)).toEqual({ notAnalysed: 1, total: 3 });
    expect(notAnalysedInFigures(session)).toBe(
      '1 of 3 videos not analysed yet — it is not in these figures.',
    );
  });

  it('keeps the video in the session — it is omitted from the figures, not dropped', () => {
    const session = withOneUnanalysed(syntheticSession());
    expect(session.videos).toHaveLength(3);
    expect(session.analyses[session.videos[2]!.id]!.auto.frames.length).toBeGreaterThan(0);
  });
});

describe('the preview pixel ratio', () => {
  it('is at least 1 and never more than 3, whatever the display claims', () => {
    expect(previewRatio(1)).toBe(1);
    expect(previewRatio(2)).toBe(2);
    expect(previewRatio(8)).toBe(3);
    expect(previewRatio(0)).toBe(1);
    expect(previewRatio(Number.NaN)).toBe(1);
  });
});

describe('the mounted figures section', () => {
  let container: HTMLElement;
  const announce = vi.fn();
  const goToTrack = vi.fn();

  beforeEach(() => {
    announce.mockClear();
    goToTrack.mockClear();
    container = document.createElement('div');
    document.body.append(container);
  });

  it('mounts one card per figure, each with a caption, a labelled canvas and a table', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });

    const cards = container.querySelectorAll('.figure-card');
    expect(cards).toHaveLength(TRIAL_FIGURES.length + COHORT_FIGURES.length);
    for (const card of cards) {
      const canvas = card.querySelector('canvas')!;
      expect(canvas.getAttribute('aria-label')).toBeTruthy();
      expect(card.querySelector('.figure-caption')!.textContent).toBeTruthy();
      // D37: the canvas is mirrored by a table, not only by its caption.
      expect(card.querySelectorAll('table thead th').length).toBeGreaterThan(0);
    }
  });

  it('closes every table by default, so the section costs no page height', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });

    for (const details of container.querySelectorAll('details')) {
      expect(details.hasAttribute('open')).toBe(false);
    }
  });

  it('shows the "not analysed" line with a way to the Track step, and hides it when there is none', () => {
    const session = syntheticSession();
    const figures = createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const block = container.querySelector<HTMLElement>('.figure-missing-block')!;
    expect(block.hidden).toBe(true);

    figures.update({ session: withOneUnanalysed(session), videoId: session.videos[0]!.id });

    expect(block.hidden).toBe(false);
    expect(block.textContent).toContain('1 of 3 videos not analysed yet');
    block.querySelector('button')!.click();
    expect(goToTrack).toHaveBeenCalledTimes(1);
  });

  it('redraws the captions when a figure option changes, and changes no parameter (D53)', () => {
    const session = syntheticSession();
    const before = hashParameters(session.parameters!);
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const heatmapCaption = (): string =>
      [...container.querySelectorAll('.figure-card')]
        .find((card) => card.querySelector('h5')!.textContent === 'Occupancy heatmap')!
        .querySelector('.figure-caption')!.textContent!;
    expect(heatmapCaption()).toContain('4 cm cell');

    const bin = container.querySelector<HTMLInputElement>('#review-figure-bin')!;
    bin.value = '7';
    bin.dispatchEvent(new Event('change'));

    expect(heatmapCaption()).toContain('7 cm cell');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('not a parameter'));
    // The session's parameters are untouched: an option changes pixels only.
    expect(hashParameters(session.parameters!)).toBe(before);
  });

  it('refuses a bin size that is not a positive number, and says so', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const bin = container.querySelector<HTMLInputElement>('#review-figure-bin')!;

    bin.value = '-2';
    bin.dispatchEvent(new Event('change'));

    expect(bin.value).toBe('4');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('positive number'));
  });

  it('clamps a bin size outside the offered range, and says it did', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const bin = container.querySelector<HTMLInputElement>('#review-figure-bin')!;
    const caption = (): string =>
      [...container.querySelectorAll('.figure-card')]
        .find((card) => card.querySelector('h5')!.textContent === 'Occupancy heatmap')!
        .querySelector('.figure-caption')!.textContent!;

    // 0.001 cm asks for millions of cells and used to throw out of `draw()`,
    // freezing every card after the heatmap with nothing said.
    bin.value = '0.001';
    bin.dispatchEvent(new Event('change'));

    expect(bin.value).toBe('1');
    expect(caption()).toContain('1 cm cell');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('outside the 1–12 cm range'));
    const captions = [...container.querySelectorAll('.figure-caption')].filter(
      (node) => (node.textContent ?? '').trim().length > 0,
    );
    expect(captions).toHaveLength(TRIAL_FIGURES.length + COHORT_FIGURES.length);
  });

  it('names the colour map in the caption when it is changed', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const select = container.querySelector<HTMLSelectElement>('#review-figure-colormap')!;

    select.value = 'cividis';
    select.dispatchEvent(new Event('change'));

    const captions = [...container.querySelectorAll('.figure-caption')].map((node) => node.textContent!);
    expect(captions.some((text) => text.includes('cividis'))).toBe(true);
    expect(captions.some((text) => text.includes('viridis'))).toBe(false);
  });

  it('still writes the caption and the table when no canvas context exists', () => {
    const session = syntheticSession();
    createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });

    // happy-dom gives no 2D context, which is the case this asserts.
    const card = container.querySelector('.figure-card')!;
    expect(card.querySelector('canvas')!.getContext('2d')).toBeNull();
    expect(card.querySelector('.figure-caption')!.textContent).toBeTruthy();
    expect(card.querySelector<HTMLElement>('.figure-note')!.hidden).toBe(false);
    expect(card.querySelector('.figure-note')!.textContent).toContain('could not be drawn here');
    expect(card.querySelectorAll('table tbody tr').length).toBeGreaterThan(0);
  });

  it('does not redraw when nothing the figures read has changed', () => {
    const session = syntheticSession();
    const figures = createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const drawn = figures.lastDrawMs;

    // The store emits on every autosave completion too, so the step re-renders
    // with the same session; redrawing eight canvases for that is pure waste.
    figures.update({ session, videoId: session.videos[0]!.id });
    expect(figures.lastDrawMs).toBe(drawn);

    // Looking at another video does redraw: the trial named on the canvas moves.
    const label = (): string => container.querySelector('canvas')!.getAttribute('aria-label')!;
    const before = label();
    figures.update({ session, videoId: session.videos[1]!.id });
    expect(label()).not.toBe(before);
  });

  it('reports a figure that throws on its own card, and still draws the rest', () => {
    // happy-dom returns null from `getContext`, so nothing in this suite entered
    // the draw path at all until this stub — the catch was dead code under test.
    const session = syntheticSession();
    const context = fakeContext();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const broken = TRIAL_FIGURES[1]!;
    const draw = vi.spyOn(broken, 'draw').mockImplementation(() => {
      throw new Error('deliberate failure');
    });
    try {
      createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
        onAnnounce: announce,
        onGoToTrack: goToTrack,
      });

      const cards = [...container.querySelectorAll('.figure-card')];
      const failed = cards[1]!;
      expect(failed.querySelector('h5')!.textContent).toBe(broken.title);
      expect(failed.querySelector<HTMLElement>('.figure-note')!.hidden).toBe(false);
      expect(failed.querySelector('.figure-note')!.textContent).toContain('deliberate failure');
      expect(failed.querySelector('button')!.disabled).toBe(true);
      expect(announce).toHaveBeenCalledWith(expect.stringContaining('deliberate failure'));

      // The cards after it drew normally: one bad figure is not eight.
      const after = cards[2]!;
      expect(after.querySelector<HTMLElement>('.figure-note')!.hidden).toBe(true);
      expect(after.querySelector('button')!.disabled).toBe(false);
      expect(after.querySelector('.figure-caption')!.textContent).toBeTruthy();
    } finally {
      draw.mockRestore();
      getContext.mockRestore();
    }
  });

  it('names the videos it could not analyse instead of calling them untracked', () => {
    const session = syntheticSession();
    const figures = createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    const block = container.querySelector<HTMLElement>('.figure-missing-block')!;
    const button = block.querySelector<HTMLButtonElement>('button')!;

    figures.update({
      session,
      videoId: session.videos[0]!.id,
      problems: ['test51.mp4 — the maze has no usable hole radius'],
    });

    expect(block.hidden).toBe(false);
    expect(block.textContent).toContain('the maze has no usable hole radius');
    // The Track step cannot fix a derive that throws, so it is not offered.
    expect(button.hidden).toBe(true);
  });

  it('takes its listeners with it when destroyed', () => {
    const session = syntheticSession();
    const figures = createReviewFigures(container, { session, videoId: session.videos[0]!.id }, {
      onAnnounce: announce,
      onGoToTrack: goToTrack,
    });
    expect(container.querySelector('#review-figures')).not.toBeNull();

    figures.destroy();

    expect(container.querySelector('#review-figures')).toBeNull();
  });
});
