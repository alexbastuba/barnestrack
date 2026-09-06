import { describe, expect, it } from 'vitest';
import type { CorrectionEntry, CorrectionsLayer } from '../../src/contracts/session.js';
import {
  IN_ESCAPE_BOX_REASON,
  NOT_VISIBLE_REASON,
  applyTrackCorrections,
  correctionsOfKind,
  latestCorrection,
  sortedCorrections,
} from '../../src/analysis/corrections.js';
import { buildTrack, deepFreeze } from './track-builder.js';

const at = (i: number): string => `2026-09-06T10:00:${String(i).padStart(2, '0')}.000Z`;

function layer(...entries: CorrectionEntry[]): CorrectionsLayer {
  return deepFreeze({ entries });
}

describe('applyTrackCorrections', () => {
  const auto = deepFreeze(
    buildTrack([
      [100, 100],
      [110, 100],
      [120, 100],
      [130, 100],
    ]),
  );

  it('replaces one named point, marks it corrected, and shares every other frame', () => {
    const { frames, flags, pointCorrections } = applyTrackCorrections(
      auto,
      layer({
        id: 'c1',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 2,
        point: 'nose',
        value: { x: 99, y: 98, confidence: 1, valid: true },
      }),
    );
    expect(flags).toEqual([]);
    expect(pointCorrections).toBe(1);
    expect(frames[2]!.nose).toEqual({
      x: 99,
      y: 98,
      confidence: 1,
      valid: true,
      source: 'corrected',
    });
    expect(frames[2]!.centroid).toBe(auto[2]!.centroid);
    expect(frames[2]!.detectionState).toBe('tracked');
    expect(frames[0]).toBe(auto[0]);
    expect(frames[1]).toBe(auto[1]);
    expect(frames[3]).toBe(auto[3]);
    expect(auto[2]!.nose.source).toBe('auto');
  });

  it('lets a point correction declare a point invalid', () => {
    const { frames } = applyTrackCorrections(
      auto,
      layer({
        id: 'c1',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 1,
        point: 'centroid',
        value: { x: 0, y: 0, confidence: 0, valid: false },
      }),
    );
    expect(frames[1]!.centroid).toEqual({
      x: 0,
      y: 0,
      confidence: 0,
      valid: false,
      source: 'corrected',
    });
  });

  it('marks a not-visible range: both points invalid, corrected, state not_detected with the reason', () => {
    const { frames, rangeCorrections } = applyTrackCorrections(
      auto,
      layer({
        id: 'r1',
        kind: 'range',
        timestamp: at(1),
        source: 'user',
        rangeType: 'not_visible',
        startFrame: 1,
        endFrame: 2,
      }),
    );
    expect(rangeCorrections).toBe(1);
    for (const i of [1, 2]) {
      expect(frames[i]!.centroid).toEqual({
        x: 0,
        y: 0,
        confidence: 0,
        valid: false,
        source: 'corrected',
      });
      expect(frames[i]!.nose).toEqual({
        x: 0,
        y: 0,
        confidence: 0,
        valid: false,
        source: 'corrected',
      });
      expect(frames[i]!.detectionState).toBe('not_detected');
      expect(frames[i]!.reason).toBe(NOT_VISIBLE_REASON);
      expect(frames[i]!.blobArea_px2).toBe(auto[i]!.blobArea_px2);
    }
    expect(frames[0]).toBe(auto[0]);
    expect(frames[3]).toBe(auto[3]);
  });

  it('marks an in-escape-box range with its own reason', () => {
    const { frames } = applyTrackCorrections(
      auto,
      layer({
        id: 'r1',
        kind: 'range',
        timestamp: at(1),
        source: 'user',
        rangeType: 'in_escape_box',
        startFrame: 3,
        endFrame: 3,
      }),
    );
    expect(frames[3]!.reason).toBe(IN_ESCAPE_BOX_REASON);
    expect(frames[3]!.centroid.valid).toBe(false);
  });

  it('applies corrections in timestamp order, not array order', () => {
    const point: CorrectionEntry = {
      id: 'p',
      kind: 'point',
      timestamp: at(5),
      source: 'user',
      frameIndex: 1,
      point: 'centroid',
      value: { x: 50, y: 60, confidence: 0.7, valid: true },
    };
    const range: CorrectionEntry = {
      id: 'r',
      kind: 'range',
      timestamp: at(2),
      source: 'user',
      rangeType: 'not_visible',
      startFrame: 0,
      endFrame: 1,
    };
    // the range is earlier: the later point wins on frame 1 and the frame keeps the range's state
    const a = applyTrackCorrections(auto, layer(point, range));
    expect(a.frames[1]!.centroid).toEqual({
      x: 50,
      y: 60,
      confidence: 0.7,
      valid: true,
      source: 'corrected',
    });
    expect(a.frames[1]!.detectionState).toBe('not_detected');
    expect(a.frames[0]!.centroid.valid).toBe(false);
    // swap the timestamps: the range is later and wins
    const b = applyTrackCorrections(
      auto,
      layer({ ...point, timestamp: at(1) }, { ...range, timestamp: at(9) }),
    );
    expect(b.frames[1]!.centroid.valid).toBe(false);
    expect(b.frames[1]!.centroid.source).toBe('corrected');
  });

  it('flags corrections outside the track instead of throwing', () => {
    const { frames, flags } = applyTrackCorrections(
      auto,
      layer(
        {
          id: 'p',
          kind: 'point',
          timestamp: at(1),
          source: 'user',
          frameIndex: 40,
          point: 'nose',
          value: { x: 1, y: 1, confidence: 1, valid: true },
        },
        {
          id: 'r',
          kind: 'range',
          timestamp: at(2),
          source: 'user',
          rangeType: 'not_visible',
          startFrame: 10,
          endFrame: 12,
        },
        {
          id: 'r2',
          kind: 'range',
          timestamp: at(3),
          source: 'user',
          rangeType: 'not_visible',
          startFrame: 3,
          endFrame: 12,
        },
      ),
    );
    expect(flags.map((f) => f.correctionId)).toEqual(['p', 'r']);
    expect(flags[0]!.code).toBe('correction_out_of_range');
    expect(flags[0]!.message).toContain('frame 40');
    // a range that starts inside the track is clamped, not dropped
    expect(frames[3]!.reason).toBe(NOT_VISIBLE_REASON);
    expect(frames.every((f, i) => i === 3 || f === auto[i])).toBe(true);
  });

  it('never mutates the automatic frames or the corrections', () => {
    const before = JSON.stringify(auto);
    const corrections = layer(
      {
        id: 'p',
        kind: 'point',
        timestamp: at(1),
        source: 'user',
        frameIndex: 0,
        point: 'centroid',
        value: { x: 1, y: 2, confidence: 1, valid: true },
      },
      {
        id: 'r',
        kind: 'range',
        timestamp: at(2),
        source: 'user',
        rangeType: 'not_visible',
        startFrame: 2,
        endFrame: 3,
      },
    );
    applyTrackCorrections(auto, corrections);
    expect(JSON.stringify(auto)).toBe(before);
  });
});

describe('correction ordering helpers', () => {
  const entries: CorrectionEntry[] = [
    { id: 'b', kind: 'trial_start', timestamp: at(3), source: 'user', frameIndex: 30 },
    { id: 'a', kind: 'trial_start', timestamp: at(3), source: 'user', frameIndex: 20 },
    {
      id: 'z',
      kind: 'strategy_override',
      timestamp: at(1),
      source: 'user',
      strategy: 'serial',
      reason: 'walked the ring',
    },
    { id: 'c', kind: 'trial_start', timestamp: at(2), source: 'user', frameIndex: 10 },
  ];

  it('sorts by timestamp then id without touching the input', () => {
    const frozen = deepFreeze([...entries]);
    expect(sortedCorrections(frozen).map((c) => c.id)).toEqual(['z', 'c', 'a', 'b']);
    expect(frozen.map((c) => c.id)).toEqual(['b', 'a', 'z', 'c']);
  });

  it('finds the latest of a kind', () => {
    expect(latestCorrection(entries, 'trial_start')?.frameIndex).toBe(30);
    expect(latestCorrection(entries, 'strategy_override')?.strategy).toBe('serial');
    expect(latestCorrection(entries, 'event')).toBeNull();
    expect(correctionsOfKind(entries, 'trial_start').map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });
});
