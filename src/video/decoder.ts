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
 * closed as soon as the copy lands; a bounded number of copies overlap
 * because reading a hardware-decoded frame back is the slow step, and the
 * consumer still sees frames strictly in order.
 *
 * Borrowed from vibes: the decode-order feed with `type` from `is_sync` and
 * an awaited `flush()`; re-implemented with backpressure, synthetic
 * timestamps and luma extraction.
 */
import type { ByteSource } from './byte-source.js';
import { copyLuma, createLumaScratch, type LumaPlane, type LumaScratch } from './luma.js';
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
   * Luma plane, row-major, tightly packed. The buffer is reused for a later
   * frame once the callback returns: copy it if it must outlive the callback.
   */
  gray: Uint8Array;
}

export type GrayFrameConsumer = (frame: GrayFrame) => void;

export interface DecoderTuning {
  /** Passed to `VideoDecoder.configure`. Default false. */
  optimizeForLatency?: boolean;
  /**
   * Passed to `VideoDecoder.configure`. Default `prefer-software`: the pass
   * consumes CPU pixels, and on the reference Mac reading hardware-decoded
   * frames back is the bottleneck (test50: ~270 fps hardware-allowed versus
   * ~470 fps software; see prototypes/frame-server/RESULTS.md). It is also
   * what a machine without a GPU does anyway. `no-preference` lets the
   * browser choose. Falls back to `no-preference` if the browser rejects the hint.
   */
  hardwareAcceleration?: HardwareAcceleration;
}

export const DEFAULT_HARDWARE_ACCELERATION: HardwareAcceleration = 'prefer-software';

export interface SequentialDecoderOptions extends DecoderTuning {
  /** Encoded chunks allowed in the decoder queue before the feed waits. Default 8. */
  maxQueueDepth?: number;
  /** Luma copies allowed in flight at once (each holds one decoded frame open). Default 4. */
  copyConcurrency?: number;
  /** Called after every `progressEvery` delivered frames (default 15). */
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
const DEFAULT_COPY_CONCURRENCY = 4;
const DEFAULT_PROGRESS_EVERY = 15;

export function decoderConfig(index: Mp4Index, tuning: DecoderTuning = {}): VideoDecoderConfig {
  return {
    codec: index.codec,
    codedWidth: index.width,
    codedHeight: index.height,
    description: index.description,
    optimizeForLatency: tuning.optimizeForLatency ?? false,
    hardwareAcceleration: tuning.hardwareAcceleration ?? DEFAULT_HARDWARE_ACCELERATION,
  };
}

/**
 * Checks the config with `isConfigSupported`; a rejected `hardwareAcceleration`
 * hint is retried as `no-preference` before giving up.
 */
export async function resolveDecoderConfig(config: VideoDecoderConfig): Promise<VideoDecoderConfig> {
  if (typeof VideoDecoder === 'undefined') {
    throw new Error('WebCodecs VideoDecoder is not available in this browser');
  }
  if ((await VideoDecoder.isConfigSupported(config)).supported) return config;
  if (config.hardwareAcceleration && config.hardwareAcceleration !== 'no-preference') {
    const relaxed: VideoDecoderConfig = { ...config, hardwareAcceleration: 'no-preference' };
    if ((await VideoDecoder.isConfigSupported(relaxed)).supported) return relaxed;
  }
  throw new Error(`the browser cannot decode ${config.codec} (${config.codedWidth}×${config.codedHeight})`);
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

/** Wakes every waiter on `notify()`; waiters re-check their own condition. */
class Signal {
  private waiters: (() => void)[] = [];

  wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

interface LumaSlot {
  scratch: LumaScratch;
  gray: Uint8Array;
}

interface ArrivedFrame {
  presIndex: number;
  frame: VideoFrame;
}

interface CopyInFlight {
  presIndex: number;
  slot: LumaSlot;
  done: Promise<LumaPlane>;
}

export function createSequentialDecoder(
  index: Mp4Index,
  source: ByteSource,
  onFrame: GrayFrameConsumer,
  options: SequentialDecoderOptions = {},
): SequentialDecoder {
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_QUEUE_DEPTH;
  const copyConcurrency = Math.max(1, options.copyConcurrency ?? DEFAULT_COPY_CONCURRENCY);
  const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;
  let cancelled = false;
  let decoder: VideoDecoder | null = null;
  const signal = new Signal();

  async function run(): Promise<SequentialDecodeResult> {
    const config = await resolveDecoderConfig(decoderConfig(index, options));

    const decodeOrder = [...index.frames].sort((a, b) => a.decodeIndex - b.decodeIndex);
    const freeSlots: LumaSlot[] = Array.from({ length: copyConcurrency }, () => ({
      scratch: createLumaScratch(),
      gray: new Uint8Array(index.width * index.height),
    }));
    const arrived: ArrivedFrame[] = [];
    const copies: CopyInFlight[] = [];
    const started = performance.now();

    let nextArrival = 0;
    let delivered = 0;
    let flushed = false;
    let fatal: Error | null = null;
    let failRun: (error: Error) => void = () => {};
    const failed = new Promise<never>((_, reject) => {
      failRun = reject;
    });
    const fail = (error: unknown) => {
      if (fatal) return;
      fatal = error instanceof Error ? error : new Error(String(error));
      signal.notify();
      failRun(fatal);
    };

    const startCopies = () => {
      while (arrived.length > 0 && freeSlots.length > 0 && !fatal && !cancelled) {
        const { presIndex, frame } = arrived.shift()!;
        const slot = freeSlots.pop()!;
        const done = copyLuma(frame, slot.scratch, slot.gray).finally(() => frame.close());
        copies.push({ presIndex, slot, done });
      }
      signal.notify();
    };

    decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (fatal || cancelled) {
            frame.close();
            return;
          }
          const presIndex = presIndexFromTimestamp(frame.timestamp);
          if (presIndex !== nextArrival) {
            throw new DecodeOrderError(
              `decoder output out of order: expected frame ${nextArrival}, got ${presIndex}`,
              nextArrival,
              presIndex,
            );
          }
          if (presIndex >= index.frameCount) {
            throw new Error(`decoder produced frame ${presIndex} beyond the index`);
          }
          nextArrival++;
          arrived.push({ presIndex, frame });
          startCopies();
        } catch (e) {
          frame.close();
          fail(e);
        }
      },
      error: (e) => fail(e),
    });
    decoder.configure(config);

    const deliver = async (): Promise<void> => {
      while (!fatal && !cancelled) {
        const copy = copies.shift();
        if (!copy) {
          if (flushed && arrived.length === 0) return;
          await signal.wait();
          continue;
        }
        let plane: LumaPlane;
        try {
          plane = await copy.done;
        } catch (e) {
          fail(e);
          return;
        }
        if (fatal || cancelled) return;
        const entry = index.frames[copy.presIndex]!;
        try {
          onFrame({ presIndex: copy.presIndex, t_s: entry.t_s, width: plane.width, height: plane.height, gray: copy.slot.gray });
        } catch (e) {
          fail(e);
          return;
        }
        delivered++;
        if (options.onProgress && delivered % progressEvery === 0) options.onProgress(copy.presIndex);
        freeSlots.push(copy.slot);
        startCopies();
      }
    };

    const feed = async (): Promise<void> => {
      const maxOutstanding = copyConcurrency * 2;
      for await (const batch of readSamplesBatched(source, decodeOrder)) {
        for (const { frame, data } of batch) {
          if (cancelled || fatal) return;
          await waitForQueue(decoder!, maxQueueDepth);
          while (arrived.length + copies.length >= maxOutstanding && !fatal && !cancelled) {
            await signal.wait();
          }
          if (cancelled || fatal) return;
          decoder!.decode(encodedChunkFor(frame, data));
        }
      }
      if (cancelled || fatal) return;
      try {
        await decoder!.flush();
      } catch (e) {
        // cancel() closes the decoder, which rejects an in-flight flush with AbortError.
        if (!cancelled) throw e;
        return;
      }
      flushed = true;
      signal.notify();
    };

    try {
      const delivery = deliver();
      await Promise.race([Promise.all([feed(), delivery]), failed]);
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
      for (const { frame } of arrived.splice(0)) frame.close();
      await Promise.allSettled(copies.splice(0).map((c) => c.done));
      const d = decoder;
      decoder = null;
      if (d && d.state !== 'closed') d.close();
    }
  }

  function cancel(): void {
    cancelled = true;
    signal.notify();
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
