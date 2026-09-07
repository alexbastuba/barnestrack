import { describe, expect, it } from 'vitest';
import { applyTrackCorrections } from '../../src/analysis/corrections.js';
import {
  applyEventCorrections,
  autoEventId,
  detectAutoEvents,
  eventPoints,
  type EventContext,
} from '../../src/analysis/events.js';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import { proposeTrialStart } from '../../src/analysis/trial.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionEntry, CorrectionsLayer } from '../../src/contracts/session.js';
import { testGeometry } from './maze-fixture.js';
import { holePoint, scriptTrack, visitHoles, type Segment } from './synthetic-track.js';
import { deepFreeze } from './track-builder.js';

const g = testGeometry(); // target hole 7
const none: CorrectionsLayer = { entries: [] };
const at = (i: number): string => `2026-09-06T10:00:${String(i).padStart(2, '0')}.000Z`;

const EVENT_KEYS = [
  'id',
  'kind',
  'holeIndex',
  'isTarget',
  'startFrame',
  'endFrame',
  'startTime_s',
  'endTime_s',
  'durationSeconds',
  'pointUsed',
  'minNoseDistance_cm',
  'minCentroidDistance_cm',
  'evidence',
  'source',
].sort();

function run(
  segments: Segment[],
  options: { p?: Parameters; corrections?: CorrectionsLayer; fps?: number } = {},
) {
  const p = options.p ?? DEFAULT_PARAMETERS;
  const corrections = options.corrections ?? none;
  const scripted = scriptTrack(segments, { g, fps: options.fps });
  const frames = applyTrackCorrections(deepFreeze(scripted.frames), corrections).frames;
  const a = buildTrackArrays(frames, g);
  const pts = eventPoints(a, g, p);
  const ctx: EventContext = { frames, a, g, p, pts };
  const startFrame = proposeTrialStart(frames, a, corrections).startFrame;
  const auto = detectAutoEvents(ctx, startFrame);
  return { ctx, auto, frames, segmentStarts: scripted.segmentStarts, startFrame };
}

const kinds = (events: readonly EventRecord[]): string[] =>
  events.map((e) => `${e.kind}@${e.holeIndex}`);
const investigations = (events: readonly EventRecord[]): EventRecord[] =>
  events.filter((e) => e.kind === 'investigation');

describe('investigations (O1)', () => {
  it('detects dwell at a hole with the nose as the event point and both distances', () => {
    const { auto, segmentStarts } = run([
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ]);
    expect(auto.events).toHaveLength(1);
    const ev = auto.events[0]!;
    expect(ev.kind).toBe('investigation');
    expect(ev.holeIndex).toBe(3);
    expect(ev.isTarget).toBe(false);
    expect(ev.source).toBe('auto');
    expect(ev.pointUsed).toBe('nose');
    expect(ev.startFrame).toBeLessThanOrEqual(segmentStarts[1]!);
    expect(ev.endFrame).toBeGreaterThanOrEqual(segmentStarts[2]! - 1);
    expect(ev.durationSeconds).toBeCloseTo(ev.endTime_s - ev.startTime_s, 12);
    expect(ev.durationSeconds).toBeGreaterThanOrEqual(14 / 30);
    expect(ev.minNoseDistance_cm).toBeCloseTo(Math.abs(1 - 8 / g.pxPerCm), 6); // nose 8 px past the centroid, 1 cm inward of the hole
    expect(ev.minCentroidDistance_cm).toBeCloseTo(1, 6);
    expect(ev.id).toBe(autoEventId('investigation', 3, ev.startFrame));
    expect(Object.keys(ev).sort()).toEqual(EVENT_KEYS);
    expect(ev.evidence).toContain('hole 3 (non-target)');
    expect(ev.evidence).toContain('1.5 × hole radius');
    expect(ev.evidence).toMatch(/Nose used on \d+ of \d+ positioned frames/);
    expect(auto.flags).toEqual([]);
    expect(auto.endReason).toBe('end_of_video');
  });

  it('needs the minimum duration', () => {
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const strict: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 1.0 },
    };
    expect(run(script, { p: strict }).auto.events).toHaveLength(0);
    const longer: Segment[] = [script[0]!, { kind: 'dwell', hole: 3, seconds: 1.2 }, script[2]!];
    expect(run(longer, { p: strict }).auto.events).toHaveLength(1);
  });

  it('merges bouts at the same hole closer than the merge gap, and keeps returns apart otherwise', () => {
    const away = holePoint(g, 3, 6); // 6 cm inward of hole 3: outside the 3.75 cm investigation radius
    const bouts = (awaySeconds: number): Segment[] => [
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.1 },
      { kind: 'dwell', seconds: awaySeconds },
      { kind: 'moveToHole', hole: 3, seconds: 0.1 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const merged = run(bouts(0.1)).auto.events;
    expect(kinds(merged)).toEqual(['investigation@3']);
    expect(merged[0]!.evidence).toContain('Merged from 2 bouts');
    const separate = run(bouts(1.0)).auto.events;
    expect(kinds(separate)).toEqual(['investigation@3', 'investigation@3']);
    expect(separate[0]!.id).not.toBe(separate[1]!.id);
  });

  it('keeps repeat visits to a hole as separate events, in time order', () => {
    const { auto } = run(visitHoles([3, 5, 3]));
    expect(kinds(auto.events)).toEqual(['investigation@3', 'investigation@5', 'investigation@3']);
    for (const ev of auto.events) expect(Object.keys(ev).sort()).toEqual(EVENT_KEYS);
    const again = run(visitHoles([3, 5, 3]));
    expect(again.auto.events).toEqual(auto.events); // deterministic, content-derived ids
  });

  it('uses the nose only when its heading confidence clears the cutoff — or it was placed by hand', () => {
    // centroid 4.5 cm from the hole (outside the radius); the nose, 8 px ≈ 1.8 cm nearer, is inside it
    const usable: Segment[] = [
      { kind: 'moveToHole', hole: 3, seconds: 0.5, offset_cm: 4.5 },
      { kind: 'dwell', hole: 3, offset_cm: 4.5, seconds: 0.5, noseConf: 0.5 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ];
    const withNose = run(usable).auto.events;
    expect(kinds(withNose)).toEqual(['investigation@3']);
    expect(withNose[0]!.pointUsed).toBe('nose');
    const lowConf: Segment[] = [
      usable[0]!,
      { ...(usable[1] as Extract<Segment, { kind: 'dwell' }>), noseConf: 0 },
      usable[2]!,
    ];
    expect(run(lowConf).auto.events).toHaveLength(0);
    const stricter: Parameters = { ...DEFAULT_PARAMETERS, noseConfidenceCutoff: 0.9 };
    expect(run(usable, { p: stricter }).auto.events).toHaveLength(0);
    // a hand-placed nose is used whatever its confidence
    const scripted = scriptTrack(lowConf, { g });
    const dwellStart = scripted.segmentStarts[1]!;
    const entries: CorrectionEntry[] = [];
    for (let i = dwellStart; i < dwellStart + 15; i++) {
      const nose = scripted.frames[i]!.nose;
      entries.push({
        id: `n${i}`,
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: i,
        point: 'nose',
        value: { x: nose.x, y: nose.y, confidence: 1, valid: true },
      });
    }
    const corrected = run(lowConf, { corrections: { entries } }).auto.events;
    expect(kinds(corrected)).toEqual(['investigation@3']);
    expect(corrected[0]!.pointUsed).toBe('nose');
  });

  it('falls back to the centroid and leaves the nose distance unrecorded when the nose is never valid', () => {
    const { auto } = run([
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5, nose: null },
      { kind: 'moveToCentre', seconds: 0.5 },
    ]);
    const ev = investigations(auto.events)[0]!;
    expect(ev.pointUsed).toBe('centroid');
    // the approach frames carry a nose, so a nose distance exists; strip them by dwelling only
    const only = run([{ kind: 'dwell', hole: 3, seconds: 0.5, nose: null }]).auto.events[0]!;
    expect(Number.isNaN(only.minNoseDistance_cm)).toBe(true);
    expect(only.minCentroidDistance_cm).toBeCloseTo(1, 6);
    expect(only.evidence).toContain('nose distance is not recorded');
  });
});

describe('losses of detection (O4, D19)', () => {
  const approachTarget: Segment[] = [
    { kind: 'moveToHole', hole: 7, seconds: 0.5 },
    { kind: 'dwell', hole: 7, seconds: 0.5, area: [500, 200] },
  ];

  it('reads a loss at the target that lasts to the end of the video as a persistent escape entry', () => {
    const { auto, segmentStarts, frames } = run([...approachTarget, { kind: 'lost', seconds: 5 }]);
    expect(kinds(auto.events)).toEqual(['investigation@7', 'escape_entry@7']);
    const entry = auto.events[1]!;
    expect(entry.isTarget).toBe(true);
    expect(entry.startFrame).toBe(segmentStarts[2]);
    expect(entry.endFrame).toBe(frames.length - 1);
    expect(entry.pointUsed).toBe('nose');
    expect(entry.minCentroidDistance_cm).toBeCloseTo(1, 6);
    expect(entry.evidence).toContain('to the end of the video');
    expect(entry.evidence).toMatch(
      /blob area fell from \d+ to 200 px² over the 10 positioned frames/,
    );
    expect(entry.evidence).toContain('Persistent');
    expect(entry.evidence).toContain('the trial ends at the first lost frame');
    expect(auto.persistentEscapeStartFrame).toBe(segmentStarts[2]);
    expect(auto.endFrame).toBe(segmentStarts[2]);
    expect(auto.endReason).toBe('escape');
    expect(auto.flags).toEqual([]);
    expect(Object.keys(entry).sort()).toEqual(EVENT_KEYS);
  });

  it('reads a loss at the target of at least three seconds as persistent even when the animal reappears later', () => {
    const { auto, segmentStarts } = run([
      ...approachTarget,
      { kind: 'lost', seconds: 3.5 },
      { kind: 'dwell', hole: 7, seconds: 1 },
      { kind: 'moveToCentre', seconds: 1 },
    ]);
    expect(auto.persistentEscapeStartFrame).toBe(segmentStarts[2]);
    expect(auto.endReason).toBe('escape');
    // nothing after the trial end is emitted
    expect(kinds(auto.events)).toEqual(['investigation@7', 'escape_entry@7']);
  });

  it('records a short entry that reappears at the target as an entry that does not end the trial', () => {
    const { auto } = run([
      ...approachTarget,
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'moveToCentre', seconds: 1 },
    ]);
    expect(kinds(auto.events)).toEqual(['investigation@7', 'escape_entry@7', 'investigation@7']);
    expect(auto.events[1]!.evidence).toContain('Not persistent');
    expect(auto.events[1]!.evidence).toContain('the same hole');
    expect(auto.persistentEscapeStartFrame).toBeNull();
    expect(auto.endReason).toBe('end_of_video');
    expect(auto.flags).toEqual([]);
  });

  it('flags an entry-shaped loss at a non-target hole as a physically unlikely investigation', () => {
    const { auto, segmentStarts } = run([
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'lost', seconds: 2 },
      { kind: 'dwell', hole: 3, seconds: 0.3 },
      { kind: 'moveToCentre', seconds: 0.5 },
    ]);
    expect(kinds(auto.events)).toEqual(['investigation@3']);
    const ev = auto.events[0]!;
    expect(ev.evidence).toMatch(/^Physically unlikely — review/);
    expect(ev.startFrame).toBeLessThanOrEqual(segmentStarts[1]!);
    expect(ev.endFrame).toBeGreaterThanOrEqual(segmentStarts[4]! - 1);
    expect(auto.flags.map((f) => f.code)).toEqual(['physically_unlikely_entry']);
    expect(auto.flags[0]!.eventId).toBe(ev.id);
    const toEnd = run([
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'lost', seconds: 2 },
    ]);
    expect(kinds(toEnd.auto.events)).toEqual(['investigation@3']);
    expect(toEnd.auto.persistentEscapeStartFrame).toBeNull();
  });

  it('reads the same loss 6 cm from any hole as a tracking failure that is never an entry', () => {
    const away = holePoint(g, 3, 6);
    const { auto, segmentStarts, frames } = run([
      { kind: 'moveTo', x: away.x, y: away.y, seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 5 },
    ]);
    expect(kinds(auto.events)).toEqual(['tracking_failure@null']);
    const tf = auto.events[0]!;
    expect(tf.isTarget).toBe(false);
    expect(tf.startFrame).toBe(segmentStarts[2]);
    expect(tf.endFrame).toBe(frames.length - 1);
    expect(tf.evidence).toContain('Tracking failure away from every hole');
    expect(tf.evidence).toContain('to the end of the video');
    expect(Number.isNaN(tf.minCentroidDistance_cm)).toBe(true);
    expect(auto.persistentEscapeStartFrame).toBeNull();
    expect(auto.endReason).toBe('end_of_video');
    expect(auto.flags).toEqual([]);
  });

  it('flags a tracking failure at a hole: outside the entry radius, or reappearing elsewhere', () => {
    const outsideEntryRadius = run([
      { kind: 'moveToHole', hole: 3, seconds: 0.5, offset_cm: 3 },
      { kind: 'dwell', hole: 3, offset_cm: 3, seconds: 0.5, nose: null },
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', hole: 3, offset_cm: 3, seconds: 0.5, nose: null },
    ]);
    expect(kinds(outsideEntryRadius.auto.events)).toEqual([
      'investigation@3',
      'tracking_failure@3',
      'investigation@3',
    ]);
    expect(outsideEntryRadius.auto.flags.map((f) => f.code)).toEqual(['tracking_failure_at_hole']);
    expect(outsideEntryRadius.auto.events[1]!.evidence).toContain('Lost at a hole');

    const elsewhere = run([
      ...approachTarget,
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', hole: 12, seconds: 0.5 },
    ]);
    expect(kinds(elsewhere.auto.events)).toEqual([
      'investigation@7',
      'tracking_failure@7',
      'investigation@12',
    ]);
    expect(elsewhere.auto.events[1]!.evidence).toContain('elsewhere');
    expect(elsewhere.auto.flags.map((f) => f.code)).toEqual(['tracking_failure_at_hole']);
    expect(elsewhere.auto.persistentEscapeStartFrame).toBeNull();
  });

  it('ignores losses shorter than the entry minimum (they belong to the quality report)', () => {
    const { auto } = run([
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
    ]);
    expect(auto.events).toEqual([]);
  });

  it('takes a user-marked in-escape-box range as an entry from its first frame, persistent by the same rule as any entry', () => {
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'dwell', seconds: 3 },
    ];
    const from = scriptTrack(script, { g }).segmentStarts[2]! + 15;
    const range = (endFrame: number): CorrectionsLayer => ({
      entries: [
        {
          id: 'r1',
          kind: 'range',
          timestamp: at(1),
          source: 'user',
          rangeType: 'in_escape_box',
          startFrame: from,
          endFrame,
        },
      ],
    });
    const short = run(script, { corrections: range(from + 20) });
    const shortEntry = short.auto.events.find((e) => e.kind === 'escape_entry')!;
    expect(shortEntry.startFrame).toBe(from);
    expect(shortEntry.evidence).toContain('the trial continues');
    expect(short.auto.persistentEscapeStartFrame).toBeNull();
    expect(short.auto.endReason).toBe('end_of_video');
    const long = run(script, { corrections: range(from + 100) }); // 100 frames ≥ 3 s at 30 fps
    expect(long.auto.events.find((e) => e.kind === 'escape_entry')!.evidence).toContain(
      'the trial ends here',
    );
    expect(long.auto.persistentEscapeStartFrame).toBe(from);
    expect(long.auto.endReason).toBe('escape');
  });

  it('takes a user-marked in-escape-box range to the end of the video as a persistent entry from its first frame', () => {
    const scripted = scriptTrack(
      [
        { kind: 'moveToHole', hole: 7, seconds: 0.5 },
        { kind: 'dwell', hole: 7, seconds: 0.5 },
        { kind: 'dwell', seconds: 2 },
      ],
      { g },
    );
    const from = scripted.segmentStarts[2]! + 15;
    const corrections: CorrectionsLayer = {
      entries: [
        {
          id: 'r1',
          kind: 'range',
          timestamp: at(1),
          source: 'user',
          rangeType: 'in_escape_box',
          startFrame: from,
          endFrame: scripted.frames.length - 1,
        },
      ],
    };
    const { auto } = run(
      [
        { kind: 'moveToHole', hole: 7, seconds: 0.5 },
        { kind: 'dwell', hole: 7, seconds: 0.5 },
        { kind: 'dwell', seconds: 2 },
      ],
      { corrections },
    );
    expect(kinds(auto.events)).toEqual(['investigation@7', 'escape_entry@7']);
    expect(auto.events[1]!.startFrame).toBe(from);
    expect(auto.events[1]!.evidence).toContain('marked by the user');
    expect(auto.persistentEscapeStartFrame).toBe(from);
    expect(auto.endReason).toBe('escape');
  });

  it('emits only events that begin within the trial, and says when one continues past its end', () => {
    const p: Parameters = { ...DEFAULT_PARAMETERS, trialCutoff_s: 1.0 };
    const after = run([{ kind: 'dwell', seconds: 1.5 }, ...visitHoles([3])], { p });
    expect(after.auto.events).toEqual([]);
    expect(after.auto.endReason).toBe('cutoff');
    const straddling = run(
      [
        { kind: 'moveToHole', hole: 3, seconds: 0.5 },
        { kind: 'dwell', hole: 3, seconds: 1.5 },
      ],
      { p },
    );
    expect(kinds(straddling.auto.events)).toEqual(['investigation@3']);
    expect(straddling.auto.events[0]!.endFrame).toBe(straddling.auto.endFrame);
    expect(straddling.auto.events[0]!.evidence).toContain('still at the hole when the trial ended');
  });
});

describe('event corrections (D20, D25)', () => {
  const script = visitHoles([3, 5, 3]);

  function corrected(entries: CorrectionEntry[], autoOverride?: readonly EventRecord[]) {
    const { ctx, auto } = run(script);
    const result = applyEventCorrections(
      ctx,
      deepFreeze(autoOverride ?? auto.events),
      deepFreeze({ entries }),
      auto.endFrame,
    );
    return { ...result, auto };
  }

  it('deletes by exact id, and by a stale id whose start frame falls inside the same kind and hole', () => {
    const { auto } = run(script);
    const first = auto.events[0]!;
    const exact = corrected([
      {
        id: 'd1',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'delete',
        eventId: first.id,
      },
    ]);
    expect(kinds(exact.events)).toEqual(['investigation@5', 'investigation@3']);
    expect(exact.applied).toBe(1);
    expect(exact.flags).toEqual([]);
    const stale = corrected([
      {
        id: 'd2',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'delete',
        eventId: autoEventId('investigation', 3, first.startFrame + 3),
      },
    ]);
    expect(kinds(stale.events)).toEqual(['investigation@5', 'investigation@3']);
  });

  it('flags an orphaned delete instead of resurrecting or ignoring silently', () => {
    const { events, flags, applied } = corrected([
      {
        id: 'd3',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'delete',
        eventId: autoEventId('investigation', 9, 4),
      },
    ]);
    expect(events).toHaveLength(3);
    expect(applied).toBe(0);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.code).toBe('orphaned_correction');
    expect(flags[0]!.correctionId).toBe('d3');
  });

  it('edits hole and frames, keeps the automatic values as autoShadow, recomputes the rest', () => {
    const { auto } = run(script);
    const second = auto.events[1]!;
    const { events } = corrected([
      {
        id: 'e1',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'edit',
        eventId: second.id,
        holeIndex: 7,
        startFrame: second.startFrame + 2,
        endFrame: second.endFrame - 2,
      },
    ]);
    const ev = events.find((e) => e.id === second.id)!;
    expect(ev.source).toBe('corrected');
    expect(ev.holeIndex).toBe(7);
    expect(ev.isTarget).toBe(true);
    expect(ev.startFrame).toBe(second.startFrame + 2);
    expect(ev.endFrame).toBe(second.endFrame - 2);
    expect(ev.durationSeconds).toBeCloseTo(ev.endTime_s - ev.startTime_s, 12);
    expect(ev.autoShadow).toEqual({
      holeIndex: 5,
      startFrame: second.startFrame,
      endFrame: second.endFrame,
    });
    expect(ev.minCentroidDistance_cm).toBeGreaterThan(second.minCentroidDistance_cm); // hole 7 is far from where the animal sat
    expect(ev.evidence).toContain('hole 5 → 7');
    expect(Object.keys(ev).sort()).toEqual([...EVENT_KEYS, 'autoShadow'].sort());
    // an edit that changes only the hole keeps the frames
    const holeOnly = corrected([
      {
        id: 'e2',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'edit',
        eventId: second.id,
        holeIndex: 6,
      },
    ]);
    const ho = holeOnly.events.find((e) => e.id === second.id)!;
    expect([ho.holeIndex, ho.startFrame, ho.endFrame]).toEqual([
      6,
      second.startFrame,
      second.endFrame,
    ]);
  });

  it('keeps an edited event pinned when its automatic event has gone (a parameter change)', () => {
    const { auto } = run(script);
    const second = auto.events[1]!;
    const withoutSecond = auto.events.filter((e) => e !== second);
    const { events, flags } = corrected(
      [
        {
          id: 'e3',
          kind: 'event',
          timestamp: at(1),
          source: 'user',
          action: 'edit',
          eventId: second.id,
          holeIndex: 5,
          startFrame: second.startFrame,
          endFrame: second.endFrame,
        },
      ],
      withoutSecond,
    );
    expect(flags).toEqual([]);
    const pinned = events.find((e) => e.id === second.id)!;
    expect(pinned.source).toBe('corrected');
    expect(pinned.holeIndex).toBe(5);
    expect(pinned.autoShadow).toBeUndefined();
    expect(pinned.evidence).toContain('no longer exists');
    // a second edit of the pinned orphan still carries no autoShadow: user values are never labelled automatic
    const { events: twice } = corrected(
      [
        {
          id: 'e3',
          kind: 'event',
          timestamp: at(1),
          source: 'user',
          action: 'edit',
          eventId: second.id,
          holeIndex: 5,
          startFrame: second.startFrame,
          endFrame: second.endFrame,
        },
        {
          id: 'e4',
          kind: 'event',
          timestamp: at(2),
          source: 'user',
          action: 'edit',
          eventId: second.id,
          holeIndex: 6,
        },
      ],
      withoutSecond,
    );
    const again = twice.find((e) => e.id === second.id)!;
    expect(again.holeIndex).toBe(6);
    expect(again.autoShadow).toBeUndefined();
    expect(again.evidence).toContain('pinned correction with no automatic values');
  });

  it('adds a user event, applies corrections in timestamp order, and validates the span', () => {
    const { auto } = run(script);
    const added = corrected([
      {
        id: 'a1',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'add',
        holeIndex: 9,
        startFrame: 3,
        endFrame: 8,
      },
    ]);
    expect(kinds(added.events)).toEqual([
      'investigation@9',
      'investigation@3',
      'investigation@5',
      'investigation@3',
    ]);
    const user = added.events[0]!;
    expect(user.id).toBe('user-a1');
    expect(user.source).toBe('corrected');
    expect(user.autoShadow).toBeUndefined();
    expect(user.evidence).toContain('added by the user');
    // a later delete of the added event, listed first in the array, still applies after the add
    const addThenDelete = corrected([
      {
        id: 'd9',
        kind: 'event',
        timestamp: at(2),
        source: 'user',
        action: 'delete',
        eventId: 'user-a1',
      },
      {
        id: 'a1',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'add',
        holeIndex: 9,
        startFrame: 3,
        endFrame: 8,
      },
    ]);
    expect(kinds(addThenDelete.events)).toEqual(kinds(auto.events));
    expect(addThenDelete.flags).toEqual([]);
    const bad = corrected([
      {
        id: 'a2',
        kind: 'event',
        timestamp: at(1),
        source: 'user',
        action: 'add',
        holeIndex: 99,
        startFrame: 3,
        endFrame: 8,
      },
    ]);
    expect(bad.flags.map((f) => f.code)).toEqual(['orphaned_correction']);
    expect(bad.events).toHaveLength(3);
  });
});
