/**
 * The one entry point of the analysis engine (D9, D20, D22):
 * `derive(auto ⊕ corrections, maze, parameters) → derived`. Pure and
 * deterministic; never mutates its inputs; no DOM, no video, no clock.
 *
 * Order: validate → geometry → point/range corrections → cleaning → trial
 * start → losses and the automatic trial end → investigations → event
 * corrections → (further detection passes while a correction moves the first
 * persistent escape entry, so the trial end follows the corrected events) →
 * kinematics → strategy → metrics → quality.
 */
import type { MazeMapFile, SimilarityTransform } from '../contracts/mazeMap.js';
import type { Parameters } from '../contracts/parameters.js';
import type { AutoLayer, CorrectionsLayer, DerivedLayer } from '../contracts/session.js';
import type { Mp4Index } from '../video/mp4-index.js';
import { cleanTrack, type CleaningReport } from './clean.js';
import { applyTrackCorrections, latestCorrection } from './corrections.js';
import {
  applyEventCorrections,
  detectAutoEvents,
  eventPoints,
  type AutoEvents,
  type EventContext,
} from './events.js';
import { mazeGeometry, type MazeGeometry } from './geometry.js';
import { computeKinematics, type KinematicsSummary } from './kinematics.js';
import { computeMetrics, isPersistentEscape } from './metrics.js';
import {
  ANALYSIS_MODEL,
  assertValidParameters,
  hashParameters,
  hashTrackingParameters,
} from './parameters.js';
import { qualityReport } from './quality.js';
import { classifyStrategy, type StrategyResult } from './strategy.js';
import { buildTrackArrays, framePosition } from './track-arrays.js';
import {
  OVERSIZED_REASON,
  proposeTrialStart,
  resolveTrialEnd,
  trialBounds,
  type TrialBounds,
} from './trial.js';
import type { ReviewFlag } from './types.js';

export interface DeriveInput {
  videoId: string;
  auto: AutoLayer;
  corrections: CorrectionsLayer;
  mazeMap: MazeMapFile;
  /** Where the shared map sits in this video (D10, D49). */
  mazeTransform: SimilarityTransform;
  /** The video's reference resolution and, when the video is attached, the index's timebase record. */
  index: Pick<Mp4Index, 'width' | 'height'> & Partial<Pick<Mp4Index, 'timebaseAnomalies'>>;
  /** Every threshold, including the strategy, censoring and tier blocks (D55). */
  parameters: Parameters;
}

/**
 * The persisted `DerivedLayer` plus the explanations the UI shows: trial
 * bounds, the cleaning report, kinematics, the strategy reasoning and the
 * review flags. `toDerivedLayer` picks the contract fields.
 */
export interface DerivedAnalysis extends DerivedLayer {
  parametersHash: string;
  trackingParametersHash: string;
  geometry: MazeGeometry;
  trial: TrialBounds;
  cleaning: CleaningReport;
  kinematics: KinematicsSummary;
  strategy: StrategyResult;
  reviewFlags: ReviewFlag[];
  correctionsApplied: { point: number; range: number; event: number };
}

export function toDerivedLayer(analysis: DerivedAnalysis): DerivedLayer {
  return {
    cleanedTrack: analysis.cleanedTrack,
    events: analysis.events,
    metrics: analysis.metrics,
    quality: analysis.quality,
  };
}

export function derive(input: DeriveInput): DerivedAnalysis {
  const { videoId, auto, corrections, mazeMap, mazeTransform, index, parameters } = input;
  assertValidParameters(parameters);
  const parametersHash = hashParameters(parameters);
  const trackingParametersHash = hashTrackingParameters(parameters.tracking);

  const g = mazeGeometry({
    map: mazeMap,
    transform: mazeTransform,
    referenceResolution: { width: index.width, height: index.height },
    parameters,
  });

  const corrected = applyTrackCorrections(auto.frames, corrections);
  const correctedArrays = buildTrackArrays(corrected.frames, g);
  const cleaned = cleanTrack(corrected.frames, correctedArrays, g, parameters);
  const a = buildTrackArrays(cleaned.track, g);

  const proposal = proposeTrialStart(cleaned.track, a, corrections);
  const pts = eventPoints(a, g, parameters, cleaned.track);
  const ctx: EventContext = { frames: cleaned.track, a, g, p: parameters, pts };

  let autoEvents: AutoEvents = detectAutoEvents(ctx, proposal.startFrame);
  let correctedEvents = applyEventCorrections(
    ctx,
    autoEvents.events,
    corrections,
    autoEvents.endFrame,
  );
  const endFlags: ReviewFlag[] = [];
  if (proposal.startFrame !== null && autoEvents.endFrame !== null) {
    // The trial end follows the corrected events: a deleted or moved escape entry moves it, and a
    // later persistent entry revealed by the move can take over. The end only moves within the
    // window, so a few passes reach a fixed point; the bound is a documented model constant.
    const lastFrameIndex = cleaned.track[cleaned.track.length - 1]!.frameIndex;
    for (let pass = 0; pass < ANALYSIS_MODEL.trialEndPasses; pass++) {
      let escapePosition: number | null = null;
      for (const ev of correctedEvents.events) {
        if (!isPersistentEscape(ev, lastFrameIndex, parameters)) continue;
        const position = framePosition(cleaned.track, ev.startFrame);
        if (position < 0) continue;
        if (position < proposal.startFrame) {
          if (!endFlags.some((f) => f.eventId === ev.id)) {
            endFlags.push({
              code: 'correction_out_of_range',
              eventId: ev.id,
              frameIndex: ev.startFrame,
              message: `Escape entry ${ev.id} starts at frame ${ev.startFrame}, before the trial start at frame ${cleaned.track[proposal.startFrame]!.frameIndex}; it cannot end the trial. Check the correction that placed it.`,
            });
          }
          continue;
        }
        if (escapePosition === null || position < escapePosition) escapePosition = position;
      }
      const end = resolveTrialEnd(a, proposal.startFrame, autoEvents.cutoffFrame, escapePosition);
      if (end.endFrame === autoEvents.endFrame && end.endReason === autoEvents.endReason) break;
      autoEvents = detectAutoEvents(ctx, proposal.startFrame, {
        endFrame: end.endFrame!,
        endReason: end.endReason,
      });
      correctedEvents = applyEventCorrections(
        ctx,
        autoEvents.events,
        corrections,
        autoEvents.endFrame,
      );
    }
  }
  const bounds = trialBounds(a, proposal, autoEvents.cutoffFrame, {
    endFrame: autoEvents.endFrame,
    endReason: autoEvents.endReason,
  });

  // A flag raised on an automatic event goes with the event: once the user has deleted it, the
  // flag has nothing to point at, and a trial must be able to reach "ok" after review (D20).
  const liveEventIds = new Set(correctedEvents.events.map((ev) => ev.id));
  const flagFollowsEvent = (f: ReviewFlag): boolean =>
    f.code === 'physically_unlikely_entry' || f.code === 'tracking_failure_at_hole';
  const reviewFlags: ReviewFlag[] = [
    ...corrected.flags,
    ...proposal.flags,
    ...autoEvents.flags,
    ...correctedEvents.flags,
    ...endFlags,
  ].filter((f) => !(flagFollowsEvent(f) && f.eventId !== undefined && !liveEventIds.has(f.eventId)));
  // D51: the automatic layer is keyed by the hash of the tracking parameters that produced it.
  // A tracking threshold changed after the pass leaves the track as it was; the parameters hash
  // stamped on this analysis would then name a configuration that never ran, so say so.
  if (auto.parametersHash !== trackingParametersHash) {
    reviewFlags.push({
      code: 'stale_auto_layer',
      message: `This track was produced with tracking parameters ${auto.parametersHash.slice(0, 8)}…, not the ${trackingParametersHash.slice(0, 8)}… in force now: re-track the video before trusting the parameters hash on any export.`,
    });
  }
  if (bounds.startFrame !== null && bounds.endFrame !== null) {
    let count = 0;
    let first = -1;
    for (let i = bounds.startFrame; i <= bounds.endFrame; i++) {
      if (cleaned.track[i]!.reason === OVERSIZED_REASON) {
        count++;
        if (first < 0) first = i;
      }
    }
    if (count > 0) {
      reviewFlags.push({
        code: 'oversized_in_trial',
        frameIndex: cleaned.track[first]!.frameIndex,
        message: `${count} frame${count === 1 ? '' : 's'} inside the trial show an oversized foreground (a hand or the start cylinder), the first at ${a.t[first]!.toFixed(2)} s: check the trial start and what happened there.`,
      });
    }
  }

  const trialWindow =
    bounds.startFrame === null || bounds.endFrame === null
      ? null
      : { startFrame: bounds.startFrame, endFrame: bounds.endFrame };
  const kinematics = computeKinematics(a, g, parameters, trialWindow);
  const strategy = classifyStrategy({
    events: correctedEvents.events,
    kinematics,
    a,
    frames: cleaned.track,
    g,
    bounds,
    corrections,
    parameters,
  });
  /*
   * D63: the human's "this animal never entered the escape box", contradicted the moment an escape
   * entry appears beside it — a threshold change or a range correction can produce one after the
   * confirmation was recorded — and then the entry wins and the trial goes back to review.
   *
   * The test is *any* escape entry, not only the one that ended the trial. An entry that is too
   * short to be persistent (O4), or one outside the trial window, is still an `escape_entry` row in
   * `events.csv` at the escape hole while `escaped` stays false, so the trial-ending test alone
   * would let `escaped = false, no_escape_confirmed = true, status = ok` ship over an entry the
   * tool itself found and printed. The two cases read differently and say so.
   */
  const noEscape = latestCorrection(corrections.entries, 'no_escape');
  const escapeEntries = correctedEvents.events.filter((ev) => ev.kind === 'escape_entry');
  if (noEscape !== null && escapeEntries.length > 0) {
    const because = noEscape.reason ? ` ("${noEscape.reason}")` : '';
    const first = escapeEntries.reduce((a, b) => (a.startFrame <= b.startFrame ? a : b));
    reviewFlags.push({
      code: 'no_escape_contradicted',
      correctionId: noEscape.id,
      frameIndex: first.startFrame,
      message:
        bounds.endReason === 'escape'
          ? `An escape entry ends this trial at ${bounds.endTime_s.toFixed(2)} s, contradicting the confirmation that the animal never entered the escape box${because}. The entry stands: revert the confirmation, or revert what produced the entry.`
          : `${escapeEntries.length === 1 ? 'An escape entry was' : `${escapeEntries.length} escape entries were`} detected at ${first.startTime_s.toFixed(2)} s, contradicting the confirmation that the animal never entered the escape box${because}. ${escapeEntries.length === 1 ? 'It is' : 'They are'} too short to end the trial, or outside it, so the trial is not marked escaped — check the entry and then either revert the confirmation or delete the entry.`,
    });
  }

  const metrics = computeMetrics({
    bounds,
    events: correctedEvents.events,
    flags: reviewFlags,
    kinematics,
    a,
    strategy,
    noEscapeConfirmed: noEscape !== null,
    // A confirmation ("Keep": an event correction marked `confirmed`) says the
    // tool was right, so counting it as a correction would report a hand edit
    // that never happened — a queue of thirty good events walked with K would
    // export `correction_count = 30` (D11, D26).
    correctionCount: corrections.entries.filter(
      (entry) => !(entry.kind === 'event' && entry.confirmed === true),
    ).length,
    parameters,
  });
  const quality = qualityReport({
    videoId,
    corrected: correctedArrays,
    cleaned: a,
    frames: cleaned.track,
    events: correctedEvents.events,
    g,
    p: parameters,
    parametersHash,
    bounds,
    indexTimebase: index.timebaseAnomalies ?? null,
  });

  return {
    cleanedTrack: cleaned.track,
    events: correctedEvents.events,
    metrics,
    quality,
    parametersHash,
    trackingParametersHash,
    geometry: g,
    trial: bounds,
    cleaning: cleaned.report,
    kinematics,
    strategy,
    reviewFlags,
    correctionsApplied: {
      point: corrected.pointCorrections,
      range: corrected.rangeCorrections,
      event: correctedEvents.applied,
    },
  };
}
