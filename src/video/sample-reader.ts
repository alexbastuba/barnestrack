// Adapted from talmolab/vibes/video-player (BSD-3-Clause, commit d9410fa)
/**
 * Batched reads of sample bytes in decode order. Samples that are contiguous
 * in the file are fetched with one `read` of up to ~2 MB (one `File.slice`
 * per batch, not per sample), and each sample is handed out as a view into
 * that batch. Borrowed from vibes: grouping file-contiguous samples into one
 * read; re-implemented over `ByteSource`.
 */
import type { ByteSource } from './byte-source.js';
import type { FrameEntry } from './mp4-index.js';

export const DEFAULT_BATCH_BYTES = 2 * 1024 * 1024;

export interface SampleBytes {
  frame: FrameEntry;
  data: Uint8Array;
}

/**
 * Yields the given frames (in the order given, expected to be decode order)
 * with their bytes. The next batch is read while the current one is consumed.
 */
export async function* readSamplesBatched(
  source: ByteSource,
  frames: readonly FrameEntry[],
  batchBytes: number = DEFAULT_BATCH_BYTES,
): AsyncGenerator<SampleBytes[], void, undefined> {
  const batches = planBatches(frames, batchBytes);
  let pending: Promise<ArrayBuffer> | null = null;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const buffer = await (pending ?? source.read(batch.start, batch.end));
    const next = batches[b + 1];
    pending = next ? source.read(next.start, next.end) : null;
    yield batch.frames.map((frame) => ({
      frame,
      data: new Uint8Array(buffer, frame.byteOffset - batch.start, frame.byteLength),
    }));
  }
}

interface Batch {
  start: number;
  end: number;
  frames: FrameEntry[];
}

/** Groups consecutive samples whose file span fits in `batchBytes` (a lone larger sample gets its own batch). */
export function planBatches(frames: readonly FrameEntry[], batchBytes: number): Batch[] {
  const batches: Batch[] = [];
  let current: Batch | null = null;
  for (const frame of frames) {
    const frameEnd = frame.byteOffset + frame.byteLength;
    if (
      current &&
      frame.byteOffset >= current.start &&
      Math.max(current.end, frameEnd) - current.start <= batchBytes
    ) {
      current.end = Math.max(current.end, frameEnd);
      current.frames.push(frame);
    } else {
      current = { start: frame.byteOffset, end: frameEnd, frames: [frame] };
      batches.push(current);
    }
  }
  return batches;
}
