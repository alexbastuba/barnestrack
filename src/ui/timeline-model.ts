// Adapted from talmolab/vibes/event-annotator (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * The row model of the review timeline (D24, D26): what each stacked track
 * shows, derived from `auto ⊕ corrections` and never stored. Borrowed from
 * event-annotator: rows are a pure function of a flat event list, so a redraw
 * cannot disagree with the data. Re-implemented over the analysis result —
 * detection-state runs, nose confidence, event bars with the hole number as
 * text, correction marks, trial markers — with every distinction carried by
 * shape and words as well as colour.
 */
import type { DerivedAnalysis } from '../analysis/derive.js';
import type { EventRecord } from '../contracts/events.js';
import type { CorrectionsLayer } from '../contracts/session.js';
import type { DetectionState } from '../contracts/track.js';
import { describeCorrection } from '../session/corrections.js';
import { stateRuns, type StateRun } from '../viz/quality-strip.js';

export interface EventBar {
  id: string;
  kind: EventRecord['kind'];
  holeIndex: number | null;
  isTarget: boolean;
  startFrame: number;
  endFrame: number;
  /** The text on the bar: the hole number, `T<n>` for the target, `entry`, or `?` for a failure. */
  label: string;
  corrected: boolean;
  /** An entry-shaped run at a non-target hole: flagged for review. */
  unlikely: boolean;
}

export interface CorrectionMark {
  id: string;
  kind: 'point' | 'range' | 'event' | 'trial_start' | 'strategy_override';
  startFrame: number;
  endFrame: number;
  label: string;
}

export interface FlaggedFrame {
  frame: number;
  code: string;
  message: string;
}

export interface TimelineModel {
  frameCount: number;
  frameTimes: Float64Array;
  stateRuns: StateRun[];
  /** Nose heading confidence per frame, 0–1; NaN where the nose is invalid. */
  noseConfidence: Float32Array;
  noseCorrected: Uint8Array;
  centroidCorrected: Uint8Array;
  centroidFilled: Uint8Array;
  events: EventBar[];
  corrections: CorrectionMark[];
  trialStart: number | null;
  trialEnd: number | null;
  endReason: DerivedAnalysis['trial']['endReason'];
  cutoffFrame: number | null;
  flagged: FlaggedFrame[];
}

export function eventLabel(ev: Pick<EventRecord, 'kind' | 'holeIndex' | 'isTarget'>): string {
  if (ev.kind === 'escape_entry') return 'entry';
  if (ev.kind === 'tracking_failure') return ev.holeIndex === null ? '? lost' : `? lost at ${ev.holeIndex}`;
  return ev.isTarget ? `T${ev.holeIndex}` : String(ev.holeIndex);
}

const AUTO_EVENT_ID = /^auto-(?:investigation|escape_entry|tracking_failure)-h(?:\d+|x)-f(\d+)$/;

export function timelineModel(analysis: DerivedAnalysis, corrections: CorrectionsLayer): TimelineModel {
  const track = analysis.cleanedTrack;
  const n = track.length;
  const frameTimes = new Float64Array(n);
  const noseConfidence = new Float32Array(n);
  const noseCorrected = new Uint8Array(n);
  const centroidCorrected = new Uint8Array(n);
  const centroidFilled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = track[i]!;
    frameTimes[i] = f.t_s;
    noseConfidence[i] = f.nose.valid ? f.noseHeadingConfidence : Number.NaN;
    noseCorrected[i] = f.nose.source === 'corrected' ? 1 : 0;
    centroidCorrected[i] = f.centroid.source === 'corrected' ? 1 : 0;
    centroidFilled[i] = f.centroid.source === 'filled' ? 1 : 0;
  }

  const events: EventBar[] = analysis.events.map((ev) => ({
    id: ev.id,
    kind: ev.kind,
    holeIndex: ev.holeIndex,
    isTarget: ev.isTarget,
    startFrame: ev.startFrame,
    endFrame: ev.endFrame,
    label: eventLabel(ev),
    corrected: ev.source === 'corrected',
    unlikely: ev.evidence.startsWith('Physically unlikely'),
  }));

  const byId = new Map(analysis.events.map((ev) => [ev.id, ev]));
  const marks: CorrectionMark[] = [];
  for (const entry of corrections.entries) {
    const label = describeCorrection(entry);
    switch (entry.kind) {
      case 'point':
        marks.push({ id: entry.id, kind: 'point', startFrame: entry.frameIndex, endFrame: entry.frameIndex, label });
        break;
      case 'range':
        marks.push({ id: entry.id, kind: 'range', startFrame: entry.startFrame, endFrame: entry.endFrame, label });
        break;
      case 'trial_start':
        marks.push({ id: entry.id, kind: 'trial_start', startFrame: entry.frameIndex, endFrame: entry.frameIndex, label });
        break;
      case 'strategy_override': {
        // no frame of its own: shown at the trial start, where the classification begins
        const at = analysis.trial.startFrame ?? 0;
        marks.push({ id: entry.id, kind: 'strategy_override', startFrame: at, endFrame: at, label });
        break;
      }
      case 'event': {
        const resulting =
          entry.action === 'add' ? byId.get(`user-${entry.id}`) : entry.eventId ? byId.get(entry.eventId) : undefined;
        let start = resulting?.startFrame ?? entry.startFrame;
        let end = resulting?.endFrame ?? entry.endFrame ?? start;
        if (start === undefined) {
          const m = entry.eventId ? AUTO_EVENT_ID.exec(entry.eventId) : null;
          start = m ? Number(m[1]) : 0;
          end = start;
        }
        marks.push({ id: entry.id, kind: 'event', startFrame: start, endFrame: end ?? start, label });
        break;
      }
    }
  }
  marks.sort((a, b) => a.startFrame - b.startFrame);

  const flagged: FlaggedFrame[] = analysis.reviewFlags
    .filter((f) => f.frameIndex !== undefined)
    .map((f) => ({ frame: f.frameIndex!, code: f.code, message: f.message }));

  return {
    frameCount: n,
    frameTimes,
    stateRuns: stateRuns(track),
    noseConfidence,
    noseCorrected,
    centroidCorrected,
    centroidFilled,
    events,
    corrections: marks,
    trialStart: analysis.trial.startFrame,
    trialEnd: analysis.trial.endFrame,
    endReason: analysis.trial.endReason,
    cutoffFrame: analysis.trial.cutoffFrame,
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Navigation: flagged runs and events
// ---------------------------------------------------------------------------

export interface FrameSpan {
  startFrame: number;
  endFrame: number;
}

export interface FlaggedRun extends FrameSpan {
  reason: string;
}

const STATE_WORDS: Record<DetectionState, string> = {
  tracked: 'tracked',
  not_detected: 'not detected',
  ambiguous: 'ambiguous',
  low_confidence: 'low confidence',
};

/**
 * Where a reviewer should look: every run of frames inside the trial whose
 * state is not `tracked`, plus every frame a review flag names, in frame
 * order. Touching runs of one reason merge.
 */
export function flaggedRuns(model: TimelineModel): FlaggedRun[] {
  const lo = model.trialStart ?? 0;
  const hi = model.trialEnd ?? model.frameCount - 1;
  const runs: FlaggedRun[] = [];
  for (const run of model.stateRuns) {
    if (run.state === 'tracked' || run.endFrame < lo || run.startFrame > hi) continue;
    runs.push({
      startFrame: Math.max(lo, run.startFrame),
      endFrame: Math.min(hi, run.endFrame),
      reason: STATE_WORDS[run.state],
    });
  }
  for (const f of model.flagged) runs.push({ startFrame: f.frame, endFrame: f.frame, reason: f.message });
  runs.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  return runs;
}

/** The next span whose start lies strictly after `frame` (direction 1), or the last one starting strictly before it (−1). */
export function nextSpan<T extends FrameSpan>(spans: readonly T[], frame: number, direction: 1 | -1): T | null {
  if (direction === 1) {
    for (const span of spans) if (span.startFrame > frame) return span;
    return null;
  }
  let best: T | null = null;
  for (const span of spans) if (span.startFrame < frame) best = span;
  return best;
}

/** The first event that contains the frame, or null. */
export function eventAtFrame(events: readonly EventBar[], frame: number): EventBar | null {
  for (const ev of events) if (ev.startFrame <= frame && frame <= ev.endFrame) return ev;
  return null;
}

/** The state run that contains the frame, or null. */
export function stateAtFrame(runs: readonly StateRun[], frame: number): StateRun | null {
  for (const run of runs) if (run.startFrame <= frame && frame <= run.endFrame) return run;
  return null;
}
