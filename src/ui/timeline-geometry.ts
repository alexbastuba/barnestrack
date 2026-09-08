/**
 * The geometry of the review timeline (D24): a zoom window over frame
 * positions, frame ↔ pixel mapping, the track layout, and the rule that a
 * mark is never narrower than two pixels at any zoom (D25). Pure, so it is
 * tested in Node; the canvas that draws it is `timeline.ts`.
 */

/** Inclusive frame positions shown across the timeline's width. */
export interface TimelineWindow {
  first: number;
  last: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single-frame mark is at least this wide, whatever the zoom (D25). */
export const MIN_MARK_PX = 2;
/** The window never shows fewer frames than this (or the whole clip if shorter). */
export const MIN_WINDOW_FRAMES = 16;
export const ZOOM_STEP = 1.5;

export function fullWindow(frameCount: number): TimelineWindow {
  return { first: 0, last: Math.max(0, frameCount - 1) };
}

export function windowSpan(window: TimelineWindow): number {
  return window.last - window.first + 1;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** A window that lies inside the clip and shows at least the minimum number of frames. */
export function clampWindow(window: TimelineWindow, frameCount: number): TimelineWindow {
  const total = Math.max(1, frameCount);
  const span = clamp(Math.round(windowSpan(window)), Math.min(MIN_WINDOW_FRAMES, total), total);
  const first = clamp(Math.round(window.first), 0, total - span);
  return { first, last: first + span - 1 };
}

/** Left edge of a frame's slot, in pixels from the timeline's left edge. */
export function frameToX(frame: number, window: TimelineWindow, width: number): number {
  return ((frame - window.first) / windowSpan(window)) * width;
}

export function frameCentreX(frame: number, window: TimelineWindow, width: number): number {
  return frameToX(frame + 0.5, window, width);
}

/** The frame under a pixel, clamped to the window. */
export function xToFrame(x: number, window: TimelineWindow, width: number): number {
  const frame = Math.floor(window.first + (x / Math.max(1, width)) * windowSpan(window));
  return clamp(frame, window.first, window.last);
}

/**
 * The rectangle of an inclusive frame span, clipped to the timeline and never
 * narrower than `MIN_MARK_PX`; null when the span is entirely out of view.
 */
export function spanRect(
  startFrame: number,
  endFrame: number,
  window: TimelineWindow,
  width: number,
  y: number,
  height: number,
): Rect | null {
  const x0 = frameToX(Math.min(startFrame, endFrame), window, width);
  const x1 = frameToX(Math.max(startFrame, endFrame) + 1, window, width);
  // A span that ends at the window's first pixel or starts at its last is not in view.
  if (x1 <= 0 || x0 >= width) return null;
  let left = Math.max(0, x0);
  const right = Math.min(width, x1);
  const w = Math.max(MIN_MARK_PX, right - left);
  if (left + w > width) left = Math.max(0, width - w);
  return { x: left, y, width: w, height };
}

export function markRect(
  frame: number,
  window: TimelineWindow,
  width: number,
  y: number,
  height: number,
): Rect | null {
  return spanRect(frame, frame, window, width, y, height);
}

/**
 * A full-height sliver for a frame span, with its own floor on the width. The
 * detection-state sliver must survive whole-clip zoom, where one lost frame out
 * of five thousand is a hundredth of a pixel; `minWidth` is passed in CSS
 * pixels, so a caller drawing on a device-pixel-scaled canvas can ask for one
 * device pixel rather than `MIN_MARK_PX`.
 */
export function sliverRect(
  startFrame: number,
  endFrame: number,
  window: TimelineWindow,
  width: number,
  height: number,
  minWidth: number,
): Rect | null {
  const x0 = frameToX(Math.min(startFrame, endFrame), window, width);
  const x1 = frameToX(Math.max(startFrame, endFrame) + 1, window, width);
  if (x1 <= 0 || x0 >= width) return null;
  let left = Math.max(0, x0);
  const right = Math.min(width, x1);
  const w = Math.max(minWidth, right - left);
  if (left + w > width) left = Math.max(0, width - w);
  return { x: left, y: 0, width: w, height };
}

/** Zooms the window by `factor` (> 1 zooms in) about a frame, which keeps its place on screen. */
export function zoomWindow(
  window: TimelineWindow,
  factor: number,
  anchorFrame: number,
  frameCount: number,
): TimelineWindow {
  const oldSpan = windowSpan(window);
  const newSpan = Math.round(oldSpan / factor);
  const fraction = clamp((anchorFrame - window.first) / oldSpan, 0, 1);
  const first = anchorFrame - fraction * newSpan;
  return clampWindow({ first, last: first + newSpan - 1 }, frameCount);
}

export function panWindow(
  window: TimelineWindow,
  deltaFrames: number,
  frameCount: number,
): TimelineWindow {
  return clampWindow(
    { first: window.first + deltaFrames, last: window.last + deltaFrames },
    frameCount,
  );
}

/** The same window, shifted (never resized) so the frame is inside it with a small margin. */
export function ensureVisible(
  window: TimelineWindow,
  frame: number,
  frameCount: number,
): TimelineWindow {
  if (frame >= window.first && frame <= window.last) return window;
  const span = windowSpan(window);
  const margin = Math.floor(span / 10);
  const first = frame < window.first ? frame - margin : frame + margin - span + 1;
  return clampWindow({ first, last: first + span - 1 }, frameCount);
}

// ---------------------------------------------------------------------------
// Track layout, top to bottom
// ---------------------------------------------------------------------------

export type TrackId = 'axis' | 'state' | 'events' | 'corrections';

export interface TrackLayout {
  id: TrackId;
  label: string;
  y: number;
  height: number;
}

/**
 * Four rows, not five. The nose-confidence row left the timeline: the quality
 * panel's histogram says the same thing with an axis and a count, and the row
 * cost 28 px of the height the events row needs for leader labels. The
 * detection-state row is half what it was, because it now carries a pattern
 * rather than a pattern with a word written across it.
 */
export const TRACKS: readonly TrackLayout[] = [
  { id: 'axis', label: 'Time (s)', y: 0, height: 18 },
  { id: 'state', label: 'Detection state', y: 22, height: 10 },
  { id: 'events', label: 'Events', y: 36, height: 46 },
  { id: 'corrections', label: 'Corrections', y: 86, height: 14 },
];

/** Where an event's bar starts inside the events row; above it go leader labels. */
export const EVENT_BAR_TOP = 16;
/** Space kept under an event bar, inside the events row. */
export const EVENT_BAR_BOTTOM = 3;

/** Height of the stacked tracks; the overview strip sits below it. */
export const TRACKS_HEIGHT = 104;
export const OVERVIEW_HEIGHT = 16;
export const TIMELINE_HEIGHT = TRACKS_HEIGHT + 4 + OVERVIEW_HEIGHT;

export function trackAt(y: number): TrackLayout | null {
  for (const track of TRACKS) if (y >= track.y && y < track.y + track.height) return track;
  return null;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The last frame whose time is at or before `t` (the frame on screen at wall-clock time t), or 0. */
export function frameAtTime(frameTimes: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = frameTimes.length - 1;
  if (hi < 0) return 0;
  if (t <= frameTimes[0]!) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frameTimes[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const TICK_STEPS_S = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export interface TimeTick {
  frame: number;
  x: number;
  label: string;
}

/** Round-number time ticks across the window, from each frame's own timestamp (D7), at most about `target` of them. */
export function timeTicks(
  frameTimes: ArrayLike<number>,
  window: TimelineWindow,
  width: number,
  target = 8,
): TimeTick[] {
  if (frameTimes.length === 0) return [];
  const t0 = frameTimes[window.first] ?? 0;
  const t1 = frameTimes[window.last] ?? t0;
  const span = Math.max(1e-6, t1 - t0);
  const step = TICK_STEPS_S.find((s) => span / s <= target) ?? TICK_STEPS_S[TICK_STEPS_S.length - 1]!;
  const ticks: TimeTick[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
    const frame = frameAtTime(frameTimes, t + 1e-9);
    // the first frame at or after the tick, so the label sits where that time begins
    const at = frame < frameTimes.length - 1 && frameTimes[frame]! < t - 1e-9 ? frame + 1 : frame;
    if (at < window.first || at > window.last) continue;
    ticks.push({ frame: at, x: frameToX(at, window, width), label: `${step < 1 ? t.toFixed(1) : t.toFixed(0)} s` });
  }
  return ticks;
}
