/**
 * The background model's sample frames, read on the main thread (D6).
 *
 * The tracking pass needs a per-pixel temporal median of frames spread across
 * the whole video *before* it can start, and the only random-access decoder is
 * the main thread's `FrameSource` — the worker owns a strictly sequential one.
 * Rather than run a second sequential pass, this reads the ~150 sample frames
 * by random access (about 5 ms each) and hands the planes to the worker, which
 * computes the median off the main thread.
 *
 * The indices come from the tracker's own `backgroundSampleIndices`, so the
 * same parameters always choose the same frames and the same background.
 */
import { backgroundSampleIndices } from '../analysis/tracker/background.js';
import type { TrackingParameters } from '../contracts/parameters.js';
import type { FrameSource } from './frame-source.js';

/** What the sampler needs of a frame source; keeps the unit tests off WebCodecs. */
export interface GrayReader {
  getGray(presIndex: number): Promise<Uint8Array>;
}

export interface BackgroundSampleOptions {
  /** Called after each frame, for a progress readout during the ~0.8 s read. */
  onProgress?: (done: number, total: number) => void;
  /** Polled between frames; sampling stops and `cancelled` comes back true. */
  shouldCancel?: () => boolean;
}

export interface BackgroundSamples {
  /** The frame indices read, in ascending order. Deterministic for a given parameter set. */
  indices: number[];
  /** One luma plane per index, owned by the caller and safe to transfer. */
  samples: Uint8Array[];
  elapsedMs: number;
  cancelled: boolean;
}

export type BackgroundSamplingParameters = Pick<
  TrackingParameters,
  'backgroundSampleCount' | 'backgroundExcludeRanges'
>;

/**
 * Reads the background sample frames. Sequential by necessity: `FrameSource`
 * serialises requests and rejects a pending one that a newer request
 * supersedes, so `Promise.all` over the indices would abort most of them.
 *
 * Each plane is copied. `getGray` hands back an array from a small LRU, so two
 * reads of the same index alias one buffer and a later read can evict one the
 * caller is still holding; the median needs all of them at once.
 */
export async function sampleBackgroundFrames(
  source: GrayReader,
  frameCount: number,
  params: BackgroundSamplingParameters,
  options: BackgroundSampleOptions = {},
): Promise<BackgroundSamples> {
  const started = performance.now();
  const indices = backgroundSampleIndices(
    frameCount,
    params.backgroundSampleCount,
    params.backgroundExcludeRanges,
  );
  const samples: Uint8Array[] = [];
  let cancelled = false;

  for (const [done, presIndex] of indices.entries()) {
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const gray = await source.getGray(presIndex);
    samples.push(gray.slice());
    options.onProgress?.(done + 1, indices.length);
  }

  return {
    indices: cancelled ? indices.slice(0, samples.length) : indices,
    samples,
    elapsedMs: performance.now() - started,
    cancelled,
  };
}

/** Narrows a real `FrameSource` to what this module uses. */
export function grayReaderFor(frameSource: FrameSource): GrayReader {
  return { getGray: (presIndex) => frameSource.getGray(presIndex) };
}
