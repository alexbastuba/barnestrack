/**
 * The metrics card's pure half: every row has a definition with a decision id,
 * numbers print as the card shows them, and each value seeks to the frame that
 * defines it (D19 · F3).
 */
import { describe, expect, it } from 'vitest';
import { derive, type DeriveInput } from '../../src/analysis/derive.js';
import {
  DEFAULT_PARAMETERS,
  METRIC_DECISIONS,
  METRIC_DEFINITIONS,
  hashTrackingParameters,
} from '../../src/analysis/parameters.js';
import type { TrialMetrics } from '../../src/contracts/metrics.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';
import {
  METRIC_ROWS,
  formatCm,
  formatFrameTime,
  formatPercentage,
  formatSeconds,
  formatSpeed,
  metricDefinition,
  metricValueText,
  seekFrameFor,
} from '../../src/ui/review-format.js';
import { TEST_RESOLUTION, testGeometry, testMazeMap } from '../analysis/maze-fixture.js';
import { scriptTrack, visitHoles, type Segment } from '../analysis/synthetic-track.js';

const g = testGeometry();

function analysisOf(segments: Segment[]) {
  const scripted = scriptTrack(segments, { g });
  const input: DeriveInput = {
    videoId: 'vid',
    auto: { parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking), frames: scripted.frames },
    corrections: { entries: [] },
    mazeMap: testMazeMap(),
    mazeTransform: IDENTITY_TRANSFORM,
    index: { width: TEST_RESOLUTION.width, height: TEST_RESOLUTION.height },
    parameters: DEFAULT_PARAMETERS,
  };
  return { analysis: derive(input), segmentStarts: scripted.segmentStarts };
}

const sample: TrialMetrics = {
  trialStart_s: 5,
  primaryLatency_s: 12.6667,
  totalLatency_s: null,
  primaryErrors: 2,
  totalErrors: 45,
  pathLength_cm: 1245.6,
  pathLengthSmoothed_cm: 1213.71,
  meanSpeed_cmPerS: 6.7412,
  targetQuadrantTime_s: 90.03,
  strategy: 'spatial',
  strategySource: 'auto',
  escaped: false,
  noEscapeConfirmed: false,
  status: 'review',
  trackedFraction: 0.7612,
  correctionCount: 3,
};

describe('definitions', () => {
  it('exist for every metric row and every TrialMetrics key, each ending in a decision id', () => {
    const keys = Object.keys(sample) as (keyof TrialMetrics)[];
    expect(new Set(Object.keys(METRIC_DEFINITIONS))).toEqual(new Set(keys));
    for (const key of keys) {
      expect(METRIC_DEFINITIONS[key]).toMatch(/\(.+; [OD]\d+\)\.$/);
      expect(METRIC_DECISIONS[key]).toMatch(/^[OD]\d+$/);
    }
    expect(METRIC_DECISIONS.primaryLatency_s).toBe('O3');
    expect(METRIC_DECISIONS.totalErrors).toBe('O2');
    for (const row of METRIC_ROWS) expect(metricDefinition(row.key).text.length).toBeGreaterThan(20);
    // the two strategy keys are shown by the strategy block, not as plain rows
    expect(METRIC_ROWS.map((r) => r.key)).not.toContain('strategy');
  });
});

describe('formatting', () => {
  it('prints numbers the way the card shows them, with a dash for anything not recorded', () => {
    expect(formatSeconds(12.6667)).toBe('12.67 s');
    expect(formatSeconds(null)).toBe('—');
    expect(formatSeconds(Number.NaN)).toBe('—');
    expect(formatCm(1245.6)).toBe('1245.6 cm');
    expect(formatSpeed(6.7412)).toBe('6.74 cm/s');
    expect(formatSpeed(null)).toBe('—');
    expect(formatPercentage(0.7612)).toBe('76.1 %');
    expect(formatFrameTime(412, 13.7333)).toBe('frame 412 · 13.733 s');
    expect(metricValueText(sample, 'trialStart_s')).toBe('5.00 s');
    expect(metricValueText(sample, 'totalLatency_s')).toBe('—');
    expect(metricValueText(sample, 'primaryErrors')).toBe('2');
    expect(metricValueText(sample, 'escaped')).toBe('no');
    expect(metricValueText(sample, 'status')).toBe('review');
    expect(metricValueText(sample, 'trackedFraction')).toBe('76.1 %');
    expect(metricValueText(sample, 'pathLengthSmoothed_cm')).toBe('1213.7 cm');
  });
});

describe('seekFrameFor', () => {
  it('finds the trial start, the first target event, the escape entry and the first error', () => {
    const { analysis, segmentStarts } = analysisOf([
      { kind: 'empty', seconds: 0.5 },
      ...visitHoles([3, 7]),
      { kind: 'dwell', hole: 7, seconds: 0.5, state: 'low_confidence', reason: 'small_blob' },
      { kind: 'lost', seconds: 2 },
    ]);
    expect(seekFrameFor('trialStart', analysis)).toBe(analysis.trial.startFrame);
    expect(seekFrameFor('trialStart', analysis)).toBe(segmentStarts[1]);
    const firstError = analysis.events.find((e) => e.kind === 'investigation' && !e.isTarget)!;
    expect(seekFrameFor('firstError', analysis)).toBe(firstError.startFrame);
    const target = analysis.events.find((e) => e.isTarget)!;
    expect(seekFrameFor('firstTarget', analysis)).toBe(target.startFrame);
    const entry = analysis.events.find((e) => e.kind === 'escape_entry')!;
    // The frame that defines total latency: the trial's end, which is this entry's first frame.
    expect(analysis.trial.endReason).toBe('escape');
    expect(seekFrameFor('escape', analysis)).toBe(analysis.trial.endFrame);
    expect(analysis.trial.endFrame).toBe(entry.startFrame);
    expect(seekFrameFor('trialEnd', analysis)).toBe(analysis.trial.endFrame);
    expect(seekFrameFor(null, analysis)).toBeNull();
  });

  it('is null where there is nothing to seek to', () => {
    const { analysis } = analysisOf([{ kind: 'dwell', seconds: 1 }]);
    expect(seekFrameFor('firstTarget', analysis)).toBeNull();
    expect(seekFrameFor('escape', analysis)).toBeNull();
    expect(seekFrameFor('firstError', analysis)).toBeNull();
  });
});
