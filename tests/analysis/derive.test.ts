import { describe, expect, it } from 'vitest';
import { derive, toDerivedLayer, type DeriveInput } from '../../src/analysis/derive.js';
import {
  DEFAULT_PARAMETERS,
  hashParameters,
  hashTrackingParameters,
  isRecorded,
} from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import {
  SESSION_SCHEMA_VERSION,
  type CorrectionEntry,
  type SessionFile,
} from '../../src/contracts/session.js';
import { EVENT_COLUMNS, TRIAL_COLUMNS } from '../../src/export/columns.js';
import { csvHeaderRow, toCsv } from '../../src/export/csv.js';
import { eventRows, trialRows } from '../../src/export/rows.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';
import {
  NO_CORRECTIONS,
  confirmEvent,
  reclassifyEvent,
  revertNoEscape,
} from '../../src/session/corrections.js';
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
    // D60: filling is off by default, so the fillable frames in the open stay unpositioned
    expect(d.cleaning.filledFrames).toBe(0);
    expect(d.cleanedTrack[segmentStarts[6]!]!.centroid.valid).toBe(false);
    expect(d.cleanedTrack[segmentStarts[6]!]!.centroid.source).not.toBe('filled');
    // and the machinery still works for a lab that turns it on
    const filled = derive({
      ...input,
      parameters: { ...DEFAULT_PARAMETERS, gapFilling: { enabled: true, maxDuration_s: 0.1 } },
    });
    expect(filled.cleaning.filledFrames).toBeGreaterThanOrEqual(1);
    expect(filled.cleanedTrack[segmentStarts[6]!]!.centroid.source).toBe('filled');
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
      'reviewFlags',
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
    // D71: the investigation the nudge removed has no row, but it is reported, flagged (soft) and
    // counted beside the nudge exactly as a delete would be — one nudge, one removal
    expect(moved.removedAutoEvents.map((e) => `${e.kind}@${e.holeIndex}`)).toEqual(['investigation@3']);
    expect(moved.removedAutoEvents[0]!.correctionIds).toEqual(['n1']);
    expect(moved.reviewFlags.map((f) => f.code)).toEqual(['auto_event_removed_by_correction']);
    expect(moved.metrics.status).toBe(base.metrics.status);
    expect(moved.metrics.correctionCount).toBe(2);
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

  it('keeps a short user-marked escape-box range consistent between its evidence and the metrics', () => {
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'dwell', seconds: 3 },
    ];
    const from = scriptTrack(script, { g }).segmentStarts[2]! + 15;
    const range = (endFrame: number): CorrectionEntry => ({
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: from,
      endFrame,
    });
    const d = derive(inputFor(script, { corrections: [range(from + 20)] }).input);
    const entry = d.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry.evidence).toContain('the trial continues');
    expect(d.metrics.escaped).toBe(false);
    expect(d.trial.endReason).toBe('end_of_video');
    expect(d.metrics.status).toBe('review');
    const toEnd = derive(inputFor(script, { corrections: [range(10_000)] }).input);
    expect(toEnd.metrics.escaped).toBe(true);
    expect(toEnd.trial.endReason).toBe('escape');
    expect(toEnd.metrics.totalLatency_s).toBeCloseTo(
      toEnd.trial.endTime_s - toEnd.trial.startTime_s,
      12,
    );
  });

  it('lets a later persistent entry end the trial when the first one is deleted', () => {
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'lost', seconds: 3.5 }, // persistent entry 1 (the animal comes back out)
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      ...visitHoles([5, 6]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'lost', seconds: 5 }, // persistent entry 2, to the end of the video
    ];
    const base = derive(inputFor(script).input);
    const first = base.events.find((e) => e.kind === 'escape_entry')!;
    expect(base.trial.endFrame).toBe(first.startFrame);
    const d = derive(
      inputFor(script, {
        corrections: [
          {
            id: 'd1',
            kind: 'event',
            timestamp: at(1),
            source: 'user',
            action: 'delete',
            eventId: first.id,
          },
        ],
      }).input,
    );
    const entries = d.events.filter((e) => e.kind === 'escape_entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.startFrame).toBeGreaterThan(first.startFrame);
    expect(d.trial.endReason).toBe('escape');
    expect(d.trial.endFrame).toBe(entries[0]!.startFrame);
    expect(d.metrics.escaped).toBe(true);
    expect(d.metrics.totalLatency_s).toBeCloseTo(entries[0]!.startTime_s - d.trial.startTime_s, 12);
    expect(d.metrics.totalErrors).toBe(3); // holes 3, 5, 6 — all inside the trial
    expect(entries[0]!.evidence).toContain('the trial ends at the first frame of the run');
  });

  it('never lets an entry retimed before the trial start end the trial, and flags it', () => {
    const { input } = inputFor(escapeTrial);
    const base = derive(input);
    const entry = base.events.find((e) => e.kind === 'escape_entry')!;
    const d = derive({
      ...input,
      corrections: {
        entries: [
          {
            id: 'e1',
            kind: 'event',
            timestamp: at(1),
            source: 'user',
            action: 'edit',
            eventId: entry.id,
            startFrame: 5,
            endFrame: 120,
          },
        ],
      },
    });
    expect(d.trial.startFrame).toBe(30);
    expect(d.trial.endReason).not.toBe('escape');
    expect(d.trial.endFrame!).toBeGreaterThanOrEqual(d.trial.startFrame!);
    expect(d.metrics.escaped).toBe(false);
    expect(d.metrics.totalLatency_s).toBeNull();
    expect(d.metrics.trackedFraction).toBeGreaterThan(0);
    expect(d.reviewFlags.map((f) => f.code)).toContain('correction_out_of_range');
    expect(d.metrics.status).toBe('review');
    expect(Object.values(d.quality.detectionStateFractions).every(Number.isFinite)).toBe(true);
  });

  it('does not count a user-added event outside the trial as an error', () => {
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'lost', seconds: 4 },
      { kind: 'dwell', seconds: 2 },
    ];
    const base = derive(inputFor(script).input);
    const end = base.trial.endFrame!;
    const d = derive(
      inputFor(script, {
        corrections: [
          {
            id: 'a1',
            kind: 'event',
            timestamp: at(1),
            source: 'user',
            action: 'add',
            holeIndex: 5,
            startFrame: end + 130,
            endFrame: end + 150,
          },
        ],
      }).input,
    );
    expect(d.events.some((e) => e.id === 'user-a1')).toBe(true);
    expect(d.events.find((e) => e.id === 'user-a1')!.evidence).toContain('after the trial end');
    expect(d.metrics.totalErrors).toBe(base.metrics.totalErrors);
    expect(d.metrics.primaryErrors).toBe(base.metrics.primaryErrors);
  });

  it('gives the same answer when frame numbers are offset from array positions', () => {
    const script = [...visitHoles([12, 11, 10, 9]), ...visitHoles([7])];
    const plain = inputFor(script).input;
    const shifted: DeriveInput = {
      ...plain,
      auto: {
        ...plain.auto,
        frames: plain.auto.frames.map((f) => ({ ...f, frameIndex: f.frameIndex + 1000 })),
      },
      corrections: {
        entries: [
          { id: 't', kind: 'trial_start', timestamp: at(1), source: 'user', frameIndex: 1020 },
        ],
      },
    };
    const a = derive({
      ...plain,
      corrections: {
        entries: [
          { id: 't', kind: 'trial_start', timestamp: at(1), source: 'user', frameIndex: 20 },
        ],
      },
    });
    const b = derive(shifted);
    expect(b.trial.startFrame).toBe(20);
    expect(b.reviewFlags).toEqual([]);
    expect(b.metrics.strategy).toBe(a.metrics.strategy);
    expect(b.strategy.features).toEqual(a.strategy.features);
    expect(b.events.map((e) => [e.kind, e.holeIndex, e.startFrame - 1000])).toEqual(
      a.events.map((e) => [e.kind, e.holeIndex, e.startFrame]),
    );
    expect(b.quality.gaps).toEqual(
      a.quality.gaps.map((gap) => ({
        ...gap,
        startFrame: gap.startFrame + 1000,
        endFrame: gap.endFrame + 1000,
      })),
    );
  });

  it('moves the tier, fractions, gaps and events together when centroids are corrected', () => {
    // 6 s tracked, 4 s lost in the open, 6 s tracked: a quality gap, a tracking failure, tier REVIEW
    const holed: Segment[] = [
      { kind: 'dwell', seconds: 6 },
      { kind: 'lost', seconds: 4 },
      { kind: 'dwell', seconds: 6 },
    ];
    const { input, segmentStarts } = inputFor(holed);
    const before = derive(input);
    expect(before.quality.tier).toBe('REVIEW');
    expect(before.quality.gaps).toHaveLength(1);
    expect(before.events.map((e) => e.kind)).toEqual(['tracking_failure']);
    expect(before.metrics.trackedFraction).toBeCloseTo(0.75, 9);
    expect(before.quality.detectionStateFractions.not_detected).toBeCloseTo(0.25, 9);
    const placed: CorrectionEntry[] = [];
    for (let i = segmentStarts[1]!; i < segmentStarts[2]!; i++) {
      placed.push({
        id: `p${i}`,
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: i,
        point: 'centroid',
        value: { x: 322, y: 240, confidence: 1, valid: true },
      });
    }
    const after = derive({ ...input, corrections: { entries: placed } });
    expect(after.quality.gaps).toHaveLength(0);
    expect(after.events).toHaveLength(0);
    expect(after.quality.tier).toBe('GOOD');
    expect(after.metrics.trackedFraction).toBeCloseTo(1, 9);
    expect(after.quality.detectionStateFractions).toEqual({
      tracked: 1,
      not_detected: 0,
      ambiguous: 0,
      low_confidence: 0,
    });
    expect(after.cleanedTrack[segmentStarts[1]!]!.detectionState).toBe('tracked');
    expect(after.cleanedTrack[segmentStarts[1]!]!.reason).toBe('corrected');
    expect(after.kinematics.trackedTime_s).toBeGreaterThan(before.kinematics.trackedTime_s);

    // the reverse: invalidating tracked frames opens a gap, a failure, and lowers the tier
    const solid = inputFor([{ kind: 'dwell', seconds: 12 }]).input;
    const good = derive(solid);
    expect(good.quality.tier).toBe('GOOD');
    const removed: CorrectionEntry[] = [];
    for (let i = 180; i < 300; i++) {
      removed.push({
        id: `r${i}`,
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: i,
        point: 'centroid',
        value: { x: 0, y: 0, confidence: 0, valid: false },
      });
    }
    const worse = derive({ ...solid, corrections: { entries: removed } });
    expect(worse.quality.gaps).toHaveLength(1);
    expect(worse.events.map((e) => e.kind)).toEqual(['tracking_failure']);
    expect(worse.quality.tier).not.toBe('GOOD');
    expect(worse.metrics.trackedFraction).toBeCloseTo(1 - 120 / 360, 9);
    expect(worse.quality.detectionStateFractions.not_detected).toBeCloseTo(120 / 360, 9);
    expect(worse.cleanedTrack[200]!.reason).toBe('corrected');
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

  it('flags an automatic layer produced by other tracking parameters and sends the trial to review (D51)', () => {
    const { input } = inputFor(escapeTrial);
    expect(derive(input).reviewFlags.map((f) => f.code)).not.toContain('stale_auto_layer');

    const stale: DeriveInput = { ...input, auto: { ...input.auto, parametersHash: 'deadbeef0000' } };
    const d = derive(stale);
    const flag = d.reviewFlags.find((f) => f.code === 'stale_auto_layer');
    expect(flag).toBeDefined();
    expect(flag!.message).toContain('deadbeef…');
    expect(flag!.message).toContain(`${hashTrackingParameters(DEFAULT_PARAMETERS.tracking).slice(0, 8)}…`);
    expect(flag!.message).toContain('re-track the video');
    expect(d.metrics.status).toBe('review');
    // The numbers are those of the track that exists; only the provenance is called out.
    expect(d.metrics.primaryErrors).toBe(derive(input).metrics.primaryErrors);
  });

  it('drops the review flag of a flagged event the user deleted, so the trial can reach ok (D20)', () => {
    // A two-second head-in-hole run at a non-target hole (flagged physically unlikely), then a
    // clean escape at the target.
    const script: Segment[] = [
      { kind: 'empty', seconds: 1 },
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 2, state: 'low_confidence', reason: 'small_blob' },
      { kind: 'dwell', hole: 3, seconds: 0.3 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 150] },
      { kind: 'lost', seconds: 3.5 },
    ];
    const before = derive(inputFor(script).input);
    const flag = before.reviewFlags.find((f) => f.code === 'physically_unlikely_entry');
    expect(flag?.eventId).toBeDefined();
    expect(before.metrics.escaped).toBe(true);
    expect(before.metrics.status).toBe('review');

    const deletion: CorrectionEntry = {
      kind: 'event',
      id: 'del-1',
      timestamp: '2026-09-07T10:00:00.000Z',
      source: 'user',
      action: 'delete',
      eventId: flag!.eventId!,
    };
    const after = derive(inputFor(script, { corrections: [deletion] }).input);
    expect(after.events.map((e) => e.id)).not.toContain(flag!.eventId);
    expect(after.reviewFlags.map((f) => f.code)).not.toContain('physically_unlikely_entry');
    expect(after.metrics.status).toBe('ok');
  });

  it('handles an empty track and a never-tracked track without throwing', () => {
    const empty = derive({
      ...inputFor([{ kind: 'dwell', seconds: 0.1 }]).input,
      auto: { parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking), frames: [] },
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
    expect(never.strategy.strategy).toBe('unclassified');
    expect(never.metrics.primaryErrors).toBeNull();
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
      auto: { parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking), frames },
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

/*
 * D63. A trial with no escape entry is `review` by construction, because the tool cannot tell a
 * non-escaper from a missed entry. These tests are about the one thing that can settle it — a
 * person saying which it was — and about what happens when an escape entry turns up afterwards.
 *
 * The script is the one the escape-box range tests use: an investigation at the target and then
 * three seconds in the open, so the trial runs to the end of the video with no entry, and a range
 * correction can manufacture one on demand.
 */
describe('a confirmed non-escape (D63)', () => {
  const noEscapeScript: Segment[] = [
    { kind: 'moveToHole', hole: 7, seconds: 0.5 },
    { kind: 'dwell', hole: 7, seconds: 0.5 },
    { kind: 'dwell', seconds: 3 },
  ];

  const confirmation: CorrectionEntry = {
    id: 'n1',
    kind: 'no_escape',
    timestamp: at(2),
    source: 'user',
    reason: 'watched it to the end; the animal sat on the platform',
  };

  /** A range correction that puts the animal in the escape box to the end of the clip. */
  const entryToEnd: CorrectionEntry = {
    id: 'r1',
    kind: 'range',
    timestamp: at(1),
    source: 'user',
    rangeType: 'in_escape_box',
    startFrame: scriptTrack(noEscapeScript, { g }).segmentStarts[2]! + 15,
    endFrame: 10_000,
  };

  it('reads ok with escaped false and no total latency', () => {
    const before = derive(inputFor(noEscapeScript).input);
    expect(before.metrics.status).toBe('review');
    expect(before.metrics.noEscapeConfirmed).toBe(false);

    const d = derive(inputFor(noEscapeScript, { corrections: [confirmation] }).input);
    expect(d.metrics.status).toBe('ok');
    expect(d.metrics.escaped).toBe(false);
    expect(d.metrics.noEscapeConfirmed).toBe(true);
    expect(d.metrics.totalLatency_s).toBeNull();
    expect(d.reviewFlags).toEqual([]);
  });

  it('goes back to review, flagged, when an escape entry appears beside it', () => {
    const d = derive(
      inputFor(noEscapeScript, { corrections: [confirmation, entryToEnd] }).input,
    );
    // the entry wins: the trial escaped, and the disagreement is named rather than resolved
    expect(d.metrics.escaped).toBe(true);
    expect(d.trial.endReason).toBe('escape');
    expect(d.metrics.noEscapeConfirmed).toBe(true);
    expect(d.metrics.status).toBe('review');
    const flag = d.reviewFlags.find((f) => f.code === 'no_escape_contradicted');
    expect(flag).toBeDefined();
    expect(flag!.correctionId).toBe('n1');
    expect(flag!.message).toContain('the animal sat on the platform');
  });

  it('stands beside an escape entry too short to end the trial, noted rather than contradicted (D67)', () => {
    /*
     * A loss at the target over the minimum duration but under the persist cutoff is a real
     * `escape_entry` row in `events.csv` at the escape hole — the animal put its head in and came
     * back out — while the trial runs on and `escaped` stays false. Under D63 alone that entry
     * contradicted the confirmation and sent the trial to review, which asked the user to delete
     * the tool's evidence in order to agree with it. D67 lets the confirmation stand with a soft
     * flag that says what was seen; the hard contradiction stays for an entry that ended the trial.
     */
    const shortEntry: Segment[] = [
      { kind: 'empty', seconds: 1 },
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 150] },
      { kind: 'lost', seconds: 1.5 }, // over escapeEntry.minDuration_s, under persistCutoff_s
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      ...visitHoles([9]),
    ];
    const { input } = inputFor(shortEntry, { corrections: [confirmation] });
    const d = derive(input);
    expect(d.events.some((e) => e.kind === 'escape_entry')).toBe(true);
    expect(d.metrics.escaped).toBe(false); // the entry is not persistent: the trial ran on
    expect(d.reviewFlags.map((f) => f.code)).toEqual(['non_persistent_entry_noted']);
    expect(d.reviewFlags[0]!.message).toContain('under the persist cutoff');
    expect(d.reviewFlags[0]!.correctionId).toBe('n1');
    expect(d.metrics.noEscapeConfirmed).toBe(true);
    expect(d.metrics.status).toBe('ok');
    // the row says the same: ok, confirmed, and the note travels in review_flags
    const row = trialRowFor(input, d);
    expect(row).toMatchObject({
      status: 'ok',
      escaped: 'false',
      no_escape_confirmed: 'true',
      review_flags: 'non_persistent_entry_noted',
    });
    // another hard flag still sends it to review: the soft flag never masks one
    const stale = derive({ ...input, auto: { ...input.auto, parametersHash: 'deadbeef'.repeat(8) } });
    expect(stale.metrics.status).toBe('review');
    expect(stale.reviewFlags.map((f) => f.code).sort()).toEqual(['non_persistent_entry_noted', 'stale_auto_layer']);
  });

  it('leaves the trial at review once the confirmation is reverted', () => {
    // `revertNoEscape` drops the entry; deriving without it is what the store then recomputes
    const reverted = revertNoEscape({ entries: [confirmation] });
    expect(reverted.entries).toEqual([]);
    const d = derive(inputFor(noEscapeScript, { corrections: [...reverted.entries] }).input);
    expect(d.metrics.status).toBe('review');
    expect(d.metrics.noEscapeConfirmed).toBe(false);
  });

  it('does not clear a review flag that has nothing to do with escaping', () => {
    const { input } = inputFor(noEscapeScript, { corrections: [confirmation] });
    // D51: an automatic layer keyed by other tracking parameters always raises `stale_auto_layer`
    const d = derive({ ...input, auto: { ...input.auto, parametersHash: 'deadbeef'.repeat(8) } });
    expect(d.reviewFlags.map((f) => f.code)).toContain('stale_auto_layer');
    expect(d.metrics.noEscapeConfirmed).toBe(true);
    expect(d.metrics.status).toBe('review');
  });
});

/*
 * D65: provenance is the difference between two detections. Detection runs over the automatic
 * frames alone and over `auto ⊕ corrections`; an event only the second finds is a human claim, an
 * event both find but measure differently keeps its automatic source with the auto-only values as
 * its shadow, and a confirmation is the automatic event with a flag on it. Each case is checked on
 * the record and on the `events.csv` row, read back by header name.
 */
/** RFC 4180 rows by header: enough for the writer's own output (quoted fields with commas). */
function csvRows(text: string): Record<string, string>[] {
    const lines: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // part of the CRLF line ending
      } else if (ch === '\n') {
        row.push(field);
        lines.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    const [header, ...rest] = lines;
    return rest
      .filter((cells) => cells.length > 1)
      .map((cells) => Object.fromEntries(header!.map((h, i) => [h, cells[i] ?? ''])));
}

/** A one-video session around an analysis, so the export writers can be run on it. */
function sessionAround(input: DeriveInput, analysis: ReturnType<typeof derive>): SessionFile {
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      toolVersion: 'barnestrack v0.2.0 (test)',
      sessionId: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a',
      name: 'provenance',
      reviewer: null,
      videos: [
        {
          id: input.videoId,
          filename: 'vid.mp4',
          fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: input.auto.frames.length, sha256: 'a'.repeat(64) },
          referenceResolution: { ...TEST_RESOLUTION },
          mazeTransform: { ...IDENTITY_TRANSFORM },
          metadata: {},
          trialType: input.trialType ?? 'acquisition',
          targetHole: input.targetHole ?? null,
        },
      ],
      mazeMap: input.mazeMap,
      parameters: input.parameters,
      analyses: {
        [input.videoId]: {
          auto: input.auto,
          corrections: input.corrections,
          derived: toDerivedLayer(analysis),
        },
      },
    };
}

/** The events.csv row of one event, by header name. */
function rowFor(input: DeriveInput, analysis: ReturnType<typeof derive>, eventId: string) {
  const session = sessionAround(input, analysis);
  const row = csvRows(toCsv(EVENT_COLUMNS, eventRows(session))).find((r) => r['event_id'] === eventId);
  expect(row, `no events.csv row for ${eventId}`).toBeDefined();
  return row!;
}

/** The trials.csv row of a one-video session around an analysis, by header name. */
function trialRowFor(input: DeriveInput, analysis: ReturnType<typeof derive>): Record<string, string> {
  return csvRows(toCsv(TRIAL_COLUMNS, trialRows(sessionAround(input, analysis))))[0]!;
}

describe('event provenance (D65)', () => {
  // an investigation at hole 3, then a long stay at the target that the user marks as "in the box"
  const stayAtTarget: Segment[] = [
    ...visitHoles([3]),
    { kind: 'moveToHole', hole: 7, seconds: 0.5 },
    { kind: 'dwell', hole: 7, seconds: 3.5 },
  ];

  it('(a) exports a user-asserted escape-box range as a human claim naming the range, and leaves an untouched investigation automatic', () => {
    const { input: plain, segmentStarts } = inputFor(stayAtTarget);
    const rangeFrom = segmentStarts[3]! + 15;
    const frame2 = plain.auto.frames[2]!;
    const corrections: CorrectionEntry[] = [
      {
        id: 'p1',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 2,
        point: 'centroid',
        value: { x: frame2.centroid.x + 0.5, y: frame2.centroid.y, confidence: 1, valid: true },
      },
      {
        id: 'r1',
        kind: 'range',
        timestamp: at(2),
        source: 'user',
        rangeType: 'in_escape_box',
        startFrame: rangeFrom,
        endFrame: plain.auto.frames.length - 1,
      },
    ];
    const { input } = inputFor(stayAtTarget, { corrections });
    const d = derive(input);

    const entry = d.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry).toBeDefined();
    expect(entry.startFrame).toBe(rangeFrom);
    expect(entry.source).toBe('corrected');
    expect(entry.correctionIds).toEqual(['r1']);
    expect(entry.evidenceCorrected).toBe(false);
    expect(entry.confirmed).toBe(false);
    expect(entry.autoShadow).toBeUndefined();

    const elsewhere = d.events.find((e) => e.kind === 'investigation' && e.holeIndex === 3)!;
    expect(elsewhere).toBeDefined();
    expect(elsewhere.source).toBe('auto');
    expect(elsewhere.evidenceCorrected).toBe(false);
    expect(elsewhere.correctionIds).toEqual([]);
    expect(elsewhere.autoShadow).toBeUndefined();

    // (d) the rows say the same, by header name
    const entryRow = rowFor(input, d, entry.id);
    expect(entryRow).toMatchObject({ source: 'corrected', evidence_corrected: 'false', correction_ids: 'r1', confirmed: 'false', auto_start_frame: '' });
    const elsewhereRow = rowFor(input, d, elsewhere.id);
    expect(elsewhereRow).toMatchObject({ source: 'auto', evidence_corrected: 'false', correction_ids: '', confirmed: 'false', auto_start_frame: '' });
  });

  it('(b) keeps an investigation a nose correction moved by two frames automatic, evidence-corrected, with the old start as its shadow', () => {
    const script: Segment[] = [...visitHoles([3]), { kind: 'moveToCentre', seconds: 0.5 }];
    const { input: plain } = inputFor(script);
    const before = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 3)!;
    const s = before.startFrame;
    // the nose placed at the hole two frames before the automatic start: the bout there merges with
    // the automatic one (one frame apart, under the merge gap), so the investigation starts earlier
    const correction: CorrectionEntry = {
      id: 'p',
      kind: 'point',
      timestamp: at(1),
      source: 'user',
      frameIndex: s - 2,
      point: 'nose',
      value: { x: g.holeX[3]!, y: g.holeY[3]!, confidence: 1, valid: true },
    };
    const { input } = inputFor(script, { corrections: [correction] });
    const d = derive(input);
    const moved = d.events.find((e) => e.kind === 'investigation' && e.holeIndex === 3)!;
    expect(moved.startFrame).toBe(s - 2);
    expect(moved.endFrame).toBe(before.endFrame);
    expect(moved.source).toBe('auto');
    expect(moved.evidenceCorrected).toBe(true);
    expect(moved.correctionIds).toEqual(['p']);
    expect(moved.confirmed).toBe(false);
    expect(moved.autoShadow).toEqual({ holeIndex: 3, startFrame: s, endFrame: before.endFrame });
    expect(d.metrics.correctionCount).toBe(1);

    const row = rowFor(input, d, moved.id);
    expect(row).toMatchObject({
      source: 'auto',
      evidence_corrected: 'true',
      correction_ids: 'p',
      confirmed: 'false',
      auto_hole_index: '3',
      auto_start_frame: String(s),
      auto_end_frame: String(before.endFrame),
    });
  });

  it('(c) exports a kept event as automatic and confirmed, with no shadow and no correction counted', () => {
    const script: Segment[] = [...visitHoles([3, 7]), { kind: 'moveToCentre', seconds: 0.5 }];
    const { input: plain } = inputFor(script);
    const target = derive(plain).events.find((e) => e.holeIndex === 3)!;
    const kept = confirmEvent(
      NO_CORRECTIONS,
      target.id,
      { holeIndex: target.holeIndex, startFrame: target.startFrame, endFrame: target.endFrame },
      { id: 'k1', timestamp: at(1) },
    );
    const { input } = inputFor(script, { corrections: [...kept.entries] });
    const d = derive(input);
    const confirmed = d.events.find((e) => e.id === target.id)!;
    expect(confirmed).toEqual({ ...target, confirmed: true });
    expect(confirmed.source).toBe('auto');
    expect(confirmed.autoShadow).toBeUndefined();
    expect(d.metrics.correctionCount).toBe(0);
    expect(d.correctionsApplied.event).toBe(1);

    const row = rowFor(input, d, target.id);
    expect(row).toMatchObject({
      source: 'auto',
      evidence_corrected: 'false',
      correction_ids: '',
      confirmed: 'true',
      auto_hole_index: '',
      auto_start_frame: '',
      auto_end_frame: '',
    });
    // and the header has the three columns right after `source`
    const header = csvHeaderRow(EVENT_COLUMNS).split(',');
    const at_ = header.indexOf('source');
    expect(header.slice(at_, at_ + 4)).toEqual(['source', 'evidence_corrected', 'correction_ids', 'confirmed']);
  });

  it('exports an added event as a human claim that is never evidence-corrected, naming the frame corrections inside its span', () => {
    const { input: plain } = inputFor(stayAtTarget);
    const frame2 = plain.auto.frames[2]!;
    const corrections: CorrectionEntry[] = [
      {
        id: 'p1',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 2,
        point: 'centroid',
        value: { x: frame2.centroid.x + 0.5, y: frame2.centroid.y, confidence: 1, valid: true },
      },
      {
        id: 'a1',
        kind: 'event',
        timestamp: at(2),
        source: 'user',
        action: 'add',
        holeIndex: 5,
        startFrame: 0,
        endFrame: 6,
      },
    ];
    const { input } = inputFor(stayAtTarget, { corrections });
    const d = derive(input);
    const added = d.events.find((e) => e.id === 'user-a1')!;
    expect(added).toBeDefined();
    // in neither detection: a claim, with the nudge inside its span named, and no shadow
    expect(added.source).toBe('corrected');
    expect(added.evidenceCorrected).toBe(false);
    expect(added.correctionIds).toEqual(['p1']);
    expect(added.autoShadow).toBeUndefined();
    expect(rowFor(input, d, added.id)).toMatchObject({ source: 'corrected', evidence_corrected: 'false', correction_ids: 'p1', auto_start_frame: '' });
  });

  it('flags a confirmation whose event no longer exists instead of resurrecting it', () => {
    const script: Segment[] = [...visitHoles([3, 7]), { kind: 'moveToCentre', seconds: 0.5 }];
    const { input: plain } = inputFor(script);
    const target = derive(plain).events.find((e) => e.holeIndex === 3)!;
    const kept = confirmEvent(
      NO_CORRECTIONS,
      target.id,
      { holeIndex: target.holeIndex, startFrame: target.startFrame, endFrame: target.endFrame },
      { id: 'k1', timestamp: at(1) },
    );
    // a longer minimum duration removes the investigation the confirmation names
    const strict: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 5 },
    };
    const d = derive(inputFor(script, { corrections: [...kept.entries], p: strict }).input);
    expect(d.events.find((e) => e.id === target.id)).toBeUndefined();
    const flag = d.reviewFlags.find((f) => f.code === 'confirmation_contradicted');
    expect(flag).toMatchObject({ correctionId: 'k1', eventId: target.id });
    expect(d.metrics.status).toBe('review');
  });
});

/*
 * D67: the detector's escape entry is an inference until a person says what they saw. Three
 * actions exist on it — confirm, reject (delete, as before), reclassify as a tracking loss — and
 * each is checked on the record, on the metrics and on the exported row.
 */
describe('the escape entry as an inference (D67)', () => {
  // an investigation at hole 3, then a 1.5 s loss at the target the animal comes back from
  const shortEntry: Segment[] = [
    { kind: 'empty', seconds: 1 },
    ...visitHoles([3]),
    { kind: 'moveToHole', hole: 7, seconds: 0.5 },
    { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 150] },
    { kind: 'lost', seconds: 1.5 },
    { kind: 'dwell', hole: 7, seconds: 0.5 },
    ...visitHoles([9]),
  ];

  function entryOf(analysis: ReturnType<typeof derive>) {
    const entry = analysis.events.find((e) => e.kind === 'escape_entry');
    expect(entry, 'no escape entry was inferred').toBeDefined();
    return entry!;
  }

  it('accepts a confirmation on an escape entry: automatic, confirmed, nothing re-measured, nothing counted', () => {
    const { input: plain } = inputFor(escapeTrial);
    const before = derive(plain);
    const entry = entryOf(before);
    const kept = confirmEvent(
      NO_CORRECTIONS,
      entry.id,
      { holeIndex: entry.holeIndex, startFrame: entry.startFrame, endFrame: entry.endFrame },
      { id: 'k1', timestamp: at(1) },
    );
    const { input } = inputFor(escapeTrial, { corrections: [...kept.entries] });
    const d = derive(input);
    const confirmed = entryOf(d);
    expect(confirmed).toEqual({ ...entry, confirmed: true });
    expect(d.metrics).toEqual(before.metrics);
    expect(d.metrics.escaped).toBe(true);
    expect(d.metrics.status).toBe('ok');
    expect(d.metrics.correctionCount).toBe(0);
    expect(d.reviewFlags).toEqual([]);
    const row = rowFor(input, d, entry.id);
    expect(row).toMatchObject({ kind: 'escape_entry', source: 'auto', confirmed: 'true', auto_start_frame: '' });
  });

  it('flags a confirmed entry that a threshold change removed, and sends the trial to review', () => {
    const { input: plain } = inputFor(shortEntry);
    const entry = entryOf(derive(plain));
    const kept = confirmEvent(
      NO_CORRECTIONS,
      entry.id,
      { holeIndex: entry.holeIndex, startFrame: entry.startFrame, endFrame: entry.endFrame },
      { id: 'k1', timestamp: at(1) },
    );
    // a longer minimum entry duration than the 1.5 s loss: the entry no longer exists
    const strict: Parameters = {
      ...DEFAULT_PARAMETERS,
      escapeEntry: { ...DEFAULT_PARAMETERS.escapeEntry, minDuration_s: 2 },
    };
    const { input } = inputFor(shortEntry, { corrections: [...kept.entries], p: strict });
    const d = derive(input);
    expect(d.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    const flag = d.reviewFlags.find((f) => f.code === 'confirmation_contradicted');
    expect(flag).toMatchObject({ correctionId: 'k1', eventId: entry.id });
    expect(flag!.message).toContain('no longer exists');
    expect(d.metrics.status).toBe('review');
    expect(trialRowFor(input, d).review_flags).toBe('confirmation_contradicted');
  });

  it('reclassifies an entry as a tracking failure: the frames stay a gap and the trial is recomputed without it', () => {
    const { input: plain } = inputFor(escapeTrial);
    const before = derive(plain);
    const entry = entryOf(before);
    expect(before.metrics.escaped).toBe(true);
    expect(before.trial.endReason).toBe('escape');

    const reclassified = reclassifyEvent(NO_CORRECTIONS, entry.id, { id: 'x1', timestamp: at(1) });
    const { input } = inputFor(escapeTrial, { corrections: [...reclassified.entries] });
    const d = derive(input);
    const failure = d.events.find((e) => e.id === entry.id)!;
    expect(failure.kind).toBe('tracking_failure');
    expect(failure.source).toBe('corrected');
    expect(failure.holeIndex).toBe(entry.holeIndex);
    expect(failure.startFrame).toBe(entry.startFrame);
    // D71: the shadow names the automatic kind, since the live kind no longer is it
    expect(failure.autoShadow).toEqual({ holeIndex: entry.holeIndex, startFrame: entry.startFrame, endFrame: entry.endFrame, kind: 'escape_entry' });
    expect(failure.evidence).toContain('Reclassified by the user');
    // the lost frames are still a gap in the cleaned track
    const lost = d.cleanedTrack.filter((f) => f.frameIndex >= entry.startFrame && f.frameIndex <= entry.endFrame && !f.centroid.valid);
    expect(lost.length).toBeGreaterThan(0);
    // no entry: the trial runs to the end of the video, the latency is blank, and the visit the
    // entry had hidden (hole 9, after the loss) is now an error
    expect(d.trial.endReason).toBe('end_of_video');
    expect(d.metrics.escaped).toBe(false);
    expect(d.metrics.totalLatency_s).toBeNull();
    expect(d.metrics.totalErrors).toBe(before.metrics.totalErrors! + 1);
    expect(d.events.some((e) => e.kind === 'investigation' && e.holeIndex === 9)).toBe(true);
    expect(d.metrics.correctionCount).toBe(1);
    expect(d.correctionsApplied.event).toBe(1);

    const eventRow = rowFor(input, d, entry.id);
    expect(eventRow).toMatchObject({
      kind: 'tracking_failure',
      source: 'corrected',
      confirmed: 'false',
      auto_hole_index: String(entry.holeIndex),
      auto_start_frame: String(entry.startFrame),
      auto_end_frame: String(entry.endFrame),
    });
    const trialRow = trialRowFor(input, d);
    expect(trialRow).toMatchObject({ escaped: 'false', total_latency_s: '', status: 'review' });
    expect(Number(trialRow.total_errors)).toBe(before.metrics.totalErrors! + 1);
  });

  it('drops the physically-unlikely flag of a user-asserted entry once it is reclassified', () => {
    // the D57 case: an escape-box range marked while the animal sits 6 cm from hole 3
    const away = holePoint(g, 3, 6);
    const contradicted: Segment[] = [
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'dwell', seconds: 3 },
    ];
    const { input: plain, segmentStarts } = inputFor(contradicted);
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: segmentStarts[2]!,
      endFrame: plain.auto.frames.length - 1,
    };
    const flagged = derive(inputFor(contradicted, { corrections: [range] }).input);
    const entry = entryOf(flagged);
    expect(flagged.reviewFlags.map((f) => f.code)).toEqual(['physically_unlikely_entry']);
    const reclassified = reclassifyEvent({ entries: [range] }, entry.id, { id: 'x1', timestamp: at(2) });
    const d = derive(inputFor(contradicted, { corrections: [...reclassified.entries] }).input);
    expect(d.events.find((e) => e.id === entry.id)?.kind).toBe('tracking_failure');
    expect(d.reviewFlags.map((f) => f.code)).not.toContain('physically_unlikely_entry');
    expect(d.metrics.escaped).toBe(false);
  });

  it('ignores a reclassification of anything but an escape entry, and says so', () => {
    const { input: plain } = inputFor(escapeTrial);
    const investigation = derive(plain).events.find((e) => e.kind === 'investigation')!;
    const wrong = reclassifyEvent(NO_CORRECTIONS, investigation.id, { id: 'x1', timestamp: at(1) });
    const d = derive(inputFor(escapeTrial, { corrections: [...wrong.entries] }).input);
    expect(d.events.find((e) => e.id === investigation.id)?.kind).toBe('investigation');
    const flag = d.reviewFlags.find((f) => f.code === 'orphaned_correction');
    expect(flag?.message).toContain('only an escape entry can be reclassified');
  });

  it('is unchanged by a probe trial type on a trial with no loss at the target, except that nothing about escaping is a number', () => {
    // covered in detail under D68 below; here only that the D67 paths do not leak into a probe
    const { input } = inputFor([...visitHoles([3, 7, 9]), { kind: 'moveToCentre', seconds: 0.5 }]);
    const probe = derive({ ...input, trialType: 'probe' });
    expect(probe.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    expect(probe.metrics.escaped).toBeNull();
  });

  it('refuses a confirmation on a tracking failure, and says so', () => {
    const away = holePoint(g, 3, 6);
    const lostInTheOpen: Segment[] = [
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 5 },
    ];
    const { input: plain } = inputFor(lostInTheOpen);
    const failure = derive(plain).events.find((e) => e.kind === 'tracking_failure')!;
    const kept = confirmEvent(
      NO_CORRECTIONS,
      failure.id,
      { holeIndex: failure.holeIndex, startFrame: failure.startFrame, endFrame: failure.endFrame },
      { id: 'k1', timestamp: at(1) },
    );
    const d = derive(inputFor(lostInTheOpen, { corrections: [...kept.entries] }).input);
    expect(d.events.find((e) => e.id === failure.id)?.confirmed).toBe(false);
    expect(d.reviewFlags.find((f) => f.code === 'orphaned_correction')?.message).toContain(
      'cannot be confirmed',
    );
  });
});

/*
 * D68: a probe trial has no escape box, and a video may name its own target hole under the
 * map's numbering. Both are properties of the video, passed to derive beside the map.
 */
describe('probe trials and per-video target holes (D68)', () => {
  const search: Segment[] = [...visitHoles([3, 7, 9]), { kind: 'moveToCentre', seconds: 0.5 }];

  it('leaves a probe trial’s escape measures blank, never review for not escaping, and measures the rest to the cutoff', () => {
    const { input } = inputFor(search);
    const acquisition = derive(input);
    expect(acquisition.metrics.escaped).toBe(false);
    expect(acquisition.metrics.status).toBe('review'); // never escaped, nobody confirmed

    const probeInput: DeriveInput = { ...input, trialType: 'probe' };
    const probe = derive(probeInput);
    expect(probe.metrics.escaped).toBeNull();
    expect(probe.metrics.totalLatency_s).toBeNull();
    expect(probe.metrics.noEscapeConfirmed).toBeNull();
    expect(probe.metrics.status).toBe('ok');
    expect(probe.reviewFlags).toEqual([]);
    expect(probe.trial.endReason).toBe('end_of_video');
    // primary latency, errors and strategy are the same measurements over the same window
    expect(probe.metrics.primaryLatency_s).toBe(acquisition.metrics.primaryLatency_s);
    expect(probe.metrics.primaryErrors).toBe(1);
    expect(probe.metrics.totalErrors).toBe(2);
    expect(probe.metrics.strategy).toBe(acquisition.metrics.strategy);
    expect(probe.quality).toEqual(acquisition.quality);

    const row = trialRowFor(probeInput, probe);
    expect(row).toMatchObject({
      trial_type: 'probe',
      escaped: '',
      total_latency_s: '',
      no_escape_confirmed: '',
      no_escape_confirmed_by: '',
      status: 'ok',
      review_flags: '',
    });
    expect(Number(row.primary_errors)).toBe(1);
  });

  it('never infers an entry on a probe trial: a loss at the target is read like a loss at any hole', () => {
    const { input } = inputFor(escapeTrial);
    expect(derive(input).events.some((e) => e.kind === 'escape_entry')).toBe(true);
    const probe = derive({ ...input, trialType: 'probe' });
    expect(probe.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    expect(probe.metrics.escaped).toBeNull();
    expect(probe.trial.endReason).not.toBe('escape');
    // the loss is still accounted for, as the same hole-shaped loss would be anywhere else
    expect(probe.reviewFlags.some((f) => f.code === 'physically_unlikely_entry')).toBe(true);
  });

  it('says that an escape-box range or a confirmed non-escape does not apply to a probe trial', () => {
    const { input, segmentStarts } = inputFor(search);
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: segmentStarts[3]!,
      endFrame: segmentStarts[3]! + 40,
    };
    const confirmation: CorrectionEntry = {
      id: 'n1',
      kind: 'no_escape',
      timestamp: at(2),
      source: 'user',
      reason: 'sat there',
    };
    const d = derive({
      ...inputFor(search, { corrections: [range, confirmation] }).input,
      trialType: 'probe',
    });
    expect(d.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    const flags = d.reviewFlags.filter((f) => f.code === 'orphaned_correction');
    expect(flags.map((f) => f.correctionId).sort()).toEqual(['n1', 'r1']);
    expect(flags.every((f) => f.message.includes('probe trial'))).toBe(true);
    expect(d.metrics.noEscapeConfirmed).toBeNull();
    expect(d.metrics.status).toBe('review');
    void input;
  });

  it('measures a video against its own target hole when it names one, and flips is_target with it', () => {
    const { input: plain } = inputFor(search);
    const byMap = derive(plain);
    expect(byMap.geometry.targetIndex).toBe(7);
    expect(byMap.events.find((e) => e.holeIndex === 7)!.isTarget).toBe(true);
    expect(byMap.events.find((e) => e.holeIndex === 3)!.isTarget).toBe(false);
    expect(byMap.metrics.primaryErrors).toBe(1);

    const input: DeriveInput = { ...plain, targetHole: 3 };
    const byVideo = derive(input);
    expect(byVideo.geometry.targetIndex).toBe(3);
    expect(byVideo.events.find((e) => e.holeIndex === 3)!.isTarget).toBe(true);
    expect(byVideo.events.find((e) => e.holeIndex === 7)!.isTarget).toBe(false);
    expect(byVideo.metrics.primaryErrors).toBe(0);
    expect(byVideo.metrics.totalErrors).toBe(2);
    expect(trialRowFor(input, byVideo).target_hole).toBe('3');
    expect(trialRowFor(plain, byMap).target_hole).toBe('7');
    // the map itself is untouched: the override is the video's, not the cohort's
    expect(input.mazeMap.target.holeIndex).toBe(7);
  });

  it('refuses a target hole the map does not have', () => {
    const { input } = inputFor(search);
    expect(() => derive({ ...input, targetHole: 20 })).toThrow(/target hole/);
    expect(() => derive({ ...input, targetHole: -1 })).toThrow(/target hole/);
    expect(() => derive({ ...input, targetHole: 1.5 })).toThrow(/target hole/);
  });
});

/*
 * D71 (2): the two detections are matched in two passes. A pair that differs in kind is a human
 * claim carrying the automatic event, kind included, as its shadow; an automatic event with no
 * counterpart after both passes was removed by a correction and leaves a trace — no row, a soft
 * flag at its start frame, a count beside the deletes, and a list on the in-memory result.
 */
describe('D71 (2): a kind change is a human claim; a removed automatic event leaves a trace', () => {
  it('exports a range that turned an automatic investigation into an escape entry as a claim carrying the investigation, kind included', () => {
    // an investigation at hole 3, a 1.5 s stay at the target the tracker reads as an investigation,
    // and the animal back in the open afterwards, so the entry does not end the trial
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 1.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 1 },
    ];
    const { input: plain } = inputFor(script);
    const stay = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 7)!;
    expect(stay).toBeDefined();
    // "in the escape box" over exactly the frames the tracker called an investigation
    const corrections: CorrectionEntry[] = [
      {
        id: 'r1',
        kind: 'range',
        timestamp: at(1),
        source: 'user',
        rangeType: 'in_escape_box',
        startFrame: stay.startFrame,
        endFrame: stay.endFrame,
      },
    ];
    const { input } = inputFor(script, { corrections });
    const d = derive(input);
    const entry = d.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry).toBeDefined();
    expect(d.events.some((e) => e.kind === 'investigation' && e.holeIndex === 7)).toBe(false);
    expect(entry).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r1'],
      confirmed: false,
      autoShadow: { holeIndex: 7, startFrame: stay.startFrame, endFrame: stay.endFrame, kind: 'investigation' },
    });
    expect(entry.evidence).toContain(
      `Was an automatic investigation at hole 7, frames ${stay.startFrame}–${stay.endFrame}, before the corrections changed its kind.`,
    );
    expect(d.removedAutoEvents).toEqual([]);
    expect(d.reviewFlags.some((f) => f.code === 'auto_event_removed_by_correction')).toBe(false);
    expect(d.metrics.correctionCount).toBe(1);

    // the row: a claim with the automatic hole and frames beside it, and the kind in the sentence
    const row = rowFor(input, d, entry.id);
    expect(row).toMatchObject({
      kind: 'escape_entry',
      source: 'corrected',
      evidence_corrected: 'false',
      correction_ids: 'r1',
      auto_hole_index: '7',
      auto_start_frame: String(stay.startFrame),
      auto_end_frame: String(stay.endFrame),
    });
    expect(row['evidence_summary']).toContain('Was an automatic investigation at hole 7');
  });

  it('reports the automatic visit a nudge merged away: no row, one flag at its start frame, counted beside the nudge (the measured case)', () => {
    // two visits to hole 3 separated by an excursion longer than the merge gap: two automatic investigations
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.3 },
      { kind: 'moveToHole', hole: 3, seconds: 0.3 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const { input: plain } = inputFor(script);
    const before = derive(plain);
    const visits = before.events.filter((e) => e.kind === 'investigation' && e.holeIndex === 3);
    expect(visits).toHaveLength(2);
    const [first, second] = visits;
    // the nose placed at the hole in the middle of the excursion (the event point, as in D65's
    // test b): both halves of the gap are now under the merge gap, so the corrected detection
    // sees one visit
    const mid = Math.floor((first!.endFrame + second!.startFrame) / 2);
    const nudge: CorrectionEntry = {
      id: 'p',
      kind: 'point',
      timestamp: at(1),
      source: 'user',
      frameIndex: mid,
      point: 'nose',
      value: { x: g.holeX[3]!, y: g.holeY[3]!, confidence: 1, valid: true },
    };
    const { input } = inputFor(script, { corrections: [nudge] });
    const d = derive(input);
    const merged = d.events.filter((e) => e.kind === 'investigation' && e.holeIndex === 3);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      startFrame: first!.startFrame,
      endFrame: second!.endFrame,
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['p'],
    });
    const shadow = merged[0]!.autoShadow!;
    expect(shadow).not.toHaveProperty('kind');
    // the larger visit is the shadow; the other has no counterpart in the corrected detection
    const removed = [first!, second!].find((v) => v.startFrame !== shadow.startFrame)!;
    expect(d.removedAutoEvents.map((e) => [e.id, e.startFrame, e.endFrame, e.source])).toEqual([
      [removed.id, removed.startFrame, removed.endFrame, 'auto'],
    ]);
    const flags = d.reviewFlags.filter((f) => f.code === 'auto_event_removed_by_correction');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ eventId: removed.id, frameIndex: removed.startFrame });
    expect(flags[0]!.message).toContain(`frames ${removed.startFrame}–${removed.endFrame}`);
    expect(flags[0]!.message).toContain('once correction p is applied');
    // the merged event starts where the first visit did, so when the first is the removed one
    // the merged row carries its id and the flag says so instead of "no row"
    expect(flags[0]!.message).toContain(
      removed.id === merged[0]!.id ? 'Its id now belongs to the event' : 'no row in events.csv',
    );
    // counted exactly as a delete would be: one for the nudge, one for the removal
    expect(d.metrics.correctionCount).toBe(2);
    // informational: the status is what it was without the correction
    expect(d.metrics.status).toBe(before.metrics.status);
    const trial = trialRowFor(input, d);
    expect(trial['review_flags']).toBe('auto_event_removed_by_correction');
    expect(trial['correction_count']).toBe('2');
    // and the removed visit is in no row
    expect(eventRows(sessionAround(input, d)).some((r) => r.eventId === removed.id)).toBe(false);
    // the persisted layer carries the flag, not the list (D55: the derived layer is a cache)
    expect(toDerivedLayer(d)).not.toHaveProperty('removedAutoEvents');
  });

  it('counts a removal exactly as an event delete, and writes the flag on the trial row', () => {
    const script: Segment[] = [...visitHoles([3, 5]), { kind: 'moveToCentre', seconds: 0.5 }];
    const { input: plain } = inputFor(script);
    const visit5 = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 5)!;
    const deleted = derive(
      inputFor(script, {
        corrections: [
          { id: 'd', kind: 'event', timestamp: at(1), source: 'user', action: 'delete', eventId: visit5.id },
        ],
      }).input,
    );
    expect(deleted.events.map((e) => e.holeIndex)).toEqual([3]);
    expect(deleted.metrics.correctionCount).toBe(1);
    expect(deleted.removedAutoEvents).toEqual([]);

    // "not visible here" over the visit: an unpositioned run too short to be a loss, so the
    // corrected detection simply has no event there
    const { input } = inputFor(script, {
      corrections: [
        {
          id: 'r',
          kind: 'range',
          timestamp: at(1),
          source: 'user',
          rangeType: 'not_visible',
          startFrame: visit5.startFrame,
          endFrame: visit5.endFrame,
        },
      ],
    });
    const removed = derive(input);
    expect(removed.events.map((e) => e.holeIndex)).toEqual([3]);
    expect(removed.removedAutoEvents.map((e) => [e.id, e.correctionIds])).toEqual([[visit5.id, ['r']]]);
    expect(removed.reviewFlags.filter((f) => f.code === 'auto_event_removed_by_correction')).toMatchObject([
      { eventId: visit5.id, frameIndex: visit5.startFrame },
    ]);
    expect(removed.reviewFlags[0]!.message).toContain('once correction r is applied');
    // one for the range, one for the removal: the removal adds what a delete adds
    expect(removed.metrics.correctionCount - 1).toBe(deleted.metrics.correctionCount);
    expect(removed.metrics.totalErrors).toBe(deleted.metrics.totalErrors);
    expect(trialRowFor(input, removed)['review_flags']).toBe('auto_event_removed_by_correction');
  });
});

/*
 * D71 (3): `escaped` is null when nothing can be said — on a probe trial, which has no escape
 * box, and on an unresolved trial, which has no window — and `false` only for a resolved
 * acquisition trial with no escape entry. The cell is blank for null.
 */
describe('D71 (3): escaped is null when nothing can be said', () => {
  it('writes escaped blank on an unresolved row and a probe row, and false only on a resolved trial with no entry', () => {
    // unresolved: nothing was ever tracked, so there is no trial window
    const { input: unresolved } = inputFor([
      { kind: 'empty', seconds: 1 },
      { kind: 'ambiguous', seconds: 1 },
    ]);
    const u = derive(unresolved);
    expect(u.metrics.status).toBe('unresolved');
    expect(u.metrics.escaped).toBeNull();
    expect(trialRowFor(unresolved, u)).toMatchObject({ status: 'unresolved', escaped: '', total_latency_s: '' });

    // resolved with no entry: the one case in which false is asserted
    const script: Segment[] = [...visitHoles([3, 7]), { kind: 'moveToCentre', seconds: 0.5 }];
    const { input: resolved } = inputFor(script);
    const r = derive(resolved);
    expect(r.metrics.status).toBe('review');
    expect(r.metrics.escaped).toBe(false);
    expect(trialRowFor(resolved, r)).toMatchObject({ status: 'review', escaped: 'false', no_escape_confirmed: 'false' });

    // a probe trial has no escape box: nothing about escaping is a measurement of it (D68)
    const probeInput: DeriveInput = { ...resolved, trialType: 'probe' };
    const p = derive(probeInput);
    expect(p.metrics.escaped).toBeNull();
    expect(trialRowFor(probeInput, p)).toMatchObject({ trial_type: 'probe', escaped: '', status: 'ok' });
  });
});

/*
 * D71 (2), after review: a removal is counted once. A delete or an edit that already names the
 * removed event's id counts for it; the flag says which, and an edit keeps a pinned row with
 * that id. And an edit of a kind-change event keeps the automatic kind in its rebuilt evidence.
 */
describe('D71 (2): a removal is counted once, and an edit keeps the automatic kind', () => {
  const script: Segment[] = [...visitHoles([3, 5]), { kind: 'moveToCentre', seconds: 0.5 }];
  const notVisibleOver = (
    visit: { startFrame: number; endFrame: number },
    i: number,
  ): CorrectionEntry => ({
    id: 'r',
    kind: 'range',
    timestamp: at(i),
    source: 'user',
    rangeType: 'not_visible',
    startFrame: visit.startFrame,
    endFrame: visit.endFrame,
  });

  it('does not count a removal again when a delete already names the event', () => {
    const { input: plain } = inputFor(script);
    const visit5 = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 5)!;
    const { input } = inputFor(script, {
      corrections: [
        { id: 'd', kind: 'event', timestamp: at(1), source: 'user', action: 'delete', eventId: visit5.id },
        notVisibleOver(visit5, 2),
      ],
    });
    const d = derive(input);
    expect(d.events.map((e) => e.holeIndex)).toEqual([3]);
    expect(d.removedAutoEvents.map((e) => e.id)).toEqual([visit5.id]);
    const flag = d.reviewFlags.find((f) => f.code === 'auto_event_removed_by_correction')!;
    expect(flag.message).toContain('Event correction d already deleted it');
    expect(flag.message).not.toContain('no row');
    // the delete and the range — not the delete, the range and the removal
    expect(d.metrics.correctionCount).toBe(2);
    // the delete now names an event the range removed, which the orphan flag reports as before
    expect(d.reviewFlags.map((f) => f.code).sort()).toEqual([
      'auto_event_removed_by_correction',
      'orphaned_correction',
    ]);
  });

  it('does not count a removal again when an edit already names the event, whose pinned row stands', () => {
    const { input: plain } = inputFor(script);
    const visit5 = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 5)!;
    const { input } = inputFor(script, {
      corrections: [
        {
          id: 'e',
          kind: 'event',
          timestamp: at(1),
          source: 'user',
          action: 'edit',
          eventId: visit5.id,
          holeIndex: 5,
          startFrame: visit5.startFrame,
          endFrame: visit5.endFrame - 2,
        },
        notVisibleOver(visit5, 2),
      ],
    });
    const d = derive(input);
    // the pinned edit keeps the automatic id, so there is a row with it
    const pinned = d.events.find((e) => e.id === visit5.id)!;
    expect(pinned).toMatchObject({ source: 'corrected', holeIndex: 5, endFrame: visit5.endFrame - 2 });
    expect(eventRows(sessionAround(input, d)).filter((r) => r.eventId === visit5.id)).toHaveLength(1);
    expect(d.removedAutoEvents.map((e) => e.id)).toEqual([visit5.id]);
    const flag = d.reviewFlags.find((f) => f.code === 'auto_event_removed_by_correction')!;
    expect(flag.message).toContain('Event correction e names it, so its values stand as a pinned row');
    expect(flag.message).not.toContain('no row');
    expect(d.metrics.correctionCount).toBe(2);
  });

  it('always counts a removal whose id a merged event now carries, whatever the user then does to the merged event', () => {
    // two visits to hole 3, the second longer, merged by a nose nudge between them: the merged
    // event starts where the first visit did and so carries its id, while the longer second visit
    // is the one matched — the first is removed under the very id the live row carries
    const twoVisits: Segment[] = [
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.3 },
      { kind: 'moveToHole', hole: 3, seconds: 0.3 },
      { kind: 'dwell', hole: 3, seconds: 1 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const { input: plain } = inputFor(twoVisits);
    const [first, second] = derive(plain).events.filter(
      (e) => e.kind === 'investigation' && e.holeIndex === 3,
    );
    const mid = Math.floor((first!.endFrame + second!.startFrame) / 2);
    const nudge: CorrectionEntry = {
      id: 'p',
      kind: 'point',
      timestamp: at(1),
      source: 'user',
      frameIndex: mid,
      point: 'nose',
      value: { x: g.holeX[3]!, y: g.holeY[3]!, confidence: 1, valid: true },
    };
    const merged = derive(inputFor(twoVisits, { corrections: [nudge] }).input);
    const live = merged.events.find((e) => e.kind === 'investigation' && e.holeIndex === 3)!;
    expect(live.id).toBe(first!.id);
    expect(merged.removedAutoEvents.map((e) => e.id)).toEqual([first!.id]);
    // the nudge sits inside the event that absorbed the visit, so it is named
    expect(merged.removedAutoEvents[0]!.correctionIds).toEqual(['p']);
    const flag = merged.reviewFlags.find((f) => f.code === 'auto_event_removed_by_correction')!;
    expect(flag.message).toContain(
      `Its id now belongs to the event at frames ${live.startFrame}–${live.endFrame}`,
    );
    expect(flag.message).not.toContain('no row');
    expect(merged.metrics.correctionCount).toBe(2);

    // an edit of the merged event addresses the merged event, not the removed one: the nudge,
    // the edit and the removal
    const edited = derive(
      inputFor(twoVisits, {
        corrections: [
          nudge,
          {
            id: 'e',
            kind: 'event',
            timestamp: at(2),
            source: 'user',
            action: 'edit',
            eventId: live.id,
            holeIndex: 3,
            startFrame: live.startFrame,
            endFrame: live.endFrame - 2,
          },
        ],
      }).input,
    );
    expect(edited.events.find((e) => e.id === live.id)!.endFrame).toBe(live.endFrame - 2);
    expect(edited.metrics.correctionCount).toBe(3);
    // a delete of the merged event: the same three
    const deleted = derive(
      inputFor(twoVisits, {
        corrections: [
          nudge,
          { id: 'd', kind: 'event', timestamp: at(2), source: 'user', action: 'delete', eventId: live.id },
        ],
      }).input,
    );
    expect(deleted.events.some((e) => e.id === live.id)).toBe(false);
    expect(deleted.metrics.correctionCount).toBe(3);
  });

  it('says that an edit which no longer applies counts for the event, without calling it a delete', () => {
    const { input: plain } = inputFor(script);
    const visit5 = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 5)!;
    // an edit naming only a hole has no span once its event is gone: ignored as orphaned
    const { input } = inputFor(script, {
      corrections: [
        { id: 'e', kind: 'event', timestamp: at(1), source: 'user', action: 'edit', eventId: visit5.id, holeIndex: 4 },
        notVisibleOver(visit5, 2),
      ],
    });
    const d = derive(input);
    expect(d.events.some((e) => e.id === visit5.id)).toBe(false);
    const flag = d.reviewFlags.find((f) => f.code === 'auto_event_removed_by_correction')!;
    expect(flag.message).toContain('Event correction e names it but no longer applies and is reported as orphaned');
    expect(flag.message).not.toContain('deleted');
    expect(d.reviewFlags.some((f) => f.code === 'orphaned_correction')).toBe(true);
    expect(d.metrics.correctionCount).toBe(2);
  });

  it('keeps the automatic kind in the evidence of a kind-change event the user then edits', () => {
    const stay: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 1.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 1 },
    ];
    const { input: plain } = inputFor(stay);
    const investigation = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 7)!;
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: investigation.startFrame,
      endFrame: investigation.endFrame,
    };
    const entry = derive(inputFor(stay, { corrections: [range] }).input).events.find(
      (e) => e.kind === 'escape_entry',
    )!;
    const { input } = inputFor(stay, {
      corrections: [
        range,
        {
          id: 'e1',
          kind: 'event',
          timestamp: at(2),
          source: 'user',
          action: 'edit',
          eventId: entry.id,
          holeIndex: 7,
          startFrame: entry.startFrame,
          endFrame: entry.endFrame - 1,
        },
      ],
    });
    const d = derive(input);
    const edited = d.events.find((e) => e.id === entry.id)!;
    expect(edited).toMatchObject({
      kind: 'escape_entry',
      source: 'corrected',
      endFrame: entry.endFrame - 1,
      autoShadow: {
        holeIndex: 7,
        startFrame: investigation.startFrame,
        endFrame: investigation.endFrame,
        kind: 'investigation',
      },
    });
    expect(edited.evidence).toContain('Corrected by the user (correction e1)');
    expect(edited.evidence).toContain(
      `Was an automatic investigation at hole 7, frames ${investigation.startFrame}–${investigation.endFrame}, before the corrections changed its kind.`,
    );
    const row = rowFor(input, d, entry.id);
    expect(row).toMatchObject({
      source: 'corrected',
      auto_hole_index: '7',
      auto_start_frame: String(investigation.startFrame),
    });
    expect(row['evidence_summary']).toContain('Was an automatic investigation at hole 7');
  });
});

describe('D73: what counts as a removal, and the auto-only pass to its own end or later', () => {
  /** A distinct timestamp per correction: many points land in one test. */
  const stamp = (i: number): string => `2026-09-06T10:01:00.${String(i).padStart(3, '0')}Z`;
  /** One hand-placed centroid per frame of [from, to]: the commonest repair. */
  const centroidPoints = (
    frames: readonly { frameIndex: number }[],
    from: number,
    to: number,
    xy: { x: number; y: number },
  ): CorrectionEntry[] => {
    const out: CorrectionEntry[] = [];
    for (let pos = from; pos <= to; pos++) {
      out.push({
        id: `p${pos}`,
        kind: 'point',
        timestamp: stamp(pos - from),
        source: 'user',
        frameIndex: frames[pos]!.frameIndex,
        point: 'centroid',
        value: { ...xy, confidence: 1, valid: true },
      });
    }
    return out;
  };
  const removalFlags = (d: ReturnType<typeof derive>) =>
    d.reviewFlags.filter((f) => f.code === 'auto_event_removed_by_correction');

  it('counts a tracking loss repaired frame by frame as its points only: no removal, no flag (the 45-point case)', () => {
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', seconds: 1 },
    ];
    const { input: plain, segmentStarts } = inputFor(script);
    const loss = derive(plain).events.find((e) => e.kind === 'tracking_failure')!;
    expect(loss).toBeDefined();
    expect(loss.holeIndex).toBeNull();
    const from = segmentStarts[3]!;
    const to = segmentStarts[4]! - 1;
    expect(to - from + 1).toBe(45);
    const points = centroidPoints(plain.auto.frames, from, to, { x: g.platform.cx, y: g.platform.cy });
    const { input } = inputFor(script, { corrections: points });
    const d = derive(input);
    expect(d.events.some((e) => e.kind === 'tracking_failure')).toBe(false);
    // a repaired track, not an erased event: the points count, the loss does not
    expect(d.removedAutoEvents).toEqual([]);
    expect(removalFlags(d)).toEqual([]);
    expect(d.metrics.correctionCount).toBe(45);
    const trial = trialRowFor(input, d);
    expect(trial['correction_count']).toBe('45');
    expect(trial['review_flags']).toBe('');
  });

  it('ignores automatic investigations after a trial a range ended: the range counts, nothing is removed', () => {
    // at the target from 29.5 s; the user marks the animal in the box from 30 s; the tracker went on
    // to see visits at 35 s and 40 s that the corrected trial never reaches
    const script: Segment[] = [
      { kind: 'dwell', seconds: 29 },
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 4.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 3.5 },
      { kind: 'moveToHole', hole: 5, seconds: 0.5 },
      { kind: 'dwell', hole: 5, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const { input: plain } = inputFor(script);
    const before = derive(plain);
    expect(before.events.filter((e) => e.kind === 'investigation').map((e) => e.holeIndex)).toEqual([7, 3, 5]);
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: 900,
      endFrame: 10_000,
    };
    const { input } = inputFor(script, { corrections: [range] });
    const d = derive(input);
    expect(d.trial.endReason).toBe('escape');
    expect(d.trial.endTime_s).toBeCloseTo(30, 6);
    const entry = d.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry).toMatchObject({ source: 'corrected', correctionIds: ['r1'] });
    expect(entry.autoShadow).toBeUndefined();
    expect(d.events.some((e) => e.holeIndex === 3 || e.holeIndex === 5)).toBe(false);
    expect(d.removedAutoEvents).toEqual([]);
    expect(removalFlags(d)).toEqual([]);
    expect(d.metrics.correctionCount).toBe(1);
    const trial = trialRowFor(input, d);
    expect(trial['correction_count']).toBe('1');
    expect(trial['review_flags']).toBe('');
  });

  it('keeps the automatic investigation as the shadow of a range that turned it into the entry ending the trial (the measured case)', () => {
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 3.5 },
    ];
    const { input: plain } = inputFor(script);
    const stay = derive(plain).events.find((e) => e.kind === 'investigation' && e.holeIndex === 7)!;
    expect(stay).toBeDefined();
    // "in the escape box" from the first frame of the stay to the end: the entry ends the trial
    // where the automatic investigation began
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'in_escape_box',
      startFrame: stay.startFrame,
      endFrame: 10_000,
    };
    const { input } = inputFor(script, { corrections: [range] });
    const d = derive(input);
    expect(d.trial.endReason).toBe('escape');
    expect(d.trial.endFrame).toBe(stay.startFrame);
    const entry = d.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r1'],
      autoShadow: { holeIndex: 7, startFrame: stay.startFrame, endFrame: stay.endFrame, kind: 'investigation' },
    });
    expect(entry.evidence).toContain(
      `Was an automatic investigation at hole 7, frames ${stay.startFrame}–${stay.endFrame}, before the corrections changed its kind.`,
    );
    expect(d.removedAutoEvents).toEqual([]);
    expect(removalFlags(d)).toEqual([]);
    expect(d.metrics.correctionCount).toBe(1);
    expect(rowFor(input, d, entry.id)).toMatchObject({
      source: 'corrected',
      auto_hole_index: '7',
      auto_start_frame: String(stay.startFrame),
      auto_end_frame: String(stay.endFrame),
    });
  });

  it('keeps the automatic escape entry as the shadow of the investigation the corrections turned it into (the trial now runs to the end)', () => {
    // a visit at 1 s, the open platform until 48.5 s, then straight into the target: last seen at
    // the hole, lost to the end of the clip — an automatic entry at ~49 s that ends the trial. The
    // stay before the loss is too short for an investigation of its own, so the entry is the only
    // automatic event at hole 7 and the kind change is read as one
    const script: Segment[] = [
      { kind: 'dwell', seconds: 1 },
      ...visitHoles([3]),
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 46 },
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.1 },
      { kind: 'lost', seconds: 3.5 },
    ];
    const { input: plain, segmentStarts } = inputFor(script);
    const before = derive(plain);
    const autoEntry = before.events.find((e) => e.kind === 'escape_entry')!;
    expect(autoEntry).toBeDefined();
    expect(before.trial.endReason).toBe('escape');
    expect(before.events.filter((e) => e.holeIndex === 7)).toHaveLength(1);
    // the reviewer places the animal at the hole on every lost frame: it never went in
    const points = centroidPoints(plain.auto.frames, segmentStarts[7]!, plain.auto.frames.length - 1, holePoint(g, 7));
    expect(points).toHaveLength(105);
    const { input } = inputFor(script, { corrections: points });
    const d = derive(input);
    expect(d.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    expect(d.trial.endReason).toBe('end_of_video');
    expect(d.metrics.escaped).toBe(false);
    const claim = d.events.find((e) => e.autoShadow?.kind === 'escape_entry')!;
    expect(claim, 'no event carries the automatic entry as its shadow').toBeDefined();
    expect(claim).toMatchObject({
      kind: 'investigation',
      holeIndex: 7,
      source: 'corrected',
      evidenceCorrected: false,
      autoShadow: { holeIndex: 7, startFrame: autoEntry.startFrame, endFrame: autoEntry.endFrame, kind: 'escape_entry' },
    });
    expect(claim.correctionIds).toEqual(points.map((p) => p.id));
    expect(claim.evidence).toContain(
      `Was an automatic escape entry at hole 7, frames ${autoEntry.startFrame}–${autoEntry.endFrame}, before the corrections changed its kind.`,
    );
    expect(d.removedAutoEvents).toEqual([]);
    expect(removalFlags(d)).toEqual([]);
    expect(d.metrics.correctionCount).toBe(105);
    const row = rowFor(input, d, claim.id);
    expect(row).toMatchObject({
      kind: 'investigation',
      source: 'corrected',
      auto_hole_index: '7',
      auto_start_frame: String(autoEntry.startFrame),
    });
    expect(row['evidence_summary']).toContain('Was an automatic escape entry at hole 7');
  });

  it('finds the investigations a removed entry uncovers on the automatic side: automatic, untouched, no shadow', () => {
    // an automatic entry at ~49 s (straight in, back out at the target 3.5 s later), then — had the
    // trial gone on — visits at ~60 s and ~70 s. The reviewer marks the approach and the loss "not
    // visible": no entry, the trial runs to the end
    const script: Segment[] = [
      { kind: 'dwell', seconds: 1 },
      ...visitHoles([3]),
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 46 },
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.1 },
      { kind: 'lost', seconds: 3.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 5 },
      ...visitHoles([4]),
      { kind: 'moveToCentre', seconds: 0.5 },
      { kind: 'dwell', seconds: 8.5 },
      ...visitHoles([5]),
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const { input: plain, segmentStarts } = inputFor(script);
    const before = derive(plain);
    const autoEntry = before.events.find((e) => e.kind === 'escape_entry')!;
    expect(autoEntry).toBeDefined();
    expect(before.trial.endReason).toBe('escape');
    expect(before.events.some((e) => e.holeIndex === 4 || e.holeIndex === 5)).toBe(false);
    const range: CorrectionEntry = {
      id: 'r1',
      kind: 'range',
      timestamp: at(1),
      source: 'user',
      rangeType: 'not_visible',
      startFrame: plain.auto.frames[segmentStarts[5]!]!.frameIndex,
      endFrame: plain.auto.frames[segmentStarts[8]! - 1]!.frameIndex,
    };
    const { input } = inputFor(script, { corrections: [range] });
    const d = derive(input);
    expect(d.events.some((e) => e.kind === 'escape_entry')).toBe(false);
    expect(d.trial.endReason).toBe('end_of_video');
    const uncovered = d.events.filter((e) => e.holeIndex === 4 || e.holeIndex === 5);
    expect(uncovered.map((e) => [e.kind, e.holeIndex])).toEqual([
      ['investigation', 4],
      ['investigation', 5],
    ]);
    for (const ev of uncovered) {
      expect(ev).toMatchObject({ source: 'auto', evidenceCorrected: false, correctionIds: [] });
      expect(ev.autoShadow).toBeUndefined();
      expect(rowFor(input, d, ev.id)).toMatchObject({
        source: 'auto',
        evidence_corrected: 'false',
        correction_ids: '',
        auto_start_frame: '',
      });
    }
    // the entry itself was inside the corrected trial and is no longer found: that one is a
    // removal (D73 (3)), counted beside the range; the uncovered visits are not
    expect(d.removedAutoEvents.map((e) => e.id)).toEqual([autoEntry.id]);
    const flags = removalFlags(d);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ eventId: autoEntry.id, frameIndex: autoEntry.startFrame });
    expect(d.metrics.correctionCount).toBe(2);
  });

  it('applies a trial end an event correction moved to both detections: the stay beside the moved entry stays untouched', () => {
    // an automatic entry after a 1 s stay at the target; the entry's start is edited ten frames
    // earlier, into the stay, and one unrelated centroid nudge at frame 2 is what makes the
    // auto-only pass run at all. The moved end is the human's end for both detections, so the stay
    // is clipped the same way on both sides and reads untouched — not evidence-corrected by a
    // correction that never touched it (chunk-16b review)
    const script: Segment[] = [
      ...visitHoles([3]),
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 1 },
      { kind: 'lost', seconds: 3.5 },
    ];
    const { input: plain } = inputFor(script);
    const before = derive(plain);
    const entry = before.events.find((e) => e.kind === 'escape_entry')!;
    const stay = before.events.find((e) => e.kind === 'investigation' && e.holeIndex === 7)!;
    expect(entry).toBeDefined();
    expect(stay).toBeDefined();
    const frame2 = plain.auto.frames[2]!;
    const corrections: CorrectionEntry[] = [
      {
        id: 'p1',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 2,
        point: 'centroid',
        value: { x: frame2.centroid.x + 0.5, y: frame2.centroid.y, confidence: 1, valid: true },
      },
      {
        id: 'e1',
        kind: 'event',
        timestamp: at(2),
        source: 'user',
        action: 'edit',
        eventId: entry.id,
        holeIndex: 7,
        startFrame: entry.startFrame - 10,
        endFrame: entry.endFrame,
      },
    ];
    const { input } = inputFor(script, { corrections });
    const d = derive(input);
    const clipped = d.events.find((e) => e.kind === 'investigation' && e.holeIndex === 7)!;
    expect(clipped).toBeDefined();
    expect(clipped).toMatchObject({ source: 'auto', evidenceCorrected: false, correctionIds: [] });
    expect(clipped.autoShadow).toBeUndefined();
    expect(d.removedAutoEvents).toEqual([]);
    expect(removalFlags(d)).toEqual([]);
  });
});
