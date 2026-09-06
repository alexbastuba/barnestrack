/**
 * Messages between the main thread and the tracking-pass worker (D5).
 * The worker decodes every frame sequentially and hands each gray plane to
 * a pluggable per-frame consumer. `hash` hashes the plane (`frame-hash.ts`);
 * `track` runs chunk 2's tracker over it (`track-consumer.ts`). Neither
 * touches the decode loop.
 */
import type { PlatformCircle } from '../analysis/tracker/calibration.js';
import type { ThresholdChoice } from '../analysis/tracker/foreground.js';
import type { HoleCircle } from '../analysis/tracker/nose.js';
import type { TrackerSummary, TrackerTiming } from '../analysis/tracker/tracker.js';
import type { TrackingParameters } from '../contracts/parameters.js';
import type { TrackFrame } from '../contracts/track.js';
import type { Mp4Index } from './mp4-index.js';
import type { PreviewPlane } from './preview.js';

export type FrameConsumerKind = 'hash' | 'track';

interface StartBase {
  type: 'start';
  file: Blob;
  index: Mp4Index;
  /** Fallback-ladder knob (see prototype RESULTS.md); default false. */
  optimizeForLatency?: boolean;
  /** Default `prefer-software` (see `DecoderTuning`); `no-preference` lets the browser use hardware. */
  hardwareAcceleration?: HardwareAcceleration;
}

export interface StartHashMessage extends StartBase {
  consumer: 'hash';
}

export interface StartTrackMessage extends StartBase {
  consumer: 'track';
  track: TrackStartConfig;
}

/**
 * Everything the tracker needs that the worker cannot work out from the file.
 * Spatial values are this video's pixels: the shared maze map after this
 * video's `mazeTransform` (D10, D28, D49), never the map's own pixels.
 */
export interface TrackStartConfig {
  platform: PlatformCircle;
  platformDiameter_cm: number;
  /** Hole centres for the stationary nose cue, in the same pixels as `platform`. */
  holes: HoleCircle[];
  params: TrackingParameters;
  /**
   * Background sample planes read on the main thread (`background-sampler.ts`),
   * transferred rather than copied. The worker computes the median from them,
   * so the ~200 ms of median and Otsu never blocks the page.
   */
  samples: Uint8Array[];
  /** Frames between live-preview posts; 0 turns the thumbnail off. */
  previewEvery: number;
  /** Longest edge of the posted thumbnail, px. */
  previewMaxEdge: number;
}

export interface CancelMessage {
  type: 'cancel';
}

export type WorkerRequest = StartHashMessage | StartTrackMessage | CancelMessage;

/** Sent once by the `track` consumer, before the first frame is decoded. */
export interface PreparedMessage {
  type: 'prepared';
  threshold: ThresholdChoice;
  pxPerCm: number;
  /**
   * Background contamination warnings (a stationary animal or object baked
   * into the median). Shown to the user; never acted on automatically.
   */
  warnings: string[];
  elapsedMs: number;
}

/** The live thumbnail of one frame (D17). Provisional — see `LivePreview`. */
export interface TrackPreview extends PreviewPlane {
  /** Provisional centroid in preview pixels, or null when nothing was found. */
  centroid: { x: number; y: number } | null;
  /** The pick's body axis in preview pixels. */
  axis: { ax: number; ay: number; bx: number; by: number } | null;
  candidateCount: number;
}

export interface ProgressMessage {
  type: 'progress';
  presIndex: number;
  /** Frames per second since the start of the pass. */
  fps: number;
  etaSeconds: number;
  /** Present for the `track` consumer when a preview was due on this frame. */
  preview?: TrackPreview;
}

/**
 * The pass's output. Only `frames` reaches the session: the tracker's
 * candidates, axes and nose cues are evidence for the quality report, not
 * session data, and are dropped before posting.
 */
export interface TrackResult {
  frames: TrackFrame[];
  summary: TrackerSummary;
  timing: TrackerTiming;
}

export interface DoneMessage {
  type: 'done';
  frameCount: number;
  elapsedMs: number;
  fps: number;
  /**
   * Peak `performance.memory.usedJSHeapSize` sampled in the worker, when the
   * browser exposes it — which no browser does inside a worker today, so this
   * is in practice absent on the worker path.
   */
  peakHeapBytes?: number;
  /** Consumer output: for `hash`, one FNV-1a value per presIndex. */
  hashes?: Uint32Array;
  /** Consumer output: for `track`, the pass's frames and summary. */
  track?: TrackResult;
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

export type WorkerResponse =
  | PreparedMessage
  | ProgressMessage
  | DoneMessage
  | CancelledMessage
  | ErrorMessage;
