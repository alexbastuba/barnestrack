/**
 * The one entry point of the analysis engine (D9, D20, D22):
 * `derive(auto ⊕ corrections, maze, parameters) → derived`. Pure and
 * deterministic; never mutates its inputs; no DOM, no video, no clock.
 *
 * Order: validate → geometry → point/range corrections → cleaning → trial
 * start → losses and the automatic trial end → investigations → event
 * corrections → (a second detection pass when a correction moved the first
 * persistent escape entry, so the trial end follows the corrected events) →
 * kinematics → strategy → metrics → quality.
 */
import type { MazeMapFile, SimilarityTransform } from '../contracts/mazeMap.js';
import type { Parameters } from '../contracts/parameters.js';
import type { AutoLayer, CorrectionsLayer, DerivedLayer } from '../contracts/session.js';
import type { Mp4Index } from '../video/mp4-index.js';
import { cleanTrack, type CleaningReport } from './clean.js';
import { applyTrackCorrections } from './corrections.js';
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
  DEFAULT_ANALYSIS_OPTIONS,
  assertValidParameters,
  hashParameters,
  hashTrackingParameters,
  type AnalysisOptions,
} from './parameters.js';
import { qualityReport } from './quality.js';
import { classifyStrategy, type StrategyResult } from './strategy.js';
import { buildTrackArrays } from './track-arrays.js';
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
  parameters: Parameters;
  /** Thresholds the contract does not carry yet; defaults when omitted. */
  options?: AnalysisOptions;
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
  const options = input.options ?? DEFAULT_ANALYSIS_OPTIONS;
  const parametersHash = hashParameters(parameters);
  const trackingParametersHash = hashTrackingParameters(parameters.tracking);

  const g = mazeGeometry({
    map: mazeMap,
    transform: mazeTransform,
    referenceResolution: { width: index.width, height: index.height },
    parameters,
    options,
  });

  const corrected = applyTrackCorrections(auto.frames, corrections);
  const correctedArrays = buildTrackArrays(corrected.frames, g);
  const cleaned = cleanTrack(corrected.frames, correctedArrays, g, parameters);
  const a = buildTrackArrays(cleaned.track, g);

  const proposal = proposeTrialStart(cleaned.track, a, corrections);
  const pts = eventPoints(a, g, parameters);
  const ctx: EventContext = { frames: cleaned.track, a, g, p: parameters, pts };

  let autoEvents: AutoEvents = detectAutoEvents(ctx, proposal.startFrame);
  let correctedEvents = applyEventCorrections(
    ctx,
    autoEvents.events,
    corrections,
    autoEvents.endFrame,
  );
  if (proposal.startFrame !== null && autoEvents.endFrame !== null) {
    // the trial end follows the corrected events: a deleted or edited escape entry moves it
    const lastFrameIndex = cleaned.track[cleaned.track.length - 1]!.frameIndex;
    const positionOf = new Map<number, number>();
    for (let i = 0; i < cleaned.track.length; i++) positionOf.set(cleaned.track[i]!.frameIndex, i);
    let escapePosition: number | null = null;
    for (const ev of correctedEvents.events) {
      if (!isPersistentEscape(ev, lastFrameIndex, parameters)) continue;
      const position = positionOf.get(ev.startFrame);
      if (position !== undefined && (escapePosition === null || position < escapePosition))
        escapePosition = position;
    }
    const end = resolveTrialEnd(a, proposal.startFrame, autoEvents.cutoffFrame, escapePosition);
    if (end.endFrame !== autoEvents.endFrame || end.endReason !== autoEvents.endReason) {
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

  const reviewFlags: ReviewFlag[] = [
    ...corrected.flags,
    ...proposal.flags,
    ...autoEvents.flags,
    ...correctedEvents.flags,
  ];
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
    g,
    bounds,
    corrections,
    options,
  });
  const metrics = computeMetrics({
    bounds,
    events: correctedEvents.events,
    flags: reviewFlags,
    kinematics,
    a,
    strategy,
    correctionCount: corrections.entries.length,
    parameters,
    options,
  });
  const quality = qualityReport({
    videoId,
    corrected: correctedArrays,
    cleaned: a,
    g,
    p: parameters,
    options,
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
