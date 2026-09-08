import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import { testGeometry } from './maze-fixture.js';
import { pipeline } from './pipeline.js';
import { holePoint, visitHoles, type Segment } from './synthetic-track.js';

const target8 = testGeometry({ map: { target: { holeIndex: 8 } } });

describe('classifyStrategy (O7)', () => {
  it('serial: 12→8 then the target (8) is a run of three, the target and its neighbours excluded', () => {
    const r = pipeline(visitHoles([12, 11, 10, 9, 8]), { g: target8 });
    expect(r.metrics.primaryErrors).toBe(4);
    expect(r.metrics.totalErrors).toBe(4);
    expect(r.strategy.strategy).toBe('serial');
    expect(r.strategy.strategySource).toBe('auto');
    // D58: holes 9, 8 and 7 are the target and its neighbours, so the run is 12→11→10
    expect(r.strategy.features.longestAdjacentRun).toBe(3);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([12, 11, 10]);
    expect(r.strategy.features.centreCrossings).toBe(0);
    expect(r.strategy.features.maxHoleDistanceFromTarget).toBe(4);
    expect(r.strategy.features.targetReached).toBe(true);
    expect(r.strategy.features.sequence).toEqual([12, 11, 10, 9, 8]);
    expect(r.strategy.runnerUp).toBe('random');
    expect(r.strategy.reasoning.join('\n')).toContain(
      'serial fired: longest run of adjacent holes in one direction, not counting the target or the holes beside it, with no centre crossing during it 3 (12→11→10) (at least 2; Gawel et al. 2019, Table 1)',
    );
    expect(r.strategy.reasoning.join('\n')).toContain('4 errors');
    expect(r.strategy.reasoning.join('\n')).toContain(
      'Classified as serial (the first rule to fire in the order spatial → serial → random; rule set from Gawel et al. 2019, Table 1); runner-up random.',
    );
    expect(r.metrics.strategy).toBe('serial');
  });

  it('spatial: few errors, all next to the target, no centre crossing', () => {
    const r = pipeline(visitHoles([8, 6, 7]));
    expect(r.strategy.strategy).toBe('spatial');
    expect(r.strategy.features.errors).toBe(2);
    expect(r.strategy.features.maxHoleDistanceFromTarget).toBe(1);
    expect(r.strategy.features.centreCrossings).toBe(0);
    // D58: 8, 7 and 6 are the target and its neighbours, so nothing is left to build a run from
    expect(r.strategy.features.longestAdjacentRun).toBe(0);
    expect(r.strategy.runnerUp).toBe('random');
    expect(r.strategy.reasoning.join('\n')).toContain('spatial fired: 2 errors (at most 2) — yes');
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
    // under the D58 defaults the spatial rule fails all three conditions, so the run of one is
    // the closest anything came to firing
    expect(r.strategy.runnerUp).toBe('serial');
    expect(r.strategy.reasoning.join('\n')).toContain('3 centre crossings (at most 0) — no');
  });

  it('a centre crossing between two adjacent holes breaks the run', () => {
    const script: Segment[] = [
      ...visitHoles([12, 11]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([10, 9, 8]),
    ];
    const r = pipeline(script, { g: target8 });
    // 9 and 8 are excluded (D58), so the crossing splits 12→11 from 10 and the longest run is two
    expect(r.strategy.features.longestAdjacentRun).toBe(2);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([12, 11]);
    expect(r.strategy.features.centreCrossings).toBe(1);
    expect(r.strategy.strategy).toBe('serial');
    // a crossing after every hole leaves no two adjacent holes in one uninterrupted walk
    const broken: Segment[] = [
      ...visitHoles([12]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([11]),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([10, 9, 8]),
    ];
    const b = pipeline(broken, { g: target8 });
    expect(b.strategy.features.longestAdjacentRun).toBe(1);
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
    // 12→11→11→10 is a run of three; 9 and 8 are the target's neighbour and the target (D58)
    expect(r.strategy.features.longestAdjacentRun).toBe(3);
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
    // D58: Gawel's definitions presuppose a target visit, so the opening sentence says the
    // classification is made over the whole trial window instead of a search phase
    expect(r.strategy.reasoning[0]).toContain(
      'The target was never reached, so the classification is made over the whole trial window',
    );
    expect(r.strategy.reasoning[0]).toContain('Gawel et al. 2019, Table 1');
    expect(r.strategy.reasoning.join('\n')).toContain('the target was never reached');
    const empty = pipeline([{ kind: 'dwell', seconds: 1 }]);
    expect(empty.strategy.strategy).toBe('spatial'); // the O7 placeholder fires vacuously — flagged in the reasoning
    expect(empty.strategy.reasoning.join('\n')).toContain('No investigation and no target visit');
  });

  it('says a rule was outranked when it fired but lost to an earlier one', () => {
    // Under the D58 defaults the two rules are mutually exclusive — spatial wants every error
    // within one hole of the target, serial wants a run of holes that are not — so the
    // "outranked" wording is reachable only for a lab that has widened the spatial rule.
    const wide: Parameters = {
      ...DEFAULT_PARAMETERS,
      strategy: {
        ...DEFAULT_PARAMETERS.strategy,
        spatialMaxErrors: 3,
        spatialMaxHoleDistance: 4,
      },
    };
    // 3 → 4 → 5 → 7 (target 7): three errors, a run of three, and no centre crossing
    const script = visitHoles([3, 4, 5, 7]);
    const r = pipeline(script, { p: wide });
    expect(r.strategy.strategy).toBe('spatial');
    expect(r.strategy.runnerUp).toBe('serial');
    expect(r.strategy.rules.find((x) => x.strategy === 'serial')!.fired).toBe(true);
    const text = r.strategy.reasoning.join('\n');
    expect(text).toContain(
      'serial fired, outranked by spatial (rule order spatial → serial → random)',
    );
    expect(text).not.toMatch(/did not fire.*— yes\.$/m);
    expect(text).toContain(
      'Classified as spatial (the first rule to fire in the order spatial → serial → random; rule set from Gawel et al. 2019, Table 1); runner-up serial.',
    );
    // at the shipped defaults the same trial is plainly serial
    expect(pipeline(script).strategy.strategy).toBe('serial');
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
      strategy: {
        ...DEFAULT_PARAMETERS.strategy,
        spatialMaxErrors: 3,
        spatialMaxHoleDistance: 8,
        spatialMaxCentreCrossings: 5,
      },
    };
    const changed = pipeline(visitHoles([3, 15, 9, 7]), { corrections, p: loose });
    expect(changed.strategy.autoStrategy).toBe('spatial');
    expect(changed.strategy.strategy).toBe('serial');
    expect(changed.strategy.strategySource).toBe('corrected');
  });

  it('ends a run at a change of direction and restarts it from the turn (O7, settled)', () => {
    const r = pipeline(visitHoles([12, 13, 12, 11, 8]), { g: target8 });
    expect(r.strategy.features.longestAdjacentRun).toBe(3);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([13, 12, 11]);
    expect(r.strategy.strategy).toBe('serial');
  });

  it('never builds a run longer than two from a zig-zag between two holes', () => {
    // 8 is the target's neighbour, so only the two visits to 9 survive the D58 filter and a
    // repeat neither extends nor starts a second run
    const r = pipeline(visitHoles([8, 9, 8, 9, 7]));
    expect(r.strategy.features.longestAdjacentRun).toBe(1);
    expect(r.strategy.features.errors).toBe(4);
    expect(r.strategy.strategy).toBe('random');
    // widening the exclusion away is not a parameter, so check the zig-zag itself away from the
    // target: 12↔13 with target 7 still never builds a run of three
    const away = pipeline(visitHoles([12, 13, 12, 13]));
    expect(away.strategy.features.longestAdjacentRun).toBe(2);
  });

  it('excludes the target and the holes beside it from a serial run (D58)', () => {
    // Gawel et al. 2019, Table 1: "in a serial manner … but not adjacent to target hole".
    // 9→8→7 with target 7 leaves only hole 9, so there is no run and nothing fires but random.
    const r = pipeline(visitHoles([9, 8, 7]));
    expect(r.strategy.features.sequence).toEqual([9, 8, 7]);
    expect(r.strategy.features.longestAdjacentRun).toBe(1);
    expect(r.strategy.features.longestAdjacentRunHoles).toEqual([9]);
    expect(r.strategy.features.maxHoleDistanceFromTarget).toBe(2);
    expect(r.strategy.strategy).toBe('random');
    expect(r.strategy.rules.find((x) => x.strategy === 'serial')!.fired).toBe(false);
    // the same walk one hole further out — 11→10→9, none of them adjacent to target 7 — is serial
    const out = pipeline(visitHoles([11, 10, 9]));
    expect(out.strategy.features.longestAdjacentRun).toBe(3);
    expect(out.strategy.strategy).toBe('serial');
  });

  it('calls a direct approach spatial by definition, however many centre crossings it made', () => {
    const outside = (hole: number): Segment => ({ kind: 'moveToHole', hole, seconds: 0.5, offset_cm: 8 });
    const r = pipeline([
      outside(3),
      { kind: 'moveToCentre', seconds: 0.5 },
      outside(15),
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([7]),
    ]);
    expect(r.strategy.features.errors).toBe(0);
    expect(r.strategy.features.targetReached).toBe(true);
    expect(r.strategy.features.centreCrossings).toBeGreaterThanOrEqual(2);
    expect(r.strategy.strategy).toBe('spatial');
    expect(r.strategy.reasoning.join('\n')).toContain('a direct approach is spatial by definition');
  });

  it('reads its thresholds from the strategy block of the parameters (D55)', () => {
    const strict: Parameters = {
      ...DEFAULT_PARAMETERS,
      strategy: { ...DEFAULT_PARAMETERS.strategy, serialMinRun: 4 },
    };
    const r = pipeline(visitHoles([12, 11, 10, 9, 8]), { g: target8, p: strict });
    expect(r.strategy.strategy).toBe('random');
    expect(r.strategy.runnerUp).toBe('serial'); // a run of 3 against 4 is closer than the spatial rule came
    expect(
      r.strategy.rules.find((x) => x.strategy === 'serial')!.conditions[0]!.degree,
    ).toBeCloseTo(3 / 4, 12);
  });
});
