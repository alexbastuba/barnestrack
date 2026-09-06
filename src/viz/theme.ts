/**
 * Two palettes: `light` matches the app's own tokens in `src/styles/app.css` so
 * a figure on screen belongs to the page it sits in, and `print` drops hue from
 * every structural element and thickens strokes for a black-and-white printer.
 *
 * No decision covers a print theme; D32 asks only that figures survive a
 * grayscale printer. Colour maps stay in use in both themes because viridis and
 * cividis are monotone in luminance — it is the *categorical* colour that a
 * grayscale printer destroys, so `print` removes that and leaves the scales.
 *
 * Nothing here carries meaning by colour alone: every figure pairs its colours
 * with a shape and a text label (D26, D37).
 */
import type { ThemeName } from './types.js';

export interface Palette {
  paper: string;
  panel: string;
  ink: string;
  inkSoft: string;
  line: string;
  lineStrong: string;
  accent: string;
  /** Fill of the platform disc a trajectory is drawn on. */
  platform: string;
  platformEdge: string;
  hole: string;
  holeEdge: string;
  target: string;
  path: string;
  /** A human-corrected value (D26). */
  corrected: string;
  /** A gap-filled position (D26, O10). */
  filled: string;
  lost: string;
  warn: string;
  ok: string;
  /** Stroke widths are multiplied by this; print needs a heavier line. */
  strokeScale: number;
}

const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const LIGHT: Palette = {
  paper: '#ffffff',
  panel: '#f4f6f8',
  ink: '#16191d',
  inkSoft: '#4a5159',
  line: '#c3cad2',
  lineStrong: '#8b959f',
  accent: '#0a4d8c',
  platform: '#eef1f4',
  platformEdge: '#8b959f',
  hole: '#ffffff',
  holeEdge: '#4a5159',
  target: '#0a4d8c',
  path: '#16191d',
  corrected: '#9a2417',
  filled: '#4a5159',
  lost: '#b57b00',
  warn: '#b57b00',
  ok: '#1c6b33',
  strokeScale: 1,
};

const PRINT: Palette = {
  paper: '#ffffff',
  panel: '#ffffff',
  ink: '#000000',
  inkSoft: '#2b2b2b',
  line: '#000000',
  lineStrong: '#000000',
  accent: '#000000',
  platform: '#ffffff',
  platformEdge: '#000000',
  hole: '#ffffff',
  holeEdge: '#000000',
  target: '#000000',
  path: '#000000',
  corrected: '#000000',
  filled: '#5a5a5a',
  lost: '#5a5a5a',
  warn: '#000000',
  ok: '#000000',
  strokeScale: 1.35,
};

export function paletteFor(theme: ThemeName): Palette {
  return theme === 'print' ? PRINT : LIGHT;
}

export function figureFont(size: number, weight: 'normal' | 'bold' = 'normal'): string {
  return `${weight === 'bold' ? 'bold ' : ''}${size}px ${FONT_STACK}`;
}

export const TITLE_SIZE = 14;
export const AXIS_LABEL_SIZE = 12;
export const TICK_SIZE = 11;
export const ANNOTATION_SIZE = 10;
