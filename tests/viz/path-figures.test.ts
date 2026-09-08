import { describe, expect, it } from 'vitest';
import { centroidPath, pathRuns, trialSource } from '../../src/viz/data.js';
import { beginFigure } from '../../src/viz/figure.js';
import { holeLabelPoint, mazeView } from '../../src/viz/maze-backdrop.js';
import { ANNOTATION_SIZE } from '../../src/viz/theme.js';
import { SPATIAL_MARGINS } from '../../src/viz/trial-figure.js';
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

/*
 * Hole numbers belong in the margin outside the platform, not on it. Inside the
 * disc they land on the path, the heat cells and the hole discs themselves, and
 * the fit has to reserve the space rather than discover it — so both halves are
 * checked: the placement, and that the placement fits.
 */
describe('the hole numbers sit outside the platform', () => {
  const source = trialSource(data)!;

  function viewFor(spec: { defaultSize: { width: number; height: number } }) {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, LIGHT, {
      title: 'test',
      defaultSize: spec.defaultSize,
      margins: SPATIAL_MARGINS,
    });
    return { ctx, frame, view: mazeView(frame, source) };
  }

  it('places every label past the rim and inside the plot rect', () => {
    for (const figure of FIGURES) {
      const { frame, view } = viewFor(figure);
      expect(source.holes).toHaveLength(20);
      for (const hole of source.holes) {
        const label = holeLabelPoint(view, hole);
        const away = Math.hypot(label.x - view.centre.x, label.y - view.centre.y);
        // Under the old placement — the hole radius plus 9 px from the *hole* —
        // the labels sat a fraction of a pixel inside the rim on this ring
        // ratio, so this margin is real but thin, and a fixture with another
        // ratio would move it.
        expect(away, `hole ${hole.holeIndex} of ${figure.id}`).toBeGreaterThan(view.radius);
        // Inside the plot rect with room for the glyph itself, not merely on it:
        // the labels are centred and middle-baselined, so half a line either way.
        const room = ANNOTATION_SIZE / 2;
        const where = `hole ${hole.holeIndex} of ${figure.id}`;
        expect(label.x, where).toBeGreaterThanOrEqual(frame.plot.x + room);
        expect(label.x, where).toBeLessThanOrEqual(frame.plot.x + frame.plot.width - room);
        expect(label.y, where).toBeGreaterThanOrEqual(frame.plot.y + room);
        expect(label.y, where).toBeLessThanOrEqual(frame.plot.y + frame.plot.height - room);
      }
    }
  });

  it('draws them where the geometry says, in the figure itself', () => {
    // The trajectory figure has no colour bar, so every all-digit string it
    // draws is a hole number and the two can be compared one for one.
    const ctx = fakeContext();
    trajectoryFigure.draw(ctx, data, LIGHT);
    const { view } = viewFor(trajectoryFigure);
    const drawn = new Map(
      ctx.texts.filter((entry) => /^\d+$/.test(entry.text)).map((entry) => [entry.text, entry]),
    );
    expect(drawn.size).toBe(20);
    for (const hole of source.holes) {
      const entry = drawn.get(String(hole.holeIndex))!;
      const expected = holeLabelPoint(view, hole);
      expect(entry.x).toBeCloseTo(expected.x, 6);
      expect(entry.y).toBeCloseTo(expected.y, 6);
      expect(Math.hypot(entry.x - view.centre.x, entry.y - view.centre.y)).toBeGreaterThan(view.radius);
    }
  });
});

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
  });

  it('keys the gap-filled marker only on a figure that has one', () => {
    // test50 carries a filled gap; test53 does not, and a key to a mark the
    // figure has not drawn sends the reader looking for something absent.
    const withFilled = fakeContext();
    trajectoryFigure.draw(withFilled, { session, videoId: 'video-test50' }, LIGHT);
    expect(withFilled.joinedText).toContain('gap-filled position');

    const withoutFilled = fakeContext();
    trajectoryFigure.draw(withoutFilled, { session, videoId: 'video-test53' }, LIGHT);
    expect(withoutFilled.joinedText).not.toContain('gap-filled position');
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
  it('separates the inside and outside path swatches by shape, not tone (D26)', () => {
    // palette.target and palette.line are both black in the print theme, and
    // drawLegend cannot show the dimming the plot uses, so the outside entry
    // has to be hollow or the two swatches are one mark twice.
    const ctx = fakeContext();
    quadrantOverlayFigure.draw(ctx, data, PRINT);
    expect(ctx.callsNamed('setLineDash').length).toBeGreaterThan(0);
    expect(ctx.joinedText).toContain('path inside the quadrant');
    expect(ctx.joinedText).toContain('path outside it, dimmed');
  });

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
