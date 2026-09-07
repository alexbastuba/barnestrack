/**
 * Trial bounds (O5, D21). The start is proposed from the track and shown as a
 * marker the user can move; the end is the first persistent escape-box
 * entry, the cutoff, or the end of the video. Every latency is measured
 * from the start, never from frame 0.
 */
import type { CorrectionsLayer } from '../contracts/session.js';
import type { TrackFrame } from '../contracts/track.js';
import { latestCorrection } from './corrections.js';
import { ANALYSIS_MODEL } from './parameters.js';
import { STATE_CODE, framePosition, type TrackArrays } from './track-arrays.js';
import type { ReviewFlag } from './types.js';

/** The tracker's reason for a start cylinder or an experimenter's hand (D6, D8). */
export const OVERSIZED_REASON = 'oversized_blob';

export type TrialEndReason = 'escape' | 'cutoff' | 'end_of_video' | 'no_start';

export interface TrialStartProposal {
  /** Frame position of the trial start, or null when nothing was ever confidently tracked. */
  startFrame: number | null;
  source: 'auto' | 'corrected';
  autoStartFrame: number | null;
  /** The last oversized-foreground frame before the automatic start, or -1. */
  lastOversizedFrame: number;
  flags: ReviewFlag[];
}

export interface TrialBounds {
  startFrame: number | null;
  /** NaN without a start. */
  startTime_s: number;
  startSource: 'auto' | 'corrected';
  autoStartFrame: number | null;
  lastOversizedFrame: number;
  /** Last frame within `trialCutoff_s` of the start; null without a start. */
  cutoffFrame: number | null;
  endFrame: number | null;
  /** NaN without a start. */
  endTime_s: number;
  endReason: TrialEndReason;
}

/**
 * O5: the first frame tracked (confident, mouse-sized) with its centroid
 * inside the platform, after every oversized-foreground frame that precedes
 * it. Oversized frames later in the video (a hand retrieving the animal) do
 * not move the start; those inside the trial are flagged by the caller.
 * A trial-start correction overrides the proposal.
 */
export function proposeTrialStart(
  frames: readonly TrackFrame[],
  a: TrackArrays,
  corrections: CorrectionsLayer,
): TrialStartProposal {
  const flags: ReviewFlag[] = [];
  let autoStartFrame: number | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a.state[i] === STATE_CODE.tracked && a.inPlatform[i] === 1) {
      autoStartFrame = i;
      break;
    }
  }
  let lastOversizedFrame = -1;
  const limit = autoStartFrame ?? a.length;
  for (let i = 0; i < limit; i++) {
    if (frames[i]!.reason === OVERSIZED_REASON) lastOversizedFrame = i;
  }
  const correction = latestCorrection(corrections.entries, 'trial_start');
  if (correction === null) {
    return {
      startFrame: autoStartFrame,
      source: 'auto',
      autoStartFrame,
      lastOversizedFrame,
      flags,
    };
  }
  let startFrame = Number.isInteger(correction.frameIndex)
    ? framePosition(frames, correction.frameIndex)
    : -1;
  if (startFrame < 0) {
    const clamped = Math.min(
      Math.max(0, Math.round(correction.frameIndex)),
      Math.max(0, a.length - 1),
    );
    flags.push({
      code: 'correction_out_of_range',
      correctionId: correction.id,
      frameIndex: correction.frameIndex,
      message: `Trial-start correction ${correction.id} names frame ${correction.frameIndex}, outside this track of ${a.length} frames; using frame ${clamped}.`,
    });
    startFrame = clamped;
  }
  if (a.length === 0) {
    return { startFrame: null, source: 'corrected', autoStartFrame, lastOversizedFrame, flags };
  }
  return { startFrame, source: 'corrected', autoStartFrame, lastOversizedFrame, flags };
}

/** The last frame whose timestamp is within `trialCutoff_s` of the start frame's (to the cutoff tolerance). */
export function cutoffFrame(a: TrackArrays, startFrame: number, trialCutoff_s: number): number {
  const limit = a.t[startFrame]! + trialCutoff_s + ANALYSIS_MODEL.cutoffTolerance_s;
  let last = startFrame;
  for (let i = startFrame + 1; i < a.length; i++) {
    if (a.t[i]! <= limit) last = i;
    else break;
  }
  return last;
}

export function resolveTrialEnd(
  a: TrackArrays,
  startFrame: number | null,
  cutoff: number | null,
  persistentEscapeStartFrame: number | null,
): { endFrame: number | null; endReason: TrialEndReason } {
  if (startFrame === null || cutoff === null) return { endFrame: null, endReason: 'no_start' };
  // an entry can end the trial only inside it: not before the start (D21) and not after the cutoff (O5)
  if (
    persistentEscapeStartFrame !== null &&
    persistentEscapeStartFrame >= startFrame &&
    persistentEscapeStartFrame <= cutoff
  ) {
    return { endFrame: persistentEscapeStartFrame, endReason: 'escape' };
  }
  if (cutoff < a.length - 1) return { endFrame: cutoff, endReason: 'cutoff' };
  return { endFrame: cutoff, endReason: 'end_of_video' };
}

export function trialBounds(
  a: TrackArrays,
  proposal: TrialStartProposal,
  cutoff: number | null,
  end: { endFrame: number | null; endReason: TrialEndReason },
): TrialBounds {
  const startFrame = proposal.startFrame;
  return {
    startFrame,
    startTime_s: startFrame === null ? Number.NaN : a.t[startFrame]!,
    startSource: proposal.source,
    autoStartFrame: proposal.autoStartFrame,
    lastOversizedFrame: proposal.lastOversizedFrame,
    cutoffFrame: cutoff,
    endFrame: end.endFrame,
    endTime_s: end.endFrame === null ? Number.NaN : a.t[end.endFrame]!,
    endReason: end.endReason,
  };
}
