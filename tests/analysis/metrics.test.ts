import { describe, expect, it } from 'vitest';
import { firstTargetEvent, isPersistentEscape } from '../../src/analysis/metrics.js';
import {
  DEFAULT_ANALYSIS_OPTIONS,
  DEFAULT_PARAMETERS,
  isRecorded,
} from '../../src/analysis/parameters.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import { pipeline } from './pipeline.js';
import { holePoint, visitHoles, type Segment } from './synthetic-track.js';
import { testGeometry } from './maze-fixture.js';

const g = testGeometry();

const METRIC_KEYS = [
  'trialStart_s',
  'primaryLatency_s',
  'totalLatency_s',
  'primaryErrors',
  'totalErrors',
  'pathLength_cm',
  'pathLengthSmoothed_cm',
  'meanSpeed_cmPerS',
  'targetQuadrantTime_s',
  'strategy',
  'strategySource',
  'escaped',
  'status',
  'trackedFraction',
  'correctionCount',
].sort();

const escapeAfter = (holes: number[]): Segment[] => [
  { kind: 'empty', seconds: 1 },
  ...visitHoles(holes),
  { kind: 'moveToHole', hole: 7, seconds: 0.5 },
  { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 150] },
  { kind: 'lost', seconds: 4 },
];

describe('computeMetrics (O2, O3, O4, O5)', () => {
  it('measures latencies from the trial start and counts errors before and after the first target visit', () => {
    const r = pipeline(escapeAfter([3, 5, 3]));
    const m = r.metrics;
    expect(Object.keys(m).sort()).toEqual(METRIC_KEYS);
    expect(m.trialStart_s).toBeCloseTo(r.bounds.startTime_s, 12);
    expect(m.trialStart_s).toBeCloseTo(1.0, 6);
    const target = firstTargetEvent(r.events)!;
    expect(target.kind).toBe('investigation');
    expect(m.primaryLatency_s).toBeCloseTo(target.startTime_s - m.trialStart_s, 12);
    expect(m.totalLatency_s).toBeCloseTo(r.bounds.endTime_s - m.trialStart_s, 12);
    expect(m.totalLatency_s!).toBeGreaterThan(m.primaryLatency_s!);
    expect(m.primaryErrors).toBe(3);
    expect(m.totalErrors).toBe(3);
    expect(m.escaped).toBe(true);
    expect(m.status).toBe('ok');
    // the window runs to the first lost frame, which is inside it and not tracked
    expect(m.trackedFraction).toBeCloseTo(
      (r.bounds.endFrame! - r.bounds.startFrame!) / (r.bounds.endFrame! - r.bounds.startFrame! + 1),
      12,
    );
    expect(m.correctionCount).toBe(0);
    expect(m.pathLength_cm).toBe(r.kinematics.pathLength_cm);
    expect(m.meanSpeed_cmPerS).toBe(r.kinematics.meanSpeed_cmPerS);
    expect(m.targetQuadrantTime_s).toBe(r.kinematics.targetQuadrantTime_s);
  });

  it('counts a return to a non-target hole after the target as a total error only', () => {
    const r = pipeline([...visitHoles([3, 7, 5]), { kind: 'moveToCentre', seconds: 0.5 }]);
    expect(r.metrics.primaryErrors).toBe(1);
    expect(r.metrics.totalErrors).toBe(2);
    expect(r.metrics.escaped).toBe(false);
    expect(r.metrics.totalLatency_s).toBeNull();
    expect(r.metrics.status).toBe('review'); // never entered the escape box (O5)
    expect(r.bounds.endReason).toBe('end_of_video');
  });

  it('ends primary latency at an escape entry when the animal dives straight in', () => {
    const r = pipeline([
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.1 },
      { kind: 'lost', seconds: 4 },
    ]);
    const target = firstTargetEvent(r.events)!;
    expect(target.kind).toBe('escape_entry');
    expect(r.metrics.primaryLatency_s).toBeCloseTo(r.metrics.totalLatency_s!, 12);
    expect(r.metrics.primaryErrors).toBe(0);
  });

  it('leaves both latencies blank when the target is never reached, and censors to the cutoff on request', () => {
    const p: Parameters = { ...DEFAULT_PARAMETERS, trialCutoff_s: 2 };
    const r = pipeline(visitHoles([3, 4, 5]), { p });
    expect(r.metrics.primaryLatency_s).toBeNull();
    expect(r.metrics.totalLatency_s).toBeNull();
    expect(r.metrics.escaped).toBe(false);
    expect(r.metrics.status).toBe('review');
    expect(r.bounds.endReason).toBe('cutoff');
    const censored = pipeline(visitHoles([3, 4, 5]), {
      p,
      options: { ...DEFAULT_ANALYSIS_OPTIONS, trialCensoring: { censorToCutoff: true } },
    });
    expect(censored.metrics.totalLatency_s).toBe(2);
    expect(censored.metrics.escaped).toBe(false);
    expect(censored.metrics.status).toBe('review');
  });

  it('is review, not escaped, with a null latency when the animal is lost 6 cm from any hole', () => {
    const away = holePoint(g, 3, 6);
    const r = pipeline([
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 5 },
    ]);
    expect(r.events.map((e) => e.kind)).toEqual(['tracking_failure']);
    expect(r.metrics.escaped).toBe(false);
    expect(r.metrics.totalLatency_s).toBeNull();
    expect(r.metrics.primaryLatency_s).toBeNull();
    expect(r.metrics.status).toBe('review');
    expect(r.metrics.primaryErrors).toBe(0); // a tracking failure is never an error
    expect(r.flags).toEqual([]);
  });

  it('is review when a tracking failure sits at a hole even after a later escape', () => {
    const r = pipeline([
      { kind: 'moveToHole', hole: 3, seconds: 0.5, offset_cm: 3 },
      { kind: 'dwell', hole: 3, offset_cm: 3, seconds: 0.5, nose: null },
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', hole: 3, offset_cm: 3, seconds: 0.5, nose: null },
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'lost', seconds: 4 },
    ]);
    expect(r.metrics.escaped).toBe(true);
    expect(r.flags.map((f) => f.code)).toEqual(['tracking_failure_at_hole']);
    expect(r.metrics.status).toBe('review');
    expect(r.metrics.totalErrors).toBe(2);
  });

  it('is unresolved with NaN start and no events when nothing was tracked', () => {
    const r = pipeline([
      { kind: 'empty', seconds: 1 },
      { kind: 'ambiguous', seconds: 1 },
    ]);
    expect(r.metrics.status).toBe('unresolved');
    expect(isRecorded(r.metrics.trialStart_s)).toBe(false);
    expect(r.metrics.primaryLatency_s).toBeNull();
    expect(r.metrics.totalLatency_s).toBeNull();
    expect(r.metrics.escaped).toBe(false);
    expect(r.metrics.primaryErrors).toBe(0);
    expect(isRecorded(r.metrics.trackedFraction)).toBe(false);
    expect(JSON.parse(JSON.stringify(r.metrics)).trialStart_s).toBeNull();
  });

  it('tracked fraction counts tracked states only, over the trial window', () => {
    const r = pipeline([
      { kind: 'empty', seconds: 1 },
      { kind: 'dwell', seconds: 1 },
      { kind: 'dwell', seconds: 1, state: 'low_confidence', reason: 'small_blob' },
    ]);
    expect(r.metrics.trackedFraction).toBeCloseTo(0.5, 12);
  });

  it('counts every correction entry', () => {
    const r = pipeline(visitHoles([3, 7]), {
      corrections: {
        entries: [
          {
            id: 't',
            kind: 'trial_start',
            timestamp: '2026-09-06T10:00:01.000Z',
            source: 'user',
            frameIndex: 2,
          },
          {
            id: 's',
            kind: 'strategy_override',
            timestamp: '2026-09-06T10:00:02.000Z',
            source: 'user',
            strategy: 'random',
            reason: '',
          },
        ],
      },
    });
    expect(r.metrics.correctionCount).toBe(2);
    expect(r.metrics.trialStart_s).toBeCloseTo(2 / 30, 12);
  });
});

describe('helpers', () => {
  const ev = (over: Partial<EventRecord>): EventRecord => ({
    id: 'x',
    kind: 'escape_entry',
    holeIndex: 7,
    isTarget: true,
    startFrame: 100,
    endFrame: 130,
    startTime_s: 3.3,
    endTime_s: 4.3,
    durationSeconds: 1.0,
    pointUsed: 'centroid',
    minNoseDistance_cm: 1,
    minCentroidDistance_cm: 1,
    evidence: '',
    source: 'auto',
    ...over,
  });

  it('isPersistentEscape: to the end of the video or at least the persist cutoff', () => {
    expect(isPersistentEscape(ev({}), 500, DEFAULT_PARAMETERS)).toBe(false);
    expect(isPersistentEscape(ev({ endFrame: 500 }), 500, DEFAULT_PARAMETERS)).toBe(true);
    expect(isPersistentEscape(ev({ durationSeconds: 3 }), 500, DEFAULT_PARAMETERS)).toBe(true);
    expect(
      isPersistentEscape(ev({ kind: 'investigation', endFrame: 500 }), 500, DEFAULT_PARAMETERS),
    ).toBe(false);
  });

  it('firstTargetEvent ignores tracking failures and non-target events', () => {
    expect(
      firstTargetEvent([ev({ kind: 'tracking_failure' }), ev({ isTarget: false, holeIndex: 3 })]),
    ).toBeNull();
    expect(
      firstTargetEvent([
        ev({ startFrame: 200, id: 'b' }),
        ev({ startFrame: 50, id: 'a', kind: 'investigation' }),
      ])!.id,
    ).toBe('a');
  });
});
