// Adapted from talmolab/vibes/labelroi (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * Zoom and pan as a *view* transform. D15, D38.
 *
 * `screenToVideo` and the device-pixel-ratio backing store are the labelroi
 * pattern named in D38 and `THIRD_PARTY_NOTICES.md`, re-implemented here as
 * pure functions so they can be unit-tested without a DOM; `canvas-view.ts`
 * holds the DOM half and explains what was changed and why.
 *
 * The frame layer is a canvas at the video's native pixel size carrying
 * `transform: translate(panX, panY) scale(zoom)` with `transform-origin: 0 0`;
 * the overlay is an untransformed canvas covering the viewport. Both mapping
 * directions are derived here from the same `{zoom, panX, panY}` — never from a
 * transformed element's bounding rectangle — so the overlay cannot drift away
 * from the frame beneath it.
 *
 * Nothing stored ever passes through here: clicks come in as client
 * coordinates and leave as native video pixels.
 */
import type { Point } from './types.js';

export interface ViewTransform {
  zoom: number;
  /** Viewport CSS pixels, applied before the scale (transform-origin is 0 0). */
  panX: number;
  panY: number;
}

/** The parts of a `DOMRect` this module needs, so the maths is testable in Node. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const IDENTITY_VIEW: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 20;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Video pixel → viewport CSS pixel. */
export function videoToViewport(point: Point, view: ViewTransform): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
}

/** Viewport CSS pixel → video pixel. */
export function viewportToVideo(point: Point, view: ViewTransform): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom };
}

/** Where a pointer event landed, in native video pixels. */
export function screenToVideo(
  clientX: number,
  clientY: number,
  rect: ViewportRect,
  view: ViewTransform,
): Point {
  return viewportToVideo({ x: clientX - rect.left, y: clientY - rect.top }, view);
}

export function videoToScreen(point: Point, rect: ViewportRect, view: ViewTransform): Point {
  const viewport = videoToViewport(point, view);
  return { x: viewport.x + rect.left, y: viewport.y + rect.top };
}

/**
 * Zoom about a fixed point, in viewport coordinates. With `transform-origin`
 * at 0 0 the invariant "the video pixel under the cursor stays under the
 * cursor" is `pan' = c − s·(c − pan)`, and nothing else.
 */
export function zoomAt(view: ViewTransform, anchor: Point, factor: number): ViewTransform {
  const zoom = clampZoom(view.zoom * factor);
  const applied = zoom / view.zoom;
  return {
    zoom,
    panX: anchor.x - applied * (anchor.x - view.panX),
    panY: anchor.y - applied * (anchor.y - view.panY),
  };
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy };
}

/** The whole frame, centred in the viewport, at the largest zoom that fits. */
export function fitView(video: Size, viewport: Size): ViewTransform {
  if (video.width <= 0 || video.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return IDENTITY_VIEW;
  }
  const zoom = clampZoom(Math.min(viewport.width / video.width, viewport.height / video.height));
  return {
    zoom,
    panX: (viewport.width - video.width * zoom) / 2,
    panY: (viewport.height - video.height * zoom) / 2,
  };
}

/**
 * The overlay canvas's backing-store size: CSS pixels times the device pixel
 * ratio, so a hairline is a hairline on a Retina display. The ratio affects
 * only how the overlay is rasterised — never `screenToVideo`, and never a
 * stored coordinate (D15).
 */
export function backingStoreSize(rect: Size, devicePixelRatio: number): Size {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.round(rect.width * ratio)),
    height: Math.max(1, Math.round(rect.height * ratio)),
  };
}
