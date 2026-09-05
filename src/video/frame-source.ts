// Adapted from talmolab/vibes/video-player (BSD-3-Clause, commit d9410fa)
/**
 * Main-thread random access for the scrubber (D5, D7).
 *
 * `getFrame(presIndex)` locates the last keyframe at or before the frame in
 * presentation order, decodes in decode order from that keyframe through the
 * rest of its group of pictures (bounded by a lookahead), flushes, and keeps
 * the output whose synthetic timestamp is `presIndex × 1000`. Every output
 * of the window lands in an LRU of ImageBitmaps so scrubbing within a group
 * is free. One decoder is reused with `reset()` + `configure()` per window.
 * Requests serialise; a request that is still waiting when a newer one
 * arrives is superseded (rejected with an `AbortError`).
 *
 * Borrowed from vibes: keyframe lookup in presentation order, decoding the
 * decode-index span that covers every reference, the ImageBitmap LRU and
 * the seek-time metric; re-implemented with timestamp identity and a
 * request queue.
 */
import type { ByteSource } from './byte-source.js';
import {
  assertDecoderSupport,
  decoderConfig,
  encodedChunkFor,
  presIndexFromTimestamp,
  waitForQueue,
} from './decoder.js';
import { copyLuma, createLumaScratch, type LumaScratch } from './luma.js';
import type { FrameEntry, Mp4Index } from './mp4-index.js';
import { readSamplesBatched } from './sample-reader.js';

export interface FrameSourceOptions {
  /** ImageBitmaps kept. Default 90 (six 15-frame groups). */
  cacheSize?: number;
  /** Gray planes kept. Default 16. */
  grayCacheSize?: number;
  /** Frames decoded past the target within its group. Default 30. */
  lookahead?: number;
  optimizeForLatency?: boolean;
}

interface WindowRequest {
  presIndex: number;
  wantBitmap: boolean;
  wantGray: boolean;
  resolve(value: WindowResult): void;
  reject(error: Error): void;
}

interface WindowResult {
  bitmap?: ImageBitmap;
  gray?: Uint8Array;
}

class Lru<V> {
  private readonly map = new Map<number, V>();

  constructor(
    private readonly capacity: number,
    private readonly dispose: (value: V) => void = () => {},
  ) {}

  get(key: number): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  set(key: number, value: V): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.map.delete(key);
      if (existing !== value) this.dispose(existing);
    }
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as number;
      const evicted = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.dispose(evicted);
    }
  }

  get size(): number {
    return this.map.size;
  }

  keys(): number[] {
    return [...this.map.keys()];
  }

  clear(): void {
    for (const value of this.map.values()) this.dispose(value);
    this.map.clear();
  }
}

const DEFAULT_CACHE_SIZE = 90;
const DEFAULT_GRAY_CACHE_SIZE = 16;
const DEFAULT_LOOKAHEAD = 30;
const QUEUE_DEPTH = 8;

export class FrameSource {
  /** Milliseconds spent by the most recent `getFrame`/`getGray`, cache hits included. */
  lastSeekMs = 0;
  /** Whether the most recent request was served from the cache. */
  lastFromCache = false;

  private readonly bitmaps: Lru<ImageBitmap>;
  private readonly grays: Lru<Uint8Array>;
  private readonly lookahead: number;
  private readonly config: VideoDecoderConfig;
  private readonly decodeOrder: FrameEntry[];
  private readonly scratch: LumaScratch = createLumaScratch();
  private decoder: VideoDecoder | null = null;
  private supportChecked: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private pending: WindowRequest | null = null;
  private closed = false;

  constructor(
    private readonly index: Mp4Index,
    private readonly source: ByteSource,
    options: FrameSourceOptions = {},
  ) {
    this.bitmaps = new Lru(options.cacheSize ?? DEFAULT_CACHE_SIZE, (b) => b.close());
    this.grays = new Lru(options.grayCacheSize ?? DEFAULT_GRAY_CACHE_SIZE);
    this.lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
    this.config = decoderConfig(index, options.optimizeForLatency ?? false);
    this.decodeOrder = [...index.frames].sort((a, b) => a.decodeIndex - b.decodeIndex);
  }

  get cachedFrameCount(): number {
    return this.bitmaps.size;
  }

  cachedPresIndices(): number[] {
    return this.bitmaps.keys();
  }

  /** The decoded picture for display. The bitmap belongs to the cache: do not close it. */
  async getFrame(presIndex: number): Promise<ImageBitmap> {
    const started = performance.now();
    this.checkIndex(presIndex);
    const cached = this.bitmaps.get(presIndex);
    if (cached) {
      this.finishTiming(started, true);
      return cached;
    }
    const result = await this.request(presIndex, true, false);
    this.finishTiming(started, false);
    if (!result.bitmap) throw new Error(`frame ${presIndex} was not produced by the decoder`);
    return result.bitmap;
  }

  /** The luma plane, byte-identical to what the sequential pass sees. Caller owns the array. */
  async getGray(presIndex: number): Promise<Uint8Array> {
    const started = performance.now();
    this.checkIndex(presIndex);
    const cached = this.grays.get(presIndex);
    if (cached) {
      this.finishTiming(started, true);
      return cached;
    }
    const result = await this.request(presIndex, false, true);
    this.finishTiming(started, false);
    if (!result.gray) throw new Error(`frame ${presIndex} was not produced by the decoder`);
    return result.gray;
  }

  /** Last keyframe at or before `presIndex` in presentation order. */
  keyframeBefore(presIndex: number): number {
    const keys = this.index.keyframePresIndices;
    let lo = 0;
    let hi = keys.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! <= presIndex) {
        best = keys[mid]!;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /** Samples to feed, in decode order, for a window ending at the target's group. */
  windowFor(presIndex: number): FrameEntry[] {
    const key = this.index.frames[this.keyframeBefore(presIndex)]!;
    const target = this.index.frames[presIndex]!;
    const nextKey = this.index.keyframePresIndices.find((k) => k > key.presIndex);
    const groupEndDi =
      nextKey === undefined
        ? this.decodeOrder.length - 1
        : this.index.frames[nextKey]!.decodeIndex - 1;
    const endDi = Math.min(groupEndDi, Math.max(target.decodeIndex, key.decodeIndex + this.lookahead));
    return this.decodeOrder.slice(key.decodeIndex, endDi + 1);
  }

  close(): void {
    this.closed = true;
    this.bitmaps.clear();
    this.grays.clear();
    if (this.pending) {
      this.pending.reject(new DOMException('frame source closed', 'AbortError'));
      this.pending = null;
    }
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
  }

  private checkIndex(presIndex: number): void {
    if (this.closed) throw new Error('frame source is closed');
    if (!Number.isInteger(presIndex) || presIndex < 0 || presIndex >= this.index.frameCount) {
      throw new RangeError(`frame ${presIndex} is outside 0..${this.index.frameCount - 1}`);
    }
  }

  private finishTiming(started: number, fromCache: boolean): void {
    this.lastSeekMs = performance.now() - started;
    this.lastFromCache = fromCache;
  }

  private request(presIndex: number, wantBitmap: boolean, wantGray: boolean): Promise<WindowResult> {
    return new Promise<WindowResult>((resolve, reject) => {
      if (this.pending) {
        this.pending.reject(new DOMException('superseded by a newer frame request', 'AbortError'));
      }
      this.pending = { presIndex, wantBitmap, wantGray, resolve, reject };
      if (!this.inFlight) this.inFlight = this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending && !this.closed) {
        const req = this.pending;
        this.pending = null;
        const bitmap = req.wantBitmap ? this.bitmaps.get(req.presIndex) : undefined;
        const gray = req.wantGray ? this.grays.get(req.presIndex) : undefined;
        if ((!req.wantBitmap || bitmap) && (!req.wantGray || gray)) {
          req.resolve({ bitmap, gray });
          continue;
        }
        try {
          req.resolve(await this.decodeWindow(req));
        } catch (e) {
          req.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      this.inFlight = null;
    }
  }

  private async ensureDecoder(): Promise<VideoDecoder> {
    if (!this.supportChecked) this.supportChecked = assertDecoderSupport(this.config);
    await this.supportChecked;
    if (!this.decoder || this.decoder.state === 'closed') {
      this.decoder = new VideoDecoder({
        output: (frame) => this.onOutput(frame),
        error: (e) => this.onError(e),
      });
    }
    return this.decoder;
  }

  private window: {
    target: number;
    wantBitmap: boolean;
    wantGray: boolean;
    result: WindowResult;
    chain: Promise<void>;
    error: Error | null;
  } | null = null;

  private onOutput(frame: VideoFrame): void {
    const w = this.window;
    if (!w) {
      frame.close();
      return;
    }
    w.chain = w.chain.then(async () => {
      try {
        if (w.error) return;
        const presIndex = presIndexFromTimestamp(frame.timestamp);
        if (w.wantBitmap || presIndex !== w.target) {
          const bitmap = await createImageBitmap(frame);
          this.bitmaps.set(presIndex, bitmap);
          if (presIndex === w.target) w.result.bitmap = bitmap;
        }
        if (w.wantGray && presIndex === w.target) {
          const plane = await copyLuma(frame, this.scratch);
          this.grays.set(presIndex, plane.gray);
          w.result.gray = plane.gray;
        }
      } catch (e) {
        w.error = e instanceof Error ? e : new Error(String(e));
      } finally {
        frame.close();
      }
    });
  }

  private onError(e: DOMException): void {
    if (this.window && !this.window.error) this.window.error = e;
  }

  private async decodeWindow(req: WindowRequest): Promise<WindowResult> {
    const decoder = await this.ensureDecoder();
    if (decoder.state === 'configured') decoder.reset();
    decoder.configure(this.config);
    const window = {
      target: req.presIndex,
      wantBitmap: req.wantBitmap,
      wantGray: req.wantGray,
      result: {} as WindowResult,
      chain: Promise.resolve(),
      error: null as Error | null,
    };
    this.window = window;
    try {
      for await (const batch of readSamplesBatched(this.source, this.windowFor(req.presIndex))) {
        for (const { frame, data } of batch) {
          if (window.error) throw window.error;
          await waitForQueue(decoder, QUEUE_DEPTH);
          decoder.decode(encodedChunkFor(frame, data));
        }
      }
      await decoder.flush();
      await window.chain;
      if (window.error) throw window.error;
      return window.result;
    } finally {
      this.window = null;
      if (window.error && decoder.state !== 'closed') {
        // A decoder error leaves it closed; a fresh one is created next time.
        decoder.close();
        this.decoder = null;
      }
    }
  }
}
