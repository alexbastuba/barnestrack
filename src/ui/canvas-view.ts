// Adapted from talmolab/vibes/labelroi (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * Two-layer canvas: a frame layer at the video's native pixel size carrying the
 * CSS zoom/pan transform, and an untransformed overlay covering the viewport.
 * D15, D38.
 *
 * Borrowed from labelroi: the two-layer arrangement itself, storing annotation
 * coordinates in native video pixels so a resize needs no data migration, an
 * overlay that is never transformed (so stroke widths and labels stay constant
 * in screen pixels at any zoom), and the device-pixel-ratio backing store.
 *
 * Re-implemented rather than transliterated, because the reference derives its
 * two mapping directions differently — screen→video from the transformed
 * element's bounding rect, video→overlay by re-deriving the matrix in JS — and
 * they agree only while a `margin: auto` offset happens to match. Here both
 * directions come from one `ViewTransform` (`src/maze/view-transform.ts`), the
 * transform origin is the top-left corner rather than the centre, the
 * cursor-anchored zoom uses the fixed-point formula that also holds when the
 * view is panned, panning uses pointer capture instead of cancelling on
 * `mouseleave`, keyboard and button zoom go through one path, and redraws are
 * coalesced into an animation frame.
 */
import {
  backingStoreSize,
  fitView,
  IDENTITY_VIEW,
  panBy,
  screenToVideo,
  zoomAt,
  type ViewTransform,
} from '../maze/view-transform.js';
import type { Point } from '../maze/types.js';
import { button, el } from './dom.js';

/** Painter for the overlay. Coordinates are viewport CSS pixels. */
export type OverlayPainter = (ctx: CanvasRenderingContext2D, view: ViewTransform) => void;

export interface CanvasViewOptions {
  /** Names the image for assistive technology; the DOM mirror carries the detail (D37). */
  label: string;
  paint: OverlayPainter;
  onPick?: (videoPoint: Point, event: PointerEvent) => void;
  onHover?: (videoPoint: Point | null) => void;
  announce?: (message: string) => void;
}

const WHEEL_ZOOM_STEP = 1.1;
const BUTTON_ZOOM_STEP = 1.25;
const KEYBOARD_PAN_PX = 40;

export class CanvasView {
  readonly element: HTMLElement;
  readonly viewport: HTMLElement;

  private readonly frame: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly zoomReadout: HTMLElement;
  private readonly options: CanvasViewOptions;
  private readonly resizeObserver: ResizeObserver;

  private view: ViewTransform = IDENTITY_VIEW;
  private videoWidth = 0;
  private videoHeight = 0;
  private drawScheduled = 0;
  private panning: { pointerId: number; lastX: number; lastY: number } | null = null;
  private destroyed = false;
  private everSized = false;
  /** True once the user has zoomed or panned; until then the view follows the viewport. */
  private userAdjusted = false;

  constructor(options: CanvasViewOptions) {
    this.options = options;

    this.frame = el('canvas', { class: 'frame-layer', attrs: { 'aria-hidden': 'true' } });
    this.overlay = el('canvas', { class: 'overlay-layer', attrs: { 'aria-hidden': 'true' } });
    this.viewport = el('div', {
      class: 'viewport',
      attrs: { role: 'group', 'aria-label': options.label, tabindex: '0' },
    }, [this.frame, this.overlay]);

    this.zoomReadout = el('span', { class: 'zoom-readout', text: '100 %' });
    const controls = el('div', { class: 'view-controls' }, [
      button('Zoom in', () => this.zoomByStep(BUTTON_ZOOM_STEP), { attrs: { 'aria-label': 'Zoom in' } }),
      button('Zoom out', () => this.zoomByStep(1 / BUTTON_ZOOM_STEP), { attrs: { 'aria-label': 'Zoom out' } }),
      button('Fit', () => this.fit()),
      this.zoomReadout,
      el('span', {
        class: 'hint',
        text: 'Scroll to zoom, Shift-drag to pan. From the keyboard: + and − zoom, 0 fits, Alt with the arrow keys pans.',
      }),
    ]);

    this.element = el('div', { class: 'canvas-view' }, [this.viewport, controls]);

    this.overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.overlay.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.overlay.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.overlay.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    this.overlay.addEventListener('pointerleave', () => this.options.onHover?.(null));
    // Explicitly non-passive: this listener calls preventDefault to stop the page scrolling.
    this.overlay.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.viewport.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.viewport);
  }

  get currentView(): ViewTransform {
    return this.view;
  }

  get videoSize(): { width: number; height: number } {
    return { width: this.videoWidth, height: this.videoHeight };
  }

  setVideoSize(width: number, height: number): void {
    if (this.videoWidth === width && this.videoHeight === height) return;
    this.everSized = this.everSized && this.viewport.getBoundingClientRect().width > 0;
    this.videoWidth = width;
    this.videoHeight = height;
    this.frame.width = width;
    this.frame.height = height;
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;
    this.fit();
  }

  /** Draws a decoded frame. The bitmap belongs to the frame source; it is only read here. */
  setFrame(bitmap: ImageBitmap | null): void {
    const ctx = this.frame.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.frame.width, this.frame.height);
    if (bitmap) ctx.drawImage(bitmap, 0, 0);
    this.requestDraw();
  }

  fit(): void {
    const rect = this.viewport.getBoundingClientRect();
    this.userAdjusted = false;
    this.applyView(
      fitView({ width: this.videoWidth, height: this.videoHeight }, { width: rect.width, height: rect.height }),
    );
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

  // ---- internals ------------------------------------------------------------

  /** The one place the view changes: the CSS transform and the overlay never disagree. */
  private applyView(view: ViewTransform): void {
    this.view = view;
    this.frame.style.transformOrigin = '0 0';
    this.frame.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    this.zoomReadout.textContent = `${Math.round(view.zoom * 100)} %`;
    this.requestDraw();
  }

  private zoomByStep(factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    this.userAdjusted = true;
    this.applyView(zoomAt(this.view, { x: rect.width / 2, y: rect.height / 2 }, factor));
  }

  private onResize(): void {
    const rect = this.viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // A panel built while its tab was hidden has no size to fit to, and a
    // browser-zoom change resizes the viewport under a view that was fitted to
    // the old one. In both cases re-fit — unless the user has zoomed or panned
    // themselves, in which case their view is the one to keep.
    const refit = !this.everSized || !this.userAdjusted;
    this.everSized = true;
    const backing = backingStoreSize(rect, window.devicePixelRatio);
    if (this.overlay.width !== backing.width || this.overlay.height !== backing.height) {
      this.overlay.width = backing.width;
      this.overlay.height = backing.height;
    }
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    if (refit && this.videoWidth > 0) this.fit();
    else this.requestDraw();
  }

  private draw(): void {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    const rect = this.viewport.getBoundingClientRect();
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // setTransform, not scale: this runs on every frame and must not compound.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    this.options.paint(ctx, this.view);
  }

  private videoPointFor(event: PointerEvent | WheelEvent): Point {
    return screenToVideo(event.clientX, event.clientY, this.viewport.getBoundingClientRect(), this.view);
  }

  private viewportPointFor(event: PointerEvent | WheelEvent): Point {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.shiftKey || event.button === 1) {
      this.panning = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      this.overlay.setPointerCapture(event.pointerId);
      this.viewport.classList.add('is-panning');
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    // Measure before focusing: focus can scroll the viewport into view, which
    // moves the rect while the event's client coordinates stay where they were,
    // and the click would then land on the wrong hole.
    const point = this.videoPointFor(event);
    this.viewport.focus({ preventScroll: true });
    this.options.onPick?.(point, event);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.panning && this.panning.pointerId === event.pointerId) {
      this.userAdjusted = true;
      this.applyView(panBy(this.view, event.clientX - this.panning.lastX, event.clientY - this.panning.lastY));
      this.panning.lastX = event.clientX;
      this.panning.lastY = event.clientY;
      return;
    }
    this.options.onHover?.(this.videoPointFor(event));
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.panning || this.panning.pointerId !== event.pointerId) return;
    if (this.overlay.hasPointerCapture(event.pointerId)) {
      this.overlay.releasePointerCapture(event.pointerId);
    }
    this.panning = null;
    this.viewport.classList.remove('is-panning');
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
    this.userAdjusted = true;
    this.applyView(zoomAt(this.view, this.viewportPointFor(event), factor));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoomByStep(BUTTON_ZOOM_STEP);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.zoomByStep(1 / BUTTON_ZOOM_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      this.fit();
      this.options.announce?.('View fitted to the frame.');
    } else if (event.altKey && event.key.startsWith('Arrow')) {
      event.preventDefault();
      const dx = event.key === 'ArrowLeft' ? KEYBOARD_PAN_PX : event.key === 'ArrowRight' ? -KEYBOARD_PAN_PX : 0;
      const dy = event.key === 'ArrowUp' ? KEYBOARD_PAN_PX : event.key === 'ArrowDown' ? -KEYBOARD_PAN_PX : 0;
      this.userAdjusted = true;
      this.applyView(panBy(this.view, dx, dy));
    }
  }
}
