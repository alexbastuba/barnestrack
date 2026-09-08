// @vitest-environment happy-dom
/**
 * The quality panel (D30, D54).
 *
 * happy-dom has no 2D canvas context, so the panel is given the recording
 * context the figure tests use (`tests/viz/fake-context.ts`). That is not a
 * workaround: the strip's facts live in `describe()`, which is what the mirror
 * table renders and what a screen reader and a grayscale reader actually get,
 * so the table is the thing worth asserting. One test drives the panel with no
 * context at all, to check it says so rather than showing an empty box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qualityStripFigure } from '../../../src/viz/quality-strip.js';
import { createQualityPanel, figureDataFor } from '../../../src/ui/components/quality-panel.js';
import { wholeClipStateFractions } from '../../../src/ui/components/quality-summary.js';
import { fakeContext } from '../../viz/fake-context.js';
import { fixture } from './fixture.js';

const f = fixture('video-test50', { corrections: [] });

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => container.remove());

function mount(
  source = f,
  getContext = () => fakeContext() as unknown as CanvasRenderingContext2D,
) {
  const onSeek = vi.fn();
  const onAnnounce = vi.fn();
  const panel = createQualityPanel(
    container,
    { session: source.session, videoId: source.descriptor.id, analysis: source.analysis },
    { onSeek, onAnnounce },
    { getContext },
  );
  return { panel, onSeek, onAnnounce };
}

describe('the tier badge', () => {
  it('carries the word and a shape, not colour alone (D26)', () => {
    mount();
    const badge = container.querySelector('.tier-badge')!;
    expect(badge.textContent).toContain(f.analysis.quality.tier);
    // A glyph outside the A–Z range is present in the same text node, so it
    // reaches a screen reader and survives a grayscale print.
    expect(badge.textContent).toMatch(/[●▲■]/);
  });

  it('says in words what the tier means for using the trial', () => {
    mount();
    expect(container.querySelector('.quality-tier')!.textContent).toContain('trust the measures');
  });
});

describe('the three D54 numbers, read from the quality report', () => {
  it('shows the trial-window headline and the whole-clip number side by side', () => {
    mount();
    const text = container.querySelector('.quality-figures')!.textContent ?? '';
    expect(text).toContain('Positioned (trial window)');
    expect(text).toContain('Positioned (whole clip)');
    expect(text).toContain('the headline the tier is judged on');
    // Decision references stay in the comments, off the screen.
    expect(text).not.toContain('(D54)');
  });

  it('prints the report’s own fields rather than deriving them again', () => {
    const { positionedFraction, wholeClipPositionedFraction, noseJudgedEventFraction } =
      f.analysis.quality;
    mount();
    const text = container.textContent ?? '';
    for (const fraction of [
      positionedFraction,
      wholeClipPositionedFraction,
      noseJudgedEventFraction,
    ]) {
      expect(text).toContain(`${(fraction * 100).toFixed(1)} %`);
    }
  });

  it('states the fraction of events judged on the nose, over the events that were judged (O16)', () => {
    mount();
    // The denominator excludes tracking failures, which `qualityReport()` also
    // excludes: a caption drawn from a different set would contradict the
    // percentage printed beside it.
    const judged = f.analysis.events.filter((event) => event.kind !== 'tracking_failure');
    const nose = judged.filter((event) => event.pointUsed === 'nose').length;
    const text = container.textContent ?? '';
    expect(text).toContain('Events judged on the nose');
    expect(text).toContain(`${nose} of ${judged.length}`);
    expect(text).not.toContain('(O16)');
    expect(judged.length).toBeLessThan(f.analysis.events.length);
  });

  it('shows an em dash, not a zero, for a fraction the report could not compute', () => {
    const quality = { ...f.analysis.quality, noseJudgedEventFraction: Number.NaN };
    mount({ ...f, analysis: { ...f.analysis, quality } });
    const text = container.querySelector('.quality-figures')!.textContent ?? '';
    expect(text).toContain('Events judged on the nose');
    expect(text).not.toContain('0.0 %');
    expect(text).toContain('—');
  });
});

describe('the strip and its DOM mirror (D37)', () => {
  it('draws the strip and labels the canvas with the figure description', () => {
    mount();
    const canvas = container.querySelector('canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    const description = qualityStripFigure.describe(
      figureDataFor({
        session: f.session,
        videoId: f.descriptor.id,
        analysis: f.analysis,
      }),
    );
    expect(canvas.getAttribute('aria-label')).toBe(`${description.title}. ${description.summary}`);
  });

  it('mirrors every row of describe() into the table', () => {
    mount();
    const description = qualityStripFigure.describe(
      figureDataFor({
        session: f.session,
        videoId: f.descriptor.id,
        analysis: f.analysis,
      }),
    );
    const headers = [...container.querySelectorAll('.quality-strip .mirror-table thead th')].map(
      (n) => n.textContent,
    );
    expect(headers).toEqual(description.columns);

    const rows = [...container.querySelectorAll('.quality-strip .mirror-table tbody tr')];
    expect(rows).toHaveLength(description.rows.length);
    for (const [i, row] of rows.entries()) {
      expect(row.querySelector('th')!.textContent).toBe(String(description.rows[i]![0]));
    }
  });

  it('says the strip could not be drawn, and still shows the table, with no context', () => {
    mount(f, () => null as unknown as CanvasRenderingContext2D);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.quality-strip .empty')!.textContent).toContain(
      'could not be drawn',
    );
    expect(
      container.querySelectorAll('.quality-strip .mirror-table tbody tr').length,
    ).toBeGreaterThan(0);
  });
});

describe('figureDataFor', () => {
  it('gives the figure the analysis on screen, not the stale persisted cache', () => {
    // A different derivation of the same video: the persisted layer in the
    // session is the fixture's, which is not this one.
    const changed = fixture('video-test50', {
      parameters: {
        ...f.parameters,
        holeInvestigation: { ...f.parameters.holeInvestigation, minDuration_s: 10 },
      },
    });
    const data = figureDataFor({
      session: f.session,
      videoId: f.descriptor.id,
      analysis: changed.analysis,
    });
    const derived = data.session.analyses[f.descriptor.id]!.derived!;
    expect(derived.events).toHaveLength(changed.analysis.events.length);
    expect(derived.events).not.toHaveLength(
      f.session.analyses[f.descriptor.id]!.derived!.events.length,
    );
  });

  it('does not mutate the session it was given', () => {
    const before = f.session.analyses[f.descriptor.id]!.derived;
    figureDataFor({ session: f.session, videoId: f.descriptor.id, analysis: f.analysis });
    expect(f.session.analyses[f.descriptor.id]!.derived).toBe(before);
  });
});

describe('the gap list', () => {
  it('lists each gap with its duration, location class and hole', () => {
    mount();
    const rows = [...container.querySelectorAll('.quality-gaps tbody tr')];
    expect(rows).toHaveLength(f.analysis.quality.gaps.length);
    expect(rows.length).toBeGreaterThan(0);
    const first = f.analysis.quality.gaps[0]!;
    expect(rows[0]!.textContent).toContain(first.durationSeconds.toFixed(2));
    expect(rows[0]!.textContent).toMatch(/at a hole|on the open platform|at the rim/);
  });

  it('seeks to the frame the gap starts on', () => {
    const { onSeek, onAnnounce } = mount();
    const first = f.analysis.quality.gaps[0]!;
    container.querySelector<HTMLButtonElement>('.quality-gaps .seek-cell')!.click();
    expect(onSeek).toHaveBeenCalledWith(first.startFrame);
    expect(onAnnounce).toHaveBeenCalledWith(expect.stringContaining('start of this gap'));
  });

  it('says so plainly when there are no gaps', () => {
    const clean = {
      ...f,
      analysis: {
        ...f.analysis,
        quality: { ...f.analysis.quality, gaps: [], longestGapSeconds: 0 },
      },
    };
    mount(clean);
    expect(container.querySelector('.quality-gaps .empty')!.textContent).toContain('No gaps');
  });
});

describe('the nose-confidence distribution (D30)', () => {
  it('shows every bin with its count and share, as a table not a colour bar', () => {
    mount();
    const bins = f.analysis.quality.noseConfidenceHistogram;
    expect(bins.length).toBeGreaterThan(0);

    const summary = [...container.querySelectorAll('summary')].find(
      (n) => n.textContent === 'Nose-heading confidence distribution',
    );
    expect(summary).toBeDefined();

    const table = summary!.closest('details')!.querySelector('table')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(bins.length);
    expect([...table.querySelectorAll('thead th')].map((n) => n.textContent)).toEqual([
      'Confidence',
      'Frames',
      'Share',
    ]);
    const total = bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(table.textContent).toContain(total > 0 ? String(bins[0]!.count) : '0');
  });
});

describe('calibration and provenance', () => {
  it('shows the platform diameter, the scale, the anomalies and both hashes', () => {
    mount();
    const text = container.querySelector('.quality-provenance')!.textContent ?? '';
    expect(text).toContain('Platform diameter');
    expect(text).toContain('px/cm');
    expect(text).toContain('Duplicate timestamps');
    expect(text).toContain('Timebase drift');
    expect(text).toContain(f.analysis.parametersHash);
    expect(text).toContain(f.analysis.trackingParametersHash);
  });
});

describe('quality-summary', () => {
  it('counts the whole clip, not the trial window', () => {
    const track = f.analysis.cleanedTrack;
    const fractions = wholeClipStateFractions(track);
    const sum = Object.values(fractions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    const tracked = track.filter((frame) => frame.detectionState === 'tracked').length;
    expect(fractions.tracked).toBeCloseTo(tracked / track.length, 12);
  });

  it('reports NaN rather than a confident zero for an empty track', () => {
    const fractions = wholeClipStateFractions([]);
    for (const fraction of Object.values(fractions)) expect(fraction).toBeNaN();
  });
});

describe('lifecycle', () => {
  it('removes itself on destroy', () => {
    const { panel } = mount();
    panel.destroy();
    expect(container.querySelector('.quality-panel')).toBeNull();
  });
});
