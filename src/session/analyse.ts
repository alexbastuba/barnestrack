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
import { hashParameters } from '../analysis/parameters.js';
import type { SessionFile } from '../contracts/session.js';
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

export interface CohortRun {
  /** One entry per video that could be derived, in session order. */
  runs: Map<VideoId, AnalysisRun>;
  /** Videos that could not be derived, with the reason `analysisBlockedReason` gives. */
  skipped: Map<VideoId, string>;
  /** Wall-clock time inside `derive`, summed over the cohort, ms. */
  deriveMs: number;
}

/**
 * Derives every video in the session that can be derived (D28: the parameters
 * are shared, so one threshold change moves every video's numbers at once).
 *
 * A video that throws is skipped with its message rather than taking the whole
 * cohort down: one uncalibrated transform must not stop the other two videos
 * from being re-derived, and the caller reports what was skipped.
 */
export function analyseAllVideos(store: SessionStore): CohortRun {
  const runs = new Map<VideoId, AnalysisRun>();
  const skipped = new Map<VideoId, string>();
  let deriveMs = 0;
  for (const video of store.videos) {
    const blocked = analysisBlockedReason(store, video.id);
    if (blocked) {
      skipped.set(video.id, blocked);
      continue;
    }
    try {
      const run = analyseVideo(store, video.id);
      if (!run) {
        skipped.set(video.id, 'this video has nothing to derive from');
        continue;
      }
      runs.set(video.id, run);
      deriveMs += run.deriveMs;
    } catch (error) {
      skipped.set(video.id, (error as Error).message);
    }
  }
  return { runs, skipped, deriveMs };
}

/**
 * The videos whose derived cache was computed under a different parameter set
 * than the one the session now carries — the A2 signature. Compares
 * `derived.quality.parametersHash` (the hash `derive` stamped) with the hash of
 * `session.parameters` (what an export's `parameters.json` and every
 * `parameters_hash` column would name).
 */
export function staleAnalyses(session: SessionFile): VideoId[] {
  if (session.parameters === null) return [];
  const expected = hashParameters(session.parameters);
  return session.videos
    .filter((video) => {
      const derived = session.analyses[video.id]?.derived;
      return derived !== null && derived !== undefined && derived.quality.parametersHash !== expected;
    })
    .map((video) => video.id);
}

/**
 * Derives every video that can be derived and does not already carry a cache
 * made with the parameters in force.
 *
 * The store drops the derived layer whenever anything a derive reads changes,
 * which is what makes "no cache" mean "needs deriving" rather than "was never
 * analysed" — but only if something re-derives. Without this, loading a session
 * file or nudging the maze leaves an analysed cohort looking unanalysed: the
 * figures empty, the export button disabled, and the "N of M not analysed" line
 * asserting something false about videos that are analysed (D33 promises the
 * example cohort renders every result with no video attached).
 */
export function analyseMissing(store: SessionStore): CohortRun {
  const session = store.current;
  const expected = session.parameters === null ? null : hashParameters(session.parameters);
  const runs = new Map<VideoId, AnalysisRun>();
  const skipped = new Map<VideoId, string>();
  let deriveMs = 0;
  for (const video of store.videos) {
    const blocked = analysisBlockedReason(store, video.id);
    if (blocked) {
      skipped.set(video.id, blocked);
      continue;
    }
    const derived = store.analysisFor(video.id)?.derived;
    if (derived && expected !== null && derived.quality.parametersHash === expected) continue;
    try {
      const run = analyseVideo(store, video.id);
      if (!run) {
        skipped.set(video.id, 'this video has nothing to derive from');
        continue;
      }
      runs.set(video.id, run);
      deriveMs += run.deriveMs;
    } catch (error) {
      skipped.set(video.id, (error as Error).message);
    }
  }
  return { runs, skipped, deriveMs };
}

export interface ExportReadiness {
  /** Why the export must not be built, or null when the session is consistent. */
  blocked: string | null;
  /** Time spent re-deriving the cohort for this check, ms. */
  deriveMs: number;
  /** How many videos carry a fresh derived layer. */
  analysed: number;
}

/**
 * Re-derives the cohort and checks it before an export is built (trust audit
 * A2). An export must never be assembled from a derived cache: the cache is
 * per video, the parameters are shared, and a row whose numbers came from one
 * parameter set while its `parameters_hash` column names another is exactly
 * the reconciliation D11 and D12 exist to make possible.
 *
 * The store now invalidates the caches on every input change, so after this
 * re-derive a mismatch should be unreachable. It is checked anyway and, on a
 * mismatch, the export is refused with the reason: this is an internal
 * consistency stop, not a user state. Marking the row instead would mean a new
 * `trials.csv` column or a new `status` value, and that is a D11 schema change
 * needing sign-off and a version bump.
 */
export function prepareExport(store: SessionStore): ExportReadiness {
  const cohort = analyseAllVideos(store);
  const session = store.current;
  const expected = session.parameters === null ? null : hashParameters(session.parameters);
  if (expected === null) {
    return { blocked: 'no video has been analysed yet, so there are no parameters to export', deriveMs: cohort.deriveMs, analysed: 0 };
  }
  const analysed = session.videos.filter((video) => session.analyses[video.id]?.derived).length;
  const stale = staleAnalyses(session);
  if (stale.length > 0) {
    const names = stale.map((id) => session.videos.find((v) => v.id === id)?.filename ?? id);
    return {
      blocked: `the analysis of ${names.join(', ')} does not match the parameters in force, so the export would carry numbers and a parameters hash that disagree. Re-run the analysis on the Review step; if this persists it is a defect, not a setting.`,
      deriveMs: cohort.deriveMs,
      analysed,
    };
  }
  return { blocked: null, deriveMs: cohort.deriveMs, analysed };
}
