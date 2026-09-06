import { describe, expect, it } from 'vitest';
import {
  backingStoreSize,
  clampZoom,
  fitView,
  IDENTITY_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToVideo,
  videoToScreen,
  videoToViewport,
  viewportToVideo,
  zoomAt,
  type ViewTransform,
  type ViewportRect,
} from '../../src/maze/view-transform.js';

/** A viewport that is not at the page origin, because a real one never is. */
const RECT: ViewportRect = { left: 96.5, top: 218.25, width: 800, height: 600 };
const VIEW: ViewTransform = { zoom: 1.75, panX: -134.5, panY: 62.25 };

describe('screenToVideo', () => {
  it('round-trips a video pixel through the screen and back', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 320.5, y: 240.25 },
      { x: 639, y: 479 },
    ]) {
      const screen = videoToScreen(point, RECT, VIEW);
      const back = screenToVideo(screen.x, screen.y, RECT, VIEW);
      expect(back.x).toBeCloseTo(point.x, 10);
      expect(back.y).toBeCloseTo(point.y, 10);
    }
  });

  it('subtracts the viewport origin, then the pan, then divides by the zoom', () => {
    const p = screenToVideo(RECT.left + 100, RECT.top + 200, RECT, VIEW);
    expect(p.x).toBeCloseTo((100 - VIEW.panX) / VIEW.zoom, 10);
    expect(p.y).toBeCloseTo((200 - VIEW.panY) / VIEW.zoom, 10);
  });

  it('gives the same video pixel whatever the device pixel ratio is (D15)', () => {
    // Nothing in the click path reads devicePixelRatio: the ratio only changes
    // how the overlay is rasterised, never a stored coordinate.
    const at1 = screenToVideo(400, 500, RECT, VIEW);
    const backing1 = backingStoreSize(RECT, 1);
    const backing2 = backingStoreSize(RECT, 2);
    const backing25 = backingStoreSize(RECT, 2.5);
    const at2 = screenToVideo(400, 500, RECT, VIEW);
    expect(at2).toEqual(at1);
    expect(backing1).toEqual({ width: 800, height: 600 });
    expect(backing2).toEqual({ width: 1600, height: 1200 });
    expect(backing25).toEqual({ width: 2000, height: 1500 });
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
    expect(backingStoreSize(RECT, 0)).toEqual({ width: 800, height: 600 });
  });

  it('maps viewport and video coordinates consistently in both directions', () => {
    const viewport = videoToViewport({ x: 100, y: 50 }, VIEW);
    expect(viewport.x).toBeCloseTo(100 * VIEW.zoom + VIEW.panX, 10);
    const back = viewportToVideo(viewport, VIEW);
    expect(back.x).toBeCloseTo(100, 10);
    expect(back.y).toBeCloseTo(50, 10);
  });
});

describe('zoomAt', () => {
  it('keeps the video pixel under the cursor under the cursor, panned or not', () => {
    for (const view of [IDENTITY_VIEW, VIEW, panBy(VIEW, 250, -80)]) {
      const anchor = { x: 612.5, y: 133 };
      const before = viewportToVideo(anchor, view);
      const zoomed = zoomAt(view, anchor, 1.1);
      const after = viewportToVideo(anchor, zoomed);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(zoomed.zoom).toBeCloseTo(view.zoom * 1.1, 9);
    }
  });

  it('clamps and stops panning once the zoom is pinned at a limit', () => {
    const pinned = zoomAt({ zoom: MAX_ZOOM, panX: 10, panY: 20 }, { x: 100, y: 100 }, 4);
    expect(pinned.zoom).toBe(MAX_ZOOM);
    expect(pinned.panX).toBe(10);
    expect(pinned.panY).toBe(20);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
  });
});

describe('fitView', () => {
  it('centres the whole frame at the largest zoom that fits', () => {
    const view = fitView({ width: 640, height: 480 }, { width: 800, height: 600 });
    expect(view.zoom).toBeCloseTo(1.25, 10);
    expect(view.panX).toBeCloseTo(0, 10);
    expect(view.panY).toBeCloseTo(0, 10);

    const wide = fitView({ width: 640, height: 480 }, { width: 1600, height: 600 });
    expect(wide.zoom).toBeCloseTo(1.25, 10);
    expect(wide.panX).toBeCloseTo((1600 - 800) / 2, 10);
    expect(wide.panY).toBeCloseTo(0, 10);

    const corners = [
      { x: 0, y: 0 },
      { x: 640, y: 480 },
    ].map((p) => videoToViewport(p, wide));
    expect(corners[0]!.x).toBeGreaterThanOrEqual(0);
    expect(corners[1]!.x).toBeLessThanOrEqual(1600);
    expect(corners[1]!.y).toBeLessThanOrEqual(600);
  });

  it('falls back to the identity when a size is not yet known', () => {
    expect(fitView({ width: 0, height: 0 }, { width: 800, height: 600 })).toEqual(IDENTITY_VIEW);
    expect(fitView({ width: 640, height: 480 }, { width: 0, height: 0 })).toEqual(IDENTITY_VIEW);
  });
});
