import { describe, expect, it } from 'vitest';
import { EXPORT_SCHEMA_VERSION } from '../../src/contracts/exportRows.js';
import { TRIAL_COLUMNS } from '../../src/export/columns.js';
import { toCsv } from '../../src/export/csv.js';
import { eventRows, qualityRows, trialRows } from '../../src/export/rows.js';
import {
  FIXTURE_PARAMETERS,
  FIXTURE_PARAMETERS_HASH,
  FIXTURE_TOOL_VERSION,
  syntheticSession,
} from '../fixtures/synthetic-analysis.js';

const session = syntheticSession();

describe('trialRows', () => {
  it('writes one row per tracked video, in session order', () => {
    const rows = trialRows(session);
    expect(rows.map((row) => row.videoId)).toEqual(session.videos.map((video) => video.id));
  });

  it('stamps the tool version, schema version and parameters hash on every row (D12)', () => {
    for (const row of trialRows(session)) {
      expect(row.toolVersion).toBe(FIXTURE_TOOL_VERSION);
      expect(row.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
      expect(row.parametersHash).toBe(FIXTURE_PARAMETERS_HASH);
    }
  });

  it('writes a duration that is the difference of the times beside it (A10)', () => {
    // The contract says durationSeconds = endTime_s − startTime_s. Rounding each of the three
    // independently to 3 dp broke that by up to a millisecond, so a reader recomputing the
    // duration from the columns disagreed with the file — and a bout at exactly the minimum
    // duration could read as below it.
    const rows = eventRows(session);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.durationSeconds, row.eventId).toBeCloseTo(row.endTime_s - row.startTime_s, 12);
    }
  });

  it('names the map’s target hole on every row, and leaves it blank without a map (D62)', () => {
    const rows = trialRows(session);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.targetHole).toBe(session.mazeMap!.target.holeIndex);
    // Gawel's protocol rotates the platform between trials, so the column has to move with the map
    const rotated = { ...session, mazeMap: { ...session.mazeMap!, target: { holeIndex: 13 } } };
    expect(trialRows(rotated).map((r) => r.targetHole)).toEqual(rows.map(() => 13));
    // a session with no map has no analyses either (D47), but the column is nullable regardless
    expect(trialRows({ ...session, mazeMap: null }).every((r) => r.targetHole === null)).toBe(true);
  });

  it('carries every event-defining threshold as its own column (D11)', () => {
    const row = trialRows(session)[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.holeInvestigationRadiusFactor).toBe(
      FIXTURE_PARAMETERS.holeInvestigation.radiusFactor,
    );
    expect(row.holeInvestigationMinDuration_s).toBe(
      FIXTURE_PARAMETERS.holeInvestigation.minDuration_s,
    );
    expect(row.holeInvestigationMergeGap_s).toBe(FIXTURE_PARAMETERS.holeInvestigation.mergeGap_s);
    expect(row.escapeEntryRadiusFactor).toBe(FIXTURE_PARAMETERS.escapeEntry.radiusFactor);
    expect(row.escapeEntryMinDuration_s).toBe(FIXTURE_PARAMETERS.escapeEntry.minDuration_s);
    expect(row.escapeEntryPersistCutoff_s).toBe(FIXTURE_PARAMETERS.escapeEntry.persistCutoff_s);
    expect(row.trialCutoff_s).toBe(FIXTURE_PARAMETERS.trialCutoff_s);
    expect(row.targetQuadrantHoleSpan).toBe(FIXTURE_PARAMETERS.targetQuadrant.holeSpan);
    expect(row.gapFillMaxDuration_s).toBe(FIXTURE_PARAMETERS.gapFilling.maxDuration_s);
    expect(row.noseConfidenceCutoff).toBe(FIXTURE_PARAMETERS.noseConfidenceCutoff);
    expect(row.outlierVelocityThreshold_cmPerS).toBe(
      FIXTURE_PARAMETERS.outlierVelocityThreshold_cmPerS,
    );
  });

  it('leaves total_latency_s null and status review for a trial that never escapes (O5)', () => {
    const row = trialRows(session).find((candidate) => !candidate.escaped);
    expect(row).toBeDefined();
    expect(row?.totalLatency_s).toBeNull();
    expect(row?.status).toBe('review');
  });

  it('keeps numbers as numbers, times to 3 dp and distances to 2 dp', () => {
    for (const row of trialRows(session)) {
      // the fixture's trials all have a start and tracked time, so neither nullable cell is null here
      expect(typeof row.trialStart_s).toBe('number');
      expect(row.trialStart_s).toBe(Number(row.trialStart_s!.toFixed(3)));
      expect(row.pathLength_cm).toBe(Number(row.pathLength_cm!.toFixed(2)));
      expect(row.meanSpeed_cmPerS).toBe(Number(row.meanSpeed_cmPerS!.toFixed(2)));
    }
  });

  it('carries the O12 metadata, or null where a field was left blank', () => {
    const row = trialRows(session)[0];
    expect(row?.animal).toBe('M12');
    expect(row?.group).toBe('control');
    expect(row?.trialLabel).toBe('1');
  });

  it('exports nothing from a session whose parameters have never been stamped (D47)', () => {
    expect(trialRows({ ...session, parameters: null })).toEqual([]);
  });
});

/*
 * D66: a number that cannot be established is an empty cell, never 0; a legitimate zero is `0`;
 * and the review flag codes travel with the row.
 */
describe('nulls, zeros and review flags (D66)', () => {
  function cell(csv: string, rowIndex: number, header: string): string {
    const lines = csv.split('\r\n');
    const headers = lines[0]!.split(',');
    return lines[rowIndex + 1]!.split(',')[headers.indexOf(header)]!;
  }

  it('writes an empty cell for an unresolved trial’s window measures, and 0 for a resolved zero', () => {
    const edited = syntheticSession();
    const [first, second] = edited.videos.map((video) => edited.analyses[video.id]!.derived!);
    first!.metrics = {
      ...first!.metrics,
      status: 'unresolved',
      trialStart_s: null,
      primaryLatency_s: null,
      totalLatency_s: null,
      primaryErrors: null,
      totalErrors: null,
      pathLength_cm: null,
      pathLengthSmoothed_cm: null,
      meanSpeed_cmPerS: null,
      targetQuadrantTime_s: null,
      trackedFraction: null,
      strategy: 'unclassified',
    };
    second!.metrics = { ...second!.metrics, primaryErrors: 0, totalErrors: 0 };
    const csv = toCsv(TRIAL_COLUMNS, trialRows(edited));
    for (const header of [
      'primary_errors',
      'total_errors',
      'path_length_cm',
      'path_length_smoothed_cm',
      'mean_speed_cm_per_s',
      'target_quadrant_time_s',
      'tracked_fraction',
    ]) {
      expect(cell(csv, 0, header), header).toBe('');
    }
    expect(cell(csv, 0, 'strategy')).toBe('unclassified');
    expect(cell(csv, 0, 'status')).toBe('unresolved');
    expect(cell(csv, 1, 'primary_errors')).toBe('0');
    expect(cell(csv, 1, 'total_errors')).toBe('0');
  });

  it('writes the review flag codes derive() raised, unique and in a stable order, blank when none', () => {
    const edited = syntheticSession();
    const derived = edited.analyses[edited.videos[0]!.id]!.derived!;
    derived.reviewFlags = [
      { code: 'stale_auto_layer', message: 'other tracking parameters' },
      { code: 'oversized_in_trial', message: 'a hand', frameIndex: 12 },
      { code: 'stale_auto_layer', message: 'said twice' },
    ];
    const csv = toCsv(TRIAL_COLUMNS, trialRows(edited));
    expect(cell(csv, 0, 'review_flags')).toBe('oversized_in_trial;stale_auto_layer');
    expect(cell(csv, 1, 'review_flags')).toBe('');
    // the column sits right after status, so a reader sees the reason beside the verdict
    const headers = csv.split('\r\n')[0]!.split(',');
    expect(headers[headers.indexOf('status') + 1]).toBe('review_flags');
  });
});

describe('eventRows', () => {
  const rows = eventRows(session);
  const events = Object.values(session.analyses).flatMap((analysis) => analysis.derived!.events);

  it('exports tracking failures as rows of their own kind, with a blank hole away from any hole (D67)', () => {
    const failures = events.filter((event) => event.kind === 'tracking_failure');
    expect(failures.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(events.length);
    const failureRows = rows.filter((row) => row.kind === 'tracking_failure');
    expect(failureRows).toHaveLength(failures.length);
    expect(failureRows.every((row) => row.holeIndex === null && row.isTarget === false)).toBe(true);
    expect(failureRows.every((row) => row.source === 'auto' && row.confirmed === false)).toBe(true);
  });

  it('keeps every investigation and escape entry', () => {
    expect(rows.filter((row) => row.kind === 'escape_entry').length).toBe(
      events.filter((event) => event.kind === 'escape_entry').length,
    );
  });

  it('fills the auto_* shadow columns on a corrected or evidence-corrected row, never on an untouched one (D11, D26, D65)', () => {
    const corrected = rows.filter((row) => row.source === 'corrected');
    const untouched = rows.filter((row) => row.source === 'auto' && !row.evidenceCorrected);
    expect(corrected.length).toBeGreaterThan(0);
    for (const row of corrected) {
      expect(row.autoStartFrame).not.toBeNull();
      expect(row.autoEndFrame).not.toBeNull();
      expect(row.autoEndFrame).not.toBe(row.endFrame);
    }
    for (const row of untouched) {
      expect(row.autoHoleIndex).toBeNull();
      expect(row.autoStartFrame).toBeNull();
      expect(row.autoEndFrame).toBeNull();
      expect(row.correctionIds).toBe('');
      expect(row.confirmed).toBe(false);
    }
  });

  it('records the point each event was judged on (O16)', () => {
    expect(rows.every((row) => row.pointUsed === 'nose' || row.pointUsed === 'centroid')).toBe(
      true,
    );
  });
});

describe('qualityRows', () => {
  it('writes one row per tracked video with fractions that account for every frame (D30)', () => {
    const rows = qualityRows(session);
    expect(rows).toHaveLength(session.videos.length);
    for (const row of rows) {
      const total =
        row.trackedFraction +
        row.notDetectedFraction +
        row.ambiguousFraction +
        row.lowConfidenceFraction;
      expect(total).toBeCloseTo(1, 3);
      expect(row.tier === 'GOOD' || row.tier === 'REVIEW' || row.tier === 'POOR').toBe(true);
    }
  });

  it('reports the per-video calibration derived from the maze map (D44)', () => {
    for (const row of qualityRows(session)) {
      expect(row.platformDiameter_cm).toBe(92);
      expect(row.pxPerCm).toBeGreaterThan(4);
      expect(row.pxPerCm).toBeLessThan(6);
    }
  });
});

describe('a tracked but unanalysed video (D52)', () => {
  it('contributes no row at all, rather than a row of zeroes', () => {
    // `VideoAnalysis.derived` is null until the first analysis run computes it.
    // A row built from it would carry a fabricated trial: zero errors, a blank
    // hash and a latency that was never measured (D16).
    const partial = syntheticSession();
    const id = partial.videos[1]!.id;
    partial.analyses[id]!.derived = null;

    const trials = trialRows(partial);
    const events = eventRows(partial);
    const quality = qualityRows(partial);

    expect(trials).toHaveLength(session.videos.length - 1);
    expect(quality).toHaveLength(session.videos.length - 1);
    expect(trials.map((row) => row.videoId)).not.toContain(id);
    expect(quality.map((row) => row.videoId)).not.toContain(id);
    expect(events.map((row) => row.videoId)).not.toContain(id);

    // Every other video is untouched.
    expect(trialRows(partial).map((r) => r.videoId)).toEqual(
      trialRows(session)
        .map((r) => r.videoId)
        .filter((v) => v !== id),
    );
  });

  it('still stamps the parameters hash from the videos that do have one', () => {
    const partial = syntheticSession();
    partial.analyses[partial.videos[0]!.id]!.derived = null;
    for (const row of trialRows(partial)) {
      expect(row.parametersHash).toBeTruthy();
      expect(row.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    }
  });
});

describe('the fixture\u2019s own guarantee', () => {
  it('analyses every video, which is what the `derived!` assertions above rest on', () => {
    for (const analysis of Object.values(syntheticSession().analyses)) {
      expect(analysis.derived, 'every video in the fixture is analysed').not.toBeNull();
    }
  });
});
