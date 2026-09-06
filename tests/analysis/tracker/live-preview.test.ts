/**
 * The live-preview hook (D17): a pass can be watched without changing what it
 * reports. The equivalence test is the point of this file — everything the
 * tracker returns, except the wall-clock `timing`, must be identical whether
 * or not a preview callback is attached.
 */
import { describe, expect, it } from 'vitest';
import {
  trackFrames,
  type FrameInput,
  type LivePreview,
  type TrackerResult,
} from '../../../src/analysis/tracker/tracker.js';
import {
  DEFAULT_MOUSE,
  mouseOnCircle,
  renderScene,
  renderStaticScene,
  type SceneObjects,
} from '../synthetic-frames.js';
import { setup, t_s } from './helpers.js';

const s = setup({ spec: { noise: 2 } });

/** Empty platform, a mouse running a circle, then frames whose body a hole cuts in two (D48). */
function sequence(): FrameInput[] {
  const spec = s.spec;
  const staticScene = renderStaticScene({ ...spec, noise: 0 });
  const entries: (SceneObjects & { split?: boolean })[] = [];
  for (let i = 0; i < 4; i++) entries.push({ seed: i });
  for (let i = 0; i < 40; i++) {
    entries.push({ mouse: { ...DEFAULT_MOUSE, ...mouseOnCircle(spec, t_s(i)) }, seed: 20 + i });
  }
  for (let i = 0; i < 4; i++) {
    entries.push({ mouse: { ...DEFAULT_MOUSE, x: 300, y: 250, heading: 0 }, seed: 80 + i, split: true });
  }

  return entries.map((objects, i) => {
    const gray = renderScene(spec, objects, undefined, staticScene);
    if (objects.split && objects.mouse) {
      const m = objects.mouse;
      for (let y = Math.floor(m.y - 20); y <= Math.ceil(m.y + 20); y++) {
        for (let x = Math.round(m.x) - 3; x <= Math.round(m.x) + 3; x++) {
          gray[y * spec.width + x] = staticScene[y * spec.width + x]!;
        }
      }
    }
    return { gray, presIndex: i, t_s: t_s(i) };
  });
}

/** Everything the tracker returns except `timing`, which is wall-clock by construction. */
function withoutTiming(result: TrackerResult): Omit<TrackerResult, 'timing'> {
  const rest: Omit<TrackerResult, 'timing'> & { timing?: unknown } = { ...result };
  delete rest.timing;
  return rest;
}

describe('onLivePreview does not change the pass', () => {
  it('produces an identical TrackerResult, timing aside, with and without the hook', () => {
    const frames = sequence();
    const withoutHook = trackFrames(frames, s.options);

    const seen: LivePreview[] = [];
    const withHook = trackFrames(frames, {
      ...s.options,
      livePreviewEvery: 1,
      onLivePreview: (live) => seen.push(live),
    });

    expect(seen).toHaveLength(frames.length);
    expect(withoutTiming(withHook)).toEqual(withoutTiming(withoutHook));
  });

  it('leaves the result alone when only the interval is set and no callback is given', () => {
    const frames = sequence();
    const plain = trackFrames(frames, s.options);
    const intervalOnly = trackFrames(frames, { ...s.options, livePreviewEvery: 3 });
    expect(withoutTiming(intervalOnly)).toEqual(withoutTiming(plain));
  });
});

describe('onLivePreview interval', () => {
  it('fires every fifteenth frame by default, starting at frame 0', () => {
    const frames = sequence();
    const seen: number[] = [];
    trackFrames(frames, { ...s.options, onLivePreview: (live) => seen.push(live.presIndex) });
    const expected: number[] = [];
    for (let i = 0; i < frames.length; i += 15) expected.push(i);
    expect(seen).toEqual(expected);
  });

  it('honours a custom interval', () => {
    const frames = sequence();
    const seen: number[] = [];
    trackFrames(frames, {
      ...s.options,
      livePreviewEvery: 7,
      onLivePreview: (live) => seen.push(live.presIndex),
    });
    expect(seen).toEqual([0, 7, 14, 21, 28, 35, 42]);
  });
});

describe('what the preview carries', () => {
  const frames = sequence();
  const seen = new Map<number, LivePreview>();
  const result = trackFrames(frames, {
    ...s.options,
    livePreviewEvery: 1,
    onLivePreview: (live) => seen.set(live.presIndex, live),
  });

  it('reports the same candidate count the result records for that frame', () => {
    for (const [i, live] of seen) {
      expect(live.candidateCount).toBe(result.candidates[i]!.length);
    }
  });

  it('has no centroid and no axis on the empty frames at the start', () => {
    for (let i = 0; i < 4; i++) {
      const live = seen.get(i)!;
      expect(live.candidateCount).toBe(0);
      expect(live.centroid).toBeNull();
      expect(live.axis).toBeNull();
    }
  });

  it('takes the single candidate when there is one', () => {
    const single = [...seen].filter(([i, live]) => live.candidateCount === 1 && i >= 4);
    expect(single.length).toBeGreaterThan(20);
    for (const [i, live] of single) {
      const only = result.candidates[i]![0]!;
      expect(live.centroid?.x).toBeCloseTo(only.cx, 6);
      expect(live.centroid?.y).toBeCloseTo(only.cy, 6);
      expect(live.axis).not.toBeNull();
    }
  });

  it('takes the merged union, not the larger piece, on a split frame (D48)', () => {
    const split = [...seen].filter(([, live]) => live.candidateCount === 2);
    expect(split.length).toBeGreaterThan(0);
    for (const [i, live] of split) {
      const pieces = result.candidates[i]!;
      const a = pieces[0]!;
      const b = pieces[1]!;
      const total = a.area_px2 + b.area_px2;
      const unionX = (a.cx * a.area_px2 + b.cx * b.area_px2) / total;
      const unionY = (a.cy * a.area_px2 + b.cy * b.area_px2) / total;
      expect(live.centroid?.x).toBeCloseTo(unionX, 4);
      expect(live.centroid?.y).toBeCloseTo(unionY, 4);
      // The union is genuinely not just the largest piece.
      expect(Math.abs(live.centroid!.x - a.cx) + Math.abs(live.centroid!.y - a.cy)).toBeGreaterThan(0.5);
    }
  });
});
