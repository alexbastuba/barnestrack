// Adapted from talmolab/vibes/event-annotator (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * The review timeline (D24, D25, D26): stacked tracks on one shared frame
 * axis — detection state, nose confidence, events, corrections, trial
 * markers — with a zoom window, an overview strip, and a playhead. Clicking
 * any track seeks; dragging an event's edge retimes it; dragging the
 * trial-start marker moves it. Everything drawn is repeated in the DOM
 * tables of the review step (D37).
 *
 * Borrowed from event-annotator: rows as a pure function of a flat event list,
 * segments and playhead in the same coordinate space, and painting a range
 * with two keystrokes. Re-implemented on a single DPR-aware canvas over frame
 * positions rather than percentages of the clip, with a zoom window, marks
 * never narrower than two pixels, and every distinction carried by a pattern
 * or a word, not a colour.
 */
import { fillHatched } from '../viz/figure.js';
import { button, el, uniqueId } from './dom.js';
import { ACCENT, DANGER, INK, INK_SOFT } from './overlay-draw.js';
import {
  MIN_MARK_PX,
  OVERVIEW_HEIGHT,
  TIMELINE_HEIGHT,
  TRACKS,
  TRACKS_HEIGHT,
  ZOOM_STEP,
  clampWindow,
  ensureVisible,
  frameCentreX,
  frameToX,
  fullWindow,
  markRect,
  panWindow,
  spanRect,
  timeTicks,
  trackAt,
  windowSpan,
  xToFrame,
  zoomWindow,
  type Rect,
  type TimelineWindow,
  type TrackLayout,
} from './timeline-geometry.js';
import { eventAtFrame, stateAtFrame, type EventBar, type TimelineModel } from './timeline-model.js';

export type EventEdge = 'start' | 'end';

export interface TimelineCallbacks {
  onSeek(frame: number): void;
  onSelectEvent(id: string | null): void;
  /** An edge was dragged and released here (the frame is inclusive). */
  onRetime(eventId: string, edge: EventEdge, frame: number): void;
  onTrialStart(frame: number): void;
  onHover?(text: string | null): void;
  announce?(message: string): void;
}

/** How near (px) a pointer must be to an edge or a marker to grab it. */
const GRAB_PX = 6;
const OVERVIEW_TOP = TRACKS_HEIGHT + 4;

type Drag =
  | { kind: 'edge'; pointerId: number; eventId: string; edge: EventEdge; frame: number }
  | { kind: 'trial-start'; pointerId: number; frame: number }
  | { kind: 'overview'; pointerId: number };

const STATE_WORD: Record<string, string> = {
  tracked: 'tracked',
  low_confidence: 'low confidence',
  ambiguous: 'ambiguous',
  not_detected: 'not detected',
};

export class Timeline {
  readonly element: HTMLElement;
  /** The focusable canvas wrapper; the review step listens for keys on its body. */
  readonly surface: HTMLElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly windowRange: HTMLInputElement;
  private readonly zoomReadout: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks: TimelineCallbacks;

  private model: TimelineModel | null = null;
  private window: TimelineWindow = { first: 0, last: 0 };
  private playhead = 0;
  private selectedEventId: string | null = null;
  private selectedEdge: EventEdge | null = null;
  private noseCutoff = 0.5;
  private drag: Drag | null = null;
  private drawScheduled = 0;
  private width = 0;
  private destroyed = false;

  constructor(callbacks: TimelineCallbacks) {
    this.callbacks = callbacks;
    this.canvas = el('canvas', { class: 'timeline-canvas', attrs: { 'aria-hidden': 'true' } });
    this.surface = el(
      'div',
      {
        class: 'timeline-surface',
        attrs: {
          role: 'group',
          tabindex: '0',
          'aria-label':
            'Timeline: detection state, nose confidence, events, corrections and trial markers on one time axis. The tables below repeat everything drawn here.',
        },
      },
      [this.canvas],
    );

    this.windowRange = el('input', { id: uniqueId('timeline-window'), class: 'timeline-window' });
    this.windowRange.type = 'range';
    this.windowRange.min = '0';
    this.windowRange.max = '0';
    this.windowRange.step = '1';
    this.windowRange.addEventListener('input', () => {
      if (!this.model) return;
      const span = windowSpan(this.window);
      const first = Number(this.windowRange.value);
      this.setWindow({ first, last: first + span - 1 });
    });
    this.zoomReadout = el('span', { class: 'zoom-readout' });

    const controls = el('div', { class: 'timeline-controls' }, [
      button('Zoom in', () => this.zoomBy(ZOOM_STEP), { attrs: { 'aria-label': 'Zoom the timeline in' } }),
      button('Zoom out', () => this.zoomBy(1 / ZOOM_STEP), { attrs: { 'aria-label': 'Zoom the timeline out' } }),
      button('Whole clip', () => this.zoomFit()),
      this.zoomReadout,
      el('div', { class: 'field timeline-window-field' }, [
        el('label', { text: 'Window start (frame)', attrs: { for: this.windowRange.id } }),
        this.windowRange,
      ]),
    ]);

    this.element = el('div', { class: 'timeline' }, [this.surface, controls]);

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => this.callbacks.onHover?.(null));
    // Non-passive: the wheel zooms the timeline instead of scrolling the page.
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.surface);
  }

  get currentWindow(): TimelineWindow {
    return this.window;
  }

  get frame(): number {
    return this.playhead;
  }

  setModel(model: TimelineModel | null, noseCutoff: number): void {
    const sameLength = this.model !== null && model !== null && this.model.frameCount === model.frameCount;
    this.model = model;
    this.noseCutoff = noseCutoff;
    if (!model) {
      this.window = { first: 0, last: 0 };
    } else if (!sameLength) {
      this.window = fullWindow(model.frameCount);
    }
    this.syncControls();
    this.requestDraw();
  }

  setPlayhead(frame: number): void {
    this.playhead = frame;
    if (this.model) this.setWindow(ensureVisible(this.window, frame, this.model.frameCount));
    this.requestDraw();
  }

  setSelection(eventId: string | null, edge: EventEdge | null): void {
    this.selectedEventId = eventId;
    this.selectedEdge = eventId === null ? null : edge;
    this.requestDraw();
  }

  zoomBy(factor: number, anchorFrame = this.playhead): void {
    if (!this.model) return;
    this.setWindow(zoomWindow(this.window, factor, anchorFrame, this.model.frameCount));
  }

  zoomFit(): void {
    if (!this.model) return;
    this.setWindow(fullWindow(this.model.frameCount));
  }

  panBy(frames: number): void {
    if (!this.model) return;
    this.setWindow(panWindow(this.window, frames, this.model.frameCount));
  }

  requestDraw(): void {
    if (this.drawScheduled !== 0 || this.destroyed) return;
    this.drawScheduled = requestAnimationFrame(() => {
      this.drawScheduled = 0;
      this.draw();
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.drawScheduled !== 0) cancelAnimationFrame(this.drawScheduled);
    this.resizeObserver.disconnect();
  }

  // ---- window -----------------------------------------------------------------

  private setWindow(window: TimelineWindow): void {
    if (!this.model) return;
    this.window = clampWindow(window, this.model.frameCount);
    this.syncControls();
    this.requestDraw();
  }

  private syncControls(): void {
    const total = this.model?.frameCount ?? 0;
    const span = windowSpan(this.window);
    this.windowRange.max = String(Math.max(0, total - span));
    this.windowRange.value = String(this.window.first);
    this.windowRange.disabled = this.model === null || span >= total;
    this.zoomReadout.textContent =
      total === 0 ? '' : `frames ${this.window.first}–${this.window.last} of ${total} (${(total / Math.max(1, span)).toFixed(1)} ×)`;
  }

  // ---- drawing ----------------------------------------------------------------

  private onResize(): void {
    const rect = this.surface.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    this.width = rect.width;
    const w = Math.round(rect.width * ratio);
    const h = Math.round(TIMELINE_HEIGHT * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${TIMELINE_HEIGHT}px`;
    this.requestDraw();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0) return;
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = this.width;
    ctx.clearRect(0, 0, width, TIMELINE_HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, TIMELINE_HEIGHT);
    const model = this.model;
    if (!model) {
      this.text(ctx, 'No analysis yet.', 6, 4);
      return;
    }
    const w = this.window;
    for (const track of TRACKS) {
      ctx.strokeStyle = '#e3e8ed';
      ctx.beginPath();
      ctx.moveTo(0, track.y + track.height + 1.5);
      ctx.lineTo(width, track.y + track.height + 1.5);
      ctx.stroke();
    }
    this.drawAxis(ctx, model, w, width, TRACKS[0]!);
    this.drawStates(ctx, model, w, width, TRACKS[1]!);
    this.drawNose(ctx, model, w, width, TRACKS[2]!);
    this.drawEvents(ctx, model, w, width, TRACKS[3]!);
    this.drawCorrections(ctx, model, w, width, TRACKS[4]!);
    this.drawMarkers(ctx, model, w, width);
    this.drawOverview(ctx, model, width);
    this.drawPlayhead(ctx, w, width);
  }

  private text(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, strong = false, colour = INK): void {
    ctx.font = `${strong ? '600 ' : ''}11px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  private fits(ctx: CanvasRenderingContext2D, text: string, width: number): boolean {
    ctx.font = '11px system-ui, sans-serif';
    return ctx.measureText(text).width + 6 <= width;
  }

  private drawAxis(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number, track: TrackLayout): void {
    for (const tick of timeTicks(model.frameTimes, w, width)) {
      ctx.strokeStyle = INK_SOFT;
      ctx.beginPath();
      ctx.moveTo(tick.x + 0.5, track.y + 12);
      ctx.lineTo(tick.x + 0.5, track.y + track.height);
      ctx.stroke();
      this.text(ctx, tick.label, tick.x + 3, track.y, false, INK_SOFT);
    }
    for (const flag of model.flagged) {
      const rect = markRect(flag.frame, w, width, track.y + 6, track.height - 6);
      if (!rect) continue;
      ctx.fillStyle = DANGER;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (this.fits(ctx, '! review', 40)) this.text(ctx, '!', rect.x + rect.width + 1, track.y + 4, true, DANGER);
    }
  }

  private drawStates(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number, track: TrackLayout): void {
    for (const run of model.stateRuns) {
      const rect = spanRect(run.startFrame, run.endFrame, w, width, track.y, track.height);
      if (!rect) continue;
      this.paintState(ctx, run.state, rect);
      const word = STATE_WORD[run.state] ?? run.state;
      if (this.fits(ctx, word, rect.width)) {
        this.text(ctx, word, rect.x + 3, rect.y + 3, false, run.state === 'not_detected' ? '#ffffff' : INK);
      }
    }
  }

  /** Pattern per state, matching the quality strip: plain, hatched, dense, solid. */
  private paintState(ctx: CanvasRenderingContext2D, state: string, rect: Rect): void {
    switch (state) {
      case 'tracked':
        ctx.fillStyle = '#e7f0f9';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        break;
      case 'low_confidence':
        ctx.fillStyle = '#f4f6f8';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        fillHatched(ctx, rect, INK_SOFT, 5);
        break;
      case 'ambiguous':
        ctx.fillStyle = '#c3cad2';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        fillHatched(ctx, rect, INK, 3);
        break;
      default:
        ctx.fillStyle = INK;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  private drawNose(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number, track: TrackLayout): void {
    // one bar per pixel column: the highest confidence of the frames in it; a corrected nose is a diamond
    const span = windowSpan(w);
    const columns = Math.max(1, Math.floor(width));
    const perColumn = span / columns;
    const bottom = track.y + track.height;
    ctx.fillStyle = INK_SOFT;
    for (let c = 0; c < columns; c++) {
      const f0 = Math.floor(w.first + c * perColumn);
      const f1 = Math.min(w.last, Math.floor(w.first + (c + 1) * perColumn));
      let best = Number.NaN;
      for (let f = f0; f <= f1; f++) {
        const v = model.noseConfidence[f]!;
        if (Number.isNaN(v)) continue;
        if (Number.isNaN(best) || v > best) best = v;
      }
      if (Number.isNaN(best)) continue;
      const h = Math.max(1, best * (track.height - 4));
      ctx.fillRect(c, bottom - h, Math.max(1, width / columns), h);
    }
    // the cutoff (O16): dashed line with its value
    const cutY = bottom - this.noseCutoff * (track.height - 4);
    ctx.strokeStyle = DANGER;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, cutY + 0.5);
    ctx.lineTo(width, cutY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    this.text(ctx, `nose confidence · cutoff ${this.noseCutoff}`, 3, track.y + 1, false, INK_SOFT);
    for (let f = w.first; f <= w.last; f++) {
      if (model.noseCorrected[f] !== 1) continue;
      const rect = markRect(f, w, width, track.y + 2, 8);
      if (!rect) continue;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      const cx = rect.x + rect.width / 2;
      ctx.beginPath();
      ctx.moveTo(cx, rect.y);
      ctx.lineTo(cx + 4, rect.y + 4);
      ctx.lineTo(cx, rect.y + 8);
      ctx.lineTo(cx - 4, rect.y + 4);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  private drawEvents(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number, track: TrackLayout): void {
    for (const ev of model.events) {
      const rect = spanRect(ev.startFrame, ev.endFrame, w, width, track.y + 3, track.height - 6);
      if (!rect) continue;
      const selected = ev.id === this.selectedEventId;
      // fill: investigations light, the target's investigation with a double border, the entry dark,
      // a failure dashed and empty; a corrected event hatched with a "user" tag
      if (ev.kind === 'escape_entry') {
        ctx.fillStyle = INK_SOFT;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      } else if (ev.kind === 'investigation') {
        ctx.fillStyle = ev.isTarget ? '#f9e3e0' : '#e7f0f9';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      if (ev.corrected) fillHatched(ctx, rect, ACCENT, 4);
      ctx.strokeStyle = ev.kind === 'escape_entry' || ev.isTarget ? DANGER : ACCENT;
      ctx.lineWidth = selected ? 3 : ev.isTarget ? 2 : 1;
      ctx.setLineDash(ev.kind === 'tracking_failure' ? [3, 2] : []);
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), rect.height - 1);
      ctx.setLineDash([]);
      if (ev.isTarget && ev.kind === 'investigation') {
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 3.5, rect.y + 3.5, Math.max(1, rect.width - 7), Math.max(1, rect.height - 7));
      }
      ctx.lineWidth = 1;
      const label = `${ev.unlikely ? '! ' : ''}${ev.label}${ev.corrected ? ' user' : ''}`;
      const short = ev.corrected ? `${ev.label}·u` : ev.label;
      const colour = ev.kind === 'escape_entry' ? '#ffffff' : INK;
      if (this.fits(ctx, label, rect.width)) this.text(ctx, label, rect.x + 3, rect.y + 6, true, colour);
      else if (this.fits(ctx, short, rect.width)) this.text(ctx, short, rect.x + 3, rect.y + 6, true, colour);
      if (selected && this.selectedEdge) {
        const x = this.selectedEdge === 'start' ? rect.x : rect.x + rect.width;
        ctx.fillStyle = ACCENT;
        ctx.fillRect(x - 1.5, rect.y - 2, 3, rect.height + 4);
      }
    }
    // a live drag preview
    if (this.drag?.kind === 'edge') {
      const x = frameToX(this.drag.frame + (this.drag.edge === 'end' ? 1 : 0), w, width);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, track.y);
      ctx.lineTo(x, track.y + track.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }

  private drawCorrections(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number, track: TrackLayout): void {
    this.text(ctx, 'corrections', 3, track.y + 1, false, INK_SOFT);
    for (const mark of model.corrections) {
      const rect = spanRect(mark.startFrame, mark.endFrame, w, width, track.y + 2, track.height - 4);
      if (!rect) continue;
      ctx.fillStyle = ACCENT;
      ctx.strokeStyle = ACCENT;
      switch (mark.kind) {
        case 'point': {
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          ctx.beginPath();
          ctx.moveTo(cx, rect.y);
          ctx.lineTo(cx + 4, cy);
          ctx.lineTo(cx, rect.y + rect.height);
          ctx.lineTo(cx - 4, cy);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'range':
          ctx.fillStyle = '#e7f0f9';
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          fillHatched(ctx, rect, ACCENT, 4);
          ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(1, rect.width - 1), rect.height - 1);
          break;
        case 'event':
          ctx.fillRect(rect.x, rect.y, Math.max(MIN_MARK_PX, 2), rect.height);
          ctx.fillRect(rect.x + rect.width - 2, rect.y, 2, rect.height);
          ctx.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2);
          break;
        case 'trial_start':
          ctx.beginPath();
          ctx.moveTo(rect.x, rect.y);
          ctx.lineTo(rect.x + 7, rect.y + rect.height / 2);
          ctx.lineTo(rect.x, rect.y + rect.height);
          ctx.closePath();
          ctx.fill();
          break;
        case 'strategy_override':
          ctx.fillRect(rect.x, rect.y, Math.max(rect.width, MIN_MARK_PX), rect.height);
          this.text(ctx, 'S', rect.x + Math.max(rect.width, MIN_MARK_PX) + 2, rect.y - 1, true, ACCENT);
          break;
      }
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, model: TimelineModel, w: TimelineWindow, width: number): void {
    const line = (frame: number, label: string, colour: string, dashed: boolean, labelAtBottom: boolean): void => {
      if (frame < w.first || frame > w.last + 1) return;
      const x = Math.round(frameToX(frame, w, width)) + 0.5;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x, TRACKS[0]!.y + 12);
      ctx.lineTo(x, TRACKS_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      const y = labelAtBottom ? TRACKS_HEIGHT - 13 : TRACKS[1]!.y + 2;
      ctx.font = '600 11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const lx = x + tw + 6 > width ? x - tw - 6 : x + 3;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(lx - 2, y - 1, tw + 4, 13);
      this.text(ctx, label, lx, y, true, colour);
    };
    if (model.trialStart !== null) {
      line(model.trialStart, 'trial start', DANGER, false, false);
      // the start marker is grabbable: a small flag on the axis
      const x = frameToX(model.trialStart, w, width);
      ctx.fillStyle = DANGER;
      ctx.beginPath();
      ctx.moveTo(x, TRACKS[0]!.y + 12);
      ctx.lineTo(x + 8, TRACKS[0]!.y + 15);
      ctx.lineTo(x, TRACKS[0]!.y + 18);
      ctx.closePath();
      ctx.fill();
    }
    if (model.trialEnd !== null) {
      const reason =
        model.endReason === 'escape'
          ? 'end · escape'
          : model.endReason === 'cutoff'
            ? 'end · cutoff'
            : 'end · end of video';
      line(model.trialEnd + 1, reason, INK_SOFT, true, true);
    }
    if (this.drag?.kind === 'trial-start') line(this.drag.frame, 'trial start →', DANGER, true, false);
  }

  private drawOverview(ctx: CanvasRenderingContext2D, model: TimelineModel, width: number): void {
    const full = fullWindow(model.frameCount);
    const y = OVERVIEW_TOP;
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, y, width, OVERVIEW_HEIGHT);
    for (const run of model.stateRuns) {
      if (run.state === 'tracked') continue;
      const rect = spanRect(run.startFrame, run.endFrame, full, width, y + 3, OVERVIEW_HEIGHT - 6);
      if (rect) this.paintState(ctx, run.state, rect);
    }
    for (const ev of model.events) {
      const rect = spanRect(ev.startFrame, ev.endFrame, full, width, y + 1, 2);
      if (!rect) continue;
      ctx.fillStyle = ev.isTarget || ev.kind === 'escape_entry' ? DANGER : ACCENT;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    const win = spanRect(this.window.first, this.window.last, full, width, y, OVERVIEW_HEIGHT)!;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(win.x + 0.75, win.y + 0.75, Math.max(2, win.width - 1.5), win.height - 1.5);
    ctx.lineWidth = 1;
    const px = frameCentreX(this.playhead, full, width);
    ctx.fillStyle = DANGER;
    ctx.fillRect(px - 1, y, 2, OVERVIEW_HEIGHT);
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, w: TimelineWindow, width: number): void {
    if (this.playhead < w.first || this.playhead > w.last) return;
    const x = Math.round(frameCentreX(this.playhead, w, width)) + 0.5;
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TRACKS_HEIGHT);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = DANGER;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 7);
    ctx.closePath();
    ctx.fill();
  }

  // ---- pointer ------------------------------------------------------------------

  private localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private edgeUnder(x: number, y: number): { ev: EventBar; edge: EventEdge } | null {
    const model = this.model;
    const track = trackAt(y);
    if (!model || track?.id !== 'events') return null;
    let best: { ev: EventBar; edge: EventEdge; d: number } | null = null;
    for (const ev of model.events) {
      const rect = spanRect(ev.startFrame, ev.endFrame, this.window, this.width, 0, 1);
      if (!rect) continue;
      for (const [edge, ex] of [
        ['start', rect.x],
        ['end', rect.x + rect.width],
      ] as const) {
        const d = Math.abs(x - ex);
        if (d <= GRAB_PX && (best === null || d < best.d)) best = { ev, edge, d };
      }
    }
    return best ? { ev: best.ev, edge: best.edge } : null;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.model) return;
    const { x, y } = this.localPoint(event);
    this.surface.focus({ preventScroll: true });
    if (y >= OVERVIEW_TOP) {
      this.drag = { kind: 'overview', pointerId: event.pointerId };
      this.canvas.setPointerCapture(event.pointerId);
      this.scrollOverviewTo(x);
      return;
    }
    const frame = xToFrame(x, this.window, this.width);
    const track = trackAt(y);
    if (track?.id === 'axis' && this.model.trialStart !== null) {
      const sx = frameToX(this.model.trialStart, this.window, this.width);
      if (Math.abs(x - sx) <= GRAB_PX + 2) {
        this.drag = { kind: 'trial-start', pointerId: event.pointerId, frame: this.model.trialStart };
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    const edge = this.edgeUnder(x, y);
    if (edge) {
      this.drag = { kind: 'edge', pointerId: event.pointerId, eventId: edge.ev.id, edge: edge.edge, frame: edge.edge === 'start' ? edge.ev.startFrame : edge.ev.endFrame };
      this.canvas.setPointerCapture(event.pointerId);
      this.callbacks.onSelectEvent(edge.ev.id);
      this.requestDraw();
      return;
    }
    if (track?.id === 'events') {
      const ev = eventAtFrame(this.model.events, frame);
      this.callbacks.onSelectEvent(ev?.id ?? null);
    }
    this.callbacks.onSeek(frame);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.model) return;
    const { x, y } = this.localPoint(event);
    if (this.drag && this.drag.pointerId === event.pointerId) {
      if (this.drag.kind === 'overview') {
        this.scrollOverviewTo(x);
        return;
      }
      this.drag.frame = xToFrame(x, this.window, this.width);
      this.callbacks.onHover?.(
        this.drag.kind === 'edge'
          ? `${this.drag.edge} edge → frame ${this.drag.frame}; release to apply`
          : `trial start → frame ${this.drag.frame}; release to apply`,
      );
      this.requestDraw();
      return;
    }
    if (y >= OVERVIEW_TOP) {
      this.callbacks.onHover?.('Overview of the whole clip: click or drag to move the window.');
      return;
    }
    const frame = xToFrame(x, this.window, this.width);
    const t = this.model.frameTimes[frame] ?? 0;
    const state = stateAtFrame(this.model.stateRuns, frame);
    const ev = eventAtFrame(this.model.events, frame);
    const edge = this.edgeUnder(x, y);
    const parts = [`frame ${frame} · ${t.toFixed(3)} s`];
    if (state) parts.push(STATE_WORD[state.state] ?? state.state);
    if (ev) parts.push(`${ev.kind === 'investigation' ? 'investigation' : ev.kind === 'escape_entry' ? 'escape entry' : 'tracking failure'} ${ev.label}${ev.corrected ? ' (user)' : ''}`);
    if (edge) parts.push(`drag to move the ${edge.edge} edge`);
    this.callbacks.onHover?.(parts.join(' · '));
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (drag.kind === 'edge') this.callbacks.onRetime(drag.eventId, drag.edge, drag.frame);
    else if (drag.kind === 'trial-start') this.callbacks.onTrialStart(drag.frame);
    this.requestDraw();
  }

  private scrollOverviewTo(x: number): void {
    if (!this.model) return;
    const span = windowSpan(this.window);
    const centre = xToFrame(x, fullWindow(this.model.frameCount), this.width);
    this.setWindow({ first: centre - Math.floor(span / 2), last: centre - Math.floor(span / 2) + span - 1 });
  }

  private onWheel(event: WheelEvent): void {
    if (!this.model) return;
    event.preventDefault();
    const { x } = this.localPoint(event);
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      this.panBy(Math.sign(delta) * Math.max(1, Math.round(windowSpan(this.window) / 10)));
      return;
    }
    const anchor = xToFrame(x, this.window, this.width);
    this.zoomBy(event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP, anchor);
  }
}
