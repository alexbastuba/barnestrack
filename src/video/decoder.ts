// Adapted from talmolab/vibes/slp-viewer (BSD-3-Clause, commit d9410fa)
/**
 * Long-lived sequential decoder for the tracking pass (D5, D7).
 *
 * One `VideoDecoder` is fed every sample in decode order with a synthetic
 * timestamp `presIndex × 1000` µs. Decoded frames are identified by that
 * timestamp (an exact integer after ÷ 1000) and must arrive in strictly
 * increasing presentation order with no gaps or repeats: that is the check
 * that the duplicate-timestamp frames in the sample videos survive decoding
 * as distinct frames. Each frame's luma plane is copied out and the frame
 * closed immediately; nothing accumulates.
 *
 * Borrowed from vibes: the decode-order feed with `type` from `is_sync` and
 * an awaited `flush()`; re-implemented with backpressure, synthetic
 * timestamps and luma extraction.
 */
import type { ByteSource } from './byte-source.js';
import { copyLuma, createLumaScratch } from './luma.js';
import type { FrameEntry, Mp4Index } from './mp4-index.js';
import { readSamplesBatched } from './sample-reader.js';

/** Synthetic timestamp unit: presIndex × TIMESTAMP_STEP_US microseconds. */
export const TIMESTAMP_STEP_US = 1000;

export interface GrayFrame {
  presIndex: number;
  t_s: number;
  width: number;
  height: number;
  /**
   * Luma plane, row-major, tightly packed. The buffer is reused for the next
   * frame: copy it if it must outlive the callback.
   */
  gray: Uint8Array;
}

export type GrayFrameConsumer = (frame: GrayFrame) => void;

export interface SequentialDecoderOptions {
  /** Encoded chunks allowed in the decoder queue before the feed waits. Default 8. */
  maxQueueDepth?: number;
  /** Passed to `VideoDecoder.configure`. Default false. */
  optimizeForLatency?: boolean;
  /** Called after every `progressEvery` output frames (default 15). */
  onProgress?: (presIndex: number) => void;
  progressEvery?: number;
}

export interface SequentialDecodeResult {
  status: 'done' | 'cancelled';
  /** Frames delivered to the consumer. */
  frameCount: number;
  elapsedMs: number;
  /** Frames per second over the whole pass (0 when nothing was decoded). */
  fps: number;
}

export interface SequentialDecoder {
  run(): Promise<SequentialDecodeResult>;
  cancel(): void;
}

export class DecodeOrderError extends Error {
  override readonly name = 'DecodeOrderError';
  constructor(
    message: string,
    readonly expectedPresIndex: number,
    readonly receivedPresIndex: number,
  ) {
    super(message);
  }
}

const DEFAULT_QUEUE_DEPTH = 8;
const DEFAULT_PROGRESS_EVERY = 15;

export function decoderConfig(index: Mp4Index, optimizeForLatency = false): VideoDecoderConfig {
  return {
    codec: index.codec,
    codedWidth: index.width,
    codedHeight: index.height,
    description: index.description,
    optimizeForLatency,
  };
}

export async function assertDecoderSupport(config: VideoDecoderConfig): Promise<void> {
  if (typeof VideoDecoder === 'undefined') {
    throw new Error('WebCodecs VideoDecoder is not available in this browser');
  }
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`the browser cannot decode ${config.codec} (${config.codedWidth}×${config.codedHeight})`);
  }
}

/** presIndex from a synthetic output timestamp; throws when it is not an exact multiple. */
export function presIndexFromTimestamp(timestampUs: number): number {
  const presIndex = timestampUs / TIMESTAMP_STEP_US;
  if (!Number.isInteger(presIndex) || presIndex < 0) {
    throw new Error(`decoder output timestamp ${timestampUs} µs is not a frame index`);
  }
  return presIndex;
}

export function encodedChunkFor(frame: FrameEntry, data: Uint8Array): EncodedVideoChunk {
  return new EncodedVideoChunk({
    type: frame.isKeyframe ? 'key' : 'delta',
    timestamp: frame.presIndex * TIMESTAMP_STEP_US,
    duration: TIMESTAMP_STEP_US,
    data,
  });
}

/** Resolves once the decoder's input queue has drained below `maxDepth`. */
export async function waitForQueue(decoder: VideoDecoder, maxDepth: number): Promise<void> {
  while (decoder.decodeQueueSize >= maxDepth) {
    await new Promise<void>((resolve) => {
      if ('ondequeue' in decoder) {
        const handler = () => {
          decoder.removeEventListener('dequeue', handler);
          resolve();
        };
        decoder.addEventListener('dequeue', handler);
      } else {
        setTimeout(resolve, 1);
      }
    });
  }
}

export function createSequentialDecoder(
  index: Mp4Index,
  source: ByteSource,
  onFrame: GrayFrameConsumer,
  options: SequentialDecoderOptions = {},
): SequentialDecoder {
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_QUEUE_DEPTH;
  const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;
  let cancelled = false;
  let decoder: VideoDecoder | null = null;

  async function run(): Promise<SequentialDecodeResult> {
    const config = decoderConfig(index, options.optimizeForLatency ?? false);
    await assertDecoderSupport(config);

    const decodeOrder = [...index.frames].sort((a, b) => a.decodeIndex - b.decodeIndex);
    const scratch = createLumaScratch();
    const gray = new Uint8Array(index.width * index.height);
    const started = performance.now();

    let expectedPresIndex = 0;
    let delivered = 0;
    let fatal: Error | null = null;
    let outputChain: Promise<void> = Promise.resolve();
    let pendingOutputs = 0;
    let failRun: (error: Error) => void = () => {};
    const failed = new Promise<never>((_, reject) => {
      failRun = reject;
    });

    const fail = (error: Error) => {
      if (fatal) return;
      fatal = error;
      failRun(error);
    };

    const handleOutput = async (frame: VideoFrame) => {
      try {
        if (fatal || cancelled) return;
        const presIndex = presIndexFromTimestamp(frame.timestamp);
        if (presIndex !== expectedPresIndex) {
          throw new DecodeOrderError(
            `decoder output out of order: expected frame ${expectedPresIndex}, got ${presIndex}`,
            expectedPresIndex,
            presIndex,
          );
        }
        const entry = index.frames[presIndex];
        if (!entry) throw new Error(`decoder produced frame ${presIndex} beyond the index`);
        const plane = await copyLuma(frame, scratch, gray);
        onFrame({ presIndex, t_s: entry.t_s, width: plane.width, height: plane.height, gray });
        expectedPresIndex++;
        delivered++;
        if (options.onProgress && delivered % progressEvery === 0) options.onProgress(presIndex);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      } finally {
        frame.close();
        pendingOutputs--;
      }
    };

    decoder = new VideoDecoder({
      output: (frame) => {
        pendingOutputs++;
        outputChain = outputChain.then(() => handleOutput(frame));
      },
      error: (e) => fail(e instanceof Error ? e : new Error(String(e))),
    });
    decoder.configure(config);

    try {
      const feed = (async () => {
        for await (const batch of readSamplesBatched(source, decodeOrder)) {
          for (const { frame, data } of batch) {
            if (cancelled || fatal) return;
            await waitForQueue(decoder!, maxQueueDepth);
            while (pendingOutputs > maxQueueDepth * 2 && !fatal && !cancelled) {
              await outputChain;
            }
            if (cancelled || fatal) return;
            decoder!.decode(encodedChunkFor(frame, data));
          }
        }
        if (cancelled || fatal) return;
        await decoder!.flush();
        await outputChain;
      })();
      await Promise.race([feed, failed]);
      if (fatal) throw fatal;

      const elapsedMs = performance.now() - started;
      if (cancelled) {
        return { status: 'cancelled', frameCount: delivered, elapsedMs, fps: fpsOf(delivered, elapsedMs) };
      }
      if (delivered !== index.frameCount) {
        throw new Error(
          `decoder produced ${delivered} of ${index.frameCount} frames (short by ${index.frameCount - delivered})`,
        );
      }
      return { status: 'done', frameCount: delivered, elapsedMs, fps: fpsOf(delivered, elapsedMs) };
    } finally {
      const d = decoder;
      decoder = null;
      if (d && d.state !== 'closed') d.close();
    }
  }

  function cancel(): void {
    cancelled = true;
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        // already closed by run()
      }
    }
  }

  return { run, cancel };
}

function fpsOf(frames: number, elapsedMs: number): number {
  return elapsedMs > 0 ? (frames * 1000) / elapsedMs : 0;
}
