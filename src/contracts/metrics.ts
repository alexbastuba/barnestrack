/**
 * Per-trial metrics computed as pure functions over `auto ⊕ corrections`.
 * D11, D22, O2, O3, O6, O9, O15.
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
  primaryErrors: number;
  totalErrors: number;
  pathLength_cm: number;
  pathLengthSmoothed_cm: number;
  /** null when the trial has no tracked time to divide by (O9, D55). */
  meanSpeed_cmPerS: number | null;
  targetQuadrantTime_s: number;
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  escaped: boolean;
  /**
   * A human has recorded "the animal never entered the escape box" (D63). It
   * reports the correction being in force, not that it holds: a confirmation
   * contradicted by a later escape entry is still true here, with `escaped`
   * true and `status` review beside it.
   */
  noEscapeConfirmed: boolean;
  status: TrialStatus;
  /** Fraction of the trial with detectionState 'tracked'. */
  trackedFraction: number;
  correctionCount: number;
}
