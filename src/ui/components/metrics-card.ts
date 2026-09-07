/**
 * The trial's numbers, each one clickable through to the frame that decided it
 * (D19), and the strategy call with the reasoning that produced it (D23).
 *
 * Two things this card is careful about.
 *
 * *Every value says where it came from.* A latency is a claim about a moment in
 * the video, so the value is a button that goes to that moment: primary latency
 * to the first target event, total latency to the escape entry that ended the
 * trial, the path measures to the trial start. A value with no such frame — a
 * latency that does not exist, the correction count — is plain text, not a
 * button that would seek somewhere arbitrary.
 *
 * *Frame numbers are converted, not assumed.* `TrialBounds` indexes the cleaned
 * track by array position while events carry sample-table frame numbers; the
 * card seeks on the latter and uses `positionToFrame` for the former (D7).
 *
 * `TrialMetrics` has no field for why the status is what it is, so the reason
 * shown is the review flags plus the trial's end reason — the two things that
 * actually set it.
 */
import type { DerivedAnalysis } from '../../analysis/derive.js';
import { firstTargetEvent, isPersistentEscape } from '../../analysis/metrics.js';
import { ANALYSIS_OPTION_DEFINITIONS, PARAMETER_DEFINITIONS } from '../../analysis/parameters.js';
import type { EventRecord } from '../../contracts/events.js';
import type { Parameters } from '../../contracts/parameters.js';
import type { TrialStatus } from '../../contracts/metrics.js';
import type { SearchStrategy } from '../../contracts/session.js';
import type { FrameIndex } from '../../contracts/track.js';
import { button, disclosure, el, replaceChildren, uniqueId } from '../dom.js';
import {
  formatCm,
  formatCount,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatSpeed,
  formatTimeAndFrame,
} from './format.js';
import { positionToFrame, type Component, type StrategyCallbacks } from './types.js';
import './review-components.css';

export interface MetricsCardProps {
  analysis: DerivedAnalysis;
  parameters: Parameters;
  /** The id of the strategy-override correction in force, when there is one. */
  strategyOverrideId?: string | null;
}

const STRATEGIES: readonly SearchStrategy[] = ['spatial', 'serial', 'random'];

const STATUS_WORDS: Record<TrialStatus, string> = {
  ok: 'ok',
  review: 'review',
  unresolved: 'unresolved',
};

const END_REASON_WORDS: Record<string, string> = {
  escape: 'the animal entered the escape box',
  cutoff: 'the trial cutoff was reached',
  end_of_video: 'the video ended',
  no_start: 'no trial start could be found',
};

/** The escape entry that ended the trial, or null when none did (O4). */
export function endingEscape(
  analysis: DerivedAnalysis,
  parameters: Parameters,
): EventRecord | null {
  const track = analysis.cleanedTrack;
  const lastFrameIndex = track[track.length - 1]?.frameIndex ?? -1;
  let best: EventRecord | null = null;
  for (const event of analysis.events) {
    if (!isPersistentEscape(event, lastFrameIndex, parameters)) continue;
    if (best === null || event.startFrame < best.startFrame) best = event;
  }
  return best;
}

interface MetricSpec {
  name: string;
  value: string;
  /** Where this number was decided, or null when it has no single frame. */
  frame: FrameIndex | null;
  definition: string;
  note?: string;
}

/** Every row of the card, in the order a person reads a trial. */
export function metricRows(props: MetricsCardProps): MetricSpec[] {
  const { analysis, parameters } = props;
  const { metrics, trial, kinematics, cleanedTrack } = analysis;

  const startFrame = positionToFrame(cleanedTrack, trial.startFrame);
  const endFrame = positionToFrame(cleanedTrack, trial.endFrame);
  const target = firstTargetEvent(analysis.events);
  const escape = endingEscape(analysis, parameters);

  const statusReason =
    analysis.reviewFlags.length > 0
      ? analysis.reviewFlags.map((flag) => flag.message).join(' ')
      : `Nothing was flagged for review. The trial ended because ${END_REASON_WORDS[trial.endReason] ?? trial.endReason}.`;

  return [
    {
      name: 'Trial start',
      value: formatTimeAndFrame(metrics.trialStart_s, startFrame),
      frame: startFrame,
      definition: PARAMETER_DEFINITIONS.trialCutoff_s,
      note: trial.startSource === 'corrected' ? 'set by hand' : 'proposed automatically (O5)',
    },
    {
      name: 'Trial end',
      value: formatTimeAndFrame(trial.endTime_s, endFrame),
      frame: endFrame,
      definition: `The trial ended because ${END_REASON_WORDS[trial.endReason] ?? trial.endReason} (O4, O5).`,
    },
    {
      name: 'Primary latency',
      value: formatSeconds(metrics.primaryLatency_s),
      frame: target?.startFrame ?? null,
      definition:
        'Trial start to the first investigation of the target hole. Blank when the animal never reaches the target (O3).',
    },
    {
      name: 'Total latency',
      value: formatSeconds(metrics.totalLatency_s),
      frame: escape?.startFrame ?? null,
      definition:
        'Trial start to the first lost frame of the escape entry that ended the trial. Blank when the trial was cut off before an escape (O4, O5).',
    },
    {
      name: 'Primary errors',
      value: formatCount(metrics.primaryErrors),
      frame: target?.startFrame ?? null,
      definition:
        'Investigations of non-target holes before the first target investigation, repeat visits included (O2).',
    },
    {
      name: 'Total errors',
      value: formatCount(metrics.totalErrors),
      frame: startFrame,
      definition:
        'Investigations of non-target holes over the whole trial, repeat visits included; the target is never an error (O2).',
    },
    {
      name: 'Path length (raw)',
      value: formatCm(metrics.pathLength_cm),
      frame: startFrame,
      definition:
        'Sum of the segments between consecutive positioned frames of the raw centroid, over the trial window.',
    },
    {
      name: 'Path length (smoothed)',
      value: formatCm(metrics.pathLengthSmoothed_cm),
      frame: startFrame,
      definition: PARAMETER_DEFINITIONS.kinematicsSmoothingWindowFrames,
    },
    {
      name: 'Mean speed',
      value: formatSpeed(metrics.meanSpeed_cmPerS),
      frame: startFrame,
      definition:
        'Smoothed path length divided by the time actually covered by consecutive positioned frames — not by the trial duration, so gaps do not depress it (O9).',
    },
    {
      name: 'Target quadrant time',
      value: formatSeconds(metrics.targetQuadrantTime_s),
      frame: startFrame,
      definition: PARAMETER_DEFINITIONS['targetQuadrant.holeSpan'],
      note: `${formatPercent(kinematics.targetQuadrantFraction)} of the tracked time`,
    },
    {
      name: 'Escaped',
      value: metrics.escaped ? 'yes' : 'no',
      frame: escape?.startFrame ?? null,
      definition:
        'Whether a persistent escape-box entry was detected. False when the trial was cut off instead (O4, O5).',
    },
    {
      name: 'Status',
      value: STATUS_WORDS[metrics.status],
      frame: analysis.reviewFlags.find((flag) => flag.frameIndex !== undefined)?.frameIndex ?? null,
      definition:
        'ok when nothing needs a human; review when something was flagged or the trial was cut off; unresolved when the trial could not be bounded at all.',
      note: statusReason,
    },
    {
      name: 'Tracked fraction (trial)',
      value: formatPercent(metrics.trackedFraction),
      frame: startFrame,
      definition:
        'Fraction of the frames between trial start and trial end whose detection state is tracked. Judged over the trial window, not the whole clip (D54).',
    },
    {
      name: 'Corrections applied',
      value: formatCount(metrics.correctionCount),
      frame: null,
      definition:
        'How many human corrections this trial carries. Corrections are additive: the automatic layer is never overwritten (D9, D25).',
      note: `${analysis.correctionsApplied.point} point, ${analysis.correctionsApplied.range} range, ${analysis.correctionsApplied.event} event`,
    },
  ];
}

export function createMetricsCard(
  container: HTMLElement,
  props: MetricsCardProps,
  callbacks: StrategyCallbacks,
): Component<MetricsCardProps> {
  let current = props;

  const root = el('section', { class: 'review-panel metrics-card' });
  const headingId = uniqueId('metrics-heading');
  root.setAttribute('aria-labelledby', headingId);
  root.append(
    el('h3', { id: headingId, text: 'Metrics' }),
    el('p', {
      class: 'what',
      text: 'Every measure of this trial, with the definition it was computed from. Selecting a value moves the video to the frame that decided it.',
    }),
  );

  const rowsHost = el('div', { class: 'metric-rows' });
  const strategyHost = el('div', { class: 'strategy-block' });
  root.append(rowsHost, strategyHost);
  container.append(root);

  function seekButton(spec: MetricSpec): HTMLElement {
    if (spec.frame === null) {
      return el('span', { class: 'metric-value', text: spec.value });
    }
    const frame = spec.frame;
    return button(
      spec.value,
      () => {
        callbacks.onSeek(frame);
        callbacks.onAnnounce?.(
          `Moved to frame ${frame}, where ${spec.name.toLowerCase()} is read.`,
        );
      },
      {
        class: 'metric-value',
        attrs: { 'aria-label': `${spec.name} ${spec.value}, go to frame ${frame}` },
      },
    );
  }

  function renderRows(): void {
    replaceChildren(
      rowsHost,
      metricRows(current).map((spec) =>
        el('div', { class: 'metric-row' }, [
          el('span', { class: 'metric-name', text: spec.name }),
          seekButton(spec),
          spec.note && el('span', { class: 'metric-note', text: spec.note }),
          disclosure('Definition', [el('p', { text: spec.definition })]),
        ]),
      ),
    );
  }

  function renderStrategy(): void {
    const { strategy } = current.analysis;
    const corrected = strategy.strategySource === 'corrected';

    const features = strategy.features;
    const featureRows: [string, string][] = [
      ['Errors before the target', formatCount(features.errors)],
      [
        'Furthest error from the target',
        `${formatCount(features.maxHoleDistanceFromTarget)} holes`,
      ],
      ['Longest adjacent run', formatCount(features.longestAdjacentRun)],
      ['Holes in that run', features.longestAdjacentRunHoles.join(', ') || 'none'],
      ['Centre crossings', formatCount(features.centreCrossings)],
      ['Path efficiency', formatNumber(features.pathEfficiency)],
      ['Tortuosity', `${formatNumber(features.tortuosity_rad)} rad`],
      ['Target reached', features.targetReached ? 'yes' : 'no'],
      ['Investigation sequence', features.sequence.join(' → ') || 'none'],
    ];

    const select = el('select', { id: uniqueId('strategy-choice'), class: 'number-input' });
    for (const option of STRATEGIES) {
      const node = el('option', { text: option, attrs: { value: option } });
      if (option === strategy.strategy) node.selected = true;
      select.append(node);
    }
    const reason = el('textarea', { id: uniqueId('strategy-reason'), class: 'strategy-reason' });
    reason.rows = 2;
    reason.placeholder = 'Why this class, in your own words';

    const problem = el('p', { class: 'error', attrs: { role: 'alert', hidden: true } });

    const apply = button('Override the classification', () => {
      const text = reason.value.trim();
      if (text === '') {
        // D23 stores the reason with the correction; an override with no reason
        // would be a silent disagreement with the rule engine.
        problem.textContent = 'Say why you are overriding the classification before applying it.';
        problem.hidden = false;
        reason.focus();
        return;
      }
      problem.hidden = true;
      callbacks.onOverride(select.value as SearchStrategy, text);
      callbacks.onAnnounce?.(`Strategy overridden to ${select.value}.`);
    });

    const revert =
      corrected && current.strategyOverrideId
        ? button('Revert to automatic', () => {
            callbacks.onRevert(current.strategyOverrideId!);
            callbacks.onAnnounce?.(
              `Override removed; the automatic classification ${strategy.autoStrategy} applies again.`,
            );
          })
        : null;

    replaceChildren(strategyHost, [
      el('h4', { text: 'Search strategy' }),
      el('p', { class: 'metric-row' }, [
        el('span', { class: 'metric-name', text: 'Class' }),
        el('span', { class: 'metric-value', text: strategy.strategy }),
        corrected
          ? el('span', { class: 'badge badge-warn badge-user', text: 'user' })
          : el('span', { class: 'badge', text: 'auto' }),
        corrected &&
          el('span', {
            class: 'metric-note',
            text: `automatic call was ${strategy.autoStrategy}`,
          }),
      ]),
      el('p', { class: 'metric-row' }, [
        el('span', { class: 'metric-name', text: 'Runner-up' }),
        el('span', { class: 'metric-value', text: strategy.runnerUp }),
      ]),
      el(
        'ul',
        { class: 'strategy-reasoning' },
        strategy.reasoning.map((sentence) => el('li', { text: sentence })),
      ),
      disclosure('Feature values', [
        el(
          'dl',
          { class: 'definition-list' },
          featureRows.flatMap(([name, value]) => [
            el('dt', { text: name }),
            el('dd', { text: value }),
          ]),
        ),
      ]),
      disclosure(
        'Which rules fired',
        strategy.rules.map((rule) =>
          el('div', { class: 'strategy-rule' }, [
            el('p', {
              text: `${rule.strategy}: ${rule.fired ? 'every condition held' : 'did not fire'}${
                rule.fired && rule.strategy !== strategy.strategy
                  ? ' — but an earlier rule had already won'
                  : ''
              }`,
            }),
            el(
              'ul',
              { class: 'strategy-condition' },
              rule.conditions.map((condition) =>
                el('li', { text: `${condition.satisfied ? '✓' : '✗'} ${condition.text}` }),
              ),
            ),
          ]),
        ),
      ),
      disclosure('Definition', [
        el('p', { text: ANALYSIS_OPTION_DEFINITIONS['strategy.spatialMaxErrors'] }),
        el('p', { text: ANALYSIS_OPTION_DEFINITIONS['strategy.serialMinRun'] }),
      ]),
      problem,
      el('div', { class: 'strategy-override' }, [
        el('div', { class: 'field' }, [
          el('label', { text: 'Class', attrs: { for: select.id } }),
          select,
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Reason (required)', attrs: { for: reason.id } }),
          reason,
        ]),
        apply,
        revert,
      ]),
    ]);
  }

  function render(): void {
    renderRows();
    renderStrategy();
  }

  render();

  return {
    update(nextProps) {
      current = nextProps;
      render();
    },
    destroy() {
      root.remove();
    },
  };
}
