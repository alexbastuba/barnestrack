/**
 * The export column tables: for each row type, the order of the columns and the
 * `snake_case` header each field is written under (D11).
 *
 * Header text comes from the column tables in `docs/data-contracts.md`, not from
 * a mechanical camelCase→snake_case transform of the field name — the row types
 * say which fields exist and what type they are, and defer the header spelling
 * to this writer (see the comment at the top of `src/contracts/exportRows.ts`).
 * Two headers differ from a mechanical transform for that reason: the documented
 * `duration_s` for `durationSeconds` and `drift_s` for `driftSeconds`, both
 * matching the `_s` unit suffix every neighbouring time column already uses.
 *
 * Each table is a `Record` keyed by the row type, so TypeScript rejects a table
 * that misses a field or invents one, and JavaScript's insertion order for
 * string keys makes the declaration order the column order.
 */
import type { EventRow, QualityRow, TrialRow } from '../contracts/exportRows.js';

export interface ColumnMeta {
  /** The `snake_case` header written to the CSV and the XLSX sheet. */
  header: string;
  /** Unit for the readme sheet; empty when the column is not a measurement. */
  unit: string;
}

export interface ColumnSpec<Row> extends ColumnMeta {
  key: keyof Row & string;
}

function toColumns<Row>(meta: Record<keyof Row, ColumnMeta>): readonly ColumnSpec<Row>[] {
  return (Object.keys(meta) as (keyof Row & string)[]).map((key) => ({ key, ...meta[key] }));
}

const TRIAL_COLUMN_META: Record<keyof TrialRow, ColumnMeta> = {
  sessionId: { header: 'session_id', unit: '' },
  videoId: { header: 'video_id', unit: '' },
  animal: { header: 'animal', unit: '' },
  day: { header: 'day', unit: '' },
  trialLabel: { header: 'trial_label', unit: '' },
  group: { header: 'group', unit: '' },
  targetHole: { header: 'target_hole', unit: 'hole index' },
  trialStart_s: { header: 'trial_start_s', unit: 's' },
  primaryLatency_s: { header: 'primary_latency_s', unit: 's' },
  totalLatency_s: { header: 'total_latency_s', unit: 's' },
  primaryErrors: { header: 'primary_errors', unit: 'count' },
  totalErrors: { header: 'total_errors', unit: 'count' },
  pathLength_cm: { header: 'path_length_cm', unit: 'cm' },
  pathLengthSmoothed_cm: { header: 'path_length_smoothed_cm', unit: 'cm' },
  meanSpeed_cmPerS: { header: 'mean_speed_cm_per_s', unit: 'cm/s' },
  targetQuadrantTime_s: { header: 'target_quadrant_time_s', unit: 's' },
  strategy: { header: 'strategy', unit: '' },
  strategySource: { header: 'strategy_source', unit: '' },
  escaped: { header: 'escaped', unit: 'bool' },
  status: { header: 'status', unit: '' },
  trackedFraction: { header: 'tracked_fraction', unit: '0–1' },
  correctionCount: { header: 'correction_count', unit: 'count' },
  holeInvestigationRadiusFactor: {
    header: 'hole_investigation_radius_factor',
    unit: '× hole radius',
  },
  holeInvestigationMinDuration_s: { header: 'hole_investigation_min_duration_s', unit: 's' },
  holeInvestigationMergeGap_s: { header: 'hole_investigation_merge_gap_s', unit: 's' },
  escapeEntryRadiusFactor: { header: 'escape_entry_radius_factor', unit: '× hole radius' },
  escapeEntryMinDuration_s: { header: 'escape_entry_min_duration_s', unit: 's' },
  escapeEntryPersistCutoff_s: { header: 'escape_entry_persist_cutoff_s', unit: 's' },
  trialCutoff_s: { header: 'trial_cutoff_s', unit: 's' },
  targetQuadrantHoleSpan: { header: 'target_quadrant_hole_span', unit: 'holes' },
  gapFillMaxDuration_s: { header: 'gap_fill_max_duration_s', unit: 's' },
  noseConfidenceCutoff: { header: 'nose_confidence_cutoff', unit: '0–1' },
  outlierVelocityThreshold_cmPerS: {
    header: 'outlier_velocity_threshold_cm_per_s',
    unit: 'cm/s',
  },
  toolVersion: { header: 'tool_version', unit: '' },
  schemaVersion: { header: 'schema_version', unit: '' },
  parametersHash: { header: 'parameters_hash', unit: '' },
};

const EVENT_COLUMN_META: Record<keyof EventRow, ColumnMeta> = {
  sessionId: { header: 'session_id', unit: '' },
  videoId: { header: 'video_id', unit: '' },
  trialLabel: { header: 'trial_label', unit: '' },
  eventId: { header: 'event_id', unit: '' },
  kind: { header: 'kind', unit: '' },
  holeIndex: { header: 'hole_index', unit: '' },
  isTarget: { header: 'is_target', unit: 'bool' },
  startFrame: { header: 'start_frame', unit: '' },
  endFrame: { header: 'end_frame', unit: '' },
  startTime_s: { header: 'start_time_s', unit: 's' },
  endTime_s: { header: 'end_time_s', unit: 's' },
  // `duration_s` in docs/data-contracts.md, not a transform of `durationSeconds`.
  durationSeconds: { header: 'duration_s', unit: 's' },
  pointUsed: { header: 'point_used', unit: '' },
  minNoseDistance_cm: { header: 'min_nose_distance_cm', unit: 'cm' },
  minCentroidDistance_cm: { header: 'min_centroid_distance_cm', unit: 'cm' },
  evidenceSummary: { header: 'evidence_summary', unit: '' },
  source: { header: 'source', unit: '' },
  autoHoleIndex: { header: 'auto_hole_index', unit: '' },
  autoStartFrame: { header: 'auto_start_frame', unit: '' },
  autoEndFrame: { header: 'auto_end_frame', unit: '' },
  toolVersion: { header: 'tool_version', unit: '' },
  schemaVersion: { header: 'schema_version', unit: '' },
  parametersHash: { header: 'parameters_hash', unit: '' },
};

const QUALITY_COLUMN_META: Record<keyof QualityRow, ColumnMeta> = {
  sessionId: { header: 'session_id', unit: '' },
  videoId: { header: 'video_id', unit: '' },
  trackedFraction: { header: 'tracked_fraction', unit: '0–1' },
  notDetectedFraction: { header: 'not_detected_fraction', unit: '0–1' },
  ambiguousFraction: { header: 'ambiguous_fraction', unit: '0–1' },
  lowConfidenceFraction: { header: 'low_confidence_fraction', unit: '0–1' },
  positionedFraction: { header: 'positioned_fraction', unit: '0–1' },
  wholeClipPositionedFraction: { header: 'whole_clip_positioned_fraction', unit: '0–1' },
  noseJudgedEventFraction: { header: 'nose_judged_event_fraction', unit: '0–1' },
  gapCount: { header: 'gap_count', unit: 'count' },
  longestGap_s: { header: 'longest_gap_s', unit: 's' },
  duplicateTimestampCount: { header: 'duplicate_timestamp_count', unit: 'count' },
  droppedFrameGapCount: { header: 'dropped_frame_gap_count', unit: 'count' },
  // `drift_s` in docs/data-contracts.md, not a transform of `driftSeconds`.
  driftSeconds: { header: 'drift_s', unit: 's' },
  platformDiameter_cm: { header: 'platform_diameter_cm', unit: 'cm' },
  pxPerCm: { header: 'px_per_cm', unit: 'px/cm' },
  tier: { header: 'tier', unit: '' },
  toolVersion: { header: 'tool_version', unit: '' },
  schemaVersion: { header: 'schema_version', unit: '' },
  parametersHash: { header: 'parameters_hash', unit: '' },
};

export const TRIAL_COLUMNS = toColumns<TrialRow>(TRIAL_COLUMN_META);
export const EVENT_COLUMNS = toColumns<EventRow>(EVENT_COLUMN_META);
export const QUALITY_COLUMNS = toColumns<QualityRow>(QUALITY_COLUMN_META);
