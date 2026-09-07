/**
 * Timeline geometry (D24, D25): frame ↔ pixel under a zoom window, and the
 * rule that a mark is never narrower than two pixels at any zoom.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_MARK_PX,
  MIN_WINDOW_FRAMES,
  TIMELINE_HEIGHT,
  TRACKS,
  clampWindow,
  ensureVisible,
  frameAtTime,
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
} from '../../src/ui/timeline-geometry.js';

const FRAMES = 5539; // test50
const WIDTH = 600;

describe('frame ↔ pixel', () => {
  it('maps the whole clip across the width and back', () => {
    const w = fullWindow(FRAMES);
    expect(windowSpan(w)).toBe(FRAMES);
    expect(frameToX(0, w, WIDTH)).toBe(0);
    expect(frameToX(FRAMES, w, WIDTH)).toBeCloseTo(WIDTH, 9);
    for (const frame of [0, 1, 2769, 5538]) {
      expect(xToFrame(frameCentreX(frame, w, WIDTH), w, WIDTH)).toBe(frame);
    }
    expect(xToFrame(-5, w, WIDTH)).toBe(0);
    expect(xToFrame(WIDTH + 5, w, WIDTH)).toBe(FRAMES - 1);
  });

  it('keeps a single-frame mark at least two pixels wide when a frame is a tenth of a pixel', () => {
    const w = fullWindow(FRAMES);
    const rect = markRect(3000, w, WIDTH, 10, 8)!;
    expect(frameToX(3001, w, WIDTH) - frameToX(3000, w, WIDTH)).toBeLessThan(0.2);
    expect(rect.width).toBe(MIN_MARK_PX);
    expect(rect.y).toBe(10);
    expect(rect.height).toBe(8);
    // at the right edge the mark stays inside the timeline
    const last = markRect(FRAMES - 1, w, WIDTH, 0, 8)!;
    expect(last.x + last.width).toBeLessThanOrEqual(WIDTH);
    expect(last.width).toBe(MIN_MARK_PX);
  });

  it('clips a span to the window and drops one entirely outside it', () => {
    const w = { first: 1000, last: 1999 };
    expect(spanRect(0, 500, w, WIDTH, 0, 8)).toBeNull();
    expect(spanRect(2500, 2600, w, WIDTH, 0, 8)).toBeNull();
    const straddling = spanRect(900, 1099, w, WIDTH, 0, 8)!;
    expect(straddling.x).toBe(0);
    expect(straddling.width).toBeCloseTo(60, 6);
    const inside = spanRect(1500, 1509, w, WIDTH, 0, 8)!;
    expect(inside.x).toBeCloseTo(300, 6);
    expect(inside.width).toBeCloseTo(6, 6);
  });
});

describe('the zoom window', () => {
  it('never shows fewer than the minimum frames or reaches outside the clip', () => {
    expect(clampWindow({ first: -50, last: 20 }, FRAMES)).toEqual({ first: 0, last: 70 });
    expect(clampWindow({ first: 100, last: 102 }, FRAMES)).toEqual({ first: 100, last: 100 + MIN_WINDOW_FRAMES - 1 });
    expect(clampWindow({ first: 5500, last: 6000 }, FRAMES)).toEqual({ first: 5038, last: 5538 });
    expect(clampWindow({ first: 0, last: 99 }, 10)).toEqual({ first: 0, last: 9 });
  });

  it('zooms about an anchor frame, which keeps its place on screen', () => {
    const w = fullWindow(FRAMES);
    const anchor = 2000;
    const xBefore = frameToX(anchor, w, WIDTH);
    const zoomed = zoomWindow(w, 4, anchor, FRAMES);
    expect(windowSpan(zoomed)).toBeCloseTo(FRAMES / 4, -1);
    expect(frameToX(anchor, zoomed, WIDTH)).toBeCloseTo(xBefore, 0);
    expect(zoomWindow(zoomed, 1 / 4, anchor, FRAMES)).toEqual(w); // back out to the whole clip
    // zooming in forever stops at the minimum
    let tiny = w;
    for (let i = 0; i < 40; i++) tiny = zoomWindow(tiny, 2, anchor, FRAMES);
    expect(windowSpan(tiny)).toBe(MIN_WINDOW_FRAMES);
  });

  it('pans and follows the playhead without resizing', () => {
    const w = { first: 1000, last: 1999 };
    expect(panWindow(w, 250, FRAMES)).toEqual({ first: 1250, last: 2249 });
    expect(panWindow(w, -5000, FRAMES)).toEqual({ first: 0, last: 999 });
    expect(ensureVisible(w, 1500, FRAMES)).toBe(w); // already visible: the same object
    const later = ensureVisible(w, 3000, FRAMES);
    expect(windowSpan(later)).toBe(1000);
    expect(later.first).toBeLessThanOrEqual(3000);
    expect(later.last).toBeGreaterThanOrEqual(3000);
    const earlier = ensureVisible(w, 10, FRAMES);
    expect(earlier.first).toBe(0);
  });
});

describe('tracks and time', () => {
  it('lays the tracks out top to bottom without overlap and finds the track under a pixel', () => {
    for (let i = 1; i < TRACKS.length; i++) {
      expect(TRACKS[i]!.y).toBeGreaterThanOrEqual(TRACKS[i - 1]!.y + TRACKS[i - 1]!.height);
    }
    expect(TRACKS[TRACKS.length - 1]!.y + TRACKS[TRACKS.length - 1]!.height).toBeLessThanOrEqual(TIMELINE_HEIGHT);
    expect(trackAt(TRACKS[3]!.y + 1)?.id).toBe('events');
    expect(trackAt(TIMELINE_HEIGHT + 50)).toBeNull();
  });

  it('finds the frame on screen at a wall-clock time and places round-number ticks from the frame times', () => {
    const times = Float64Array.from({ length: 300 }, (_, i) => i / 30 + 5); // 10 s from 5.000 s
    expect(frameAtTime(times, 0)).toBe(0);
    expect(frameAtTime(times, 5)).toBe(0);
    expect(frameAtTime(times, 6)).toBe(30);
    expect(frameAtTime(times, 6.02)).toBe(30);
    expect(frameAtTime(times, 99)).toBe(299);
    // 5.000–14.967 s with at most six ticks: a 2 s step, on round multiples of it
    const ticks = timeTicks(times, fullWindow(300), WIDTH, 6);
    expect(ticks.map((t) => t.label)).toEqual(['6 s', '8 s', '10 s', '12 s', '14 s']);
    expect(ticks[0]).toMatchObject({ frame: 30, x: 60 });
    expect(ticks[1]?.frame).toBe(90);
    const zoomed = timeTicks(times, { first: 30, last: 59 }, WIDTH, 6); // one second: tenths
    expect(zoomed.length).toBeGreaterThanOrEqual(5);
    expect(zoomed[0]?.label).toBe('6.0 s');
  });
});
