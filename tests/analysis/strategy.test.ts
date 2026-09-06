import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_OPTIONS, DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import { testGeometry } from './maze-fixture.js';
import { pipeline } from './pipeline.js';
import { holePoint, visitHoles, type Segment } from './synthetic-track.js';

const target8 = testGeometry({ map: { target: { holeIndex: 8 } } });

describe('classifyStrategy (O7)', () => {
  it('serial: 12→8 then the target (8) is a run of five adjacent holes with four errors', () => {
    const r = pipeline(visitHoles([12, 11, 10, 9, 8]), { g: target8 });
    expect(r.metrics.primaryErrors).toBe(4);
    expect(r.metrics.totalErrors).toBe(4);
    expect(r.strategy.strategy).toBe('serial');
    expect(r.strategy.strategySource).toBe('auto');
    expect(r.strategy.features.longestAdjacentRun).toBe(5);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([12, 11, 10, 9, 8]);
    expect(r.strategy.features.centreCrossings).toBe(0);
    expect(r.strategy.features.maxHoleDistanceFromTarget).toBe(4);
    expect(r.strategy.features.targetReached).toBe(true);
    expect(r.strategy.features.sequence).toEqual([12, 11, 10, 9, 8]);
    expect(r.strategy.runnerUp).toBe('random');
    expect(r.strategy.reasoning.join('\n')).toContain(
      'serial fired: longest run of adjacent holes with no centre crossing during it 5 (12→11→10→9→8)',
    );
    expect(r.strategy.reasoning.join('\n')).toContain('4 errors');
    expect(r.strategy.reasoning.join('\n')).toContain('Classified as serial; runner-up random.');
    expect(r.metrics.strategy).toBe('serial');
  });

  it('spatial: few errors, all next to the target, no centre crossing', () => {
    const r = pipeline(visitHoles([8, 6, 7]));
    expect(r.strategy.strategy).toBe('spatial');
    expect(r.strategy.features.errors).toBe(2);
    expect(r.strategy.features.maxHoleDistanceFromTarget).toBe(1);
    expect(r.strategy.features.centreCrossings).toBe(0);
    expect(r.strategy.features.longestAdjacentRun).toBe(2); // 8, 6 are two apart; 6→7 is adjacent
    expect(r.strategy.runnerUp).toBe('random');
    expect(r.strategy.reasoning.join('\n')).toContain('spatial fired: 2 errors (at most 3) — yes');
  });

  it('random: errors spread around the ring with centre crossings between them', () => {
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([15]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([9]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([7]),
    ];
    const r = pipeline(script);
    expect(r.strategy.strategy).toBe('random');
    expect(r.strategy.features.errors).toBe(3);
    expect(r.strategy.features.centreCrossings).toBe(3);
    expect(r.strategy.features.longestAdjacentRun).toBe(1);
    expect(r.strategy.runnerUp).toBe('spatial'); // two of three spatial conditions hold
    expect(r.strategy.reasoning.join('\n')).toContain('3 centre crossings (at most 1) — no');
  });

  it('a centre crossing between two adjacent holes breaks the run', () => {
    const script: Segment[] = [
      ...visitHoles([12, 11]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([10, 9, 8]),
    ];
    const r = pipeline(script, { g: target8 });
    expect(r.strategy.features.longestAdjacentRun).toBe(3);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([10, 9, 8]);
    expect(r.strategy.features.centreCrossings).toBe(1);
    expect(r.strategy.strategy).toBe('serial');
    // walking from 11 to 10 crosses the centre: the run is only 10→9→8; with two crossings in a row it falls apart
    const broken: Segment[] = [
      ...visitHoles([12, 11]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([10]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([9, 8]),
    ];
    const b = pipeline(broken, { g: target8 });
    expect(b.strategy.features.longestAdjacentRun).toBe(2);
    expect(b.strategy.strategy).toBe('random');
  });

  it('a repeat of the same hole neither extends nor breaks a run', () => {
    const away = holePoint(target8, 11, 6);
    const script: Segment[] = [
      ...visitHoles([12, 11]),
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.2 },
      { kind: 'dwell', seconds: 1 },
      ...visitHoles([11, 10, 9, 8]),
    ];
    const r = pipeline(script, { g: target8 });
    expect(r.strategy.features.sequence).toEqual([12, 11, 11, 10, 9, 8]);
    expect(r.strategy.features.longestAdjacentRun).toBe(5);
    expect(r.metrics.primaryErrors).toBe(5); // repeat visits are separate errors (O2)
  });

  it('measures path efficiency and tortuosity from the smoothed path', () => {
    const straight = pipeline([
      { kind: 'moveToHole', hole: 7, seconds: 2 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
    ]);
    expect(straight.strategy.features.pathEfficiency).toBeCloseTo(1, 2);
    expect(straight.strategy.features.tortuosity_rad).toBeCloseTo(0, 6);
    const detour = pipeline([...visitHoles([17, 13]), ...visitHoles([7])]);
    expect(detour.strategy.features.pathEfficiency).toBeLessThan(0.7);
    expect(detour.strategy.features.tortuosity_rad).toBeGreaterThan(1);
  });

  it('uses the whole trial when the target is never reached, and says so', () => {
    const r = pipeline(visitHoles([3, 4]));
    expect(r.strategy.features.targetReached).toBe(false);
    expect(r.strategy.features.errors).toBe(2);
    expect(Number.isFinite(r.strategy.features.pathEfficiency)).toBe(true);
    expect(r.strategy.reasoning[0]).toContain('the target was never reached');
    const empty = pipeline([{ kind: 'dwell', seconds: 1 }]);
    expect(empty.strategy.strategy).toBe('spatial'); // the O7 placeholder fires vacuously — flagged in the reasoning
    expect(empty.strategy.reasoning.join('\n')).toContain('No investigation and no target visit');
  });

  it('is random and unclassified without a trial start', () => {
    const r = pipeline([{ kind: 'empty', seconds: 1 }]);
    expect(r.strategy.strategy).toBe('random');
    expect(r.strategy.rules).toEqual([]);
    expect(r.strategy.reasoning[0]).toContain('Not classified');
    expect(r.strategy.features.sequence).toEqual([]);
  });

  it('honours a user override and keeps the automatic classification alongside', () => {
    const corrections: CorrectionsLayer = {
      entries: [
        {
          id: 's1',
          kind: 'strategy_override',
          timestamp: '2026-09-06T10:00:01.000Z',
          source: 'user',
          strategy: 'spatial',
          reason: 'circled once then went straight in',
        },
        {
          id: 's2',
          kind: 'strategy_override',
          timestamp: '2026-09-06T10:00:02.000Z',
          source: 'user',
          strategy: 'serial',
          reason: 'walked the ring',
        },
      ],
    };
    const r = pipeline(visitHoles([3, 15, 9, 7]), { corrections });
    expect(r.strategy.strategy).toBe('serial');
    expect(r.strategy.strategySource).toBe('corrected');
    expect(r.strategy.autoStrategy).toBe('random');
    expect(r.strategy.reasoning.at(-1)).toContain(
      'Overridden by the user (correction s2): serial — walked the ring',
    );
    expect(r.metrics.strategy).toBe('serial');
    expect(r.metrics.strategySource).toBe('corrected');
    // the override survives a parameter change that alters the automatic answer
    const loose: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 5 },
    };
    const changed = pipeline(visitHoles([3, 15, 9, 7]), { corrections, p: loose });
    expect(changed.strategy.autoStrategy).toBe('spatial');
    expect(changed.strategy.strategy).toBe('serial');
    expect(changed.strategy.strategySource).toBe('corrected');
  });

  it('reads its thresholds from the options block', () => {
    const strict = {
      ...DEFAULT_ANALYSIS_OPTIONS,
      strategy: { ...DEFAULT_ANALYSIS_OPTIONS.strategy, serialMinRun: 6 },
    };
    const r = pipeline(visitHoles([12, 11, 10, 9, 8]), { g: target8, options: strict });
    expect(r.strategy.strategy).toBe('random');
    expect(r.strategy.runnerUp).toBe('serial'); // a run of 5 against 6 is closer than 4 errors against 3
    expect(
      r.strategy.rules.find((x) => x.strategy === 'serial')!.conditions[0]!.degree,
    ).toBeCloseTo(5 / 6, 12);
  });
});
