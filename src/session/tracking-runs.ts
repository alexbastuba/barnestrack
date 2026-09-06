/**
 * The tracking queue: what is running, what is waiting, and what came back
 * (D5, D17, D29).
 *
 * One worker at a time, videos taken in the order they were queued. The
 * queue is a property of this tab, not of the session — it is not in the
 * contract and is not serialised, so a reload starts with nothing running and
 * a video that was mid-pass simply comes back untracked. That is the honest
 * outcome: no half-written automatic layer can exist, because the layer is
 * written once, at the end.
 *
 * Progress deliberately does *not* go through the session store. The store
 * notifies the whole app on every change, so a store write per progress tick
 * would re-render every step several times a second while the pass runs.
 */
import type { AutoLayer } from '../contracts/session.js';
import type { TrackingParameters } from '../contracts/parameters.js';
import type { MazeMapFile } from '../contracts/mazeMap.js';
import { holeCentres, pxPerCm } from '../maze/ring.js';
import { transformMap } from '../maze/similarity.js';
import { sampleBackgroundFrames, grayReaderFor } from '../video/background-sampler.js';
import type {
  TrackPreview,
  TrackResult,
  WorkerRequest,
  WorkerResponse,
} from '../video/worker-protocol.js';
import { hashTrackingParameters } from './parameters-hash.js';
import type { SessionStore } from './session-store.js';
import type { VideoId } from './stored.js';

/** Frames between live-preview posts, matching the decoder's progress interval. */
const PREVIEW_EVERY = 15;
/** Longest edge of the posted thumbnail, px. */
const PREVIEW_MAX_EDGE = 240;

export type RunPhase =
  | 'queued'
  | 'sampling'
  | 'preparing'
  | 'tracking'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface RunState {
  videoId: VideoId;
  phase: RunPhase;
  /** Frames finished, and the total the pass will do. */
  done: number;
  total: number;
  fps: number;
  etaSeconds: number;
  /** Newest live thumbnail, or null. Provisional — see `LivePreview`. */
  preview: TrackPreview | null;
  /** Background contamination warnings from preparation. Shown, never acted on. */
  warnings: string[];
  /** Set once the pass finishes. */
  result: TrackResult | null;
  /** Plain-language reason the pass failed, when it did. */
  error: string | null;
  /** Wall time from queueing to completion, ms. */
  elapsedMs: number;
}

export interface TrackingRunnerOptions {
  /** Called whenever any run's state changes. The step re-renders from this, not from the store. */
  onChange: (state: RunState) => void;
  /** Called once a pass completes, before `onChange` reports `done`. */
  onComplete: (videoId: VideoId, auto: AutoLayer, result: TrackResult) => void;
  /** Overridable so a test can supply a fake worker. */
  createWorker?: () => Worker;
}

/** Why this video cannot be tracked yet, in the user's words, or null. */
export function trackingBlockedReason(store: SessionStore, videoId: VideoId): string | null {
  if (store.current.mazeMap === null) {
    return 'the maze is not finished — mark the platform and enter its diameter on the Maze step';
  }
  if (!store.isAttached(videoId)) {
    return 'this video is not open in this tab — drop the file again on the Videos step';
  }
  return null;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../video/track-worker.ts', import.meta.url), { type: 'module' });
}

export class TrackingRunner {
  private readonly states = new Map<VideoId, RunState>();
  private readonly waiting: VideoId[] = [];
  private running: VideoId | null = null;
  private worker: Worker | null = null;
  private cancelSampling = false;
  private startedAt = 0;

  constructor(
    private readonly store: SessionStore,
    private readonly options: TrackingRunnerOptions,
  ) {}

  stateFor(videoId: VideoId): RunState | undefined {
    return this.states.get(videoId);
  }

  /** True while a pass is running or waiting to run. */
  get busy(): boolean {
    return this.running !== null || this.waiting.length > 0;
  }

  isActive(videoId: VideoId): boolean {
    const phase = this.states.get(videoId)?.phase;
    return phase === 'queued' || phase === 'sampling' || phase === 'preparing' || phase === 'tracking';
  }

  /** Videos with no finished automatic layer and no run in flight. */
  untracked(): VideoId[] {
    return this.store.videos
      .map((v) => v.id)
      .filter(
        (id) =>
          this.store.analysisFor(id) === undefined &&
          !this.isActive(id) &&
          trackingBlockedReason(this.store, id) === null,
      );
  }

  enqueue(videoId: VideoId): void {
    if (this.isActive(videoId)) return;
    const total = this.store.attachmentFor(videoId)?.index.frameCount ?? 0;
    this.set(videoId, {
      videoId,
      phase: 'queued',
      done: 0,
      total,
      fps: 0,
      etaSeconds: 0,
      preview: null,
      warnings: [],
      result: null,
      error: null,
      elapsedMs: 0,
    });
    this.waiting.push(videoId);
    this.pump();
  }

  cancel(videoId: VideoId): void {
    if (this.running === videoId) {
      this.cancelSampling = true;
      this.worker?.postMessage({ type: 'cancel' } satisfies WorkerRequest);
      return;
    }
    const index = this.waiting.indexOf(videoId);
    if (index >= 0) {
      this.waiting.splice(index, 1);
      this.update(videoId, { phase: 'cancelled' });
    }
  }

  cancelAll(): void {
    for (const id of [...this.waiting]) this.cancel(id);
    if (this.running) this.cancel(this.running);
  }

  /** Stops everything and releases the worker. */
  destroy(): void {
    this.waiting.length = 0;
    this.cancelSampling = true;
    this.worker?.terminate();
    this.worker = null;
    this.running = null;
  }

  // ---- internals -------------------------------------------------------------

  private set(videoId: VideoId, state: RunState): void {
    this.states.set(videoId, state);
    this.options.onChange(state);
  }

  private update(videoId: VideoId, patch: Partial<RunState>): void {
    const current = this.states.get(videoId);
    if (!current) return;
    this.set(videoId, { ...current, ...patch });
  }

  private pump(): void {
    if (this.running !== null) return;
    const next = this.waiting.shift();
    if (next === undefined) return;
    this.running = next;
    void this.run(next).catch((error: unknown) => {
      this.finishRun(next, {
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private finishRun(videoId: VideoId, patch: Partial<RunState>): void {
    this.worker?.terminate();
    this.worker = null;
    this.running = null;
    this.update(videoId, { ...patch, elapsedMs: performance.now() - this.startedAt, preview: null });
    this.pump();
  }

  private async run(videoId: VideoId): Promise<void> {
    this.startedAt = performance.now();
    this.cancelSampling = false;

    const attachment = this.store.attachmentFor(videoId);
    const video = this.store.videoById(videoId);
    const map = this.store.current.mazeMap;
    const blocked = trackingBlockedReason(this.store, videoId);
    if (blocked || !attachment || !video || !map) {
      this.finishRun(videoId, { phase: 'failed', error: blocked ?? 'this video cannot be tracked' });
      return;
    }

    const params = this.store.trackingParameters;
    const frameCount = attachment.index.frameCount;

    // The maze in this video's pixels: the shared map after this video's fit
    // (D10, D49). The tracker never sees the map's own pixels.
    const videoMap: MazeMapFile = transformMap(map, video.mazeTransform, video.referenceResolution);
    const scale = pxPerCm(videoMap.platform, videoMap.calibration.platformDiameter_cm);
    if (scale === null) {
      this.finishRun(videoId, {
        phase: 'failed',
        error: 'the maze has no platform diameter, so distances cannot be measured',
      });
      return;
    }

    this.update(videoId, { phase: 'sampling', total: frameCount });
    const sampled = await sampleBackgroundFrames(
      grayReaderFor(attachment.frameSource),
      frameCount,
      params,
      {
        onProgress: (done, total) => this.update(videoId, { done, total }),
        shouldCancel: () => this.cancelSampling,
      },
    );
    if (sampled.cancelled || sampled.samples.length === 0) {
      this.finishRun(videoId, { phase: 'cancelled', done: 0, total: frameCount });
      return;
    }

    this.update(videoId, { phase: 'preparing', done: 0, total: frameCount });
    await this.runWorker(videoId, {
      type: 'start',
      consumer: 'track',
      file: attachment.file,
      index: attachment.index,
      track: {
        platform: videoMap.platform,
        platformDiameter_cm: videoMap.calibration.platformDiameter_cm,
        holes: holeCentres(videoMap).map((h) => ({
          x: h.x,
          y: h.y,
          r: videoMap.holes.holeRadius_px,
        })),
        params,
        samples: sampled.samples,
        previewEvery: PREVIEW_EVERY,
        previewMaxEdge: PREVIEW_MAX_EDGE,
      },
    });
  }

  private runWorker(videoId: VideoId, request: WorkerRequest): Promise<void> {
    return new Promise((resolve) => {
      const worker = this.options.createWorker?.() ?? defaultWorker();
      this.worker = worker;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'prepared') {
          this.update(videoId, { phase: 'tracking', warnings: message.warnings });
        } else if (message.type === 'progress') {
          this.update(videoId, {
            phase: 'tracking',
            done: message.presIndex + 1,
            fps: message.fps,
            etaSeconds: message.etaSeconds,
            ...(message.preview ? { preview: message.preview } : {}),
          });
        } else if (message.type === 'done') {
          const result = message.track;
          if (result) {
            const auto: AutoLayer = {
              parametersHash: hashTrackingParameters(this.store.trackingParameters),
              frames: result.frames,
            };
            this.options.onComplete(videoId, auto, result);
            this.finishRun(videoId, { phase: 'done', done: result.frames.length, result });
          } else {
            this.finishRun(videoId, { phase: 'failed', error: 'the pass returned no track' });
          }
          resolve();
        } else if (message.type === 'cancelled') {
          this.finishRun(videoId, { phase: 'cancelled', done: message.frameCount });
          resolve();
        } else {
          this.finishRun(videoId, { phase: 'failed', error: workerErrorText(message) });
          resolve();
        }
      };

      worker.onerror = (event) => {
        this.finishRun(videoId, {
          phase: 'failed',
          error: event.message || 'the tracking worker stopped unexpectedly',
        });
        resolve();
      };

      const transfer =
        request.type === 'start' && request.consumer === 'track'
          ? request.track.samples.map((s) => s.buffer)
          : [];
      worker.postMessage(request, transfer);
    });
  }
}

function workerErrorText(message: Extract<WorkerResponse, { type: 'error' }>): string {
  if (message.expectedPresIndex !== undefined) {
    return (
      `the decoder returned frame ${message.receivedPresIndex} where frame ` +
      `${message.expectedPresIndex} was expected, so the track would not line up with the video`
    );
  }
  return message.message || 'the tracking pass failed';
}

/** The parameters hash a finished layer would have, for "is this still current?". */
export function currentTrackingHash(params: TrackingParameters): string {
  return hashTrackingParameters(params);
}
