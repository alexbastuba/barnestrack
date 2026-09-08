/**
 * The header rows are the export's contract with a spreadsheet. These lists are
 * copied from the column tables in `docs/data-contracts.md`, so a change to
 * either the row types or the doc that is not carried into the other fails here
 * rather than shipping.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_COLUMNS, QUALITY_COLUMNS, TRIAL_COLUMNS } from '../../src/export/columns.js';
import { csvHeaderRow, toCsv } from '../../src/export/csv.js';
import { eventRows, qualityRows, trialRows } from '../../src/export/rows.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const DOCUMENTED_TRIAL_HEADERS = [
  'session_id',
  'video_id',
  'animal',
  'day',
  'trial_label',
  'group',
  'target_hole',
  'trial_start_s',
  'primary_latency_s',
  'total_latency_s',
  'primary_errors',
  'total_errors',
  'path_length_cm',
  'path_length_smoothed_cm',
  'mean_speed_cm_per_s',
  'target_quadrant_time_s',
  'strategy',
  'strategy_source',
  'escaped',
  'status',
  'tracked_fraction',
  'correction_count',
  'hole_investigation_radius_factor',
  'hole_investigation_min_duration_s',
  'hole_investigation_merge_gap_s',
  'escape_entry_radius_factor',
  'escape_entry_min_duration_s',
  'escape_entry_persist_cutoff_s',
  'trial_cutoff_s',
  'target_quadrant_hole_span',
  'gap_fill_max_duration_s',
  'nose_confidence_cutoff',
  'outlier_velocity_threshold_cm_per_s',
  'tool_version',
  'schema_version',
  'parameters_hash',
];

const DOCUMENTED_EVENT_HEADERS = [
  'session_id',
  'video_id',
  'trial_label',
  'event_id',
  'kind',
  'hole_index',
  'is_target',
  'start_frame',
  'end_frame',
  'start_time_s',
  'end_time_s',
  'duration_s',
  'point_used',
  'min_nose_distance_cm',
  'min_centroid_distance_cm',
  'evidence_summary',
  'source',
  'auto_hole_index',
  'auto_start_frame',
  'auto_end_frame',
  'tool_version',
  'schema_version',
  'parameters_hash',
];

const DOCUMENTED_QUALITY_HEADERS = [
  'session_id',
  'video_id',
  'tracked_fraction',
  'not_detected_fraction',
  'ambiguous_fraction',
  'low_confidence_fraction',
  'positioned_fraction',
  'whole_clip_positioned_fraction',
  'nose_judged_event_fraction',
  'gap_count',
  'longest_gap_s',
  'duplicate_timestamp_count',
  'dropped_frame_gap_count',
  'drift_s',
  'platform_diameter_cm',
  'px_per_cm',
  'tier',
  'tool_version',
  'schema_version',
  'parameters_hash',
];

describe('export headers', () => {
  it('writes the documented trials.csv header row verbatim (D11)', () => {
    expect(csvHeaderRow(TRIAL_COLUMNS)).toBe(DOCUMENTED_TRIAL_HEADERS.join(','));
  });

  it('writes the documented events.csv header row verbatim (D11)', () => {
    expect(csvHeaderRow(EVENT_COLUMNS)).toBe(DOCUMENTED_EVENT_HEADERS.join(','));
  });

  it('writes the documented quality.csv header row verbatim (D11)', () => {
    expect(csvHeaderRow(QUALITY_COLUMNS)).toBe(DOCUMENTED_QUALITY_HEADERS.join(','));
  });

  it('keeps a column for every field of every row type, and no extras', () => {
    const session = syntheticSession();
    const cases = [
      [TRIAL_COLUMNS, trialRows(session)[0]],
      [EVENT_COLUMNS, eventRows(session)[0]],
      [QUALITY_COLUMNS, qualityRows(session)[0]],
    ] as const;
    for (const [columns, row] of cases) {
      expect(row).toBeDefined();
      expect([...columns.map((column) => column.key)].sort()).toEqual(
        Object.keys(row as object).sort(),
      );
    }
  });

  it('ends every file with a CRLF and no BOM', () => {
    const csv = toCsv(QUALITY_COLUMNS, qualityRows(syntheticSession()));
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});
