import { describe, expect, it } from 'vitest';
import { centroidPath, trialSource } from '../../src/viz/data.js';
import { heatmapFigure, occupancyGrid } from '../../src/viz/heatmap.js';
import { holeRasterFigure, rasterGeometry } from '../../src/viz/hole-raster.js';
import { qualityStripFigure, stateRuns } from '../../src/viz/quality-strip.js';
import { paletteFor } from '../../src/viz/theme.js';
import type { FigureData, FigureOpts } from '../../src/viz/types.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { fakeContext } from './fake-context.js';

const session = syntheticSession();
const data: FigureData = { session, videoId: 'video-test50' };
const LIGHT: FigureOpts = { scale: 1, theme: 'light' };
const PRINT: FigureOpts = { scale: 1, theme: 'print' };

describe('rasterGeometry', () => {
  const plot = { x: 60, y: 30, width: 600, height: 400 };
  const geometry = rasterGeometry(plot, 20, 0, 100);

  it('puts hole k in row k, evenly spaced from the top', () => {
    expect(geometry.rowHeight).toBe(20);
    expect(geometry.rowY(0)).toBe(40);
    expect(geometry.rowY(19)).toBe(420);
    for (let hole = 1; hole < 20; hole++) {
      expect(geometry.rowY(hole) - geometry.rowY(hole - 1)).toBeCloseTo(20, 9);
    }
  });

  it('maps a timestamp linearly onto the axis', () => {
    expect(geometry.timeX(0)).toBe(60);
    expect(geometry.timeX(50)).toBe(360);
    expect(geometry.timeX(100)).toBe(660);
  });

  it('survives a clip with no elapsed time', () => {
    const degenerate = rasterGeometry(plot, 20, 7, 7);
    expect(Number.isFinite(degenerate.timeX(7))).toBe(true);
  });
});

describe('hole raster', () => {
  it('gives every hole a numbered row and names the target row in words', () => {
    const ctx = fakeContext();
    holeRasterFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('7 · target');
    for (let hole = 0; hole < 20; hole++) {
      if (hole === 7) continue;
      expect(ctx.textContent).toContain(String(hole));
    }
  });

  it('labels the axes with their units and legends every mark (D26)', () => {
    const ctx = fakeContext();
    holeRasterFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('Time from the start of the clip (s)');
    expect(ctx.joinedText).toContain('Hole');
    expect(ctx.joinedText).toContain('investigation');
    expect(ctx.joinedText).toContain('corrected by a reviewer');
    expect(ctx.joinedText).toContain('escape-box entry');
  });

  it('hatches the corrected event and only that one', () => {
    const ctx = fakeContext();
    holeRasterFigure.draw(ctx, data, LIGHT);
    // Hatching clips to its rectangle, so one clip per hatched region: the
    // corrected event's bar plus the two hatched legend swatches.
    expect(ctx.callsNamed('clip').length).toBeGreaterThanOrEqual(1);
    const corrected = holeRasterFigure.describe(data).rows.filter((row) => row[4] === 'corrected');
    expect(corrected).toHaveLength(1);
  });

  it('lists no tracking failure: a lost frame is not a hole visit (O4)', () => {
    const kinds = new Set(holeRasterFigure.describe(data).rows.map((row) => row[1]));
    expect(kinds).not.toContain('tracking failure');
    expect(kinds).toContain('investigation');
  });

  it('draws in both themes without throwing', () => {
    for (const opts of [LIGHT, PRINT]) {
      const ctx = fakeContext();
      holeRasterFigure.draw(ctx, data, opts);
      expect(ctx.saveDepth).toBe(0);
    }
  });
});

describe('occupancyGrid', () => {
  it('bins every tracked position exactly once', () => {
    for (const video of session.videos) {
      const source = trialSource({ session, videoId: video.id });
      expect(source).toBeDefined();
      if (!source) continue;
      const grid = occupancyGrid(source);
      const tracked = centroidPath(source.analysis).length;
      expect(grid.totalCounted).toBe(tracked);
      expect(grid.counts.reduce((sum, count) => sum + count, 0)).toBe(tracked);
    }
  });

  it('accounts for the tracked time without exceeding the clip', () => {
    const source = trialSource(data);
    expect(source).toBeDefined();
    if (!source) return;
    const grid = occupancyGrid(source);
    const track = source.analysis.derived.cleanedTrack;
    const clipSeconds = (track[track.length - 1]?.t_s ?? 0) - (track[0]?.t_s ?? 0);
    expect(grid.totalSeconds).toBeGreaterThan(0);
    expect(grid.totalSeconds).toBeLessThanOrEqual(clipSeconds + 1e-6);
    // Gap time belongs to no cell, so the two differ by the time spent lost.
    expect(clipSeconds - grid.totalSeconds).toBeGreaterThan(0);
    expect(grid.seconds.reduce((sum, value) => sum + value, 0)).toBeCloseTo(grid.totalSeconds, 6);
  });

  it('spans the platform at the requested cell size', () => {
    const source = trialSource(data);
    if (!source) return;
    const grid = occupancyGrid(source, 2);
    expect(grid.cellSize_cm).toBe(2);
    expect(grid.columns).toBe(grid.rows);
    expect(grid.columns * 2).toBeGreaterThanOrEqual(grid.radius_cm * 2);
  });
});

describe('heatmap figure', () => {
  it('names the cell size and the unit on the colour bar', () => {
    const ctx = fakeContext();
    heatmapFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('Time in a 4 cm cell (s)');
    expect(ctx.joinedText).toContain('no time spent here');
    expect(ctx.joinedText).toContain('hole 7');
  });

  it('fills the platform disc once, so the cells are not painted over', () => {
    const ctx = fakeContext();
    heatmapFigure.draw(ctx, data, LIGHT);
    const platform = paletteFor('light').platform;
    const clipped = ctx.calls.findIndex((call) => call.name === 'clip');
    const lastHoleNumber = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === 'fillText' && call.args[0] === '19')
      .at(-1)!.index;
    // `fill` records the fill style in force. The disc is filled once before
    // the cells and never again while the ring is drawn — a second fill there
    // would cover the data with the platform colour.
    const platformFills = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === 'fill' && call.args[0] === platform);
    expect(platformFills.filter(({ index }) => index < clipped)).toHaveLength(1);
    expect(
      platformFills.filter(({ index }) => index > clipped && index <= lastHoleNumber),
    ).toHaveLength(0);
  });

  it('draws the hole ring over the cells', () => {
    const ctx = fakeContext();
    heatmapFigure.draw(ctx, data, LIGHT);
    // The cells are drawn inside one clip to the platform disc; the ring has to
    // come after that clip is released, or it would be painted over.
    const clipped = ctx.calls.findIndex((call) => call.name === 'clip');
    const released = ctx.calls.findIndex(
      (call, index) => index > clipped && call.name === 'restore',
    );
    const cells = ctx.calls.filter(
      (call, index) => index > clipped && index < released && call.name === 'fillRect',
    );
    expect(cells.length).toBeGreaterThan(20);
    const holeNumbers = ctx.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === 'fillText' && call.args[0] === '19');
    expect(holeNumbers.at(-1)?.index).toBeGreaterThan(released);
  });
});

describe('stateRuns', () => {
  it('clusters consecutive frames sharing a detection state', () => {
    const runs = stateRuns([
      { frameIndex: 0, t_s: 0, detectionState: 'tracked' },
      { frameIndex: 1, t_s: 0.1, detectionState: 'tracked' },
      { frameIndex: 2, t_s: 0.2, detectionState: 'not_detected' },
      { frameIndex: 3, t_s: 0.3, detectionState: 'tracked' },
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({ state: 'tracked', startFrame: 0, endFrame: 1 });
    expect(runs[1]).toMatchObject({ state: 'not_detected', startFrame: 2, endFrame: 2 });
  });

  it('returns nothing for an empty track', () => {
    expect(stateRuns([])).toEqual([]);
  });
});

describe('quality strip', () => {
  it('names every state in words with its percentage (D30, D37)', () => {
    const ctx = fakeContext();
    qualityStripFigure.draw(ctx, data, LIGHT);
    for (const word of ['tracked', 'low confidence', 'ambiguous', 'not detected']) {
      expect(ctx.joinedText).toContain(word);
    }
    expect(ctx.joinedText).toContain('Tier GOOD');
    expect(ctx.joinedText).toContain('longest');
  });

  it('describes the same fractions the strip draws', () => {
    const description = qualityStripFigure.describe(data);
    const source = trialSource(data);
    if (!source) return;
    const fractions = source.analysis.derived.quality.detectionStateFractions;
    expect(description.rows[0]).toEqual(['tracked', fractions.tracked]);
    expect(description.rows.at(-1)).toEqual(['quality tier', 'GOOD']);
  });

  it('draws in both themes without throwing', () => {
    for (const opts of [LIGHT, PRINT]) {
      const ctx = fakeContext();
      qualityStripFigure.draw(ctx, data, opts);
      expect(ctx.saveDepth).toBe(0);
    }
  });
});
