/**
 * A recording stand-in for a 2D canvas context.
 *
 * `src/viz/` is DOM-free but not canvas-free, and Node has no canvas at all, so
 * the figures are exercised against this: every call is recorded, every piece of
 * text is kept, and the drawing state is stacked the way `save`/`restore` do.
 * It implements exactly the subset of the 2D API the figures are allowed to use
 * — no gradients, no patterns, no image data — so a figure reaching for anything
 * else fails here instead of silently working only in a browser.
 */

export interface RecordedCall {
  name: string;
  args: unknown[];
}

interface DrawingState {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineDash: number[];
}

export interface RecordedText {
  text: string;
  x: number;
  y: number;
  fillStyle: string;
  font: string;
}

const INITIAL: DrawingState = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  globalAlpha: 1,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  lineDash: [],
};

/** Roughly the width of a system-font glyph at 10 px; enough for wrapping. */
const CHARACTER_WIDTH = 5.6;

export class RecordingContext {
  readonly calls: RecordedCall[] = [];
  readonly texts: RecordedText[] = [];
  /** Grows on `save` and shrinks on `restore`; a mismatch leaves it non-zero. */
  saveDepth = 0;

  fillStyle = INITIAL.fillStyle;
  strokeStyle = INITIAL.strokeStyle;
  lineWidth = INITIAL.lineWidth;
  globalAlpha = INITIAL.globalAlpha;
  font = INITIAL.font;
  textAlign = INITIAL.textAlign;
  textBaseline = INITIAL.textBaseline;
  lineCap = 'butt';
  lineJoin = 'miter';

  private readonly stack: DrawingState[] = [];
  private lineDash: number[] = [];

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      lineDash: this.lineDash,
    });
    this.saveDepth++;
    this.record('save');
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) {
      Object.assign(this, previous);
      this.lineDash = previous.lineDash;
    }
    this.saveDepth--;
    this.record('restore');
  }

  scale(x: number, y: number): void {
    this.record('scale', x, y);
  }
  translate(x: number, y: number): void {
    this.record('translate', x, y);
  }
  rotate(angle: number): void {
    this.record('rotate', angle);
  }
  setLineDash(segments: number[]): void {
    this.lineDash = segments;
    this.record('setLineDash', segments);
  }
  getLineDash(): number[] {
    return this.lineDash;
  }

  beginPath(): void {
    this.record('beginPath');
  }
  closePath(): void {
    this.record('closePath');
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y);
  }
  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.record('arc', x, y, r, start, end);
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.record('rect', x, y, width, height);
  }
  clip(): void {
    this.record('clip');
  }
  fill(): void {
    this.record('fill', this.fillStyle);
  }
  stroke(): void {
    this.record('stroke', this.strokeStyle, this.lineWidth);
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', x, y, width, height, this.fillStyle);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.record('strokeRect', x, y, width, height, this.strokeStyle);
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.record('clearRect', x, y, width, height);
  }
  drawImage(...args: unknown[]): void {
    this.record('drawImage', ...args);
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, fillStyle: this.fillStyle, font: this.font });
    this.record('fillText', text, x, y);
  }
  strokeText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, fillStyle: this.strokeStyle, font: this.font });
    this.record('strokeText', text, x, y);
  }
  measureText(text: string): { width: number } {
    const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '10');
    return { width: (text.length * CHARACTER_WIDTH * size) / 10 };
  }

  /** Every string this figure drew, in the order it drew them. */
  get textContent(): string[] {
    return this.texts.map((entry) => entry.text);
  }

  /** All the drawn text as one string, for a substring assertion. */
  get joinedText(): string {
    return this.textContent.join('\n');
  }

  callsNamed(name: string): RecordedCall[] {
    return this.calls.filter((call) => call.name === name);
  }
}

/** A recording context typed as the real thing, for passing to a draw function. */
export function fakeContext(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D;
}
