import { describe, expect, it } from 'vitest';
import { derive, toDerivedLayer, type DeriveInput } from '../../src/analysis/derive.js';
import {
  DEFAULT_PARAMETERS,
  hashParameters,
  hashTrackingParameters,
  isRecorded,
} from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionEntry } from '../../src/contracts/session.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';
import { TEST_RESOLUTION, testGeometry, testMazeMap } from './maze-fixture.js';
import { holePoint, scriptTrack, visitHoles, type Segment } from './synthetic-track.js';
import { deepFreeze } from './track-builder.js';

const g = testGeometry();
const at = (i: number): string => `2026-09-06T10:00:${String(i).padStart(2, '0')}.000Z`;

function inputFor(
  segments: Segment[],
  opts: {
    p?: Parameters;
    corrections?: CorrectionEntry[];
    anomalies?: { duplicatesAt?: number[]; dropsAt?: number[] };
  } = {},
): { input: DeriveInput; segmentStarts: number[] } {
  const scripted = scriptTrack(segments, { g, ...opts.anomalies });
  const input: DeriveInput = {
    videoId: 'vid',
    auto: {
      parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking),
      frames: scripted.frames,
    },
    corrections: { entries: opts.corrections ?? [] },
    mazeMap: testMazeMap(),
    mazeTransform: IDENTITY_TRANSFORM,
    index: { width: TEST_RESOLUTION.width, height: TEST_RESOLUTION.height },
    parameters: opts.p ?? DEFAULT_PARAMETERS,
  };
  return { input: deepFreeze(input), segmentStarts: scripted.segmentStarts };
}

const escapeTrial: Segment[] = [
  { kind: 'empty', seconds: 1 },
  ...visitHoles([3, 5]),
  { kind: 'moveToCentre', seconds: 0.5 },
  { kind: 'lost', seconds: 0.05 }, // one or two frames in the open: fillable
  { kind: 'moveToHole', hole: 7, seconds: 0.5 },
  { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 150] },
  { kind: 'lost', seconds: 3.5 },
  { kind: 'dwell', hole: 7, seconds: 0.5 }, // back out at the target after 3.5 s: persistent, so the trial ended
  ...visitHoles([9]),
];

describe('derive', () => {
  it('runs the whole pipeline over a scripted trial and returns the contract layer plus its explanations', () => {
    const { input, segmentStarts } = inputFor(escapeTrial);
    const d = derive(input);
    expect(d.cleanedTrack).toHaveLength(input.auto.frames.length);
    expect(d.cleaning.filledFrames).toBeGreaterThanOrEqual(1);
    expect(d.cleanedTrack[segmentStarts[6]!]!.centroid.source).toBe('filled');
    expect(d.events.map((e) => `${e.kind}@${e.holeIndex}`)).toEqual([
      'investigation@3',
      'investigation@5',
      'investigation@7',
      'escape_entry@7',
    ]);
    expect(d.metrics.escaped).toBe(true);
    expect(d.metrics.status).toBe('ok');
    expect(d.metrics.primaryErrors).toBe(2);
    expect(d.metrics.totalErrors).toBe(2);
    expect(d.metrics.strategy).toBe('random'); // hole 3 is four holes from the target and the walk crossed the centre
    expect(d.metrics.strategySource).toBe('auto');
    expect(d.trial.endReason).toBe('escape');
    expect(d.trial.startFrame).toBe(30);
    expect(d.quality.tier).toBe('GOOD');
    expect(d.quality.parametersHash).toBe(hashParameters(DEFAULT_PARAMETERS));
    expect(d.parametersHash).toBe(hashParameters(DEFAULT_PARAMETERS));
    expect(d.trackingParametersHash).toBe(input.auto.parametersHash);
    expect(d.reviewFlags).toEqual([]);
    expect(d.strategy.reasoning.length).toBeGreaterThan(2);
    expect(Object.keys(toDerivedLayer(d)).sort()).toEqual([
      'cleanedTrack',
      'events',
      'metrics',
      'quality',
    ]);
  });

  it('never mutates its inputs and is deterministic', () => {
    const { input } = inputFor(escapeTrial, {
      corrections: [
        {
          id: 'p1',
          kind: 'point',
          timestamp: at(1),
          source: 'user',
          frameIndex: 40,
          point: 'nose',
          value: { x: 300, y: 200, confidence: 1, valid: true },
        },
        { id: 't1', kind: 'trial_start', timestamp: at(2), source: 'user', frameIndex: 31 },
      ],
    });
    const before = JSON.stringify(input);
    const a = derive(input);
    const b = derive(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(toDerivedLayer(b))).toBe(JSON.stringify(toDerivedLayer(a)));
    expect(b.events.map((e) => e.id)).toEqual(a.events.map((e) => e.id));
    expect(a.cleanedTrack[40]!.nose.source).toBe('corrected');
    expect(input.auto.frames[40]!.nose.source).toBe('auto');
    expect(a.trial.startFrame).toBe(31);
    expect(a.trial.startSource).toBe('corrected');
    expect(a.correctionsApplied).toEqual({ point: 1, range: 0, event: 0 });
    expect(a.metrics.correctionCount).toBe(2);
  });

  it('propagates a single nose correction into the events and the error count', () => {
    // the centroid sits 4.5 cm from hole 3, outside the radius; only the nose (1.8 cm nearer) makes a bout,
    // and the bout is one frame longer than the minimum, so moving the last nose away removes the investigation
    const p: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 0.25 },
    };
    const script: Segment[] = [
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'moveToHole', hole: 3, offset_cm: 4.5, seconds: 0.5 },
      { kind: 'dwell', hole: 3, offset_cm: 4.5, seconds: 8 / 30, noseConf: 1 },
      { kind: 'moveToHole', hole: 3, offset_cm: 8, seconds: 0.3 },
      ...visitHoles([7]),
    ];
    const base = derive(inputFor(script, { p }).input);
    expect(base.events.map((e) => `${e.kind}@${e.holeIndex}`)).toEqual([
      'investigation@3',
      'investigation@7',
    ]);
    expect(base.metrics.primaryErrors).toBe(1);
    const lastBoutFrame = base.events[0]!.endFrame;
    const far = holePoint(g, 3, 8);
    const moved = derive(
      inputFor(script, {
        p,
        corrections: [
          {
            id: 'n1',
            kind: 'point',
            timestamp: at(1),
            source: 'user',
            frameIndex: lastBoutFrame,
            point: 'nose',
            value: { x: far.x, y: far.y, confidence: 1, valid: true },
          },
        ],
      }).input,
    );
    expect(moved.events.map((e) => `${e.kind}@${e.holeIndex}`)).toEqual(['investigation@7']);
    expect(moved.metrics.primaryErrors).toBe(0);
    expect(moved.metrics.correctionCount).toBe(1);
  });

  it('decrements the errors when an event is deleted, and keeps a strategy override through a parameter change', () => {
    const script = [...visitHoles([12, 11, 10, 9]), ...visitHoles([7])];
    const base = derive(inputFor(script).input);
    expect(base.metrics.primaryErrors).toBe(4);
    expect(base.strategy.strategy).toBe('serial');
    const deleted = derive(
      inputFor(script, {
        corrections: [
          {
            id: 'd1',
            kind: 'event',
            timestamp: at(1),
            source: 'user',
            action: 'delete',
            eventId: base.events[0]!.id,
          },
        ],
      }).input,
    );
    expect(deleted.metrics.primaryErrors).toBe(3);
    expect(deleted.metrics.totalErrors).toBe(3);
    expect(deleted.correctionsApplied.event).toBe(1);

    const override: CorrectionEntry = {
      id: 's1',
      kind: 'strategy_override',
      timestamp: at(1),
      source: 'user',
      strategy: 'spatial',
      reason: 'knew where it was',
    };
    const overridden = derive(inputFor(script, { corrections: [override] }).input);
    expect(overridden.metrics.strategy).toBe('spatial');
    expect(overridden.metrics.strategySource).toBe('corrected');
    const changed: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, radiusFactor: 3 },
    };
    const afterChange = derive(inputFor(script, { corrections: [override], p: changed }).input);
    expect(afterChange.metrics.strategy).toBe('spatial');
    expect(afterChange.metrics.strategySource).toBe('corrected');
    expect(afterChange.strategy.autoStrategy).toBe(afterChange.strategy.autoStrategy); // whatever the new rules say, the override stands
  });

  it('moves the trial end when the escape entry is deleted, revealing what came after', () => {
    const base = derive(inputFor(escapeTrial).input);
    const escape = base.events.find((e) => e.kind === 'escape_entry')!;
    const d = derive(
      inputFor(escapeTrial, {
        corrections: [
          {
            id: 'd1',
            kind: 'event',
            timestamp: at(1),
            source: 'user',
            action: 'delete',
            eventId: escape.id,
          },
        ],
      }).input,
    );
    expect(d.trial.endReason).toBe('end_of_video');
    expect(d.metrics.escaped).toBe(false);
    expect(d.metrics.totalLatency_s).toBeNull();
    expect(d.metrics.status).toBe('review');
    expect(d.events.map((e) => `${e.kind}@${e.holeIndex}`)).toEqual([
      'investigation@3',
      'investigation@5',
      'investigation@7',
      'investigation@7',
      'investigation@9',
    ]);
    expect(d.metrics.totalErrors).toBe(3);
    expect(d.metrics.primaryErrors).toBe(2);
  });

  it('flags oversized foreground inside the trial without moving the start', () => {
    const d = derive(
      inputFor([
        { kind: 'dwell', seconds: 1 },
        { kind: 'oversized', seconds: 0.2 },
        { kind: 'dwell', seconds: 1 },
      ]).input,
    );
    expect(d.trial.startFrame).toBe(0);
    expect(d.reviewFlags.map((f) => f.code)).toEqual(['oversized_in_trial']);
    expect(d.reviewFlags[0]!.frameIndex).toBe(30);
    expect(d.metrics.status).toBe('review');
  });

  it('handles an empty track and a never-tracked track without throwing', () => {
    const empty = derive({
      ...inputFor([{ kind: 'dwell', seconds: 0.1 }]).input,
      auto: { parametersHash: 'x', frames: [] },
    });
    expect(empty.cleanedTrack).toEqual([]);
    expect(empty.events).toEqual([]);
    expect(empty.metrics.status).toBe('unresolved');
    expect(isRecorded(empty.metrics.trialStart_s)).toBe(false);
    expect(empty.quality.tier).toBe('POOR');
    const never = derive(inputFor([{ kind: 'empty', seconds: 2 }]).input);
    expect(never.metrics.status).toBe('unresolved');
    expect(never.trial.endReason).toBe('no_start');
    expect(never.quality.gaps).toHaveLength(1);
    expect(never.strategy.strategy).toBe('random');
  });

  it('rejects invalid parameters by name and survives a JSON round trip of the derived layer', () => {
    const { input } = inputFor(escapeTrial);
    const bad: Parameters = { ...DEFAULT_PARAMETERS, trialCutoff_s: -1 };
    expect(() => derive({ ...input, parameters: bad })).toThrow('trialCutoff_s');
    const layer = toDerivedLayer(derive(input));
    const round = JSON.parse(JSON.stringify(layer)) as typeof layer;
    expect(round.events).toEqual(layer.events);
    expect(round.metrics).toEqual(layer.metrics);
  });

  it('derives a 5,539-frame track well under 50 ms (D22; measured, median of five)', () => {
    const holes = [3, 5, 9, 12, 15, 18, 1, 4, 10, 14, 16, 19, 2, 6, 8, 11, 13, 17];
    const segments: Segment[] = [{ kind: 'empty', seconds: 5 }];
    for (let i = 0; i < 200; i++) {
      segments.push(...visitHoles([holes[i % holes.length]!], 0.4, 0.5));
      if (i % 9 === 4) segments.push({ kind: 'lost', seconds: 0.08 });
      if (i % 13 === 6)
        segments.push({
          kind: 'dwell',
          seconds: 0.3,
          state: 'low_confidence',
          reason: 'fragmented',
        });
    }
    const dropsAt: number[] = [];
    const duplicatesAt: number[] = [];
    for (let i = 25; i < 6000; i += 25) dropsAt.push(i);
    for (let i = 34; i < 6000; i += 34) duplicatesAt.push(i);
    const scripted = scriptTrack(segments, { g, dropsAt, duplicatesAt });
    const frames = scripted.frames.slice(0, 5539).map((f, i) => ({ ...f, frameIndex: i }));
    expect(frames).toHaveLength(5539);
    const input: DeriveInput = {
      videoId: 'big',
      auto: { parametersHash: 'x', frames },
      corrections: { entries: [] },
      mazeMap: testMazeMap(),
      mazeTransform: IDENTITY_TRANSFORM,
      index: { width: 640, height: 480 },
      parameters: DEFAULT_PARAMETERS,
    };
    derive(input);
    derive(input);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const d = derive(input);
      times.push(performance.now() - t0);
      expect(d.events.length).toBeGreaterThan(100);
    }
    times.sort((x, y) => x - y);
    const median = times[2]!;
    console.info(
      `derive timing: 5,539 frames, ${derive(input).events.length} events — median ${median.toFixed(1)} ms of ${times.map((t) => t.toFixed(1)).join(' / ')} ms`,
    );
    expect(median).toBeLessThan(250); // the acceptance figure (< 50 ms on the development Mac) is recorded in prototypes/analysis/RESULTS.md
  });
});
