import { describe, expect, it } from 'vitest';
import {
  beginFigure,
  drawAxes,
  drawColorBar,
  drawGlyph,
  drawLegend,
  drawUnavailable,
  endFigure,
  fillHatched,
  formatNumber,
  niceTicks,
  wrapText,
} from '../../src/viz/figure.js';
import { VIRIDIS } from '../../src/viz/colormaps.js';
import type { FigureOpts } from '../../src/viz/types.js';
import { fakeContext } from './fake-context.js';

const OPTS: FigureOpts = { scale: 1, theme: 'light' };
const SPEC = { title: 'Test figure', defaultSize: { width: 420, height: 320 } };

describe('beginFigure', () => {
  it('applies the scale once and paints the paper before anything else', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, { ...OPTS, scale: 3 }, SPEC);
    endFigure(frame);
    expect(ctx.callsNamed('scale')[0]?.args).toEqual([3, 3]);
    expect(ctx.callsNamed('fillRect')[0]?.args.slice(0, 4)).toEqual([0, 0, 420, 320]);
  });

  it('draws the title and leaves the drawing state balanced', () => {
    const ctx = fakeContext();
    endFigure(beginFigure(ctx, OPTS, SPEC));
    expect(ctx.joinedText).toContain('Test figure');
    expect(ctx.saveDepth).toBe(0);
  });

  it('lays out inside an explicitly requested size', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, { ...OPTS, width: 800, height: 200 }, SPEC);
    endFigure(frame);
    expect(frame.size).toEqual({ width: 800, height: 200 });
    expect(frame.plot.width).toBe(800 - 62 - 18);
  });
});

describe('drawAxes', () => {
  it('labels both axes with their units and numbers every tick', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, OPTS, SPEC);
    drawAxes(frame, {
      xLabel: 'Time (s)',
      yLabel: 'Speed (cm/s)',
      xTicks: [
        { value: 0, label: '0' },
        { value: 100, label: '30' },
      ],
      yTicks: [{ value: 0, label: '12' }],
      gridY: true,
    });
    endFigure(frame);
    expect(ctx.joinedText).toContain('Time (s)');
    expect(ctx.joinedText).toContain('Speed (cm/s)');
    expect(ctx.textContent).toContain('30');
    expect(ctx.textContent).toContain('12');
    expect(ctx.saveDepth).toBe(0);
  });
});

describe('drawLegend', () => {
  it('gives every entry a shape and a word, not only a colour (D26)', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, OPTS, SPEC);
    drawLegend(frame, [
      { label: 'automatic', colour: '#000', glyph: 'disc' },
      { label: 'corrected', colour: '#900', hatched: true },
      { label: 'filled', colour: '#555', glyph: 'ring', hollow: true },
    ]);
    endFigure(frame);
    expect(ctx.textContent).toEqual(expect.arrayContaining(['automatic', 'corrected', 'filled']));
    expect(ctx.callsNamed('arc').length).toBeGreaterThan(0);
    expect(ctx.saveDepth).toBe(0);
  });

  it('draws nothing for an empty legend', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, OPTS, SPEC);
    const before = ctx.calls.length;
    expect(drawLegend(frame, [])).toBe(0);
    endFigure(frame);
    expect(ctx.calls.length).toBe(before + 1);
  });
});

describe('drawColorBar', () => {
  it('numbers both ends and names the unit', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, OPTS, SPEC);
    drawColorBar(frame, {
      map: VIRIDIS,
      min: 0,
      max: 42.5,
      label: 'Speed (cm/s)',
      rect: { x: 10, y: 10, width: 120, height: 10 },
    });
    endFigure(frame);
    expect(ctx.textContent).toContain('0');
    expect(ctx.textContent).toContain('42.5');
    expect(ctx.textContent).toContain('Speed (cm/s)');
    expect(ctx.callsNamed('fillRect').length).toBeGreaterThan(100);
  });
});

describe('glyphs and hatching', () => {
  it('strokes a hollow marker with a dash and fills a solid one (D26, O10)', () => {
    const solid = fakeContext();
    drawGlyph(solid, 'disc', 10, 10, 8, '#000');
    expect(solid.callsNamed('fill')).toHaveLength(1);

    const hollow = fakeContext();
    drawGlyph(hollow, 'disc', 10, 10, 8, '#000', true);
    expect(hollow.callsNamed('fill')).toHaveLength(0);
    expect(hollow.callsNamed('setLineDash')).toHaveLength(1);
  });

  it('clips hatching to the rectangle it fills', () => {
    const ctx = fakeContext();
    fillHatched(ctx, { x: 0, y: 0, width: 40, height: 10 }, '#900');
    expect(ctx.callsNamed('clip')).toHaveLength(1);
    expect(ctx.callsNamed('moveTo').length).toBeGreaterThan(1);
    expect(ctx.saveDepth).toBe(0);
  });
});

describe('niceTicks', () => {
  it('lands on round numbers covering the range', () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks.map((tick) => tick.value)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('survives a degenerate range', () => {
    expect(niceTicks(5, 5)).toEqual([{ value: 5, label: '5' }]);
    expect(niceTicks(Number.NaN, 3)[0]?.label).toBe('—');
  });
});

describe('formatNumber and wrapText', () => {
  it('keeps integers whole and shortens long decimals', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(0.4567)).toBe('0.46');
    expect(formatNumber(123.456)).toBe('123');
  });

  it('wraps a message onto as many lines as it needs', () => {
    const ctx = fakeContext();
    ctx.font = '12px sans-serif';
    expect(
      wrapText(ctx, 'add animal day trial and group on the videos step', 80).length,
    ).toBeGreaterThan(1);
  });

  it('draws an unavailable message in the middle of the plot', () => {
    const ctx = fakeContext();
    const frame = beginFigure(ctx, OPTS, SPEC);
    drawUnavailable(frame, 'Add animal, day, trial and group on the Videos step.');
    endFigure(frame);
    // The message wraps, so it is checked word by word rather than as one line.
    expect(ctx.joinedText).toContain('Add animal');
    expect(ctx.joinedText).toContain('Videos');
    expect(ctx.textContent.length).toBeGreaterThan(2);
  });
});
