/**
 * The two numbers D54 asks the quality report to state that `QualityReport`
 * has no field for.
 *
 * D54: "The headline tracked fraction, the gap list and the tier are computed
 * from trial start to trial end; **the whole-clip fraction is shown as a
 * secondary number** … the report also states **the fraction of events judged
 * on the nose** (O16)."
 *
 * `qualityReport()` computes everything over the trial window only, and the
 * contract carries neither of these two, so the panel derives them here. They
 * are therefore on screen but not in `quality.csv` — recorded in
 * docs/known-limitations.md, because a number a user can see and cannot export
 * is a gap worth naming rather than a feature.
 *
 * Pure over the derived layer: no DOM, so it is tested like the analysis code.
 */
import type { EventRecord } from '../../contracts/events.js';
import type { DetectionState, Track } from '../../contracts/track.js';

/**
 * Fraction of *every* frame in the clip whose detection state is `tracked` —
 * the secondary number D54 wants beside the trial-window one. NaN for an empty
 * track, following the analysis engine's own convention for "not computable"
 * rather than reporting a confident zero.
 */
export function wholeClipTrackedFraction(track: Track): number {
  if (track.length === 0) return Number.NaN;
  let tracked = 0;
  for (const frame of track) {
    if (frame.detectionState === 'tracked') tracked += 1;
  }
  return tracked / track.length;
}

/** Fractions of the whole clip by detection state, for the same comparison. */
export function wholeClipStateFractions(track: Track): Record<DetectionState, number> {
  const counts: Record<DetectionState, number> = {
    tracked: 0,
    not_detected: 0,
    ambiguous: 0,
    low_confidence: 0,
  };
  for (const frame of track) counts[frame.detectionState] += 1;
  const states = Object.keys(counts) as DetectionState[];
  const fractions = {} as Record<DetectionState, number>;
  for (const state of states) {
    fractions[state] = track.length === 0 ? Number.NaN : counts[state] / track.length;
  }
  return fractions;
}

/**
 * Share of events whose distance and dwell were judged on the nose rather than
 * the centroid (O16). Tracking failures are included: they are events, and
 * which point was used is as much a fact about them as about an investigation.
 *
 * NaN when there are no events — a trial with nothing to judge has no
 * proportion, and 0 % would read as "the nose was never usable".
 */
export function noseJudgedEventFraction(events: readonly EventRecord[]): number {
  if (events.length === 0) return Number.NaN;
  const nose = events.filter((event) => event.pointUsed === 'nose').length;
  return nose / events.length;
}
