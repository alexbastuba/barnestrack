/**
 * The parts every figure shares: the frame and its margins, the title, axes
 * with units, tick labels, a legend whose entries carry a shape and a word as
 * well as a colour, and a labelled colour bar.
 *
 * Coordinates: `beginFigure` applies `opts.scale` once, so everything below
 * works in logical pixels and a 3× export is drawn at 3× resolution rather than
 * enlarged afterwards. The 2D context is used through a deliberately small
 * subset of its API — no gradients, no patterns, no image data — so a recording
 * fake in the tests can stand in for a real canvas.
 */
import type { Colormap } from './colormaps.js';
import { colormapCss } from './colormaps.js';
import type { Palette } from './theme.js';
import {
  ANNOTATION_SIZE,
  AXIS_LABEL_SIZE,
  figureFont,
  paletteFor,
  TICK_SIZE,
  TITLE_SIZE,
} from './theme.js';
import type { FigureOpts, FigureSize } from './types.js';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigureFrame {
  ctx: CanvasRenderingContext2D;
  palette: Palette;
  opts: FigureOpts;
  /** Logical size of the whole figure. */
  size: FigureSize;
  /** The area inside the margins that data is drawn in. */
  plot: Rect;
}

export const DEFAULT_MARGINS: Margins = { top: 34, right: 18, bottom: 64, left: 62 };

/** The title sits at the same place whatever the margins are. */
const TITLE_X = 14;

export interface BeginFigureOptions {
  title: string;
  defaultSize: FigureSize;
  margins?: Partial<Margins>;
}

/**
 * Clears the figure, applies the scale, draws the title, and hands back the
 * plotting rectangle. Always paired with `endFigure`.
 */
export function beginFigure(
  ctx: CanvasRenderingContext2D,
  opts: FigureOpts,
  options: BeginFigureOptions,
): FigureFrame {
  const size = {
    width: opts.width ?? options.defaultSize.width,
    height: opts.height ?? options.defaultSize.height,
  };
  const margins = { ...DEFAULT_MARGINS, ...options.margins };
  const palette = paletteFor(opts.theme);

  ctx.save();
  ctx.scale(opts.scale, opts.scale);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.fillStyle = palette.ink;
  ctx.font = figureFont(TITLE_SIZE, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(options.title, TITLE_X, 20);

  return {
    ctx,
    palette,
    opts,
    size,
    plot: {
      x: margins.left,
      y: margins.top,
      width: Math.max(1, size.width - margins.left - margins.right),
      height: Math.max(1, size.height - margins.top - margins.bottom),
    },
  };
}

export function endFigure(frame: FigureFrame): void {
  frame.ctx.restore();
}

/** The sentence a figure draws instead of an empty box when it has no data. */
export function drawUnavailable(frame: FigureFrame, message: string): void {
  const { ctx, palette, plot } = frame;
  ctx.fillStyle = palette.inkSoft;
  ctx.font = figureFont(AXIS_LABEL_SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [index, line] of wrapText(ctx, message, plot.width - 20).entries()) {
    ctx.fillText(line, plot.x + plot.width / 2, plot.y + plot.height / 2 + index * 18);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface Tick {
  value: number;
  label: string;
}

/** Round tick positions covering `min`–`max`, at most `count` of them. */
export function niceTicks(min: number, max: number, count = 6): Tick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [{ value: min, label: formatNumber(min) }];
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: Tick[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    const rounded = Math.abs(value) < step * 1e-6 ? 0 : value;
    ticks.push({ value: rounded, label: formatNumber(rounded) });
  }
  return ticks;
}

export interface Scale {
  ticks: Tick[];
  /** The value at the top of the axis: the first round tick at or above `max`. */
  top: number;
}

/**
 * A y scale that always has a tick at or above the largest value, so the
 * highest point sits inside the plot rather than on its top edge.
 */
export function niceScale(max: number, count = 5): Scale {
  const ticks = niceTicks(0, Math.max(max, Number.EPSILON), count);
  const last = ticks[ticks.length - 1];
  if (!last || last.value < max) {
    const step = ticks.length > 1 ? ticks[1]!.value - ticks[0]!.value : Math.max(max, 1);
    const value = (last?.value ?? 0) + step;
    ticks.push({ value, label: formatNumber(value) });
  }
  return { ticks, top: ticks[ticks.length - 1]?.value ?? Math.max(max, 1) };
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return String(value);
  const absolute = Math.abs(value);
  return value.toFixed(absolute < 1 ? 2 : absolute < 100 ? 1 : 0);
}

export interface AxesOptions {
  xLabel: string;
  yLabel: string;
  xTicks?: Tick[];
  yTicks?: Tick[];
  /** Faint horizontal rules behind the data. */
  gridY?: boolean;
}

/** Axis lines, tick marks with their numbers, and both labels with units. */
export function drawAxes(frame: FigureFrame, axes: AxesOptions): void {
  const { ctx, palette, plot } = frame;
  ctx.save();
  ctx.lineWidth = palette.strokeScale;
  ctx.strokeStyle = palette.lineStrong;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.stroke();

  ctx.font = figureFont(TICK_SIZE);
  ctx.fillStyle = palette.inkSoft;

  if (axes.xTicks) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of axes.xTicks) {
      const x = plot.x + tick.value;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 4);
      ctx.stroke();
      ctx.fillText(tick.label, x, plot.y + plot.height + 7);
    }
  }

  if (axes.yTicks) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of axes.yTicks) {
      const y = plot.y + tick.value;
      ctx.beginPath();
      ctx.moveTo(plot.x - 4, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
      if (axes.gridY) {
        ctx.save();
        ctx.strokeStyle = palette.line;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillText(tick.label, plot.x - 7, y);
    }
  }

  ctx.fillStyle = palette.ink;
  ctx.font = figureFont(AXIS_LABEL_SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(axes.xLabel, plot.x + plot.width / 2, plot.y + plot.height + 32);

  ctx.save();
  ctx.translate(16, plot.y + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(axes.yLabel, 0, 0);
  ctx.restore();
  ctx.restore();
}

export type GlyphKind =
  'disc' | 'ring' | 'square' | 'triangle' | 'diamond' | 'cross' | 'bar' | 'errorbar';

/**
 * A marker drawn as a shape, so two categories differ without relying on their
 * colours (D26). `hollow` is how a gap-filled point is shown (O10).
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: GlyphKind,
  x: number,
  y: number,
  size: number,
  colour: string,
  hollow = false,
): void {
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  switch (kind) {
    case 'disc':
    case 'ring':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - r, y - r, size, size);
      break;
    case 'bar':
      ctx.rect(x - r, y - r / 2, size, r);
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case 'errorbar':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.moveTo(x - r / 2, y - r);
      ctx.lineTo(x + r / 2, y - r);
      ctx.moveTo(x - r / 2, y + r);
      ctx.lineTo(x + r / 2, y + r);
      break;
  }
  if (kind === 'cross' || kind === 'errorbar' || kind === 'ring' || hollow) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    if (hollow && kind !== 'cross' && kind !== 'errorbar') ctx.setLineDash([2, 2]);
    ctx.stroke();
  } else {
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.restore();
}

/** Diagonal hatching, the marker a corrected event carries (D26). */
export function fillHatched(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  colour: string,
  spacing = 4,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let offset = -rect.height; offset < rect.width; offset += spacing) {
    ctx.moveTo(rect.x + offset, rect.y + rect.height);
    ctx.lineTo(rect.x + offset + rect.height, rect.y);
  }
  ctx.stroke();
  ctx.restore();
}

export interface LegendEntry {
  label: string;
  colour: string;
  glyph?: GlyphKind;
  hollow?: boolean;
  hatched?: boolean;
  /**
   * Outline the swatch. A swatch whose fill is the paper or near it — the
   * quality strip's tracked band, the heatmap's empty platform — is invisible
   * without one, and in the print theme it has no fill to show at all.
   */
  border?: boolean;
}

/**
 * A legend with a shape and a word for every entry, laid out left to right and
 * wrapped. Returns the height it used so a caller can reserve the space.
 */
export function drawLegend(
  frame: FigureFrame,
  entries: readonly LegendEntry[],
  top?: number,
): number {
  const { ctx, palette, plot, size } = frame;
  if (entries.length === 0) return 0;
  const y0 = top ?? plot.y + plot.height + 44;
  const glyphSize = 9;
  const rowHeight = 16;
  ctx.save();
  ctx.font = figureFont(ANNOTATION_SIZE);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = plot.x;
  let y = y0;
  for (const entry of entries) {
    const width = glyphSize + 6 + ctx.measureText(entry.label).width + 16;
    if (x + width > size.width - 8 && x > plot.x) {
      x = plot.x;
      y += rowHeight;
    }
    if (entry.hatched) {
      fillHatched(ctx, { x: x - 1, y: y - 5, width: glyphSize + 2, height: 10 }, entry.colour, 3);
      ctx.strokeStyle = entry.colour;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1, y - 5, glyphSize + 2, 10);
    } else {
      drawGlyph(
        ctx,
        entry.glyph ?? 'square',
        x + glyphSize / 2,
        y,
        glyphSize,
        entry.colour,
        entry.hollow,
      );
      if (entry.border) {
        ctx.save();
        ctx.strokeStyle = palette.lineStrong;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - glyphSize / 2, glyphSize, glyphSize);
        ctx.restore();
      }
    }
    ctx.fillStyle = palette.ink;
    ctx.fillText(entry.label, x + glyphSize + 6, y);
    x += width;
  }
  ctx.restore();
  return y - y0 + rowHeight;
}

export interface ColorBarOptions {
  map: Colormap;
  min: number;
  max: number;
  label: string;
  rect: Rect;
}

/**
 * A colour bar drawn as a run of thin strips — no gradient object, so the same
 * code runs against the recording context in the tests. Both ends are
 * numbered and the bar carries its unit as a label.
 */
export function drawColorBar(frame: FigureFrame, options: ColorBarOptions): void {
  const { ctx, palette } = frame;
  const { rect } = options;
  ctx.save();
  const steps = Math.max(2, Math.round(rect.width));
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = colormapCss(options.map, i / (steps - 1));
    ctx.fillRect(rect.x + (i * rect.width) / steps, rect.y, rect.width / steps + 0.5, rect.height);
  }
  ctx.strokeStyle = palette.lineStrong;
  ctx.lineWidth = palette.strokeScale;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.fillStyle = palette.ink;
  ctx.font = figureFont(ANNOTATION_SIZE);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(formatNumber(options.min), rect.x, rect.y + rect.height + 3);
  ctx.textAlign = 'right';
  ctx.fillText(formatNumber(options.max), rect.x + rect.width, rect.y + rect.height + 3);
  ctx.textAlign = 'center';
  ctx.fillText(options.label, rect.x + rect.width / 2, rect.y + rect.height + 3);
  ctx.restore();
}
