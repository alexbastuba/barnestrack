/**
 * Formatting for the Review step: the metrics card rows, the numbers as they
 * are printed, and the frame each metric seeks to when clicked (D19 · F3).
 * Pure, tested in Node; the DOM half is `review-step.ts`.
 */
import type { DerivedAnalysis } from '../analysis/derive.js';
import { firstTargetEvent } from '../analysis/metrics.js';
import { METRIC_DECISIONS, METRIC_DEFINITIONS, isRecorded, type MetricKey } from '../analysis/parameters.js';
import type { TrialMetrics } from '../contracts/metrics.js';

export function formatSeconds(value: number | null | undefined, digits = 2): string {
  return isRecorded(value) ? `${value.toFixed(digits)} s` : '—';
}

export function formatCm(value: number | null | undefined, digits = 1): string {
  return isRecorded(value) ? `${value.toFixed(digits)} cm` : '—';
}

export function formatSpeed(value: number | null | undefined): string {
  return isRecorded(value) ? `${value.toFixed(2)} cm/s` : '—';
}

export function formatPercentage(fraction: number | null | undefined): string {
  return isRecorded(fraction) ? `${(fraction * 100).toFixed(1)} %` : '—';
}

/** `frame 412 · 13.733 s`. */
export function formatFrameTime(frame: number, t_s: number): string {
  return `frame ${frame} · ${t_s.toFixed(3)} s`;
}

/** Which frame a metric's value is defined at, for click-to-seek. */
export type MetricSeek = 'trialStart' | 'firstTarget' | 'escape' | 'firstError' | 'trialEnd' | null;

export interface MetricRow {
  key: MetricKey;
  label: string;
  seek: MetricSeek;
}

export const METRIC_ROWS: readonly MetricRow[] = [
  { key: 'trialStart_s', label: 'Trial start', seek: 'trialStart' },
  { key: 'primaryLatency_s', label: 'Primary latency', seek: 'firstTarget' },
  { key: 'totalLatency_s', label: 'Total latency', seek: 'escape' },
  { key: 'primaryErrors', label: 'Primary errors', seek: 'firstError' },
  { key: 'totalErrors', label: 'Total errors', seek: 'firstError' },
  { key: 'pathLength_cm', label: 'Path length', seek: 'trialStart' },
  { key: 'pathLengthSmoothed_cm', label: 'Path length, smoothed', seek: 'trialStart' },
  { key: 'meanSpeed_cmPerS', label: 'Mean speed', seek: 'trialStart' },
  { key: 'targetQuadrantTime_s', label: 'Time in the target quadrant', seek: 'trialStart' },
  { key: 'escaped', label: 'Escaped', seek: 'escape' },
  { key: 'status', label: 'Status', seek: 'trialEnd' },
  { key: 'trackedFraction', label: 'Tracked fraction (trial)', seek: 'trialStart' },
  { key: 'correctionCount', label: 'Corrections', seek: null },
];

export function metricDefinition(key: MetricKey): { text: string; decision: string } {
  return { text: METRIC_DEFINITIONS[key], decision: METRIC_DECISIONS[key] };
}

/** The value of one metric as the card prints it. */
export function metricValueText(metrics: TrialMetrics, key: MetricKey): string {
  const value = metrics[key];
  switch (key) {
    case 'trialStart_s':
    case 'primaryLatency_s':
    case 'totalLatency_s':
    case 'targetQuadrantTime_s':
      return formatSeconds(value as number | null);
    case 'pathLength_cm':
    case 'pathLengthSmoothed_cm':
      return formatCm(value as number);
    case 'meanSpeed_cmPerS':
      return formatSpeed(value as number | null);
    case 'trackedFraction':
      return formatPercentage(value as number);
    case 'escaped':
    case 'noEscapeConfirmed':
      return value ? 'yes' : 'no';
    case 'primaryErrors':
    case 'totalErrors':
    case 'correctionCount':
      return String(value);
    case 'strategy':
    case 'strategySource':
    case 'status':
      return String(value);
  }
}

/** The frame a metric is defined at, or null when there is none to show. */
export function seekFrameFor(seek: MetricSeek, analysis: DerivedAnalysis): number | null {
  switch (seek) {
    case 'trialStart':
      return analysis.trial.startFrame;
    case 'trialEnd':
      return analysis.trial.endFrame;
    case 'firstTarget':
      return firstTargetEvent(analysis.events)?.startFrame ?? null;
    case 'escape':
      // The entry that ended the trial, not the first entry-shaped run at the target.
      return analysis.trial.endReason === 'escape' ? analysis.trial.endFrame : null;
    case 'firstError': {
      const error = analysis.events.find((e) => e.kind === 'investigation' && !e.isTarget);
      return error?.startFrame ?? null;
    }
    case null:
      return null;
  }
}
