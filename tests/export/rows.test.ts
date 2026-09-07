import { describe, expect, it } from 'vitest';
import { EXPORT_SCHEMA_VERSION } from '../../src/contracts/exportRows.js';
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
      expect(row.pathLength_cm).toBe(Number(row.pathLength_cm.toFixed(2)));
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

describe('eventRows', () => {
  const rows = eventRows(session);
  const events = Object.values(session.analyses).flatMap((analysis) => analysis.derived!.events);

  it('drops tracking failures: they belong to the quality report, never an event (O4)', () => {
    const failures = events.filter((event) => event.kind === 'tracking_failure');
    expect(failures.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(events.length - failures.length);
    expect(rows.every((row) => row.kind !== 'tracking_failure')).toBe(true);
  });

  it('keeps every investigation and escape entry', () => {
    expect(rows.filter((row) => row.kind === 'escape_entry').length).toBe(
      events.filter((event) => event.kind === 'escape_entry').length,
    );
  });

  it('fills the auto_* shadow columns only on a corrected row (D11, D26)', () => {
    const corrected = rows.filter((row) => row.source === 'corrected');
    const automatic = rows.filter((row) => row.source === 'auto');
    expect(corrected.length).toBeGreaterThan(0);
    for (const row of corrected) {
      expect(row.autoStartFrame).not.toBeNull();
      expect(row.autoEndFrame).not.toBeNull();
      expect(row.autoEndFrame).not.toBe(row.endFrame);
    }
    for (const row of automatic) {
      expect(row.autoHoleIndex).toBeNull();
      expect(row.autoStartFrame).toBeNull();
      expect(row.autoEndFrame).toBeNull();
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
