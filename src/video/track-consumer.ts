/**
 * The `track` frame consumer: chunk 2's tracker driven by chunk 1's decode
 * loop (D5, D6).
 *
 * It lives outside `track-worker.ts` because a worker cannot run in Node —
 * there is no `VideoDecoder` — so this is the piece the unit tests exercise
 * over decoded frames directly, and the worker is a thin wrapper around it.
 * Nothing here touches the DOM.
 */
import {
  createTracker,
  prepareTracking,
  type LivePreview,
  type Preparation,
  type Tracker,
} from '../analysis/tracker/tracker.js';
import type { GrayFrame } from './decoder.js';
import { downscaleGray } from './preview.js';
import type { TrackPreview, TrackResult, TrackStartConfig } from './worker-protocol.js';

export interface TrackConsumerOptions extends TrackStartConfig {
  width: number;
  height: number;
}

export interface TrackConsumer {
  /** Threshold, px/cm and contamination warnings, ready before the first frame. */
  readonly preparation: Preparation;
  /** How long preparation took, ms. */
  readonly prepareMs: number;
  onFrame(frame: GrayFrame): void;
  /** The most recent preview, or null when none was due since the last read. */
  takePreview(): TrackPreview | null;
  finish(): TrackResult;
}

/**
 * Builds the background model and the tracker. Preparation runs here — in the
 * worker, on the real path — so the median of ~150 planes and the Otsu
 * threshold never block the page.
 */
export function createTrackConsumer(options: TrackConsumerOptions): TrackConsumer {
  const { width, height, platform, platformDiameter_cm, params, samples, holes } = options;
  const previewEvery = Math.max(0, Math.floor(options.previewEvery));
  const previewMaxEdge = options.previewMaxEdge;

  const prepareStarted = performance.now();
  const preparation = prepareTracking({
    width,
    height,
    platform,
    platformDiameter_cm,
    params,
    samples,
  });
  const prepareMs = performance.now() - prepareStarted;

  // The preview is written by the tracker's callback during onFrame and read
  // by the caller straight after, so only the newest frame is ever posted: a
  // slow consumer drops previews rather than queueing stale ones.
  let pendingPreview: TrackPreview | null = null;
  let currentGray: GrayFrame | null = null;

  const onLivePreview =
    previewEvery > 0
      ? (live: LivePreview): void => {
          const frame = currentGray;
          if (!frame) return;
          const plane = downscaleGray(frame.gray, frame.width, frame.height, previewMaxEdge);
          const s = plane.scale;
          pendingPreview = {
            ...plane,
            centroid: live.centroid ? { x: live.centroid.x * s, y: live.centroid.y * s } : null,
            axis: live.axis
              ? {
                  ax: live.axis.ax * s,
                  ay: live.axis.ay * s,
                  bx: live.axis.bx * s,
                  by: live.axis.by * s,
                }
              : null,
            candidateCount: live.candidateCount,
          };
        }
      : undefined;

  const tracker: Tracker = createTracker({
    width,
    height,
    platform,
    pxPerCm: preparation.pxPerCm,
    params,
    background: preparation.background,
    threshold: preparation.threshold,
    holes,
    warnings: preparation.warnings,
    ...(onLivePreview ? { onLivePreview, livePreviewEvery: previewEvery } : {}),
  });

  return {
    preparation,
    prepareMs,
    onFrame(frame) {
      // `frame.gray` is reused after this call returns, so the preview
      // callback downscales it here and never retains the plane.
      currentGray = frame;
      tracker.onFrame(frame.gray, frame.presIndex, frame.t_s);
      currentGray = null;
    },
    takePreview() {
      const preview = pendingPreview;
      pendingPreview = null;
      return preview;
    },
    finish() {
      const result = tracker.finish();
      // candidates, axes and noseCues are evidence, not session data.
      return { frames: result.frames, summary: result.summary, timing: result.timing };
    },
  };
}
