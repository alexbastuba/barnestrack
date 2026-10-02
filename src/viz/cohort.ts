/**
 * What the cohort figures share: reading one metric out of every analysed
 * trial, grouping by animal or by group, and naming the metric with its unit.
 *
 * A cohort figure needs the O12 metadata — animal, day, trial, group — which
 * the user types on the Videos step and nothing parses out of a filename. When
 * it is missing the figure says so instead of drawing an empty axis.
 */
import { isRecorded } from '../analysis/parameters.js';
import type { TrialMetrics, TrialStatus } from '../contracts/metrics.js';
import type { SessionFile } from '../contracts/session.js';
import { analysedTrials } from './data.js';
import type { PlottableMetric } from './types.js';

export const METRIC_LABELS: Record<PlottableMetric, string> = {
  primaryLatency_s: 'Primary latency (s)',
  totalLatency_s: 'Total latency (s)',
  primaryErrors: 'Primary errors (count)',
  totalErrors: 'Total errors (count)',
  pathLength_cm: 'Path length (cm)',
  meanSpeed_cmPerS: 'Mean speed (cm/s)',
  targetQuadrantTime_s: 'Time in the target quadrant (s)',
};

export const DEFAULT_METRIC: PlottableMetric = 'primaryLatency_s';

export const NO_METADATA_MESSAGE =
  'Add animal, day, trial and group on the Videos step to compare trials across a cohort.';

/** Why a trial is left out of a cohort figure (D66). */
export type ExclusionReason = 'unresolved' | 'no_value';

export interface TrialPoint {
  videoId: string;
  animal: string;
  group: string;
  day: string;
  trial: string;
  /** Null when the trial has no value for this metric — never plotted as zero. */
  value: number | null;
  status: TrialStatus;
  /**
   * Null when the trial is plotted; `unresolved` when it has no trial window
   * at all, `no_value` when it has a window but no value for this measure (a
   * latency the animal never reached, a probe trial's escape).
   */
  excluded: ExclusionReason | null;
}

/** Every analysed trial that carries an animal, with the chosen metric read off. */
export function trialPoints(session: SessionFile, metric: PlottableMetric): TrialPoint[] {
  const out: TrialPoint[] = [];
  for (const { descriptor, analysis } of analysedTrials(session)) {
    const { animal, day, trial, group } = descriptor.metadata;
    if (!animal) continue;
    const metrics = analysis.derived.metrics;
    const value = readMetric(metrics, metric);
    out.push({
      videoId: descriptor.id,
      animal,
      group: group ?? 'ungrouped',
      day: day ?? '',
      trial: trial ?? '',
      value,
      status: metrics.status,
      excluded: value !== null ? null : metrics.status === 'unresolved' ? 'unresolved' : 'no_value',
    });
  }
  return out;
}

function readMetric(metrics: TrialMetrics, metric: PlottableMetric): number | null {
  const value = metrics[metric];
  return isRecorded(value) ? value : null;
}

/**
 * The exclusion sentence every cohort figure carries (D66): how many trials
 * are plotted, and why the rest are not — "n = 3 of 4; 1 unresolved".
 */
export function cohortCaption(points: readonly TrialPoint[]): string {
  const plotted = points.filter((point) => point.value !== null).length;
  const unresolved = points.filter((point) => point.excluded === 'unresolved').length;
  const noValue = points.filter((point) => point.excluded === 'no_value').length;
  let text = `n = ${plotted} of ${points.length}`;
  if (unresolved > 0) text += `; ${unresolved} unresolved`;
  if (noValue > 0) text += `; ${noValue} with no value for this measure`;
  return text;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation; 0 for fewer than two values. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Marker shapes cycled so two series differ by shape as well as colour (D26). */
export const SERIES_GLYPHS = ['disc', 'square', 'triangle', 'diamond', 'cross', 'ring'] as const;
export const SERIES_DASHES: readonly number[][] = [[], [6, 3], [2, 3], [8, 3, 2, 3]];
