/**
 * The whole registry, exercised the same way: every figure must draw against a
 * recording context in both themes without throwing, put its title and its
 * units on the canvas, and describe the same content as text for the DOM mirror
 * (D32, D37).
 */
import { describe, expect, it } from 'vitest';
import { hashParameters, parameterPaths } from '../../src/analysis/parameters.js';
import { CELL_CM_RANGE, cellSizeCm, FIGURES, figureById } from '../../src/viz/index.js';
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

  it('names a PNG after the figure, the subject, its figure options and the scale', () => {
    const name = figurePngName(figure, data, 3);
    // barnestrack_<figure>_<subject>[_<colormap>][_bin<N>cm]_<scale>x.png — one
    // segment per option the figure says it reads, so two exports under
    // different options cannot collide (D53).
    const optionSegments = (figure.options ?? []).length;
    expect(name).toMatch(new RegExp(`^barnestrack_[a-z0-9-]+_[a-z0-9-]+${'_[a-z0-9-]+'.repeat(optionSegments)}_3x\\.png$`));
    expect(name).toContain(figure.id);
  });
});

describe('figure options in the PNG name (D53)', () => {
  const data = { session, videoId: session.videos[1]!.id };

  it('names the colour map on every figure that draws with one', () => {
    for (const figure of FIGURES.filter((f) => f.options?.includes('colormap'))) {
      expect(figurePngName(figure, data, 2, { colormap: 'cividis' })).toContain('_cividis_');
      expect(figurePngName(figure, data, 2, { colormap: 'viridis' })).toContain('_viridis_');
    }
  });

  it('states the bin size in force on the heatmap, default included', () => {
    const heatmap = FIGURES.find((f) => f.id === 'heatmap')!;
    expect(figurePngName(heatmap, data, 2)).toContain('_bin4cm_');
    expect(figurePngName(heatmap, data, 3, { heatmapCellSize_cm: 6 })).toContain('_bin6cm_');
  });

  it('names the bin size actually drawn, so two nearby values cannot share a name', () => {
    const heatmap = FIGURES.find((f) => f.id === 'heatmap')!;
    // `cellSizeCm` clamps to the offered range and its step, so the drawing, the
    // description table and this name always agree. Before that, 4.001 and 4.002
    // drew two different figures under one filename.
    expect(cellSizeCm({ heatmapCellSize_cm: 4.001 })).toBe(4);
    expect(cellSizeCm({ heatmapCellSize_cm: 2.5 })).toBe(3);
    expect(figurePngName(heatmap, data, 2, { heatmapCellSize_cm: 4.001 })).toContain('_bin4cm_');
    expect(heatmap.describe(data, { heatmapCellSize_cm: 4.001 }).rows).toContainEqual(['Cell size (cm)', 4]);
  });

  it('refuses a bin size that would allocate millions of cells', () => {
    const heatmap = FIGURES.find((f) => f.id === 'heatmap')!;
    // The grid is the square of the span, so 0.001 cm on a 46 cm platform asked
    // for 3.4 million cells and threw `Invalid array length` from inside `draw`.
    expect(cellSizeCm({ heatmapCellSize_cm: 0.001 })).toBe(CELL_CM_RANGE.min);
    expect(cellSizeCm({ heatmapCellSize_cm: 1e6 })).toBe(CELL_CM_RANGE.max);
    expect(() => heatmap.describe(data, { heatmapCellSize_cm: 0.001 })).not.toThrow();
    const ctx = fakeContext();
    expect(() =>
      heatmap.draw(ctx, data, { scale: 1, theme: 'light', heatmapCellSize_cm: 0.001 }),
    ).not.toThrow();
  });

  it('gives two exports of one figure under different options different names', () => {
    const heatmap = FIGURES.find((f) => f.id === 'heatmap')!;
    const names = new Set([
      figurePngName(heatmap, data, 2, { colormap: 'viridis', heatmapCellSize_cm: 4 }),
      figurePngName(heatmap, data, 2, { colormap: 'cividis', heatmapCellSize_cm: 4 }),
      figurePngName(heatmap, data, 2, { colormap: 'viridis', heatmapCellSize_cm: 6 }),
      figurePngName(heatmap, data, 3, { colormap: 'viridis', heatmapCellSize_cm: 4 }),
    ]);
    expect(names.size).toBe(4);
  });

  it('leaves the name of a figure that reads no option alone', () => {
    const trajectory = FIGURES.find((f) => f.id === 'trajectory')!;
    expect(trajectory.options).toBeUndefined();
    expect(figurePngName(trajectory, data, 2, { colormap: 'cividis', heatmapCellSize_cm: 9 })).toBe(
      figurePngName(trajectory, data, 2),
    );
  });
});

describe('figure options change pixels, never a parameter (D53)', () => {
  const data = { session, videoId: session.videos[1]!.id };
  const heatmap = FIGURES.find((f) => f.id === 'heatmap')!;

  it('bins the heatmap at the size asked for, in the drawing and in its mirror', () => {
    expect(heatmap.describe(data).rows).toContainEqual(['Cell size (cm)', 4]);
    expect(heatmap.describe(data, { heatmapCellSize_cm: 8 }).rows).toContainEqual(['Cell size (cm)', 8]);
    // The canvas and the table beside it must not disagree: a coarser grid puts
    // the same seconds into fewer cells.
    const fine = heatmap.describe(data, { heatmapCellSize_cm: 2 });
    const coarse = heatmap.describe(data, { heatmapCellSize_cm: 8 });
    const occupied = (d: typeof fine): number =>
      Number(d.rows.find((row) => row[0] === 'Cells with any time in them')![1]);
    expect(occupied(fine)).toBeGreaterThan(occupied(coarse));
  });

  it('names the chosen map in the caption of every figure that uses one', () => {
    for (const figure of FIGURES.filter((f) => f.options?.includes('colormap'))) {
      expect(figure.describe(data, { colormap: 'cividis' }).summary).toContain('cividis');
      expect(figure.describe(data, { colormap: 'viridis' }).summary).toContain('viridis');
    }
  });

  it('never appears in the parameter set or its hash', () => {
    const paths = parameterPaths(session.parameters!);
    expect(paths.filter((path) => /colormap|colour|cell|bin|scale|theme/i.test(path))).toEqual([]);
    // The options live in `FigureOpts`, not in `Parameters`, so no value of them
    // can reach `hashParameters` — an analysis is the same run whichever way it
    // is drawn.
    expect(hashParameters(session.parameters!)).toBe(hashParameters(structuredClone(session.parameters!)));
  });
});

describe('renderFigureToPng', () => {
  it('says plainly that Node has no canvas to render onto', async () => {
    await expect(
      renderFigureToPng(FIGURES[0]!, data, { scale: 2, theme: 'light' }),
    ).rejects.toThrow(/canvas/i);
  });
});
