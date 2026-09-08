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
  retimedEvents,
} from '../../../src/ui/components/describe-diff.js';
import type { Parameters } from '../../../src/contracts/parameters.js';
import {
  ANALYSIS_PARAMETER_BOUNDS,
  type SliderParameterPath,
} from '../../../src/ui/components/analysis-parameter-bounds.js';
import { derivedPair, fixture, VIDEO_IDS } from './fixture.js';

/** A minimal analysis-shaped value: only the fields the badge reads. */
function analysisWith(overrides: {
  events?: Partial<EventRecord>[];
  metrics?: Partial<DerivedAnalysis['metrics']>;
  filledFrames?: number;
  tier?: DerivedAnalysis['quality']['tier'];
  runnerUp?: DerivedAnalysis['strategy']['runnerUp'];
  duplicateTimestampCount?: number;
  droppedFrameGapCount?: number;
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
        pointUsed: event.pointUsed ?? 'centroid',
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
    // The classification block, beside the class on `metrics`: the card prints
    // the runner-up too, so the badge compares it.
    strategy: {
      strategy: overrides.metrics?.strategy ?? 'spatial',
      runnerUp: overrides.runnerUp ?? 'random',
    },
    quality: {
      tier: overrides.tier ?? 'GOOD',
      // Required by the contract, so the stub carries it rather than letting
      // `describeDiff` guard against a shape that cannot occur.
      timebaseAnomalies: {
        duplicateTimestampCount: overrides.duplicateTimestampCount ?? 0,
        droppedFrameGapCount: overrides.droppedFrameGapCount ?? 0,
        driftSeconds: 0,
      },
    },
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

  it('reports the timebase counts, which only the O11 factors move', () => {
    const sentence = describeDiff(
      analysisWith({ duplicateTimestampCount: 21, droppedFrameGapCount: 11 }),
      analysisWith({ duplicateTimestampCount: 0, droppedFrameGapCount: 0 }),
    );
    expect(sentence).toContain('duplicate timestamps 21 → 0');
    expect(sentence).toContain('dropped-frame gaps 11 → 0');
  });

  it('reports events judged on the nose, which only the O16 cutoff moves', () => {
    const nose = { id: 'a', pointUsed: 'nose' as const };
    const centroid = { id: 'a', pointUsed: 'centroid' as const };
    const sentence = describeDiff(
      analysisWith({ events: [nose] }),
      analysisWith({ events: [centroid] }),
    );
    expect(sentence).toContain('events judged on the nose 1 → 0');
  });

  it('counts an event whose frames moved but whose id survived', () => {
    const before = analysisWith({ events: [{ id: 'a' }] });
    const after = analysisWith({ events: [{ id: 'a' }] });
    (after.events[0] as { endFrame: number }).endFrame = 99;
    expect(retimedEvents(before.events, after.events)).toBe(1);
    expect(describeDiff(before, after)).toContain('1 event re-timed');
  });

  it('does not call two unrecordable values a change', () => {
    // NaN !== NaN would report a change between two identical analyses and make
    // "No change." unreachable for a trial with no tracked time.
    const a = analysisWith({ metrics: { meanSpeed_cmPerS: Number.NaN } });
    const b = analysisWith({ metrics: { meanSpeed_cmPerS: Number.NaN } });
    expect(describeDiff(a, b)).toBe(NO_CHANGE);
  });

  it('reports a difference that shows on screen even inside a small epsilon', () => {
    // 100.004 → 100.006 prints 100.00 → 100.01: a 5e-3 tolerance would call
    // these the same while the card visibly moved.
    const sentence = describeDiff(
      analysisWith({ metrics: { pathLength_cm: 100.004 } }),
      analysisWith({ metrics: { pathLength_cm: 100.006 } }),
    );
    expect(sentence).toContain('path length 100.00 cm → 100.01 cm');
  });

  it('stays silent when two numbers print identically', () => {
    expect(
      describeDiff(
        analysisWith({ metrics: { pathLength_cm: 100.0001 } }),
        analysisWith({ metrics: { pathLength_cm: 100.0002 } }),
      ),
    ).toBe(NO_CHANGE);
  });

  it('reports a quality tier change', () => {
    const sentence = describeDiff(analysisWith({ tier: 'GOOD' }), analysisWith({ tier: 'POOR' }));
    expect(sentence).toContain('quality tier GOOD → POOR');
  });

  it('counts events judged on the nose over the set the quality panel counts', () => {
    // The panel prints `QualityReport.noseJudgedEventFraction`, which excludes
    // tracking failures (D54). A badge that counted them too would put a number
    // on screen that no panel shows — 16 → 1 beside a panel reading "0 of 15".
    const { before, after } = derivedPair('video-test50', (p) => ({
      ...p,
      noseConfidenceCutoff: 0.51,
    }));
    const judged = (a: DerivedAnalysis) =>
      a.events.filter((e) => e.kind !== 'tracking_failure' && e.pointUsed === 'nose').length;
    const sentence = describeDiff(before, after);
    expect(sentence).toContain(
      `events judged on the nose ${judged(before)} → ${judged(after)}`,
    );
    // The panel's own numerator, from the report rather than from this count.
    expect(after.quality.noseJudgedEventFraction).toBeCloseTo(
      judged(after) / after.events.filter((e) => e.kind !== 'tracking_failure').length,
      12,
    );
  });

  it('reports a runner-up that moved while the class stood', () => {
    // The card prints the runner-up beside the class, and the O7 thresholds can
    // move one without the other.
    const sentence = describeDiff(
      analysisWith({ runnerUp: 'random' }),
      analysisWith({ runnerUp: 'serial' }),
    );
    expect(sentence).toContain('strategy unchanged');
    expect(sentence).toContain('runner-up random → serial');
  });

  it('says nothing about the runner-up when it did not move', () => {
    const sentence = describeDiff(
      analysisWith({ metrics: { primaryErrors: 1 } }),
      analysisWith({ metrics: { primaryErrors: 2 } }),
    );
    expect(sentence).not.toContain('runner-up');
  });

  it('treats two nulls as one value, the same as two NaNs (D55)', () => {
    const a = analysisWith({ metrics: { meanSpeed_cmPerS: null } });
    const b = analysisWith({ metrics: { meanSpeed_cmPerS: null } });
    expect(describeDiff(a, b)).toBe(NO_CHANGE);
  });

  it('says a measure became computable, in words rather than an em dash', () => {
    // `—` is right in a table beside its label; in a sentence "— → 12.30 cm/s"
    // does not say what happened.
    const sentence = describeDiff(
      analysisWith({ metrics: { meanSpeed_cmPerS: null } }),
      analysisWith({ metrics: { meanSpeed_cmPerS: 12.3 } }),
    );
    expect(sentence).toContain('mean speed not computable → 12.30 cm/s');
    expect(sentence).not.toContain('— →');
  });

  it('says a measure stopped being computable, the same way round', () => {
    const sentence = describeDiff(
      analysisWith({ metrics: { meanSpeed_cmPerS: 12.3 } }),
      analysisWith({ metrics: { meanSpeed_cmPerS: null } }),
    );
    expect(sentence).toContain('mean speed 12.30 cm/s → not computable');
  });

  it('reports a trial start that moved, which the metrics card prints', () => {
    const sentence = describeDiff(
      analysisWith({ metrics: { trialStart_s: 4 } }),
      analysisWith({ metrics: { trialStart_s: 9.5 } }),
    );
    expect(sentence).toContain('trial start 4.00 s → 9.50 s');
  });

  it('reports a trial start moved by a correction, on a real re-derivation', () => {
    // No analysis threshold moves the trial start on these fixtures — the sweep
    // below was instrumented and found zero such combinations — so the clause
    // is proved here instead, on the thing that does move it: a D25 trial-start
    // correction, re-derived rather than patched.
    const base = fixture('video-test50', { corrections: [] });
    const moved = fixture('video-test50', {
      corrections: [
        {
          id: 'c-trial-start',
          timestamp: '2026-09-07T00:00:00.000Z',
          source: 'user',
          kind: 'trial_start',
          frameIndex: 300,
        },
      ],
    });
    expect(moved.analysis.metrics.trialStart_s).not.toBe(base.analysis.metrics.trialStart_s);
    expect(describeDiff(base.analysis, moved.analysis)).toContain('trial start ');
  });
});

describe('describeDiff over a real re-derivation', () => {
  it('describes what raising the investigation minimum duration actually did', () => {
    // 0.2 s → 10 s on test50: the shorter bouts stop counting as investigations,
    // and the error counts fall with them (13 → 7 total). The strategy call is
    // not one of the things that moves — both sides still fire the serial rule —
    // so the badge has to say so rather than stay silent about it.
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
    expect(sentence).toContain('strategy unchanged');
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
    expect(describeDiff(before, after)).toContain('target quadrant time 78.11 s → 178.27 s');
  });

  it('reports the smoothed path and the mean speed, which only the filter width moves', () => {
    const { before, after } = derivedPair('video-test50', (p) => ({
      ...p,
      kinematicsSmoothingWindowFrames: 31,
    }));
    const sentence = describeDiff(before, after);
    expect(sentence).toContain('smoothed path length 390.91 cm → 254.87 cm');
    expect(sentence).toContain('mean speed 2.19 cm/s → 1.43 cm/s');
  });

  it('says nothing changed when the same parameters are derived twice', () => {
    const { before, after } = derivedPair('video-test51', (p) => p);
    expect(describeDiff(before, after)).toBe(NO_CHANGE);
  });
});

describe('the badge is never silent about a number the panels print', () => {
  /**
   * Everything the four components actually display, as one comparable value.
   * Evidence *sentences* are excluded on purpose: they restate values that are
   * themselves reported, so a change confined to prose is not a silent badge.
   */
  function shown(analysis: DerivedAnalysis): string {
    return JSON.stringify({
      metrics: analysis.metrics,
      tier: analysis.quality.tier,
      // D54's three figures, which the quality panel prints at the top and
      // which it reads from the report rather than deriving. `positioned` is
      // recoverable from `states`; the other two are not, so without them the
      // sweep would be claiming coverage it did not have.
      d54: [
        analysis.quality.positionedFraction,
        analysis.quality.wholeClipPositionedFraction,
        analysis.quality.noseJudgedEventFraction,
      ],
      gaps: analysis.quality.gaps.length,
      longestGap: analysis.quality.longestGapSeconds,
      timebase: analysis.quality.timebaseAnomalies,
      states: analysis.quality.detectionStateFractions,
      filled: analysis.cleaning.filledFrames,
      trial: [analysis.trial.startTime_s, analysis.trial.endTime_s, analysis.trial.endReason],
      events: analysis.events.map((event) => [
        event.id,
        event.kind,
        event.holeIndex,
        event.isTarget,
        event.startFrame,
        event.endFrame,
        event.durationSeconds,
        event.pointUsed,
        event.minNoseDistance_cm,
        event.minCentroidDistance_cm,
        event.source,
      ]),
      flags: analysis.reviewFlags.map((flag) => [flag.code, flag.eventId]),
      strategy: [analysis.strategy.strategy, analysis.strategy.runnerUp],
    });
  }

  function setAt(parameters: Parameters, path: string, value: unknown): void {
    const keys = path.split('.');
    let target = parameters as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]!] = value;
  }

  it('speaks for every editable parameter that moves a displayed number', () => {
    const paths = Object.keys(ANALYSIS_PARAMETER_BOUNDS) as SliderParameterPath[];
    // 15 from chunk 7a plus the seven numeric thresholds D55 moved into
    // `Parameters`. A new parameter with no bound cannot reach this list, which
    // is why `ANALYSIS_PARAMETER_BOUNDS` is a total `Record`.
    expect(paths).toHaveLength(22);

    const silent: string[] = [];
    const noisy: string[] = [];
    let checked = 0;

    // All three videos: a threshold that moves nothing on one clip may move a
    // great deal on another, and a sweep of one video reports coverage it does
    // not have.
    //
    // What it still does not reach: `metrics.trialStart_s` is inside `shown()`
    // but no combination below moves it, so the clause for it is covered by its
    // own test above rather than here. This loop proves the badge is not silent;
    // it does not prove every measure was exercised.
    for (const videoId of VIDEO_IDS) {
      for (const path of paths) {
        const bound = ANALYSIS_PARAMETER_BOUNDS[path];
        for (const value of [bound.min, (bound.min + bound.max) / 2, bound.max]) {
          let pair;
          try {
            pair = derivedPair(videoId, (p) => {
              const next = structuredClone(p);
              setAt(next, path, value);
              return next;
            });
          } catch {
            continue; // the panel refuses these before they ever reach derive()
          }
          checked += 1;
          const moved = shown(pair.before) !== shown(pair.after);
          const spoke = describeDiff(pair.before, pair.after) !== NO_CHANGE;
          if (moved && !spoke) silent.push(`${videoId} ${path} = ${value}`);
          if (!moved && spoke) noisy.push(`${videoId} ${path} = ${value}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(150);
    expect(silent, 'the badge said "No change." while a displayed number moved').toEqual([]);
    expect(noisy, 'the badge reported a change nothing displayed').toEqual([]);
  });

  it('covers the two switches as well as the sliders', () => {
    // The bounds table is numeric by construction, so the booleans are swept
    // here: `gapFilling.enabled` and, since D55, `trialCensoring.censorToCutoff`.
    const switches: { path: string; values: boolean[] }[] = [
      { path: 'gapFilling.enabled', values: [true, false] },
      { path: 'trialCensoring.censorToCutoff', values: [true, false] },
    ];
    for (const videoId of VIDEO_IDS) {
      for (const { path, values } of switches) {
        for (const value of values) {
          const { before, after } = derivedPair(videoId, (p) => {
            const next = structuredClone(p);
            setAt(next, path, value);
            return next;
          });
          if (shown(before) !== shown(after)) {
            expect(describeDiff(before, after), `${videoId} ${path} = ${value}`).not.toBe(NO_CHANGE);
          }
        }
      }
    }
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
