/**
 * The correction operations (D25): pure, additive, reversible, and every one
 * propagates through `derive` by recomputation rather than by patching an
 * output (D20, D22).
 */
import { describe, expect, it } from 'vitest';
import { derive, type DeriveInput, type DerivedAnalysis } from '../../src/analysis/derive.js';
import { DEFAULT_PARAMETERS, hashTrackingParameters } from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';
import {
  NO_CORRECTIONS,
  addEvent,
  clearPoint,
  clearRange,
  correctionsAtFrame,
  deleteEvent,
  describeCorrection,
  editEvent,
  eventCorrectionsFor,
  markRange,
  noEscapeCorrection,
  orphanedCorrections,
  pointCorrectionAt,
  rangesCovering,
  revertCorrection,
  revertEvent,
  revertNoEscape,
  revertStrategyOverride,
  revertTrialStart,
  setNoEscape,
  setPoint,
  setStrategyOverride,
  setTrialStart,
  strategyOverride,
  trialStartCorrection,
  type CorrectionMeta,
} from '../../src/session/corrections.js';
import { TEST_RESOLUTION, testGeometry, testMazeMap } from '../analysis/maze-fixture.js';
import { holePoint, scriptTrack, visitHoles, type Segment } from '../analysis/synthetic-track.js';
import { deepFreeze } from '../analysis/track-builder.js';

const g = testGeometry(); // target hole 7
let counter = 0;
/** A fresh id and a strictly increasing timestamp, the way the UI supplies them. */
function meta(): CorrectionMeta {
  counter += 1;
  return { id: `c${counter}`, timestamp: `2026-09-07T10:00:${String(counter).padStart(2, '0')}.000Z` };
}

function frozen(layer: CorrectionsLayer): CorrectionsLayer {
  return deepFreeze(layer);
}

function inputFor(
  segments: Segment[],
  corrections: CorrectionsLayer,
  p: Parameters = DEFAULT_PARAMETERS,
): { input: DeriveInput; segmentStarts: number[]; frames: number } {
  const scripted = scriptTrack(segments, { g });
  return {
    input: deepFreeze({
      videoId: 'vid',
      auto: {
        parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking),
        frames: scripted.frames,
      },
      corrections,
      mazeMap: testMazeMap(),
      mazeTransform: IDENTITY_TRANSFORM,
      index: { width: TEST_RESOLUTION.width, height: TEST_RESOLUTION.height },
      parameters: p,
    }),
    segmentStarts: scripted.segmentStarts,
    frames: scripted.frames.length,
  };
}

function run(segments: Segment[], corrections: CorrectionsLayer, p?: Parameters): DerivedAnalysis {
  return derive(inputFor(segments, corrections, p).input);
}

describe('point corrections', () => {
  it('are pure and additive, and a second placement on the same frame and point replaces the first', () => {
    const base = frozen(NO_CORRECTIONS);
    const one = setPoint(base, 12, 'nose', { x: 10, y: 20, confidence: 1, valid: true }, meta());
    expect(base.entries).toHaveLength(0);
    expect(one.entries).toHaveLength(1);
    const two = setPoint(frozen(one), 12, 'nose', { x: 11, y: 21, confidence: 1, valid: true }, meta());
    expect(two.entries).toHaveLength(1);
    expect(pointCorrectionAt(two, 12, 'nose')?.value.x).toBe(11);
    expect(pointCorrectionAt(two, 12, 'nose')?.id).toBe(one.entries[0]!.id); // one item, stable id
    const other = setPoint(frozen(two), 12, 'centroid', { x: 0, y: 0, confidence: 0, valid: false }, meta());
    expect(other.entries).toHaveLength(2);
    expect(correctionsAtFrame(other, 12)).toHaveLength(2);
    expect(correctionsAtFrame(other, 13)).toHaveLength(0);
    expect(clearPoint(frozen(other), 12, 'nose').entries).toHaveLength(1);
    expect(clearPoint(other, 99, 'nose')).toBe(other); // nothing to clear: the same layer
  });

  it('propagate through derive: a head/tail flip fixed by hand creates the investigation and the error', () => {
    // the animal sits 3 cm from hole 3 with its nose pointing away, so the event point (the nose)
    // is outside the investigation radius and nothing is detected
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 3, seconds: 0.5, offset_cm: 3 },
      { kind: 'dwell', hole: 3, offset_cm: 3, seconds: 0.5, nose: 'away' },
      ...visitHoles([7]),
    ];
    const before = run(script, NO_CORRECTIONS);
    expect(before.metrics.primaryErrors).toBe(0);
    expect(before.events.filter((e) => e.holeIndex === 3)).toHaveLength(0);

    const { segmentStarts } = inputFor(script, NO_CORRECTIONS);
    const noseAtHole = holePoint(g, 3, 1);
    let layer = NO_CORRECTIONS;
    for (let f = segmentStarts[1]!; f < segmentStarts[2]!; f++) {
      layer = setPoint(layer, f, 'nose', { ...noseAtHole, confidence: 1, valid: true }, meta());
    }
    const after = run(script, frozen(layer));
    const fixed = after.events.find((e) => e.holeIndex === 3);
    expect(fixed?.kind).toBe('investigation');
    expect(fixed?.pointUsed).toBe('nose');
    expect(after.metrics.primaryErrors).toBe(1);
    expect(after.cleanedTrack[segmentStarts[1]!]!.nose.source).toBe('corrected');
    expect(after.correctionsApplied.point).toBe(segmentStarts[2]! - segmentStarts[1]!);

    // revert to automatic: removing the entries restores the automatic answer exactly
    let reverted = layer;
    for (const entry of layer.entries) reverted = revertCorrection(reverted, entry.id);
    expect(reverted.entries).toHaveLength(0);
    expect(run(script, reverted).metrics).toEqual(before.metrics);
    expect(run(script, reverted).events).toEqual(before.events);
  });
});

describe('range corrections', () => {
  it('mark a range in either order, re-mark covered frames and merge touching ranges of one type', () => {
    const a = markRange(frozen(NO_CORRECTIONS), 'not_visible', 40, 20, meta());
    expect(a.entries).toEqual([expect.objectContaining({ startFrame: 20, endFrame: 40 })]);
    const b = markRange(frozen(a), 'not_visible', 41, 60, meta()); // touching: one entry
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0]).toMatchObject({ startFrame: 20, endFrame: 60, id: a.entries[0]!.id });
    const c = markRange(frozen(b), 'in_escape_box', 30, 50, meta()); // re-marks the middle
    // ranges come back in frame order
    expect(c.entries.map((e) => (e.kind === 'range' ? [e.rangeType, e.startFrame, e.endFrame] : e))).toEqual([
      ['not_visible', 20, 29],
      ['in_escape_box', 30, 50],
      ['not_visible', 51, 60],
    ]);
    expect(rangesCovering(c, 35)[0]?.rangeType).toBe('in_escape_box');
    expect(rangesCovering(c, 25)[0]?.rangeType).toBe('not_visible');
    expect(rangesCovering(c, 61)).toHaveLength(0);
  });

  it('erase with the four-case algebra: contain, split, trim left, trim right', () => {
    const base = markRange(NO_CORRECTIONS, 'not_visible', 10, 50, meta());
    const split = clearRange(frozen(base), 20, 30, meta());
    expect(split.entries.map((e) => (e.kind === 'range' ? [e.startFrame, e.endFrame] : e))).toEqual([
      [10, 19],
      [31, 50],
    ]);
    expect(new Set(split.entries.map((e) => e.id)).size).toBe(2); // both halves addressable
    const trimmedLeft = clearRange(frozen(base), 0, 15, meta());
    expect(trimmedLeft.entries[0]).toMatchObject({ startFrame: 16, endFrame: 50 });
    const trimmedRight = clearRange(frozen(base), 45, 99, meta());
    expect(trimmedRight.entries[0]).toMatchObject({ startFrame: 10, endFrame: 44 });
    expect(clearRange(frozen(base), 0, 99, meta()).entries).toHaveLength(0);
    expect(base.entries).toHaveLength(1); // the input was never touched
  });

  it('propagate through derive: "in the escape box from here" ends the trial, and reverting restores it', () => {
    const script: Segment[] = [
      { kind: 'moveToHole', hole: 7, seconds: 0.5 },
      { kind: 'dwell', hole: 7, seconds: 0.5 },
      { kind: 'dwell', seconds: 4 },
    ];
    const { segmentStarts, frames } = inputFor(script, NO_CORRECTIONS);
    const before = run(script, NO_CORRECTIONS);
    expect(before.metrics.escaped).toBe(false);
    const from = segmentStarts[2]! + 10;
    const marked = markRange(NO_CORRECTIONS, 'in_escape_box', from, frames - 1, meta());
    const after = run(script, frozen(marked));
    expect(after.metrics.escaped).toBe(true);
    expect(after.trial.endFrame).toBe(from);
    expect(after.cleanedTrack[from]!.reason).toBe('in_escape_box');
    expect(run(script, revertCorrection(marked, marked.entries[0]!.id)).metrics).toEqual(before.metrics);
  });
});

describe('event corrections', () => {
  const script = visitHoles([3, 5, 3, 7]);

  it('relabel an automatic event once, coalescing repeated edits, and keep its automatic values as a shadow', () => {
    const before = run(script, NO_CORRECTIONS);
    const target = before.events.find((e) => e.holeIndex === 5)!;
    const first = editEvent(frozen(NO_CORRECTIONS), target.id, { holeIndex: 4 }, meta());
    const second = editEvent(frozen(first), target.id, { holeIndex: 6 }, meta());
    expect(second.entries).toHaveLength(1); // one item, not a chain
    expect(second.entries[0]).toMatchObject({ action: 'edit', eventId: target.id, holeIndex: 6, id: first.entries[0]!.id });
    const retimed = editEvent(frozen(second), target.id, { endFrame: target.endFrame + 5 }, meta());
    expect(retimed.entries[0]).toMatchObject({ holeIndex: 6, endFrame: target.endFrame + 5 }); // fields merge

    const after = run(script, frozen(retimed));
    const edited = after.events.find((e) => e.id === target.id)!;
    expect(edited.holeIndex).toBe(6);
    expect(edited.endFrame).toBe(target.endFrame + 5);
    expect(edited.source).toBe('corrected');
    expect(edited.autoShadow).toEqual({
      holeIndex: 5,
      startFrame: target.startFrame,
      endFrame: target.endFrame,
    });
    expect(after.correctionsApplied.event).toBe(1);
    expect(eventCorrectionsFor(retimed, target.id)).toHaveLength(1);

    const reverted = revertEvent(retimed, target.id);
    expect(reverted.entries).toHaveLength(0);
    expect(run(script, reverted).events).toEqual(before.events);
  });

  it('delete an automatic event, which lowers the error count, and revert it', () => {
    const before = run(script, NO_CORRECTIONS);
    expect(before.metrics.totalErrors).toBe(3);
    const target = before.events.find((e) => e.holeIndex === 5)!;
    const edited = editEvent(NO_CORRECTIONS, target.id, { holeIndex: 4 }, meta());
    const deleted = deleteEvent(frozen(edited), target.id, meta());
    expect(deleted.entries).toHaveLength(1); // the delete replaces the edit
    expect(deleted.entries[0]).toMatchObject({ action: 'delete', eventId: target.id });
    const after = run(script, frozen(deleted));
    expect(after.events.some((e) => e.id === target.id)).toBe(false);
    expect(after.metrics.totalErrors).toBe(2);
    expect(run(script, revertEvent(deleted, target.id)).metrics.totalErrors).toBe(3);
  });

  it('add an investigation at the playhead, edit it in place, and delete it by removing its own entry', () => {
    const { segmentStarts } = inputFor(script, NO_CORRECTIONS);
    const start = segmentStarts[6]!; // the walk to hole 7
    const added = addEvent(frozen(NO_CORRECTIONS), 12, start + 5, start, meta());
    expect(added.entries[0]).toMatchObject({ action: 'add', holeIndex: 12, startFrame: start, endFrame: start + 5 });
    const eventId = `user-${added.entries[0]!.id}`;
    const derived = run(script, frozen(added));
    const userEvent = derived.events.find((e) => e.id === eventId)!;
    expect(userEvent.source).toBe('corrected');
    expect(userEvent.holeIndex).toBe(12);
    expect(derived.metrics.totalErrors).toBe(4);

    const edited = editEvent(frozen(added), eventId, { holeIndex: 13 }, meta());
    expect(edited.entries).toHaveLength(1);
    expect(edited.entries[0]).toMatchObject({ action: 'add', holeIndex: 13 });
    expect(run(script, edited).events.find((e) => e.id === eventId)?.holeIndex).toBe(13);

    const removed = deleteEvent(frozen(edited), eventId, meta());
    expect(removed.entries).toHaveLength(0);
  });

  it('are pinned across a parameter change when they carry a span, and an orphan is listed with its flag rather than dropped', () => {
    const before = run(script, NO_CORRECTIONS);
    const target = before.events.find((e) => e.holeIndex === 5)!;
    // the UI always sends the whole span with a relabel, so the entry stands on its own
    const relabelled = editEvent(
      NO_CORRECTIONS,
      target.id,
      { holeIndex: 4, startFrame: target.startFrame, endFrame: target.endFrame },
      meta(),
    );
    // a longer minimum dwell removes every automatic investigation
    const strict: Parameters = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 5 },
    };
    const after = run(script, frozen(relabelled), strict);
    expect(after.events.filter((e) => e.source === 'auto')).toHaveLength(0);
    const pinned = after.events.find((e) => e.holeIndex === 4);
    expect(pinned?.source).toBe('corrected');
    expect(pinned?.autoShadow).toBeUndefined(); // no automatic values to shadow
    expect(after.reviewFlags.map((f) => f.code)).toEqual([]);

    // a relabel without a span, or a delete, of a vanished event cannot pin anything: it is an
    // orphan, listed with its flag and never silently dropped
    const holeOnly = editEvent(NO_CORRECTIONS, target.id, { holeIndex: 4 }, meta());
    const orphanedEdit = orphanedCorrections(holeOnly, run(script, frozen(holeOnly), strict).reviewFlags);
    expect(orphanedEdit).toHaveLength(1);
    expect(orphanedEdit[0]!.flag.code).toBe('orphaned_correction');
    const deleted = deleteEvent(NO_CORRECTIONS, target.id, meta());
    const orphaned = run(script, frozen(deleted), strict);
    const orphans = orphanedCorrections(deleted, orphaned.reviewFlags);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.entry.id).toBe(deleted.entries[0]!.id);
    expect(orphans[0]!.flag.code).toBe('orphaned_correction');
    expect(orphans[0]!.flag.message).toContain('no longer exists');
    expect(orphanedCorrections(deleted, run(script, deleted).reviewFlags)).toHaveLength(0);
  });
});

describe('trial start and strategy override', () => {
  const script = visitHoles([3, 7]);

  it('are single entries that replace themselves, propagate, and revert', () => {
    const one = setTrialStart(frozen(NO_CORRECTIONS), 5, meta());
    const two = setTrialStart(frozen(one), 9, meta());
    expect(two.entries).toHaveLength(1);
    expect(trialStartCorrection(two)?.frameIndex).toBe(9);
    expect(trialStartCorrection(two)?.id).toBe(one.entries[0]!.id);
    const moved = run(script, frozen(two));
    expect(moved.trial.startFrame).toBe(9);
    expect(moved.trial.startSource).toBe('corrected');
    expect(run(script, revertTrialStart(two)).trial.startSource).toBe('auto');

    const forced = setStrategyOverride(frozen(NO_CORRECTIONS), 'serial', 'walked the ring', meta());
    const again = setStrategyOverride(frozen(forced), 'random', '', meta());
    expect(again.entries).toHaveLength(1);
    expect(strategyOverride(again)?.strategy).toBe('random');
    const overridden = run(script, frozen(again));
    expect(overridden.metrics.strategy).toBe('random');
    expect(overridden.metrics.strategySource).toBe('corrected');
    expect(run(script, revertStrategyOverride(again)).metrics.strategySource).toBe('auto');
    expect(revertStrategyOverride(NO_CORRECTIONS)).toBe(NO_CORRECTIONS);

    // D63: the confirmed non-escape is the same shape — one entry per video, keeping its id
    const said = setNoEscape(frozen(NO_CORRECTIONS), 'never went in', meta());
    const resaid = setNoEscape(frozen(said), 'watched it twice', meta());
    expect(resaid.entries).toHaveLength(1);
    expect(noEscapeCorrection(resaid)?.reason).toBe('watched it twice');
    expect(noEscapeCorrection(resaid)?.id).toBe(said.entries[0]!.id);
    expect(noEscapeCorrection(revertNoEscape(resaid))).toBeNull();
    expect(revertNoEscape(NO_CORRECTIONS)).toBe(NO_CORRECTIONS);
  });
});

describe('describeCorrection', () => {
  it('says what each entry did, in words', () => {
    const m = meta();
    expect(describeCorrection(setPoint(NO_CORRECTIONS, 4, 'nose', { x: 1.25, y: 2, confidence: 1, valid: true }, m).entries[0]!)).toBe(
      'Nose placed by hand on frame 4 at (1.3, 2.0) px',
    );
    expect(describeCorrection(setPoint(NO_CORRECTIONS, 4, 'centroid', { x: 0, y: 0, confidence: 0, valid: false }, m).entries[0]!)).toBe(
      'Centroid marked invalid on frame 4',
    );
    expect(describeCorrection(markRange(NO_CORRECTIONS, 'not_visible', 3, 9, m).entries[0]!)).toBe(
      'Animal not visible, frames 3–9',
    );
    expect(describeCorrection(addEvent(NO_CORRECTIONS, 12, 30, 40, m).entries[0]!)).toBe(
      'Investigation added at hole 12, frames 30–40',
    );
    expect(describeCorrection(editEvent(NO_CORRECTIONS, 'auto-investigation-h12-f30', { holeIndex: 13 }, m).entries[0]!)).toBe(
      'Event auto-investigation-h12-f30 edited: hole → 13',
    );
    expect(describeCorrection(deleteEvent(NO_CORRECTIONS, 'auto-investigation-h12-f30', m).entries[0]!)).toBe(
      'Event auto-investigation-h12-f30 deleted',
    );
    expect(describeCorrection(setTrialStart(NO_CORRECTIONS, 150, m).entries[0]!)).toBe(
      'Trial start moved to frame 150',
    );
    expect(describeCorrection(setStrategyOverride(NO_CORRECTIONS, 'serial', 'walked the ring', m).entries[0]!)).toBe(
      'Strategy set to serial by hand: walked the ring',
    );
    expect(describeCorrection(setNoEscape(NO_CORRECTIONS, 'sat on the platform', m).entries[0]!)).toBe(
      'Confirmed: the animal never entered the escape box: sat on the platform',
    );
  });
});
