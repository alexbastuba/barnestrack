/**
 * Per-trial metrics computed as pure functions over `auto ⊕ corrections`.
 * D11, D22, O2, O3, O6, O9, O15.
 *
 * A number that cannot be established is `null` (D66): every measure taken
 * over the trial window is `null` when the trial is `unresolved` (no window),
 * never `0` and never `NaN`. A legitimate zero stays a zero.
 */
import type { SearchStrategy } from './session.js';

export type TrialStatus = 'ok' | 'review' | 'unresolved';

export interface TrialMetrics {
  /** null when no trial start could be proposed (O5, D55). */
  trialStart_s: number | null;
  /** null when the animal never reaches the target hole (O3). */
  primaryLatency_s: number | null;
  /** null when the trial is cut off before escape (O5). */
  totalLatency_s: number | null;
  /** null with no trial window (D66); 0 when a resolved trial had no non-target investigation. */
  primaryErrors: number | null;
  totalErrors: number | null;
  /** null with no trial window (D66). */
  pathLength_cm: number | null;
  pathLengthSmoothed_cm: number | null;
  /** null when the trial has no tracked time to divide by, or no window (O9, D55, D66). */
  meanSpeed_cmPerS: number | null;
  /** null with no trial window (D66). */
  targetQuadrantTime_s: number | null;
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  /** null for a probe trial, which has no escape box (D68); never false there (D66). */
  escaped: boolean | null;
  /**
   * A human has recorded "the animal never entered the escape box" (D63). It
   * reports the correction being in force, not that it holds: a confirmation
   * contradicted by a later escape entry is still true here, with `status`
   * review beside it — and `escaped` true only when that entry ended the trial,
   * since an entry too short to be persistent contradicts the confirmation
   * without making the trial an escape. null for a probe trial (D68).
   */
  noEscapeConfirmed: boolean | null;
  status: TrialStatus;
  /** Fraction of the trial with detectionState 'tracked'; null with no trial window (D66). */
  trackedFraction: number | null;
  correctionCount: number;
}
