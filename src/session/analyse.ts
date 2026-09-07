/**
 * Running the analysis engine over a video in the session (D9, D20, D51, D52,
 * D55): `derive(auto ⊕ corrections)` with the session's maze map, this video's
 * transform and the parameters in force.
 *
 * The first run stamps the parameters into the session file (D51) so every
 * derived layer and export from then on names the set it was made with. The
 * result is written back only as a cache (`toDerivedLayer`), never as the
 * truth: a reload re-derives from `auto ⊕ corrections`, and the full
 * `DerivedAnalysis` — trial bounds, cleaning report, strategy reasoning,
 * review flags — is what the review step keeps in memory and renders from.
 */
import { derive, toDerivedLayer, type DeriveInput, type DerivedAnalysis } from '../analysis/derive.js';
import type { SessionStore } from './session-store.js';
import type { VideoId } from './stored.js';

/** Why a video cannot be analysed yet, in the words the UI shows. */
export function analysisBlockedReason(store: SessionStore, videoId: VideoId): string | null {
  if (!store.videoById(videoId)) return 'this video is not in the session';
  if (!store.current.mazeMap) return 'the maze has not been finished yet';
  if (!store.analysisFor(videoId)) return 'this video has not been tracked yet';
  return null;
}

/**
 * Everything `derive` needs for one video, or null when the video has no
 * automatic layer or the session has no maze map. The timebase record comes
 * from the open file when the video is attached; without it the quality
 * report measures drift from the frame timestamps instead (D7).
 */
export function deriveInputFor(store: SessionStore, videoId: VideoId): DeriveInput | null {
  const video = store.videoById(videoId);
  const analysis = store.analysisFor(videoId);
  const mazeMap = store.current.mazeMap;
  if (!video || !analysis || !mazeMap) return null;
  const attachment = store.attachmentFor(videoId);
  return {
    videoId,
    auto: analysis.auto,
    corrections: analysis.corrections,
    mazeMap,
    mazeTransform: video.mazeTransform,
    index: {
      width: video.referenceResolution.width,
      height: video.referenceResolution.height,
      ...(attachment ? { timebaseAnomalies: attachment.index.timebaseAnomalies } : {}),
    },
    parameters: store.parameters,
  };
}

export interface AnalysisRun {
  analysis: DerivedAnalysis;
  /** Wall-clock time spent inside `derive`, ms — the D22 budget is 50 ms. */
  deriveMs: number;
}

/**
 * Derives one video, stamps the parameters on the first run (D51) and writes
 * the derived cache (D52). Returns null when the video cannot be analysed yet;
 * throws what `derive` throws (an uncalibrated map, invalid parameters).
 */
export function analyseVideo(store: SessionStore, videoId: VideoId): AnalysisRun | null {
  const input = deriveInputFor(store, videoId);
  if (!input) return null;
  const parameters = store.ensureParameters();
  const started = performance.now();
  const analysis = derive({ ...input, parameters });
  const deriveMs = performance.now() - started;
  store.setDerivedLayer(videoId, toDerivedLayer(analysis));
  return { analysis, deriveMs };
}
