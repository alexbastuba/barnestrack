/**
 * D65: provenance is the difference between two detections, decided by a
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
    const out = matchEvents(auto, [ev({ startFrame: 10, endFrame: 20 })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'auto', evidenceCorrected: false, correctionIds: [], confirmed: false });
    expect(out[0]!.autoShadow).toBeUndefined();
  });

  it('labels an event only the corrected detection found as a human claim, with the corrections inside its span', () => {
    const spans = frameCorrectionSpans([range('r1', 100, 140, 1), point('p1', 5, 2)]);
    const out = matchEvents(
      [],
      [ev({ id: 'auto-escape_entry-h7-f100', kind: 'escape_entry', holeIndex: 7, isTarget: true, startFrame: 100, endFrame: 140 })],
      spans,
    );
    expect(out[0]).toMatchObject({ source: 'corrected', evidenceCorrected: false, correctionIds: ['r1'] });
    expect(out[0]!.autoShadow).toBeUndefined();
  });

  it('keeps an event both detections found but measured differently automatic, evidence-corrected, with the auto-only values as its shadow', () => {
    const spans = frameCorrectionSpans([point('p', 11, 1)]);
    const out = matchEvents(
      [ev({ startFrame: 12, endFrame: 20 })],
      [ev({ startFrame: 10, endFrame: 20 })],
      spans,
    );
    expect(out[0]).toMatchObject({
      source: 'auto',
      evidenceCorrected: true,
      correctionIds: ['p'],
      autoShadow: { holeIndex: 3, startFrame: 12, endFrame: 20 },
    });
  });

  it('collects the ids over the union of the span and its shadow, so a correction that trimmed the end is named', () => {
    const spans = frameCorrectionSpans([range('r', 21, 40, 1)]);
    const out = matchEvents(
      [ev({ startFrame: 10, endFrame: 21 })],
      [ev({ startFrame: 10, endFrame: 20 })],
      spans,
    );
    expect(out[0]!.correctionIds).toEqual(['r']);
    expect(out[0]!.autoShadow).toEqual({ holeIndex: 3, startFrame: 10, endFrame: 21 });
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
    const out = matchEvents(auto, corrected, frameCorrectionSpans([point('p', 12, 1)]));
    expect(out.map((e) => e.source)).toEqual(['corrected', 'auto', 'auto']);
    expect(out[0]!.correctionIds).toEqual(['p']);
    expect(out[1]!.autoShadow).toEqual({ holeIndex: 3, startFrame: 10, endFrame: 30 });
    expect(out[1]!.evidenceCorrected).toBe(true);
    expect(out[2]!.evidenceCorrected).toBe(false);
    // the hole-4 auto event never matches a hole-3 event, whatever the overlap
    expect(out.every((e) => e.autoShadow?.holeIndex !== 4)).toBe(true);
  });

  it('never matches across kinds', () => {
    const auto = [ev({ startFrame: 10, endFrame: 30, kind: 'tracking_failure', holeIndex: 3 })];
    const out = matchEvents(auto, [ev({ startFrame: 10, endFrame: 30 })], []);
    expect(out[0]!.source).toBe('corrected');
  });

  it('keeps the order of the corrected list and leaves the inputs untouched', () => {
    const auto = Object.freeze([ev({ startFrame: 10, endFrame: 20 })]);
    const corrected = Object.freeze([ev({ startFrame: 30, endFrame: 40 }), ev({ startFrame: 10, endFrame: 20 })]);
    const out = matchEvents(auto, corrected, []);
    expect(out.map((e) => e.startFrame)).toEqual([30, 10]);
    expect(out.map((e) => e.source)).toEqual(['corrected', 'auto']);
  });
});
