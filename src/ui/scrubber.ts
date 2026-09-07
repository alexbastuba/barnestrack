/**
 * Frame-accurate scrubbing over one video. D24.
 *
 * A native range input carries most of the keyboard behaviour for free
 * (arrow keys ±1, Home/End); this adds Shift for ±10, a frame-number field,
 * and the frame's own timestamp from the sample table — never `frame ÷ fps`
 * (D7).
 */
import { button, el, formatDuration, uniqueId } from './dom.js';

const BIG_STEP = 10;

/**
 * What the scrubber needs from a video: how many frames, and each frame's
 * own timestamp. An `Mp4Index` provides it; so does a track, so the review
 * step can scrub a tracked video whose file is not attached.
 */
export interface FrameTimebase {
  frameCount: number;
  frames: readonly { t_s: number }[];
}

export interface ScrubberOptions {
  onSeek(frameIndex: number): void;
  announce?(message: string): void;
}

export class Scrubber {
  readonly element: HTMLElement;
  /** The frame-number field, so a host can move focus to it (D24: `F`). */
  readonly frameField: HTMLInputElement;

  private readonly range: HTMLInputElement;
  private readonly number: HTMLInputElement;
  private readonly readout: HTMLElement;
  private index: FrameTimebase | null = null;
  private frame = 0;

  constructor(private readonly options: ScrubberOptions) {
    // Ids are unique per instance: the Track step will want a second scrubber,
    // and duplicate ids break every `<label for>` on the page.
    this.range = el('input', { id: uniqueId('frame-scrubber'), class: 'frame-range' });
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = '0';
    this.range.step = '1';
    this.range.value = '0';
    this.range.setAttribute('aria-label', 'Frame');
    this.range.addEventListener('input', () => this.seek(Number(this.range.value), false));
    this.range.addEventListener('keydown', (event) => this.onRangeKeyDown(event));

    this.number = el('input', { id: uniqueId('frame-number'), class: 'frame-number' });
    this.number.type = 'number';
    this.number.min = '0';
    this.number.step = '1';
    this.number.value = '0';
    this.number.addEventListener('change', () => this.seek(Number(this.number.value), true));
    this.frameField = this.number;

    this.readout = el('span', { class: 'frame-readout' });

    this.element = el('div', { class: 'scrubber' }, [
      button('Previous frame', () => this.step(-1), { class: 'step-button' }),
      this.range,
      button('Next frame', () => this.step(1), { class: 'step-button' }),
      el('div', { class: 'field frame-field' }, [
        el('label', { text: 'Frame', attrs: { for: this.number.id } }),
        this.number,
      ]),
      this.readout,
    ]);
  }

  get frameIndex(): number {
    return this.frame;
  }

  /** Points the scrubber at a video, keeping the frame if it still exists. */
  setIndex(index: FrameTimebase | null): void {
    this.index = index;
    const last = index === null ? 0 : index.frameCount - 1;
    this.range.max = String(last);
    this.number.max = String(last);
    this.range.disabled = index === null;
    this.number.disabled = index === null;
    this.seek(Math.min(this.frame, last), false);
  }

  step(delta: number): void {
    this.seek(this.frame + delta, true);
  }

  seek(frameIndex: number, announce: boolean): void {
    if (this.index === null) {
      this.frame = 0;
      this.readout.textContent = '';
      return;
    }
    const clamped = Math.max(0, Math.min(this.index.frameCount - 1, Math.round(frameIndex)));
    const changed = clamped !== this.frame;
    this.frame = clamped;
    this.range.value = String(clamped);
    if (document.activeElement !== this.number) this.number.value = String(clamped);
    this.readout.textContent = this.describe();
    if (changed || announce) this.options.onSeek(clamped);
    if (announce) this.options.announce?.(this.describe());
  }

  private describe(): string {
    if (this.index === null) return '';
    const entry = this.index.frames[this.frame];
    const seconds = entry?.t_s ?? 0;
    return `Frame ${this.frame} of ${this.index.frameCount - 1} · ${seconds.toFixed(3)} s (${formatDuration(seconds)})`;
  }

  private onRangeKeyDown(event: KeyboardEvent): void {
    if (!event.shiftKey) return;
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? BIG_STEP
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -BIG_STEP
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    this.step(delta);
  }
}
