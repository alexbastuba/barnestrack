/**
 * The tidy export rows (D11, D12). One row per trial, per event and per video,
 * each carrying the tool version, the export schema version and the parameters
 * hash, plus every event-defining threshold as its own column — so a row is
 * still self-describing months later without a legend.
 *
 * `toolVersion` defaults to the version recorded in the session and can be
 * overridden by the build doing the exporting, since the derived layer is
 * recomputed on load (D9, D12).
 *
 * Pure: no DOM, no video, no I/O. `parametersHash` is copied from the video's
 * quality report, where chunk 5 stamps the hash of the full parameter set (D51);
 * nothing here computes a hash.
 */
import type { EventRow, QualityRow, TrialRow } from '../contracts/exportRows.js';
import { EXPORT_SCHEMA_VERSION } from '../contracts/exportRows.js';
import type { Parameters } from '../contracts/parameters.js';
import type {
  DerivedLayer,
  SessionFile,
  VideoAnalysis,
  VideoDescriptor,
} from '../contracts/session.js';

/** Seconds are reported to 3 dp and centimetres to 2 dp; fractions are left alone. */
function seconds(value: number): number;
function seconds(value: number | null): number | null;
function seconds(value: number | null): number | null {
  return value === null ? null : round(value, 3);
}

function centimetres(value: number): number {
  return round(value, 2);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The session has no separate identifier, so the cohort name is what identifies
 * it in an export (D47 makes the name the user-editable cohort label).
 */
function sessionId(session: SessionFile): string {
  return session.name;
}

interface AnalysedVideo {
  descriptor: VideoDescriptor;
  analysis: VideoAnalysis & { derived: DerivedLayer };
}

function hasDerived(
  analysis: VideoAnalysis,
): analysis is VideoAnalysis & { derived: DerivedLayer } {
  return analysis.derived !== null;
}

/**
 * Videos in session order that have actually been tracked *and* analysed
 * (D47: no placeholders). A tracked but unanalysed video has no derived layer
 * (D52), so it has no metrics, events or quality report to write: it
 * contributes no row at all rather than a row of zeroes and blank hashes (D16).
 */
function analysedVideos(session: SessionFile): AnalysedVideo[] {
  const out: AnalysedVideo[] = [];
  for (const descriptor of session.videos) {
    const analysis = session.analyses[descriptor.id];
    if (analysis && hasDerived(analysis)) out.push({ descriptor, analysis });
  }
  return out;
}

function provenance(
  session: SessionFile,
  analysis: AnalysedVideo['analysis'],
  toolVersion: string,
) {
  return {
    toolVersion,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    parametersHash: analysis.derived.quality.parametersHash,
  } as const;
}

/** Every threshold that defines an event or a cleaning step, flattened (D11). */
function thresholdColumns(parameters: Parameters) {
  return {
    holeInvestigationRadiusFactor: parameters.holeInvestigation.radiusFactor,
    holeInvestigationMinDuration_s: parameters.holeInvestigation.minDuration_s,
    holeInvestigationMergeGap_s: parameters.holeInvestigation.mergeGap_s,
    escapeEntryRadiusFactor: parameters.escapeEntry.radiusFactor,
    escapeEntryMinDuration_s: parameters.escapeEntry.minDuration_s,
    escapeEntryPersistCutoff_s: parameters.escapeEntry.persistCutoff_s,
    trialCutoff_s: parameters.trialCutoff_s,
    targetQuadrantHoleSpan: parameters.targetQuadrant.holeSpan,
    gapFillMaxDuration_s: parameters.gapFilling.maxDuration_s,
    noseConfidenceCutoff: parameters.noseConfidenceCutoff,
    outlierVelocityThreshold_cmPerS: parameters.outlierVelocityThreshold_cmPerS,
  } as const;
}

/*
 * Only `trialRows` needs `parameters`, because only it carries the threshold
 * columns. `eventRows` and `qualityRows` read nothing from them and so have no
 * reason to refuse. In practice the distinction never shows: D47 stamps
 * `parameters` at the first analysis run, so a session with a null parameter
 * set has no `analyses` either and all three return nothing.
 */
export function trialRows(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
): TrialRow[] {
  const parameters = session.parameters;
  if (!parameters) return [];
  const thresholds = thresholdColumns(parameters);
  return analysedVideos(session).map(({ descriptor, analysis }) => {
    const metrics = analysis.derived.metrics;
    return {
      sessionId: sessionId(session),
      videoId: descriptor.id,
      animal: descriptor.metadata.animal ?? null,
      day: descriptor.metadata.day ?? null,
      trialLabel: descriptor.metadata.trial ?? null,
      group: descriptor.metadata.group ?? null,
      trialStart_s: seconds(metrics.trialStart_s),
      primaryLatency_s: seconds(metrics.primaryLatency_s),
      totalLatency_s: seconds(metrics.totalLatency_s),
      primaryErrors: metrics.primaryErrors,
      totalErrors: metrics.totalErrors,
      pathLength_cm: centimetres(metrics.pathLength_cm),
      pathLengthSmoothed_cm: centimetres(metrics.pathLengthSmoothed_cm),
      meanSpeed_cmPerS: centimetres(metrics.meanSpeed_cmPerS),
      targetQuadrantTime_s: seconds(metrics.targetQuadrantTime_s),
      strategy: metrics.strategy,
      strategySource: metrics.strategySource,
      escaped: metrics.escaped,
      status: metrics.status,
      trackedFraction: metrics.trackedFraction,
      correctionCount: metrics.correctionCount,
      ...thresholds,
      ...provenance(session, analysis, toolVersion),
    };
  });
}

/**
 * One row per investigation or escape-box entry. A tracking failure is never an
 * event row: O4 makes it a finding of the quality report, and `events.csv`'s
 * documented `kind` domain is `investigation | escape_entry`. The failure keeps
 * its `EventRecord` — it is reported in `quality.csv` and in the timeline.
 */
export function eventRows(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
): EventRow[] {
  const rows: EventRow[] = [];
  for (const { descriptor, analysis } of analysedVideos(session)) {
    for (const event of analysis.derived.events) {
      if (event.kind === 'tracking_failure') continue;
      const corrected = event.source === 'corrected';
      rows.push({
        sessionId: sessionId(session),
        videoId: descriptor.id,
        trialLabel: descriptor.metadata.trial ?? null,
        eventId: event.id,
        kind: event.kind,
        holeIndex: event.holeIndex,
        isTarget: event.isTarget,
        startFrame: event.startFrame,
        endFrame: event.endFrame,
        startTime_s: seconds(event.startTime_s),
        endTime_s: seconds(event.endTime_s),
        durationSeconds: seconds(event.durationSeconds),
        pointUsed: event.pointUsed,
        minNoseDistance_cm: centimetres(event.minNoseDistance_cm),
        minCentroidDistance_cm: centimetres(event.minCentroidDistance_cm),
        evidenceSummary: event.evidence,
        source: event.source,
        autoHoleIndex: corrected ? (event.autoShadow?.holeIndex ?? null) : null,
        autoStartFrame: corrected ? (event.autoShadow?.startFrame ?? null) : null,
        autoEndFrame: corrected ? (event.autoShadow?.endFrame ?? null) : null,
        ...provenance(session, analysis, toolVersion),
      });
    }
  }
  return rows;
}

export function qualityRows(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
): QualityRow[] {
  return analysedVideos(session).map(({ descriptor, analysis }) => {
    const quality = analysis.derived.quality;
    return {
      sessionId: sessionId(session),
      videoId: descriptor.id,
      trackedFraction: quality.detectionStateFractions.tracked,
      notDetectedFraction: quality.detectionStateFractions.not_detected,
      ambiguousFraction: quality.detectionStateFractions.ambiguous,
      lowConfidenceFraction: quality.detectionStateFractions.low_confidence,
      gapCount: quality.gaps.length,
      longestGap_s: seconds(quality.longestGapSeconds),
      duplicateTimestampCount: quality.timebaseAnomalies.duplicateTimestampCount,
      droppedFrameGapCount: quality.timebaseAnomalies.droppedFrameGapCount,
      driftSeconds: seconds(quality.timebaseAnomalies.driftSeconds),
      platformDiameter_cm: centimetres(quality.platformDiameter_cm),
      pxPerCm: quality.pxPerCm,
      tier: quality.tier,
      ...provenance(session, analysis, toolVersion),
    };
  });
}
