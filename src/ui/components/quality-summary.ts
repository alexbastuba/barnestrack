/**
 * The one whole-clip number the quality panel prints that `QualityReport` has
 * no field for.
 *
 * D54's three numbers — `positionedFraction`, `wholeClipPositionedFraction` and
 * `noseJudgedEventFraction` — are contract fields now, computed once in
 * `src/analysis/quality.ts` and written to `quality.csv`, so the panel reads
 * them rather than deriving its own. What remains here is the per-state
 * whole-clip breakdown the panel shows beside each trial-window state, which
 * is a comparison the report does not carry.
 *
 * Pure over the derived layer: no DOM, so it is tested like the analysis code.
 */
import type { DetectionState, Track } from '../../contracts/track.js';

/**
 * Fractions of the whole clip by detection state, beside the trial-window ones
 * from `QualityReport.detectionStateFractions`. NaN for an empty track,
 * following the analysis engine's own convention for "not computable" rather
 * than reporting a confident zero.
 */
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
