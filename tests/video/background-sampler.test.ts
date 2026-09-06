/**
 * Background sampling: the same parameters must always choose the same frames
 * (so the same video yields the same background), and every plane handed on
 * must be the caller's own copy — the frame source's LRU reuses and evicts.
 */
import { describe, expect, it } from 'vitest';
import { backgroundSampleIndices } from '../../src/analysis/tracker/background.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../src/analysis/tracker/params.js';
import {
  sampleBackgroundFrames,
  type GrayReader,
} from '../../src/video/background-sampler.js';

const SIZE = 16;

/**
 * Stands in for `FrameSource`: returns one plane per index, filled with the
 * index, and — like the real LRU — hands back the *same* array on a repeat
 * read so an aliasing bug in the sampler would show up.
 */
function fakeSource(): GrayReader & { planes: Map<number, Uint8Array>; reads: number[] } {
  const planes = new Map<number, Uint8Array>();
  const reads: number[] = [];
  return {
    planes,
    reads,
    getGray(presIndex: number): Promise<Uint8Array> {
      reads.push(presIndex);
      let plane = planes.get(presIndex);
      if (!plane) {
        plane = new Uint8Array(SIZE).fill(presIndex % 256);
        planes.set(presIndex, plane);
      }
      return Promise.resolve(plane);
    },
  };
}

describe('sampleBackgroundFrames', () => {
  it('reads exactly the indices the tracker would choose, in order', async () => {
    const source = fakeSource();
    const params = { ...DEFAULT_TRACKING_PARAMETERS, backgroundSampleCount: 12 };
    const result = await sampleBackgroundFrames(source, 900, params);

    expect(result.indices).toEqual(backgroundSampleIndices(900, 12, []));
    expect(result.indices).toHaveLength(12);
    expect(source.reads).toEqual(result.indices);
    expect(result.samples).toHaveLength(12);
    expect(result.cancelled).toBe(false);
  });

  it('is deterministic: the same parameters give the same frames every time', async () => {
    const params = { ...DEFAULT_TRACKING_PARAMETERS, backgroundSampleCount: 30 };
    const first = await sampleBackgroundFrames(fakeSource(), 5539, params);
    const second = await sampleBackgroundFrames(fakeSource(), 5539, params);
    expect(second.indices).toEqual(first.indices);
  });

  it('never samples an excluded range', async () => {
    const source = fakeSource();
    const params = {
      ...DEFAULT_TRACKING_PARAMETERS,
      backgroundSampleCount: 20,
      backgroundExcludeRanges: [{ startFrame: 0, endFrame: 74 }],
    };
    const result = await sampleBackgroundFrames(source, 741, params);
    expect(result.indices.length).toBeGreaterThan(0);
    for (const i of result.indices) expect(i).toBeGreaterThan(74);
  });

  it('copies each plane, so a later eviction or reuse cannot corrupt a sample', async () => {
    const source = fakeSource();
    const params = { ...DEFAULT_TRACKING_PARAMETERS, backgroundSampleCount: 4 };
    const result = await sampleBackgroundFrames(source, 100, params);

    const first = result.indices[0]!;
    const before = result.samples[0]!.slice();
    // What the frame source does when it reuses a buffer for another frame.
    source.planes.get(first)!.fill(255);

    expect(result.samples[0]).toEqual(before);
    expect(result.samples[0]).not.toBe(source.planes.get(first));
  });

  it('reports progress once per frame', async () => {
    const seen: [number, number][] = [];
    const params = { ...DEFAULT_TRACKING_PARAMETERS, backgroundSampleCount: 5 };
    await sampleBackgroundFrames(fakeSource(), 200, params, {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it('stops when cancelled and reports only the frames it actually read', async () => {
    const source = fakeSource();
    const params = { ...DEFAULT_TRACKING_PARAMETERS, backgroundSampleCount: 20 };
    let read = 0;
    const result = await sampleBackgroundFrames(source, 900, params, {
      onProgress: () => {
        read += 1;
      },
      shouldCancel: () => read >= 3,
    });

    expect(result.cancelled).toBe(true);
    expect(result.samples).toHaveLength(3);
    expect(result.indices).toHaveLength(3);
    expect(source.reads).toHaveLength(3);
  });
});
