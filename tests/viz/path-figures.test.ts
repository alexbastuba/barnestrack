import { describe, expect, it } from 'vitest';
import { centroidPath, pathRuns, trialSource } from '../../src/viz/data.js';
import { quadrantOverlayFigure } from '../../src/viz/quadrant-overlay.js';
import { speedColoredPathFigure } from '../../src/viz/speed-colored-path.js';
import { timeColoredPathFigure } from '../../src/viz/time-colored-path.js';
import { trajectoryFigure } from '../../src/viz/trajectory.js';
import type { FigureData, FigureOpts } from '../../src/viz/types.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { fakeContext } from './fake-context.js';

const session = syntheticSession();
const data: FigureData = { session, videoId: 'video-test53' };
const LIGHT: FigureOpts = { scale: 1, theme: 'light' };
const PRINT: FigureOpts = { scale: 1, theme: 'print' };
const FIGURES = [
  trajectoryFigure,
  timeColoredPathFigure,
  speedColoredPathFigure,
  quadrantOverlayFigure,
];

describe('the spatial path figures', () => {
  for (const figure of FIGURES) {
    describe(figure.id, () => {
      it('draws in both themes without throwing, leaving the state balanced', () => {
        for (const opts of [LIGHT, PRINT]) {
          const ctx = fakeContext();
          figure.draw(ctx, data, opts);
          expect(ctx.saveDepth).toBe(0);
          expect(ctx.calls.length).toBeGreaterThan(50);
        }
      });

      it('draws its title and numbers every hole as text', () => {
        const ctx = fakeContext();
        figure.draw(ctx, data, LIGHT);
        expect(ctx.joinedText).toContain(figure.title);
        for (let hole = 0; hole < 20; hole++) {
          expect(ctx.textContent).toContain(String(hole));
        }
      });

      it('names the target hole in words, not only by colour (D26, D37)', () => {
        const ctx = fakeContext();
        figure.draw(ctx, data, LIGHT);
        expect(ctx.joinedText).toContain('hole 7');
      });

      it('says why it cannot draw when the video has no analysis', () => {
        const ctx = fakeContext();
        const missing = { session, videoId: 'video-nope' };
        expect(figure.unavailable(missing)).toContain('Track step');
        figure.draw(ctx, missing, LIGHT);
        // The sentence wraps across lines, so it is checked in pieces.
        expect(ctx.joinedText).toContain('No analysis for this video');
        expect(ctx.joinedText).toContain('track the video');
      });

      it('describes the same content as text for the DOM mirror (D37)', () => {
        const description = figure.describe(data);
        expect(description.title).toContain(figure.title);
        expect(description.summary.length).toBeGreaterThan(20);
        expect(description.rows.length).toBeGreaterThan(2);
        for (const row of description.rows) {
          expect(row).toHaveLength(description.columns.length);
        }
      });
    });
  }
});

describe('trajectory', () => {
  it('breaks the line at a gap instead of drawing across it', () => {
    const source = trialSource(data);
    expect(source).toBeDefined();
    if (!source) return;
    const runs = pathRuns(centroidPath(source.analysis));
    expect(runs.length).toBeGreaterThan(1);

    const ctx = fakeContext();
    trajectoryFigure.draw(ctx, data, LIGHT);
    // One moveTo begins each run of the path; the rest belong to the backdrop,
    // the markers and the legend, so the count is a lower bound.
    expect(ctx.callsNamed('moveTo').length).toBeGreaterThanOrEqual(runs.length);
  });

  it('marks the start and the last seen position with different shapes', () => {
    const ctx = fakeContext();
    trajectoryFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('start');
    expect(ctx.joinedText).toContain('last seen');
    expect(ctx.joinedText).toContain('gap-filled position');
  });

  it('counts the gap-filled positions it drew hollow (O10)', () => {
    const filled = trajectoryFigure
      .describe({ session, videoId: 'video-test50' })
      .rows.find((row) => row[0] === 'Gap-filled positions');
    expect(filled?.[1]).toBeGreaterThan(0);
  });
});

describe('the colour-scaled paths', () => {
  it('labels the time bar in seconds', () => {
    const ctx = fakeContext();
    timeColoredPathFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('Time from the start of the clip (s)');
  });

  it('labels the speed bar in cm/s and says where the scale tops out', () => {
    const ctx = fakeContext();
    speedColoredPathFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('Speed (cm/s)');
    expect(ctx.joinedText).toContain('95th percentile');
  });

  it('reports speeds in a plausible range for a mouse', () => {
    const rows = new Map(speedColoredPathFigure.describe(data).rows.map((row) => [row[0], row[1]]));
    expect(Number(rows.get('Median speed (cm/s)'))).toBeGreaterThan(0);
    expect(Number(rows.get('Fastest speed (cm/s)'))).toBeLessThan(150);
  });
});

describe('quadrant overlay', () => {
  it('states the O6 sector width in holes and degrees', () => {
    const rows = new Map(quadrantOverlayFigure.describe(data).rows.map((row) => [row[0], row[1]]));
    expect(rows.get('Quadrant width (holes either side)')).toBe(2.5);
    expect(rows.get('Quadrant width (degrees)')).toBe(90);
  });

  it('counts fewer positions inside the quadrant than in the whole path', () => {
    const rows = new Map(quadrantOverlayFigure.describe(data).rows.map((row) => [row[0], row[1]]));
    const inside = Number(rows.get('Tracked positions inside the quadrant'));
    const total = Number(rows.get('Tracked positions in total'));
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(total);
  });
});
