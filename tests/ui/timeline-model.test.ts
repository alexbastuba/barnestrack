/**
 * The timeline's row model (D24, D26): derived from `auto ⊕ corrections`,
 * with the hole number as text on every event bar, corrected items marked,
 * and the flagged runs a reviewer steps through with [ and ].
 */
import { describe, expect, it } from 'vitest';
import { derive, type DeriveInput } from '../../src/analysis/derive.js';
import { DEFAULT_PARAMETERS, hashTrackingParameters } from '../../src/analysis/parameters.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';
import { NO_CORRECTIONS, editEvent, markRange, setPoint, setStrategyOverride } from '../../src/session/corrections.js';
import {
  assertPositionsAreFrameIndices,
  eventAtFrame,
  eventLabel,
  flaggedRuns,
  nextSpan,
  stateAtFrame,
  timelineModel,
  unlikelyEventIds,
} from '../../src/ui/timeline-model.js';
import { TEST_RESOLUTION, testGeometry, testMazeMap } from '../analysis/maze-fixture.js';
import { scriptTrack, visitHoles, type Segment } from '../analysis/synthetic-track.js';

const g = testGeometry(); // target 7
const meta = (n: number) => ({ id: `c${n}`, timestamp: `2026-09-07T10:00:${String(n).padStart(2, '0')}.000Z` });

function build(segments: Segment[], corrections: CorrectionsLayer = NO_CORRECTIONS) {
  const scripted = scriptTrack(segments, { g });
  const input: DeriveInput = {
    videoId: 'vid',
    auto: { parametersHash: hashTrackingParameters(DEFAULT_PARAMETERS.tracking), frames: scripted.frames },
    corrections,
    mazeMap: testMazeMap(),
    mazeTransform: IDENTITY_TRANSFORM,
    index: { width: TEST_RESOLUTION.width, height: TEST_RESOLUTION.height },
    parameters: DEFAULT_PARAMETERS,
  };
  const analysis = derive(input);
  return { analysis, model: timelineModel(analysis, corrections), segmentStarts: scripted.segmentStarts };
}

const script: Segment[] = [
  { kind: 'empty', seconds: 0.5 },
  ...visitHoles([3, 5]),
  { kind: 'lost', seconds: 0.3 }, // a gap in the open: flagged, not an event
  ...visitHoles([7]),
  { kind: 'dwell', hole: 7, seconds: 2, state: 'low_confidence', reason: 'small_blob' },
];

describe('timelineModel', () => {
  it('reads the "physically unlikely" mark from the review flag, so a corrected event keeps it', () => {
    // A two-second head-in-hole run at a non-target hole: entry-shaped, flagged (O4).
    const unlikelyScript: Segment[] = [
      { kind: 'empty', seconds: 0.5 },
      { kind: 'moveToHole', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 0.5 },
      { kind: 'dwell', hole: 3, seconds: 2, state: 'low_confidence', reason: 'small_blob' },
      { kind: 'dwell', hole: 3, seconds: 0.3 },
      { kind: 'moveToCentre', seconds: 0.5 },
      ...visitHoles([5]),
    ];
    const { model, analysis } = build(unlikelyScript);
    const flagged = analysis.reviewFlags.filter((f) => f.code === 'physically_unlikely_entry');
    expect(flagged).toHaveLength(1);
    const target = model.events.find((e) => e.id === flagged[0]!.eventId)!;
    expect(target.unlikely).toBe(true);
    expect(unlikelyEventIds(analysis)).toEqual(new Set([target.id]));

    // Retimed by one frame: the evidence is rewritten, the flag and the mark stay.
    const auto = analysis.events.find((e) => e.id === target.id)!;
    const corrections = editEvent(
      NO_CORRECTIONS,
      auto.id,
      { holeIndex: auto.holeIndex ?? undefined, startFrame: auto.startFrame, endFrame: auto.endFrame + 1 },
      meta(1),
    );
    const edited = build(unlikelyScript, corrections);
    const bar = edited.model.events.find((e) => e.startFrame === auto.startFrame)!;
    expect(bar.corrected).toBe(true);
    expect(bar.unlikely).toBe(true);
    expect(edited.analysis.events.find((e) => e.id === bar.id)!.evidence.startsWith('Physically unlikely')).toBe(false);
  });

  it('refuses a track whose frame indices are not positions', () => {
    expect(() => assertPositionsAreFrameIndices([{ frameIndex: 0 }, { frameIndex: 1 }])).not.toThrow();
    expect(() => assertPositionsAreFrameIndices([{ frameIndex: 0 }, { frameIndex: 2 }])).toThrow(/frame 1 at position 1 but found frame 2/);
  });

  it('labels every event bar with text and carries the trial markers', () => {
    const { model, analysis } = build(script);
    expect(model.frameCount).toBe(analysis.cleanedTrack.length);
    expect(model.events.map((e) => e.label)).toEqual(['3', '5', 'T7', 'entry']);
    expect(model.events.every((e) => !e.corrected)).toBe(true);
    expect(model.trialStart).toBe(analysis.trial.startFrame);
    expect(model.trialEnd).toBe(analysis.trial.endFrame);
    expect(model.endReason).toBe('escape');
    expect(model.stateRuns[0]!.state).toBe('not_detected');
    expect(model.corrections).toEqual([]);
    expect(eventLabel({ kind: 'tracking_failure', holeIndex: null, isTarget: false })).toBe('? lost');
    expect(eventLabel({ kind: 'tracking_failure', holeIndex: 4, isTarget: false })).toBe('? lost at 4');
  });

  it('marks corrected events and lists every correction as a mark with a sentence', () => {
    const plain = build(script);
    const five = plain.analysis.events.find((e) => e.holeIndex === 5)!;
    let layer = editEvent(NO_CORRECTIONS, five.id, { holeIndex: 6, startFrame: five.startFrame, endFrame: five.endFrame }, meta(1));
    layer = setPoint(layer, 40, 'nose', { x: 300, y: 240, confidence: 1, valid: true }, meta(2));
    layer = markRange(layer, 'not_visible', 200, 210, meta(3));
    layer = setStrategyOverride(layer, 'serial', 'walked the ring', meta(4));
    const { model, analysis } = build(script, layer);
    const relabelled = model.events.find((e) => e.id === five.id)!;
    expect(relabelled.label).toBe('6');
    expect(relabelled.corrected).toBe(true);
    expect(model.corrections).toHaveLength(4);
    const byKind = Object.fromEntries(model.corrections.map((m) => [m.kind, m]));
    expect(byKind['point']).toMatchObject({ startFrame: 40, endFrame: 40 });
    expect(byKind['range']).toMatchObject({ startFrame: 200, endFrame: 210 });
    expect(byKind['event']).toMatchObject({ startFrame: five.startFrame, endFrame: five.endFrame });
    expect(byKind['strategy_override']).toMatchObject({ startFrame: analysis.trial.startFrame });
    expect(byKind['event']!.label).toContain('hole → 6');
    expect(model.noseCorrected[40]).toBe(1);
    expect(model.centroidCorrected[40]).toBe(0);
    // marks are in frame order
    for (let i = 1; i < model.corrections.length; i++) {
      expect(model.corrections[i]!.startFrame).toBeGreaterThanOrEqual(model.corrections[i - 1]!.startFrame);
    }
  });

  it('finds flagged runs inside the trial and steps through them and the events', () => {
    const { model, segmentStarts, analysis } = build(script);
    const runs = flaggedRuns(model);
    // the empty start is before the trial and does not count; the gap and the small-blob run do
    expect(runs.some((r) => r.startFrame < analysis.trial.startFrame!)).toBe(false);
    const gap = runs.find((r) => r.startFrame === segmentStarts[5]);
    expect(gap?.reason).toBe('not detected');
    expect(runs.some((r) => r.reason === 'low confidence')).toBe(true);
    expect(nextSpan(runs, 0, 1)?.startFrame).toBe(runs[0]!.startFrame);
    expect(nextSpan(runs, runs[0]!.startFrame, 1)?.startFrame).toBe(runs[1]!.startFrame);
    expect(nextSpan(runs, runs[1]!.startFrame, -1)?.startFrame).toBe(runs[0]!.startFrame);
    expect(nextSpan(runs, 0, -1)).toBeNull();
    expect(nextSpan(model.events, 0, 1)?.label).toBe('3');
    expect(nextSpan(model.events, model.frameCount, 1)).toBeNull();
    expect(eventAtFrame(model.events, model.events[1]!.startFrame)?.label).toBe('5');
    expect(eventAtFrame(model.events, 0)).toBeNull();
    expect(stateAtFrame(model.stateRuns, 0)?.state).toBe('not_detected');
  });
});
