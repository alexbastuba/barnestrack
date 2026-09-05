/**
 * Per-trial metrics computed as pure functions over `auto ⊕ corrections`.
 * D11, D22, O2, O3, O6, O9, O15.
 */
import type { SearchStrategy } from './session.js';

export type TrialStatus = 'ok' | 'review' | 'unresolved';

export interface TrialMetrics {
  trialStart_s: number;
  /** null when the animal never reaches the target hole (O3). */
  primaryLatency_s: number | null;
  /** null when the trial is cut off before escape (O5). */
  totalLatency_s: number | null;
  primaryErrors: number;
  totalErrors: number;
  pathLength_cm: number;
  pathLengthSmoothed_cm: number;
  meanSpeed_cmPerS: number;
  targetQuadrantTime_s: number;
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  escaped: boolean;
  status: TrialStatus;
  /** Fraction of the trial with detectionState 'tracked'. */
  trackedFraction: number;
  correctionCount: number;
}
