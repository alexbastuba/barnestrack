/**
 * Per-trial metrics (O2, O3, O4, O5, O9, O15) as a pure function over the
 * final event list, the trial bounds and the kinematics. Tracking failures
 * never count toward errors, latency or escape (O4).
 */
import type { EventRecord } from '../contracts/events.js';
import type { TrialMetrics } from '../contracts/metrics.js';
import type { Parameters } from '../contracts/parameters.js';
import type { SearchStrategy } from '../contracts/session.js';
import type { KinematicsSummary } from './kinematics.js';
import { isRecorded } from './parameters.js';
import { STATE_CODE, type TrackArrays } from './track-arrays.js';
import type { TrialBounds } from './trial.js';
import type { ReviewFlag } from './types.js';

export interface MetricsInput {
  bounds: TrialBounds;
  events: readonly EventRecord[];
  flags: readonly ReviewFlag[];
  kinematics: KinematicsSummary;
  /** The cleaned track as arrays. */
  a: TrackArrays;
  strategy: { strategy: SearchStrategy; strategySource: 'auto' | 'corrected' };
  correctionCount: number;
  parameters: Parameters;
}

/** A persistent entry lasts to the end of the video or at least the persist cutoff (O4). */
export function isPersistentEscape(
  ev: EventRecord,
  lastFrameIndex: number,
  p: Parameters,
): boolean {
  return (
    ev.kind === 'escape_entry' &&
    (ev.endFrame >= lastFrameIndex || ev.durationSeconds >= p.escapeEntry.persistCutoff_s)
  );
}

/** The first target event (investigation or persistent-or-not escape entry) in time order, or null. */
export function firstTargetEvent(events: readonly EventRecord[]): EventRecord | null {
  let best: EventRecord | null = null;
  for (const ev of events) {
    if (!ev.isTarget || ev.kind === 'tracking_failure') continue;
    if (best === null || ev.startFrame < best.startFrame) best = ev;
  }
  return best;
}

export function computeMetrics(input: MetricsInput): TrialMetrics {
  const { bounds, events, flags, kinematics, a, strategy, correctionCount, parameters } = input;
  const start = bounds.startFrame;
  const end = bounds.endFrame;
  const noTrial = start === null || end === null;

  const escaped = bounds.endReason === 'escape';
  const totalLatency =
    escaped && !noTrial
      ? bounds.endTime_s - bounds.startTime_s
      : parameters.trialCensoring.censorToCutoff && !noTrial
        ? parameters.trialCutoff_s
        : null;

  // only events that begin inside the trial count (O2, O3): a user-added event outside it is annotation
  const inTrial = noTrial
    ? []
    : events.filter(
        (ev) => ev.startTime_s >= bounds.startTime_s && ev.startTime_s <= bounds.endTime_s,
      );
  const target = firstTargetEvent(inTrial);
  const primaryLatency =
    target === null || noTrial ? null : target.startTime_s - bounds.startTime_s;

  let primaryErrors = 0;
  let totalErrors = 0;
  for (const ev of inTrial) {
    if (ev.kind !== 'investigation' || ev.isTarget) continue;
    totalErrors++;
    if (target === null || ev.startFrame < target.startFrame) primaryErrors++;
  }

  let trackedFraction = Number.NaN;
  if (!noTrial) {
    let tracked = 0;
    for (let i = start; i <= end; i++) if (a.state[i] === STATE_CODE.tracked) tracked++;
    trackedFraction = tracked / (end - start + 1);
  }

  const status: TrialMetrics['status'] = noTrial
    ? 'unresolved'
    : flags.length > 0 || !escaped
      ? 'review'
      : 'ok';

  return {
    // a number the contract lets be null is null, not NaN, when it cannot exist (D55)
    trialStart_s: isRecorded(bounds.startTime_s) ? bounds.startTime_s : null,
    primaryLatency_s: primaryLatency,
    totalLatency_s: totalLatency,
    primaryErrors,
    totalErrors,
    pathLength_cm: kinematics.pathLength_cm,
    pathLengthSmoothed_cm: kinematics.pathLengthSmoothed_cm,
    meanSpeed_cmPerS: isRecorded(kinematics.meanSpeed_cmPerS) ? kinematics.meanSpeed_cmPerS : null,
    targetQuadrantTime_s: kinematics.targetQuadrantTime_s,
    strategy: strategy.strategy,
    strategySource: strategy.strategySource,
    escaped,
    status,
    trackedFraction,
    correctionCount,
  };
}
