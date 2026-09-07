import { describe, expect, it } from 'vitest';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import {
  cutoffFrame,
  proposeTrialStart,
  resolveTrialEnd,
  trialBounds,
} from '../../src/analysis/trial.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import { testGeometry } from './maze-fixture.js';
import { scriptTrack, type Segment } from './synthetic-track.js';
import { buildTrack, deepFreeze } from './track-builder.js';

const g = testGeometry();
const none: CorrectionsLayer = { entries: [] };

function propose(segments: Segment[], corrections: CorrectionsLayer = none) {
  const { frames, segmentStarts } = scriptTrack(segments, { g });
  const a = buildTrackArrays(frames, g);
  return {
    proposal: proposeTrialStart(deepFreeze(frames), a, deepFreeze(corrections)),
    segmentStarts,
    a,
  };
}

describe('proposeTrialStart (O5)', () => {
  it('starts at the first tracked frame inside the platform after the empty start and the oversized frames', () => {
    const { proposal, segmentStarts } = propose([
      { kind: 'empty', seconds: 2 },
      { kind: 'oversized', seconds: 1 },
      { kind: 'dwell', seconds: 1 },
    ]);
    expect(proposal.startFrame).toBe(segmentStarts[2]);
    expect(proposal.autoStartFrame).toBe(segmentStarts[2]);
    expect(proposal.lastOversizedFrame).toBe(segmentStarts[2]! - 1);
    expect(proposal.source).toBe('auto');
    expect(proposal.flags).toEqual([]);
  });

  it('is not moved by oversized frames later in the video (a hand at the end)', () => {
    const { proposal, segmentStarts } = propose([
      { kind: 'ambiguous', seconds: 0.5 },
      { kind: 'dwell', seconds: 2 },
      { kind: 'oversized', seconds: 0.5 },
      { kind: 'dwell', seconds: 1 },
    ]);
    expect(proposal.startFrame).toBe(segmentStarts[1]);
    expect(proposal.lastOversizedFrame).toBe(-1);
  });

  it('waits for a confident (tracked) frame, not a low-confidence one', () => {
    const { proposal, segmentStarts } = propose([
      { kind: 'dwell', seconds: 0.5, state: 'low_confidence', reason: 'partial_at_rim' },
      { kind: 'dwell', seconds: 0.5 },
    ]);
    expect(proposal.startFrame).toBe(segmentStarts[1]);
  });

  it('is null when nothing was ever confidently tracked', () => {
    const { proposal } = propose([
      { kind: 'empty', seconds: 1 },
      { kind: 'ambiguous', seconds: 1 },
    ]);
    expect(proposal.startFrame).toBeNull();
    expect(proposal.autoStartFrame).toBeNull();
  });

  it('is overridden by the latest trial-start correction, keeping the automatic proposal', () => {
    const corrections: CorrectionsLayer = {
      entries: [
        {
          id: 'a',
          kind: 'trial_start',
          timestamp: '2026-09-06T10:00:02.000Z',
          source: 'user',
          frameIndex: 40,
        },
        {
          id: 'b',
          kind: 'trial_start',
          timestamp: '2026-09-06T10:00:01.000Z',
          source: 'user',
          frameIndex: 20,
        },
      ],
    };
    const { proposal } = propose(
      [
        { kind: 'empty', seconds: 2 },
        { kind: 'dwell', seconds: 1 },
      ],
      corrections,
    );
    expect(proposal.startFrame).toBe(40);
    expect(proposal.source).toBe('corrected');
    expect(proposal.autoStartFrame).toBe(60);
  });

  it('clamps a correction outside the track and flags it', () => {
    const corrections: CorrectionsLayer = {
      entries: [
        {
          id: 'a',
          kind: 'trial_start',
          timestamp: '2026-09-06T10:00:02.000Z',
          source: 'user',
          frameIndex: 999,
        },
      ],
    };
    const { proposal } = propose([{ kind: 'dwell', seconds: 1 }], corrections);
    expect(proposal.startFrame).toBe(29);
    expect(proposal.flags).toHaveLength(1);
    expect(proposal.flags[0]!.code).toBe('correction_out_of_range');
    expect(proposal.flags[0]!.message).toContain('frame 999');
  });
});

describe('trial end (O4, O5)', () => {
  const a = buildTrackArrays(buildTrack(new Array(61).fill([322, 240])), g); // 61 frames at 30 fps: 0 … 2 s

  it('cutoffFrame is the last frame within the cutoff of the start', () => {
    expect(cutoffFrame(a, 0, 1.0)).toBe(30);
    expect(cutoffFrame(a, 10, 1.0)).toBe(40);
    expect(cutoffFrame(a, 0, 180)).toBe(60);
    expect(cutoffFrame(a, 60, 1.0)).toBe(60);
  });

  it('ends at the persistent escape, else the cutoff, else the end of the video', () => {
    expect(resolveTrialEnd(a, 0, 30, 12)).toEqual({ endFrame: 12, endReason: 'escape' });
    expect(resolveTrialEnd(a, 0, 30, 45)).toEqual({ endFrame: 30, endReason: 'cutoff' });
    expect(resolveTrialEnd(a, 0, 30, null)).toEqual({ endFrame: 30, endReason: 'cutoff' });
    expect(resolveTrialEnd(a, 0, 60, null)).toEqual({ endFrame: 60, endReason: 'end_of_video' });
    expect(resolveTrialEnd(a, 0, 60, 60)).toEqual({ endFrame: 60, endReason: 'escape' });
    expect(resolveTrialEnd(a, null, null, null)).toEqual({ endFrame: null, endReason: 'no_start' });
  });

  it('trialBounds carries times, NaN without a start', () => {
    const withStart = trialBounds(
      a,
      { startFrame: 3, source: 'auto', autoStartFrame: 3, lastOversizedFrame: -1, flags: [] },
      33,
      { endFrame: 33, endReason: 'cutoff' },
    );
    expect(withStart.startTime_s).toBeCloseTo(0.1, 12);
    expect(withStart.endTime_s).toBeCloseTo(1.1, 12);
    expect(withStart.endReason).toBe('cutoff');
    const without = trialBounds(
      a,
      { startFrame: null, source: 'auto', autoStartFrame: null, lastOversizedFrame: -1, flags: [] },
      null,
      { endFrame: null, endReason: 'no_start' },
    );
    expect(Number.isNaN(without.startTime_s)).toBe(true);
    expect(Number.isNaN(without.endTime_s)).toBe(true);
    expect(without.endFrame).toBeNull();
  });
});
