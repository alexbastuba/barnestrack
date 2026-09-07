/**
 * The whole registry, exercised the same way: every figure must draw against a
 * recording context in both themes without throwing, put its title and its
 * units on the canvas, and describe the same content as text for the DOM mirror
 * (D32, D37).
 */
import { describe, expect, it } from 'vitest';
import { FIGURES, figureById } from '../../src/viz/index.js';
import { figurePngName, renderFigureToPng } from '../../src/viz/figure-export.js';
import type { FigureData, FigureOpts } from '../../src/viz/types.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { fakeContext } from './fake-context.js';

const session = syntheticSession();
const data: FigureData = { session, videoId: 'video-test51' };
const THEMES: FigureOpts[] = [
  { scale: 1, theme: 'light' },
  { scale: 1, theme: 'print' },
  { scale: 3, theme: 'light' },
];

describe('the figure registry', () => {
  it('holds the nine figures D32 names, each with a unique id', () => {
    expect(FIGURES).toHaveLength(9);
    expect(new Set(FIGURES.map((figure) => figure.id)).size).toBe(9);
    expect(FIGURES.map((figure) => figure.id)).toEqual([
      'trajectory',
      'time-colored-path',
      'speed-colored-path',
      'heatmap',
      'hole-raster',
      'quadrant-overlay',
      'quality-strip',
      'learning-curve',
      'group-comparison',
    ]);
  });

  it('looks a figure up by id', () => {
    expect(figureById('heatmap')?.title).toBe('Occupancy heatmap');
    expect(figureById('nope')).toBeUndefined();
  });

  it('gives every figure a sensible default size', () => {
    for (const figure of FIGURES) {
      expect(figure.defaultSize.width).toBeGreaterThan(200);
      expect(figure.defaultSize.height).toBeGreaterThan(200);
    }
  });
});

describe.each(FIGURES.map((figure) => [figure.id, figure] as const))('%s', (_id, figure) => {
  it('draws in every theme and scale without throwing, leaving no unbalanced save', () => {
    for (const opts of THEMES) {
      const ctx = fakeContext();
      figure.draw(ctx, data, opts);
      expect(ctx.saveDepth).toBe(0);
      expect(ctx.calls.length).toBeGreaterThan(20);
    }
  });

  it('applies the requested scale exactly once', () => {
    const ctx = fakeContext();
    figure.draw(ctx, data, { scale: 3, theme: 'light' });
    expect(ctx.callsNamed('scale')).toHaveLength(1);
    expect(ctx.callsNamed('scale')[0]?.args).toEqual([3, 3]);
  });

  it('writes its title on the canvas', () => {
    const ctx = fakeContext();
    figure.draw(ctx, data, THEMES[0]!);
    expect(ctx.joinedText).toContain(figure.title);
  });

  it('puts at least one unit on the canvas as text', () => {
    const ctx = fakeContext();
    figure.draw(ctx, data, THEMES[0]!);
    expect(ctx.joinedText).toMatch(/\((s|cm|cm\/s|count|px\/cm)\)|hole|Day|Trial|%/);
  });

  it('describes itself with a title, a summary and square rows (D37)', () => {
    const description = figure.describe(data);
    expect(description.title.length).toBeGreaterThan(3);
    expect(description.summary.length).toBeGreaterThan(20);
    expect(description.columns.length).toBeGreaterThan(1);
    for (const row of description.rows) {
      expect(row).toHaveLength(description.columns.length);
    }
  });

  it('draws its own explanation instead of an empty box when it has no data', () => {
    const empty = { session: { ...session, videos: [], analyses: {} }, videoId: 'gone' };
    expect(figure.unavailable(empty)).not.toBeNull();
    const ctx = fakeContext();
    figure.draw(ctx, empty, THEMES[0]!);
    expect(ctx.texts.length).toBeGreaterThan(1);
    expect(ctx.saveDepth).toBe(0);
  });

  it('names a PNG after the figure, the subject and the scale', () => {
    const name = figurePngName(figure, data, 3);
    expect(name).toMatch(/^barnestrack_[a-z0-9-]+_[a-z0-9-]+_3x\.png$/);
    expect(name).toContain(figure.id);
  });
});

describe('renderFigureToPng', () => {
  it('says plainly that Node has no canvas to render onto', async () => {
    await expect(
      renderFigureToPng(FIGURES[0]!, data, { scale: 2, theme: 'light' }),
    ).rejects.toThrow(/canvas/i);
  });
});
