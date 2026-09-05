/**
 * Messages between the main thread and the tracking-pass worker (D5).
 * The worker decodes every frame sequentially and hands each gray plane to
 * a pluggable per-frame consumer. In this chunk the only consumer hashes the
 * plane (`frame-hash.ts`); the tracker drops in as another consumer without
 * touching the decode loop.
 */
import type { Mp4Index } from './mp4-index.js';

export type FrameConsumerKind = 'hash';

export interface StartMessage {
  type: 'start';
  file: Blob;
  index: Mp4Index;
  consumer: FrameConsumerKind;
  /** Fallback-ladder knob (see prototype RESULTS.md); default false. */
  optimizeForLatency?: boolean;
  /** Default `prefer-software` (see `DecoderTuning`); `no-preference` lets the browser use hardware. */
  hardwareAcceleration?: HardwareAcceleration;
}

export interface CancelMessage {
  type: 'cancel';
}

export type WorkerRequest = StartMessage | CancelMessage;

export interface ProgressMessage {
  type: 'progress';
  presIndex: number;
  /** Frames per second since the start of the pass. */
  fps: number;
  etaSeconds: number;
}

export interface DoneMessage {
  type: 'done';
  frameCount: number;
  elapsedMs: number;
  fps: number;
  /** Peak `performance.memory.usedJSHeapSize` sampled in the worker, when the browser exposes it. */
  peakHeapBytes?: number;
  /** Consumer output: for `hash`, one FNV-1a value per presIndex. */
  hashes?: Uint32Array;
}

export interface CancelledMessage {
  type: 'cancelled';
  frameCount: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  name: string;
  /** Set for out-of-order decoder output, the duplicate-timestamp failure mode. */
  expectedPresIndex?: number;
  receivedPresIndex?: number;
}

export type WorkerResponse = ProgressMessage | DoneMessage | CancelledMessage | ErrorMessage;
