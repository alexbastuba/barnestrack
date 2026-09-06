/**
 * Contact sheet of tracked frames: tiles at one third scale with the frame's
 * overlay (bbox, centroid disc, nose square, body axis, tail direction), a
 * border whose pattern encodes the detection state (solid = tracked, dashed =
 * low_confidence, double = ambiguous, cross-hatched corner = not_detected)
 * and a 3×5 bitmap-font label with the frame number and the state's first
 * letter. Colour is additional to the pattern, never the only carrier.
 * Written as an 8-bit indexed PNG: a 240-level gray ramp plus overlay colours.
 */
import type { TrackFrame } from '../../src/contracts/track.js';
import type { BodyAxis } from '../../src/analysis/tracker/tracker.js';
import { encodePng } from './png.js';

export const TILE_WIDTH = 213;
export const TILE_HEIGHT = 160;
export const TILE_SCALE = 3;
const COLUMNS = 6;
const GAP = 3;
const LEGEND_HEIGHT = 18;

const GRAY_LEVELS = 240;
const COLOR = {
  red: 240,
  green: 241,
  cyan: 242,
  yellow: 243,
  magenta: 244,
  black: 245,
  white: 246,
  orange: 247,
  sheet: 248,
} as const;

export function contactPalette(): Uint8Array {
  const palette = new Uint8Array(3 * 256);
  for (let i = 0; i < GRAY_LEVELS; i++) {
    const g = Math.round((i * 255) / (GRAY_LEVELS - 1));
    palette[3 * i] = g;
    palette[3 * i + 1] = g;
    palette[3 * i + 2] = g;
  }
  const set = (index: number, r: number, g: number, b: number) => {
    palette[3 * index] = r;
    palette[3 * index + 1] = g;
    palette[3 * index + 2] = b;
  };
  set(COLOR.red, 230, 40, 40);
  set(COLOR.green, 40, 210, 70);
  set(COLOR.cyan, 40, 210, 230);
  set(COLOR.yellow, 245, 225, 40);
  set(COLOR.magenta, 230, 60, 210);
  set(COLOR.black, 0, 0, 0);
  set(COLOR.white, 255, 255, 255);
  set(COLOR.orange, 245, 140, 30);
  set(COLOR.sheet, 24, 24, 28);
  return palette;
}

export function grayIndex(gray: number): number {
  return Math.round((gray * (GRAY_LEVELS - 1)) / 255);
}

/** Row-major 8-bit indexed canvas with the drawing primitives the sheet needs. */
export class IndexedCanvas {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    fill: number = COLOR.sheet,
  ) {
    this.pixels = new Uint8Array(width * height).fill(fill);
  }

  set(x: number, y: number, color: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color;
  }

  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    pattern?: { on: number; off: number },
  ): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let step = 0;
    for (;;) {
      const period = pattern ? pattern.on + pattern.off : 1;
      if (!pattern || step % period < pattern.on) this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
      step++;
    }
  }

  rect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    pattern?: { on: number; off: number },
  ): void {
    this.line(x0, y0, x1, y0, color, pattern);
    this.line(x1, y0, x1, y1, color, pattern);
    this.line(x1, y1, x0, y1, color, pattern);
    this.line(x0, y1, x0, y0, color, pattern);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, color: number): void {
    for (let y = Math.round(y0); y <= Math.round(y1); y++)
      for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, color);
  }

  fillCircle(cx: number, cy: number, r: number, color: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.set(x, y, color);
      }
    }
  }

  /** 3×5 bitmap text; `scale` multiplies the glyph size. Returns the width drawn. */
  text(x: number, y: number, s: string, color: number, scale = 1): number {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT['?']!;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row]![col] !== '#') continue;
          this.fillRect(
            cx + col * scale,
            y + row * scale,
            cx + (col + 1) * scale - 1,
            y + (row + 1) * scale - 1,
            color,
          );
        }
      }
      cx += 4 * scale;
    }
    return cx - x;
  }
}

const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '###', '#..', '###'],
  F: ['###', '#..', '###', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['###', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '=': ['...', '###', '...', '###', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  _: ['...', '...', '...', '...', '###'],
  '[': ['##.', '#..', '#..', '#..', '##.'],
  ']': ['.##', '..#', '..#', '..#', '.##'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  ' ': ['...', '...', '...', '...', '...'],
};

export interface ContactTile {
  /** Full-resolution gray plane of the frame. */
  gray: Uint8Array;
  frame: TrackFrame;
  axis: BodyAxis | null;
  /** Extra tag shown after the state letter (e.g. `+` for an extra frame). */
  tag?: string;
}

const STATE_LETTER: Record<TrackFrame['detectionState'], string> = {
  tracked: 'T',
  low_confidence: 'L',
  ambiguous: 'A',
  not_detected: 'N',
};

const STATE_COLOR: Record<TrackFrame['detectionState'], number> = {
  tracked: COLOR.green,
  low_confidence: COLOR.yellow,
  ambiguous: COLOR.orange,
  not_detected: COLOR.red,
};

function drawTile(
  canvas: IndexedCanvas,
  ox: number,
  oy: number,
  tile: ContactTile,
  width: number,
  height: number,
): void {
  const s = TILE_SCALE;
  for (let ty = 0; ty < TILE_HEIGHT; ty++) {
    for (let tx = 0; tx < TILE_WIDTH; tx++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < s; dy++) {
        const y = ty * s + dy;
        if (y >= height) continue;
        for (let dx = 0; dx < s; dx++) {
          const x = tx * s + dx;
          if (x >= width) continue;
          sum += tile.gray[y * width + x]!;
          n++;
        }
      }
      canvas.set(ox + tx, oy + ty, grayIndex(n > 0 ? sum / n : 0));
    }
  }
  const f = tile.frame;
  const X = (x: number) => ox + x / s;
  const Y = (y: number) => oy + y / s;
  if (f.boundingBox) {
    const b = f.boundingBox;
    canvas.rect(X(b.x), Y(b.y), X(b.x + b.width), Y(b.y + b.height), COLOR.yellow);
  }
  if (tile.axis) {
    const a = tile.axis;
    canvas.line(X(a.ax), Y(a.ay), X(a.bx), Y(a.by), COLOR.cyan);
    if (a.tail) {
      const len = 12;
      canvas.line(
        X(f.centroid.x),
        Y(f.centroid.y),
        X(f.centroid.x) + a.tail.dx * len,
        Y(f.centroid.y) + a.tail.dy * len,
        COLOR.magenta,
      );
    }
  }
  if (f.centroid.valid) {
    canvas.fillCircle(X(f.centroid.x), Y(f.centroid.y), 3.2, COLOR.black);
    canvas.fillCircle(X(f.centroid.x), Y(f.centroid.y), 2.2, COLOR.green);
  }
  if (f.nose.valid) {
    const nx = X(f.nose.x);
    const ny = Y(f.nose.y);
    canvas.fillRect(nx - 3, ny - 3, nx + 3, ny + 3, COLOR.black);
    if (f.noseHeadingConfidence >= 1) canvas.fillRect(nx - 2, ny - 2, nx + 2, ny + 2, COLOR.red);
    else canvas.rect(nx - 2, ny - 2, nx + 2, ny + 2, COLOR.red);
  }

  // Border pattern by state.
  const color = STATE_COLOR[f.detectionState];
  const x0 = ox;
  const y0 = oy;
  const x1 = ox + TILE_WIDTH - 1;
  const y1 = oy + TILE_HEIGHT - 1;
  switch (f.detectionState) {
    case 'tracked':
      canvas.rect(x0, y0, x1, y1, color);
      canvas.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, color);
      break;
    case 'low_confidence':
      canvas.rect(x0, y0, x1, y1, color, { on: 6, off: 4 });
      canvas.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, color, { on: 6, off: 4 });
      break;
    case 'ambiguous':
      canvas.rect(x0, y0, x1, y1, color);
      canvas.rect(x0 + 3, y0 + 3, x1 - 3, y1 - 3, color);
      break;
    case 'not_detected': {
      canvas.rect(x0, y0, x1, y1, color);
      const size = 30;
      for (let k = 0; k <= size; k += 3) {
        canvas.line(x1 - size + k, y0, x1, y0 + size - k, color);
      }
      break;
    }
  }

  // Label: frame number and state letter on a dark box.
  const label = `${f.frameIndex} ${STATE_LETTER[f.detectionState]}${tile.tag ?? ''}`;
  const scale = 2;
  const w = label.length * 4 * scale;
  canvas.fillRect(ox + 3, oy + 3, ox + 3 + w + 2, oy + 3 + 5 * scale + 3, COLOR.black);
  canvas.text(ox + 5, oy + 5, label, COLOR.white, scale);
}

export interface ContactSheet {
  png: Uint8Array;
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export function renderContactSheet(
  tiles: readonly ContactTile[],
  frameWidth: number,
  frameHeight: number,
  title: string,
): ContactSheet {
  const rows = Math.ceil(tiles.length / COLUMNS);
  const width = GAP + COLUMNS * (TILE_WIDTH + GAP);
  const titleHeight = 16;
  const height = titleHeight + GAP + rows * (TILE_HEIGHT + GAP) + LEGEND_HEIGHT;
  const canvas = new IndexedCanvas(width, height);
  canvas.text(GAP + 2, 3, title, COLOR.white, 2);
  tiles.forEach((tile, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    drawTile(
      canvas,
      GAP + col * (TILE_WIDTH + GAP),
      titleHeight + GAP + row * (TILE_HEIGHT + GAP),
      tile,
      frameWidth,
      frameHeight,
    );
  });
  const ly = height - LEGEND_HEIGHT + 4;
  let lx = GAP + 2;
  lx +=
    canvas.text(
      lx,
      ly,
      'BORDER: SOLID=TRACKED  DASHED=LOW CONFIDENCE  DOUBLE=AMBIGUOUS  HATCHED CORNER=NOT DETECTED',
      COLOR.white,
      2,
    ) + 16;
  lx += canvas.text(lx, ly, 'OVERLAY: ', COLOR.white, 2);
  canvas.fillCircle(lx + 4, ly + 5, 3, COLOR.green);
  lx += canvas.text(lx + 10, ly, 'CENTROID ', COLOR.white, 2) + 12;
  canvas.fillRect(lx, ly + 2, lx + 5, ly + 7, COLOR.red);
  lx += canvas.text(lx + 9, ly, 'NOSE (HOLLOW=ONE CUE) ', COLOR.white, 2) + 12;
  canvas.line(lx, ly + 5, lx + 10, ly + 5, COLOR.cyan);
  lx += canvas.text(lx + 13, ly, 'BODY AXIS ', COLOR.white, 2) + 12;
  canvas.line(lx, ly + 5, lx + 10, ly + 5, COLOR.magenta);
  lx += canvas.text(lx + 13, ly, 'TAIL DIRECTION ', COLOR.white, 2) + 12;
  canvas.rect(lx, ly + 1, lx + 9, ly + 9, COLOR.yellow);
  canvas.text(lx + 13, ly, 'BBOX', COLOR.white, 2);
  return {
    png: encodePng(width, height, canvas.pixels, { type: 'indexed', palette: contactPalette() }),
    width,
    height,
    columns: COLUMNS,
    rows,
  };
}
