/**
 * D65, D71: provenance is the difference between two detections, decided by a
 * pure matcher over the two event lists and the frame corrections in force.
 */
import { describe, expect, it } from 'vitest';
import {
  correctionIdsInSpan,
  frameCorrectionSpans,
  matchEvents,
  sameEventValues,
} from '../../src/analysis/match-events.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { CorrectionEntry } from '../../src/contracts/session.js';

const at = (i: number): string => `2026-09-06T10:00:${String(i).padStart(2, '0')}.000Z`;

function ev(over: Partial<EventRecord> & Pick<EventRecord, 'startFrame' | 'endFrame'>): EventRecord {
  const { startFrame, endFrame, ...rest } = over;
  return {
    id: `auto-investigation-h3-f${startFrame}`,
    kind: 'investigation',
    holeIndex: 3,
    isTarget: false,
    startFrame,
    endFrame,
    startTime_s: startFrame / 30,
    endTime_s: endFrame / 30,
    durationSeconds: (endFrame - startFrame) / 30,
    pointUsed: 'nose',
    minNoseDistance_cm: 1.2,
    minCentroidDistance_cm: 2.4,
    evidence: 'hole 3 (non-target).',
    source: 'auto',
    evidenceCorrected: false,
    correctionIds: [],
    confirmed: false,
    ...rest,
  };
}

const point =(id: string, frameIndex: number, i: number): CorrectionEntry => ({
  id,
  kind: 'point',
  timestamp: at(i),
  source: 'user',
  frameIndex,
  point: 'centroid',
  value: { x: 1, y: 2, confidence: 1, valid: true },
});

const range = (id: string, startFrame: number, endFrame: number, i: number): CorrectionEntry => ({
  id,
  kind: 'range',
  timestamp: at(i),
  source: 'user',
  rangeType: 'not_visible',
  startFrame,
  endFrame,
});

/** A user's "in the escape box from here" range (D57), the one correction that creates an entry. */
const escapeRange = (id: string, startFrame: number, endFrame: number, i: number): CorrectionEntry => ({
  id,
  kind: 'range',
  timestamp: at(i),
  source: 'user',
  rangeType: 'in_escape_box',
  startFrame,
  endFrame,
});

describe('frameCorrectionSpans / correctionIdsInSpan', () => {
  it('turns points and ranges into inclusive frame spans in application order, and ignores the rest', () => {
    const entries: CorrectionEntry[] = [
      range('r', 40, 50, 2),
      point('p', 10, 1),
      { id: 't', kind: 'trial_start', timestamp: at(0), source: 'user', frameIndex: 3 },
      { id: 'n', kind: 'no_escape', timestamp: at(3), source: 'user', reason: '' },
    ];
    expect(frameCorrectionSpans(entries)).toEqual([
      { id: 'p', startFrame: 10, endFrame: 10 },
      { id: 'r', startFrame: 40, endFrame: 50 },
    ]);
    const spans = frameCorrectionSpans(entries);
    expect(correctionIdsInSpan(spans, 0, 9)).toEqual([]);
    expect(correctionIdsInSpan(spans, 10, 10)).toEqual(['p']);
    expect(correctionIdsInSpan(spans, 50, 60)).toEqual(['r']);
    expect(correctionIdsInSpan(spans, 0, 100)).toEqual(['p', 'r']);
  });
});

describe('sameEventValues', () => {
  it('ignores the id and the provenance fields, and treats NaN as equal to NaN', () => {
    const a = ev({ startFrame: 10, endFrame: 20, minCentroidDistance_cm: Number.NaN });
    const b = ev({
      startFrame: 10,
      endFrame: 20,
      minCentroidDistance_cm: Number.NaN,
      id: 'other',
      source: 'corrected',
      confirmed: true,
      correctionIds: ['x'],
      autoShadow: { holeIndex: 3, startFrame: 1, endFrame: 2 },
    });
    expect(sameEventValues(a, b)).toBe(true);
    expect(sameEventValues(a, ev({ startFrame: 10, endFrame: 21 }))).toBe(false);
    expect(sameEventValues(a, ev({ startFrame: 10, endFrame: 20, pointUsed: 'centroid' }))).toBe(false);
  });
});

describe('matchEvents (D65)', () => {
  it('labels an untouched event automatic with no ids and no shadow', () => {
    const auto = [ev({ startFrame: 10, endFrame: 20 })];
    const { events, removedAutoEvents } = matchEvents(auto, [ev({ startFrame: 10, endFrame: 20 })], []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'auto', evidenceCorrected: false, correctionIds: [], confirmed: false });
    expect(events[0]!.autoShadow).toBeUndefined();
    expect(removedAutoEvents).toEqual([]);
  });

  it('labels an event only the corrected detection found as a human claim, with the corrections inside its span', () => {
    const spans = frameCorrectionSpans([range('r1', 100, 140, 1), point('p1', 5, 2)]);
    const { events } = matchEvents(
      [],
      [ev({ id: 'auto-escape_entry-h7-f100', kind: 'escape_entry', holeIndex: 7, isTarget: true, startFrame: 100, endFrame: 140 })],
      spans,
    );
    expect(events[0]).toMatchObject({ source: 'corrected', evidenceCorrected: false, correctionIds: ['r1'] });
    expect(events[0]!.autoShadow).toBeUndefined();
  });

  it('keeps an event both detections found but measured differently automatic, evidence-corrected, with the auto-only values as its shadow', () => {
    const spans = frameCorrectionSpans([point('p', 11, 1)]);
    const { events } = matchEvents(
      [ev({ startFrame: 12, endFrame: 20 })],
      [ev({ startFrame: 10, endFrame: 20 })],
      spans,
    );
    expect(events[0]).toMatchObject({
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['p'],
      autoShadow: { holeIndex: 3, startFrame: 12, endFrame: 20 },
    });
    // the kinds agree, so the shadow does not name one
    expect(events[0]!.autoShadow).not.toHaveProperty('kind');
  });

  it('collects the ids over the union of the span and its shadow, so a correction that trimmed the end is named', () => {
    const spans = frameCorrectionSpans([range('r', 21, 40, 1)]);
    const { events } = matchEvents(
      [ev({ startFrame: 10, endFrame: 21 })],
      [ev({ startFrame: 10, endFrame: 20 })],
      spans,
    );
    expect(events[0]!.correctionIds).toEqual(['r']);
    expect(events[0]!.autoShadow).toEqual({ holeIndex: 3, startFrame: 10, endFrame: 21 });
  });

  it('matches by kind and hole on overlapping spans, largest overlap first, each event at most once', () => {
    const auto = [
      ev({ startFrame: 10, endFrame: 30 }),
      ev({ startFrame: 10, endFrame: 12, holeIndex: 4, id: 'auto-investigation-h4-f10' }),
      ev({ startFrame: 40, endFrame: 60 }),
    ];
    const corrected = [
      ev({ startFrame: 8, endFrame: 12 }), // overlaps the first auto event by 3 frames
      ev({ startFrame: 13, endFrame: 30 }), // overlaps it by 18: wins it
      ev({ startFrame: 40, endFrame: 60 }),
    ];
    const { events, removedAutoEvents } = matchEvents(auto, corrected, frameCorrectionSpans([point('p', 12, 1)]));
    expect(events.map((e) => e.source)).toEqual(['corrected', 'auto', 'auto']);
    expect(events[0]!.correctionIds).toEqual(['p']);
    expect(events[1]!.autoShadow).toEqual({ holeIndex: 3, startFrame: 10, endFrame: 30 });
    expect(events[1]!.evidenceCorrected).toBe(true);
    expect(events[2]!.evidenceCorrected).toBe(false);
    // the hole-4 auto event never matches a hole-3 event, whatever the overlap: it is reported removed
    expect(events.every((e) => e.autoShadow?.holeIndex !== 4)).toBe(true);
    expect(removedAutoEvents.map((e) => [e.id, e.correctionIds])).toEqual([['auto-investigation-h4-f10', ['p']]]);
  });

  it('keeps the order of the corrected list and leaves the inputs untouched', () => {
    const auto = Object.freeze([ev({ startFrame: 10, endFrame: 20 })]);
    const corrected = Object.freeze([ev({ startFrame: 30, endFrame: 40 }), ev({ startFrame: 10, endFrame: 20 })]);
    const { events } = matchEvents(auto, corrected, []);
    expect(events.map((e) => e.startFrame)).toEqual([30, 10]);
    expect(events.map((e) => e.source)).toEqual(['corrected', 'auto']);
  });
});

/*
 * D71 (2): the second pass. A pair left over by the kind-and-hole pass that shares a hole and
 * overlaps is a kind change — a human claim that carries the automatic event, kind included, as
 * its shadow and names it in the sentence. An automatic event left over by both passes was
 * removed by a correction and is reported so derive() can flag and count it.
 */
describe('matchEvents (D71): a kind change is a human claim; a vanished automatic event is reported', () => {
  it('matches a kind change on the second pass: corrected, with the automatic kind in the shadow and in the sentence', () => {
    const spans = frameCorrectionSpans([point('p', 12, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [ev({ startFrame: 10, endFrame: 30, kind: 'tracking_failure', id: 'auto-tracking_failure-h3-f10' })],
      [ev({ startFrame: 10, endFrame: 30 })],
      spans,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['p'],
      confirmed: false,
      autoShadow: { holeIndex: 3, startFrame: 10, endFrame: 30, kind: 'tracking_failure' },
    });
    expect(events[0]!.evidence).toBe(
      'hole 3 (non-target). Was an automatic tracking failure at hole 3, frames 10–30, before the corrections changed its kind.',
    );
    expect(removedAutoEvents).toEqual([]);
  });

  it('names the automatic investigation a range turned into an escape entry (the D71 example)', () => {
    const spans = frameCorrectionSpans([range('r', 1100, 1140, 1)]);
    const { events } = matchEvents(
      [ev({ id: 'auto-investigation-h7-f1100', holeIndex: 7, isTarget: true, startFrame: 1100, endFrame: 1129 })],
      [
        ev({
          id: 'auto-escape_entry-h7-f1100',
          kind: 'escape_entry',
          holeIndex: 7,
          isTarget: true,
          startFrame: 1100,
          endFrame: 1140,
          evidence: 'In the escape box at the target hole 7 by assertion.',
        }),
      ],
      spans,
    );
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 1100, endFrame: 1129, kind: 'investigation' },
    });
    expect(events[0]!.evidence).toBe(
      'In the escape box at the target hole 7 by assertion. Was an automatic investigation at hole 7, frames 1100–1129, before the corrections changed its kind.',
    );
  });

  it('collects the ids of a kind-change pair over the union of the two spans', () => {
    // the nudge at 12 sits only inside the automatic event's span; the range made the entry
    const spans = frameCorrectionSpans([point('p', 12, 1), range('r', 20, 30, 2)]);
    const { events } = matchEvents(
      [ev({ id: 'auto-investigation-h7-f10', holeIndex: 7, isTarget: true, startFrame: 10, endFrame: 30 })],
      [ev({ id: 'auto-escape_entry-h7-f20', kind: 'escape_entry', holeIndex: 7, isTarget: true, startFrame: 20, endFrame: 30 })],
      spans,
    );
    expect(events[0]!.correctionIds).toEqual(['p', 'r']);
  });

  it('reports an automatic event with no counterpart in either pass as removed (the measured case)', () => {
    // [auto 10–14, auto 16–25] vs [corrected 10–25], a nudge at 15 that merged the two visits
    const spans = frameCorrectionSpans([point('p', 15, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [ev({ startFrame: 10, endFrame: 14 }), ev({ startFrame: 16, endFrame: 25 })],
      [ev({ startFrame: 10, endFrame: 25 })],
      spans,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['p'],
      autoShadow: { holeIndex: 3, startFrame: 16, endFrame: 25 },
    });
    expect(events[0]!.autoShadow).not.toHaveProperty('kind');
    expect(removedAutoEvents).toHaveLength(1);
    expect(removedAutoEvents[0]).toMatchObject({
      id: 'auto-investigation-h3-f10',
      startFrame: 10,
      endFrame: 14,
      source: 'auto',
      correctionIds: ['p'], // the nudge at 15 is outside 10–14 but inside the 10–25 that absorbed it
    });
    expect(removedAutoEvents[0]!.autoShadow).toBeUndefined();
  });

  it('names on the removed record the corrections that overlap it, and lists removals by start frame', () => {
    const spans = frameCorrectionSpans([range('r', 40, 50, 1), point('p', 72, 2)]);
    const { events, removedAutoEvents } = matchEvents(
      [ev({ startFrame: 60, endFrame: 70 }), ev({ startFrame: 42, endFrame: 48 }), ev({ startFrame: 71, endFrame: 80 })],
      [ev({ startFrame: 60, endFrame: 70 })],
      spans,
    );
    expect(events.map((e) => e.source)).toEqual(['auto']);
    expect(removedAutoEvents.map((e) => [e.startFrame, e.correctionIds])).toEqual([
      [42, ['r']],
      [71, ['p']],
    ]);
  });

  it('matches the second pass at most once too: the larger overlap takes the automatic event, the other stays a shadowless claim', () => {
    const auto = [ev({ holeIndex: 7, isTarget: true, startFrame: 10, endFrame: 40, id: 'auto-investigation-h7-f10' })];
    const corrected = [
      ev({ kind: 'escape_entry', holeIndex: 7, isTarget: true, startFrame: 8, endFrame: 12, id: 'auto-escape_entry-h7-f8' }),
      ev({ kind: 'escape_entry', holeIndex: 7, isTarget: true, startFrame: 13, endFrame: 40, id: 'auto-escape_entry-h7-f13' }),
    ];
    const { events, removedAutoEvents } = matchEvents(auto, corrected, []);
    expect(events.map((e) => e.source)).toEqual(['corrected', 'corrected']);
    expect(events[0]!.autoShadow).toBeUndefined();
    expect(events[1]!.autoShadow).toEqual({ holeIndex: 7, startFrame: 10, endFrame: 40, kind: 'investigation' });
    expect(removedAutoEvents).toEqual([]);
  });

  it('never matches across holes on either pass', () => {
    const { events, removedAutoEvents } = matchEvents(
      [ev({ startFrame: 10, endFrame: 30, holeIndex: 4, id: 'auto-investigation-h4-f10' })],
      [ev({ startFrame: 10, endFrame: 30, kind: 'escape_entry' })],
      [],
    );
    expect(events[0]!.source).toBe('corrected');
    expect(events[0]!.autoShadow).toBeUndefined();
    expect(removedAutoEvents.map((e) => e.holeIndex)).toEqual([4]);
  });
});

describe('matchEvents (D73): what a leftover automatic event is', () => {
  const entry = (startFrame: number, endFrame: number): EventRecord =>
    ev({
      id: `auto-escape_entry-h7-f${startFrame}`,
      kind: 'escape_entry',
      holeIndex: 7,
      isTarget: true,
      startFrame,
      endFrame,
      evidence: 'In the escape box at the target hole 7.',
    });
  const investigation = (hole: number, startFrame: number, endFrame: number): EventRecord =>
    ev({ id: `auto-investigation-h${hole}-f${startFrame}`, holeIndex: hole, isTarget: hole === 7, startFrame, endFrame });

  it('drops an automatic tracking failure the corrections repaired: not removed, not reported', () => {
    // a 1.5 s loss in the open, repaired with one centroid point per lost frame
    const points: CorrectionEntry[] = [];
    for (let f = 10; f <= 54; f++) points.push(point(`p${f}`, f, 1));
    const { events, removedAutoEvents } = matchEvents(
      [ev({ id: 'auto-tracking_failure-hx-f10', kind: 'tracking_failure', holeIndex: null, startFrame: 10, endFrame: 54 })],
      [],
      frameCorrectionSpans(points),
    );
    expect(events).toEqual([]);
    expect(removedAutoEvents).toEqual([]);
  });

  it('reads a user’s range entry beside the tracker’s own entry five frames later as a claim carrying that entry, and leaves what the corrected trial never reached alone (D74 (4))', () => {
    const window = { startFrame: 0, endFrame: 900 };
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [entry(905, 2000), investigation(3, 1050, 1065), investigation(5, 1200, 1215)],
      [entry(900, 2000)],
      spans,
      window,
      new Set(['auto-escape_entry-h7-f900']),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 905, endFrame: 2000 },
    });
    expect(events[0]!.autoShadow).not.toHaveProperty('kind');
    // the investigations at 1050 and 1200 lie entirely after the corrected end: not removed
    expect(removedAutoEvents).toEqual([]);
  });

  it('reads an entry the detector does not name as the user’s — the tracker’s own, moved by a correction — as a move', () => {
    const window = { startFrame: 0, endFrame: 900 };
    const spans = frameCorrectionSpans([range('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents([entry(905, 2000)], [entry(900, 2000)], spans, window);
    expect(events[0]).toMatchObject({
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 905, endFrame: 2000 },
    });
    expect(removedAutoEvents).toEqual([]);
  });

  it('pairs a range-created entry with the automatic investigation it replaced as a kind change, window or not', () => {
    const window = { startFrame: 0, endFrame: 900 };
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [investigation(7, 905, 930), investigation(3, 1050, 1065), investigation(5, 1200, 1215)],
      [entry(900, 2000)],
      spans,
      window,
      new Set(['auto-escape_entry-h7-f900']),
    );
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 905, endFrame: 930, kind: 'investigation' },
    });
    expect(events[0]!.evidence).toContain('Was an automatic investigation at hole 7, frames 905–930');
    expect(removedAutoEvents).toEqual([]);
  });

  it('keeps a leftover that straddles the corrected end as a removal, and drops one before the start', () => {
    const window = { startFrame: 100, endFrame: 900 };
    const { removedAutoEvents } = matchEvents(
      [investigation(3, 50, 80), investigation(4, 890, 950), investigation(5, 901, 950)],
      [],
      [],
      window,
    );
    expect(removedAutoEvents.map((e) => e.startFrame)).toEqual([890]);
  });

  it('drops nothing for the window when none is given', () => {
    const { removedAutoEvents } = matchEvents(
      [investigation(3, 50, 80), investigation(5, 1200, 1215)],
      [],
      [],
    );
    expect(removedAutoEvents.map((e) => e.startFrame)).toEqual([50, 1200]);
  });
});

/*
 * D74 (4): a user's escape-box range is always a claim. The detector names the entries a range
 * produced; the matcher never offers one to the same-kind pass, pairs it instead with the
 * automatic escape entry it overlaps — the tracker's reading, kept beside the claim as its shadow —
 * and so never reports that entry removed, and the queue (which skips `source: corrected`) never
 * asks the person who marked the box to confirm it.
 */
describe('matchEvents (D74 (4)): a range entry is a claim, with the tracker’s own entry as its shadow', () => {
  const entry = (startFrame: number, endFrame: number): EventRecord =>
    ev({
      id: `auto-escape_entry-h7-f${startFrame}`,
      kind: 'escape_entry',
      holeIndex: 7,
      isTarget: true,
      startFrame,
      endFrame,
      evidence: 'In the escape box at the target hole 7.',
    });
  const investigation = (hole: number, startFrame: number, endFrame: number): EventRecord =>
    ev({ id: `auto-investigation-h${hole}-f${startFrame}`, holeIndex: hole, isTarget: hole === 7, startFrame, endFrame });
  const window = { startFrame: 0, endFrame: 900 };
  const user = new Set(['auto-escape_entry-h7-f900']);

  it('carries the automatic entry it overlaps as its shadow, and that entry is never a removal (the measured case)', () => {
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents([entry(1473, 1622)], [entry(900, 2000)], spans, window, user);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      confirmed: false,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 1473, endFrame: 1622 },
    });
    expect(events[0]!.autoShadow).not.toHaveProperty('kind');
    expect(events[0]!.evidence).toBe('In the escape box at the target hole 7.');
    expect(removedAutoEvents).toEqual([]);
  });

  it('stays a claim with no shadow when the tracker found no entry, as before', () => {
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents([], [entry(900, 2000)], spans, window, user);
    expect(events[0]).toMatchObject({ source: 'corrected', evidenceCorrected: false, correctionIds: ['r'] });
    expect(events[0]!.autoShadow).toBeUndefined();
    expect(removedAutoEvents).toEqual([]);
  });

  it('is a claim even when the tracker’s entry agrees with it on every value', () => {
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events } = matchEvents([entry(900, 2000)], [entry(900, 2000)], spans, window, user);
    expect(events[0]).toMatchObject({
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 900, endFrame: 2000 },
    });
  });

  it('takes the tracker’s entry, not its investigation, when both sit at the hole; the investigation keeps its own match', () => {
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [investigation(7, 870, 930), entry(1473, 1622)],
      [investigation(7, 870, 899), entry(900, 2000)],
      spans,
      window,
      user,
    );
    expect(events.map((e) => e.source)).toEqual(['auto', 'corrected']);
    // the range trimmed the stay: the tracker's own event, evidence-corrected, with the whole stay as its shadow
    expect(events[0]).toMatchObject({ evidenceCorrected: true, autoShadow: { holeIndex: 7, startFrame: 870, endFrame: 930 } });
    expect(events[1]!.autoShadow).toEqual({ holeIndex: 7, startFrame: 1473, endFrame: 1622 });
    expect(removedAutoEvents).toEqual([]);
  });

  it('covers every automatic entry the range overlaps: the earliest is the shadow, the rest are neither rows nor removals', () => {
    // the tracker saw the animal go in twice at the target; the person marked the box from inside
    // the first stay to the end
    const spans = frameCorrectionSpans([escapeRange('r', 98, 2000, 1)]);
    const { events, removedAutoEvents } = matchEvents(
      [entry(93, 146), entry(336, 455)],
      [entry(98, 2000)],
      spans,
      { startFrame: 0, endFrame: 98 },
      new Set(['auto-escape_entry-h7-f98']),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'corrected',
      correctionIds: ['r'],
      autoShadow: { holeIndex: 7, startFrame: 93, endFrame: 146 },
    });
    expect(removedAutoEvents).toEqual([]);
  });

  it('leaves an automatic entry the range only touches to the tracker’s own corrected entry, which stays automatic (the second review’s case)', () => {
    // the person marked the box over the first stay; the tracker's next entry, which the range
    // ends three frames into, is still found by the corrected detection on its own
    const spans = frameCorrectionSpans([escapeRange('r1', 98, 310, 1), point('p1', 315, 2)]);
    const { events, removedAutoEvents } = matchEvents(
      [entry(150, 250), entry(305, 2000)],
      [entry(98, 310), entry(320, 2000)],
      spans,
      { startFrame: 0, endFrame: 320 },
      new Set(['auto-escape_entry-h7-f98']),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: 'corrected', correctionIds: ['r1'], autoShadow: { holeIndex: 7, startFrame: 150, endFrame: 250 } });
    expect(events[1]).toMatchObject({
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['r1', 'p1'],
      autoShadow: { holeIndex: 7, startFrame: 305, endFrame: 2000 },
    });
    expect(removedAutoEvents).toEqual([]);
  });

  it('gives each of two range entries the automatic entry it overlaps', () => {
    const spans = frameCorrectionSpans([escapeRange('r1', 90, 340, 1), escapeRange('r2', 345, 2000, 2)]);
    const both = new Set(['auto-escape_entry-h7-f90', 'auto-escape_entry-h7-f345']);
    const { events, removedAutoEvents } = matchEvents(
      [entry(93, 146), entry(336, 455)],
      [entry(90, 340), entry(345, 2000)],
      spans,
      { startFrame: 0, endFrame: 90 },
      both,
    );
    expect(events.map((e) => e.autoShadow)).toEqual([
      { holeIndex: 7, startFrame: 93, endFrame: 146 },
      { holeIndex: 7, startFrame: 336, endFrame: 455 },
    ]);
    expect(events.map((e) => e.source)).toEqual(['corrected', 'corrected']);
    expect(removedAutoEvents).toEqual([]);
  });

  it('names a point placed inside the range beside the range (D65’s rule for the ids)', () => {
    const spans = frameCorrectionSpans([escapeRange('r', 900, 2000, 1), point('p', 950, 2)]);
    const { events } = matchEvents([entry(905, 2000)], [entry(900, 2000)], spans, window, user);
    expect(events[0]!.correctionIds).toEqual(['r', 'p']);
  });
});
