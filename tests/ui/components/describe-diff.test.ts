/**
 * The D20 diff badge. Pure over two `DerivedAnalysis` values, so this runs in
 * the node environment; the pairs come from real `derive()` runs on the
 * synthetic session wherever a real threshold change can produce them, and from
 * constructed pairs where a specific shape (a swap, a lost escape) has to be
 * pinned exactly.
 */
import { describe, expect, it } from 'vitest';
import type { DerivedAnalysis } from '../../../src/analysis/derive.js';
import type { EventRecord } from '../../../src/contracts/events.js';
import {
  NO_CHANGE,
  describeDiff,
  describeEventCounts,
  eventDeltas,
} from '../../../src/ui/components/describe-diff.js';
import { derivedPair, fixture } from './fixture.js';

/** A minimal analysis-shaped value: only the fields the badge reads. */
function analysisWith(overrides: {
  events?: Partial<EventRecord>[];
  metrics?: Partial<DerivedAnalysis['metrics']>;
  filledFrames?: number;
  tier?: DerivedAnalysis['quality']['tier'];
}): DerivedAnalysis {
  const events = (overrides.events ?? []).map(
    (event, i) =>
      ({
        id: event.id ?? `e${i}`,
        kind: event.kind ?? 'investigation',
        holeIndex: event.holeIndex ?? 0,
        isTarget: event.isTarget ?? false,
        startFrame: 0,
        endFrame: 1,
        startTime_s: 0,
        endTime_s: 1,
        durationSeconds: 1,
        pointUsed: 'centroid',
        minNoseDistance_cm: 0,
        minCentroidDistance_cm: 0,
        evidence: '',
        source: 'auto',
      }) as EventRecord,
  );
  return {
    events,
    metrics: {
      primaryErrors: 0,
      totalErrors: 0,
      primaryLatency_s: null,
      totalLatency_s: null,
      escaped: false,
      status: 'ok',
      strategy: 'spatial',
      ...overrides.metrics,
    },
    cleaning: { filledFrames: overrides.filledFrames ?? 0 },
    quality: { tier: overrides.tier ?? 'GOOD' },
  } as unknown as DerivedAnalysis;
}

describe('eventDeltas', () => {
  it('compares by id, so a swap of equal size is not silence', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'a' }, { id: 'c' }];
    const deltas = eventDeltas(
      analysisWith({ events: before }).events,
      analysisWith({ events: after }).events,
    );
    const investigations = deltas.find((d) => d.kind === 'investigation')!;
    expect(investigations).toEqual({ kind: 'investigation', added: 1, removed: 1 });
  });

  it('keeps the three kinds separate', () => {
    const before = [{ id: 'a', kind: 'investigation' as const }];
    const after = [
      { id: 'a', kind: 'investigation' as const },
      { id: 'x', kind: 'escape_entry' as const },
      { id: 'y', kind: 'tracking_failure' as const },
    ];
    const deltas = eventDeltas(
      analysisWith({ events: before }).events,
      analysisWith({ events: after }).events,
    );
    expect(deltas.map((d) => [d.kind, d.added, d.removed])).toEqual([
      ['investigation', 0, 0],
      ['escape_entry', 1, 0],
      ['tracking_failure', 1, 0],
    ]);
  });
});

describe('describeDiff', () => {
  it('says so plainly when nothing it watches moved', () => {
    const same = analysisWith({});
    expect(describeDiff(same, analysisWith({}))).toBe(NO_CHANGE);
  });

  it('has nothing to compare against on the first analysis', () => {
    expect(describeDiff(null, analysisWith({}))).toBe(
      'First analysis — nothing to compare with yet.',
    );
    expect(describeDiff(undefined, undefined)).toBe('No analysis yet.');
  });

  it('writes the badge sentence from the chunk prompt', () => {
    const before = analysisWith({
      events: [{ id: 'a' }, { id: 'b' }],
      metrics: { primaryErrors: 4 },
    });
    const after = analysisWith({
      events: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      metrics: { primaryErrors: 3 },
    });
    expect(describeDiff(before, after)).toBe(
      '+2 investigations; primary errors 4 → 3; strategy unchanged; status unchanged; ' +
        'quality tier unchanged.',
    );
  });

  it('reports both directions when events were swapped, never a bare net of zero', () => {
    const before = analysisWith({ events: [{ id: 'a' }, { id: 'b' }] });
    const after = analysisWith({ events: [{ id: 'c' }, { id: 'd' }] });
    expect(describeDiff(before, after)).toContain('+2 investigations, −2');
  });

  it('names a strategy change instead of leaving the reader to notice it', () => {
    const before = analysisWith({ metrics: { strategy: 'spatial' } });
    const after = analysisWith({ metrics: { strategy: 'serial' } });
    expect(describeDiff(before, after)).toContain('strategy spatial → serial');
  });

  it('always states the three judgements, so silence never stands in for "unchanged"', () => {
    const sentence = describeDiff(
      analysisWith({ metrics: { primaryErrors: 1 } }),
      analysisWith({ metrics: { primaryErrors: 2 } }),
    );
    expect(sentence).toContain('strategy unchanged');
    expect(sentence).toContain('status unchanged');
    expect(sentence).toContain('quality tier unchanged');
  });

  it('writes a latency that ceased to exist as "none", not as zero', () => {
    const before = analysisWith({ metrics: { totalLatency_s: 28.34, escaped: true } });
    const after = analysisWith({ metrics: { totalLatency_s: null, escaped: false } });
    const sentence = describeDiff(before, after);
    expect(sentence).toContain('total latency 28.34 s → none');
    expect(sentence).toContain('escaped yes → no');
    expect(sentence).not.toContain('0.00 s');
  });

  it('reports a change in the filled-frame count, since cleaning is never invisible (D31)', () => {
    const sentence = describeDiff(
      analysisWith({ filledFrames: 12 }),
      analysisWith({ filledFrames: 3 }),
    );
    expect(sentence).toContain('filled frames 12 → 3');
  });

  it('reports a quality tier change', () => {
    const sentence = describeDiff(analysisWith({ tier: 'GOOD' }), analysisWith({ tier: 'POOR' }));
    expect(sentence).toContain('quality tier GOOD → POOR');
  });
});

describe('describeDiff over a real re-derivation', () => {
  it('describes what raising the investigation minimum duration actually did', () => {
    // 0.2 s → 10 s on test50: the shorter bouts stop counting as investigations,
    // which drops the error count far enough to change the strategy call too.
    const { before, after } = derivedPair('video-test50', (p) => ({
      ...p,
      holeInvestigation: { ...p.holeInvestigation, minDuration_s: 10 },
    }));
    expect(before.events).toHaveLength(16);
    expect(after.events).toHaveLength(9);

    const sentence = describeDiff(before, after);
    // The badge must agree with the metrics beside it, not merely be plausible.
    expect(sentence).toContain('−7 investigations');
    expect(sentence).toContain(
      `total errors ${before.metrics.totalErrors} → ${after.metrics.totalErrors}`,
    );
    expect(sentence).toContain('strategy serial → random');
  });

  it('reports the quadrant time, which only the quadrant span moves', () => {
    // Widening the sector changes nothing but the quadrant time. A badge that
    // watched only the counts would read "No change." while the metrics card
    // beside it showed the number more than double.
    const { before, after } = derivedPair('video-test50', (p) => ({
      ...p,
      targetQuadrant: { holeSpan: 9.5 },
    }));
    expect(after.metrics.targetQuadrantTime_s).toBeGreaterThan(before.metrics.targetQuadrantTime_s);
    expect(describeDiff(before, after)).toContain('target quadrant time 78.21 s → 178.37 s');
  });

  it('reports the smoothed path and the mean speed, which only the filter width moves', () => {
    const { before, after } = derivedPair('video-test50', (p) => ({
      ...p,
      kinematicsSmoothingWindowFrames: 31,
    }));
    const sentence = describeDiff(before, after);
    expect(sentence).toContain('smoothed path length 391.30 cm → 254.94 cm');
    expect(sentence).toContain('mean speed 2.19 cm/s → 1.43 cm/s');
  });

  it('says nothing changed when the same parameters are derived twice', () => {
    const { before, after } = derivedPair('video-test51', (p) => p);
    expect(describeDiff(before, after)).toBe(NO_CHANGE);
  });
});

describe('describeEventCounts', () => {
  it('counts every kind, including the ones with none', () => {
    expect(describeEventCounts(fixture('video-test53').analysis.events)).toBe(
      '6 investigations · 1 escape entry · 1 tracking failure',
    );
  });

  it('agrees with the singular when there is exactly one', () => {
    const one = [{ id: 'a', kind: 'escape_entry' as const }];
    expect(describeEventCounts(analysisWith({ events: one }).events)).toBe(
      '0 investigations · 1 escape entry · 0 tracking failures',
    );
  });
});
