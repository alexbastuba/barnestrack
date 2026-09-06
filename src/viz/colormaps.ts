/**
 * Sampling the two colour maps D32 names, and the check that makes them safe to
 * print: a map whose relative luminance rises monotonically still reads as an
 * ordered scale when the colour is thrown away.
 */
import type { Rgb } from './colormap-tables.js';
import { CIVIDIS_ANCHORS, VIRIDIS_ANCHORS } from './colormap-tables.js';

export type { Rgb } from './colormap-tables.js';

export interface Colormap {
  name: string;
  anchors: readonly Rgb[];
}

export const VIRIDIS: Colormap = { name: 'viridis', anchors: VIRIDIS_ANCHORS };
export const CIVIDIS: Colormap = { name: 'cividis', anchors: CIVIDIS_ANCHORS };

/** The colour at `t` in 0–1, linearly interpolated between anchors. */
export function sampleColormap(map: Colormap, t: number): Rgb {
  const anchors = map.anchors;
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const position = clamped * (anchors.length - 1);
  const low = Math.min(anchors.length - 2, Math.floor(position));
  const fraction = position - low;
  const a = anchors[low]!;
  const b = anchors[low + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * fraction),
    Math.round(a[1] + (b[1] - a[1]) * fraction),
    Math.round(a[2] + (b[2] - a[2]) * fraction),
  ];
}

export function rgbCss(colour: Rgb): string {
  return `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
}

/** The colour at `t` as a CSS string. */
export function colormapCss(map: Colormap, t: number): string {
  return rgbCss(sampleColormap(map, t));
}

/** Relative luminance, WCAG 2.x definition — what a grayscale printer keeps. */
export function relativeLuminance(colour: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

export interface MonotoneCheck {
  monotone: boolean;
  /** The largest step backwards found, 0 when there is none. */
  worstDrop: number;
  /** Where that step was, as a position in 0–1. */
  worstAt: number;
}

/**
 * Whether luminance rises across the whole map. `tolerance` allows the tiny
 * non-monotonicities that 8-bit rounding introduces without hiding a real dip.
 */
export function luminanceMonotone(map: Colormap, samples = 256, tolerance = 0.002): MonotoneCheck {
  let previous = relativeLuminance(sampleColormap(map, 0));
  let worstDrop = 0;
  let worstAt = 0;
  for (let i = 1; i < samples; i++) {
    const t = i / (samples - 1);
    const current = relativeLuminance(sampleColormap(map, t));
    const drop = previous - current;
    if (drop > worstDrop) {
      worstDrop = drop;
      worstAt = t;
    }
    previous = current;
  }
  return { monotone: worstDrop <= tolerance, worstDrop, worstAt };
}
