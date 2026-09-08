// @vitest-environment happy-dom
/**
 * The metrics card (D19, D23).
 *
 * The tests that matter most are the seek ones. `TrialBounds` indexes the
 * cleaned track by array position while events carry sample-table frame
 * numbers, so a card that emitted the position for the trial start and the
 * frame for a latency would look right and send the user to the wrong place.
 * Each row's target is therefore asserted against the value derived
 * independently from the analysis, not against a number typed into the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstTargetEvent } from '../../../src/analysis/metrics.js';
import { PARAMETER_DEFINITIONS } from '../../../src/analysis/parameters.js';
import type { CorrectionEntry } from '../../../src/contracts/session.js';
import {
  createMetricsCard,
  endingEscape,
  metricRows,
  withinTrial,
} from '../../../src/ui/components/metrics-card.js';
import { fixture } from './fixture.js';

/** test50: never escapes, so total latency is null and the status is review. */
const noEscape = fixture('video-test50', { corrections: [] });
/** test53: escapes, so there is an ending entry and a total latency. */
const escaped = fixture('video-test53', { corrections: [] });

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => container.remove());

function mount(f = noEscape, strategyOverrideId: string | null = null) {
  const onSeek = vi.fn();
  const onOverride = vi.fn();
  const onRevert = vi.fn();
  const onAnnounce = vi.fn();
  const card = createMetricsCard(
    container,
    { analysis: f.analysis, parameters: f.parameters, strategyOverrideId },
    { onSeek, onOverride, onRevert, onAnnounce },
  );
  return { card, onSeek, onOverride, onRevert, onAnnounce };
}

/** The value control of a row, found by the row's visible name. */
function row(name: string): HTMLElement {
  const found = [...container.querySelectorAll('.metric-row')].find(
    (node) => node.querySelector('.metric-name')?.textContent === name,
  );
  if (!found) throw new Error(`no metric row named ${name}`);
  return found as HTMLElement;
}

function valueControl(name: string): HTMLElement {
  return row(name).querySelector<HTMLElement>('.metric-value')!;
}

describe('the rows a trial has', () => {
  it('shows every measure the export carries', () => {
    mount();
    const names = [...container.querySelectorAll('.metric-name')].map((n) => n.textContent);
    expect(names).toEqual(
      expect.arrayContaining([
        'Trial start',
        'Trial end',
        'Primary latency',
        'Total latency',
        'Primary errors',
        'Total errors',
        'Path length (raw)',
        'Path length (smoothed)',
        'Mean speed',
        'Target quadrant time',
        'Escaped',
        'Status',
        'Tracked fraction (trial)',
        'Corrections applied',
      ]),
    );
  });

  it('gives every row a definition disclosure', () => {
    mount();
    const rows = container.querySelectorAll('.metric-rows .metric-row');
    expect(rows.length).toBe(14);
    for (const node of rows) {
      const name = node.querySelector('.metric-name')?.textContent;
      expect(
        node.querySelector('details > summary')?.textContent,
        `${name} has no definition`,
      ).toBe('Definition');
    }
  });

  it('gives each row its own definition, not a neighbouring threshold’s', () => {
    mount();
    const definitionOf = (name: string): string =>
      row(name).querySelector('details')!.textContent ?? '';

    // The trial-start row used to show the trial-*cutoff* definition: a wrong
    // definition is worse than a missing one.
    // Primary latency ends at the first target event of *either* kind, per
    // docs/data-contracts.md; the old text said the investigation only.
    const primary = definitionOf('Primary latency');
    expect(primary).toContain('either kind');
    expect(primary).toContain('never exceeds total latency');

    const start = definitionOf('Trial start');
    expect(start).not.toContain(PARAMETER_DEFINITIONS.trialCutoff_s);
    expect(start).toContain('oversized-foreground');
    // The decision reference is a comment in the source, not text on screen.
    expect(start).not.toContain('O5');

    // These two keep the threshold that shapes them, but only after their own
    // definition, never instead of it.
    expect(definitionOf('Path length (smoothed)')).toContain('median-filtered centroid positions');
    expect(definitionOf('Target quadrant time')).toContain('Time inside the target quadrant');
  });

  it('shows the raw and the smoothed path length separately (D31)', () => {
    mount();
    const raw = valueControl('Path length (raw)').textContent;
    const smoothed = valueControl('Path length (smoothed)').textContent;
    expect(raw).toBe(`${noEscape.analysis.metrics.pathLength_cm.toFixed(2)} cm`);
    expect(smoothed).toBe(`${noEscape.analysis.metrics.pathLengthSmoothed_cm.toFixed(2)} cm`);
    expect(raw).not.toBe(smoothed);
  });
});

describe('seeking to the frame that decided a value', () => {
  it('sends the trial start to a frame index, not to an array position', () => {
    const { onSeek } = mount();
    const position = noEscape.analysis.trial.startFrame!;
    const expected = noEscape.analysis.cleanedTrack[position]!.frameIndex;

    valueControl('Trial start').dispatchEvent(new Event('click', { bubbles: true }));
    expect(onSeek).toHaveBeenCalledWith(expected);
  });

  it('sends the trial end to the frame index of its position', () => {
    const { onSeek } = mount();
    const position = noEscape.analysis.trial.endFrame!;
    const expected = noEscape.analysis.cleanedTrack[position]!.frameIndex;
    (valueControl('Trial end') as HTMLButtonElement).click();
    expect(onSeek).toHaveBeenCalledWith(expected);
  });

  it('sends primary latency and primary errors to the first target event', () => {
    const { onSeek } = mount();
    const target = firstTargetEvent(noEscape.analysis.events)!;
    expect(target).not.toBeNull();

    (valueControl('Primary latency') as HTMLButtonElement).click();
    expect(onSeek).toHaveBeenLastCalledWith(target.startFrame);

    (valueControl('Primary errors') as HTMLButtonElement).click();
    expect(onSeek).toHaveBeenLastCalledWith(target.startFrame);
  });

  it('sends total latency to the escape entry that ended the trial', () => {
    const { onSeek } = mount(escaped);
    const entry = endingEscape(escaped.analysis, escaped.parameters)!;
    expect(entry).not.toBeNull();
    (valueControl('Total latency') as HTMLButtonElement).click();
    expect(onSeek).toHaveBeenCalledWith(entry.startFrame);
  });

  it('announces the move, for the shell live region (D37)', () => {
    const { onAnnounce } = mount();
    (valueControl('Trial start') as HTMLButtonElement).click();
    expect(onAnnounce).toHaveBeenCalledWith(expect.stringContaining('Moved to frame'));
  });
});

describe('a value with no frame behind it', () => {
  it('renders a missing total latency as an em dash, not zero, and not a button', () => {
    mount();
    expect(noEscape.analysis.metrics.totalLatency_s).toBeNull();
    const value = valueControl('Total latency');
    expect(value.textContent).toBe('—');
    expect(value.tagName).toBe('SPAN');
  });

  it('does not make the correction count seekable', () => {
    mount();
    expect(valueControl('Corrections applied').tagName).toBe('SPAN');
  });

  it('breaks the correction count down by kind', () => {
    mount();
    expect(row('Corrections applied').querySelector('.metric-note')!.textContent).toBe(
      '0 point, 0 range, 0 event',
    );
  });
});

describe('the status row', () => {
  it('gives a reason, since TrialMetrics carries none', () => {
    mount();
    const note = row('Status').querySelector('.metric-note')!.textContent ?? '';
    expect(note.length).toBeGreaterThan(0);
    // test50 is never flagged, so the reason falls back to the trial end reason.
    expect(note).toContain('the trial cutoff was reached');
  });

  it('reads out the review-flag messages when there are any', () => {
    const flagged = {
      ...noEscape,
      analysis: {
        ...noEscape.analysis,
        reviewFlags: [
          {
            code: 'oversized_in_trial' as const,
            message: 'A hand appears at 4.2 s.',
            frameIndex: 126,
          },
        ],
      },
    };
    const { onSeek } = mount(flagged);
    expect(row('Status').querySelector('.metric-note')!.textContent).toContain(
      'A hand appears at 4.2 s.',
    );
    (valueControl('Status') as HTMLButtonElement).click();
    expect(onSeek).toHaveBeenCalledWith(126);
  });
});

describe('the strategy block (D23)', () => {
  it('shows the class, the source, the runner-up and the reasoning', () => {
    mount();
    const text = container.querySelector('.strategy-block')!.textContent ?? '';
    expect(text).toContain(noEscape.analysis.strategy.strategy);
    expect(text).toContain(noEscape.analysis.strategy.runnerUp);
    for (const sentence of noEscape.analysis.strategy.reasoning) {
      expect(text).toContain(sentence);
    }
  });

  it('shows the named feature values (O7)', () => {
    mount();
    const text = container.querySelector('.strategy-block')!.textContent ?? '';
    expect(text).toContain('Errors before the target');
    expect(text).toContain('Centre crossings');
    expect(text).toContain('Path efficiency');
    expect(text).toContain('Tortuosity');
  });

  it('says of each rule whether it fired, and marks one that was outranked', () => {
    mount();
    const text = container.querySelector('.strategy-block')!.textContent ?? '';
    for (const rule of noEscape.analysis.strategy.rules) {
      expect(text).toContain(rule.strategy);
    }
    expect(text).toMatch(/every condition held|did not fire/);
  });

  it('refuses an override with no reason, and says why', () => {
    const { onOverride } = mount();
    const apply = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Override the classification',
    )!;
    apply.click();
    expect(onOverride).not.toHaveBeenCalled();
    expect(container.querySelector('.strategy-block [role="alert"]')!.textContent).toContain(
      'Say why',
    );
  });

  it('emits the chosen class and the reason', () => {
    const { onOverride } = mount();
    const select = container.querySelector<HTMLSelectElement>('.strategy-block select')!;
    const reason = container.querySelector<HTMLTextAreaElement>('.strategy-reason')!;
    select.value = 'random';
    reason.value = 'The run of adjacent holes is an artefact of two merged bouts.';
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Override the classification')!
      .click();
    expect(onOverride).toHaveBeenCalledWith(
      'random',
      'The run of adjacent holes is an artefact of two merged bouts.',
    );
  });

  it('offers no revert while the classification is automatic', () => {
    mount();
    const revert = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Revert to automatic',
    )!;
    // Present but hidden, so it is out of the tab order and off the screen;
    // the button itself persists so a half-typed reason beside it survives.
    expect(revert.hidden).toBe(true);
    expect(container.querySelector('.strategy-block .badge')!.textContent).toBe('auto');
  });

  it('keeps a half-typed reason and the focus across an update (D37)', () => {
    const { card } = mount();
    const reason = container.querySelector<HTMLTextAreaElement>('.strategy-reason')!;
    reason.value = 'Half a thought about the adjacent run';
    reason.focus();

    // A parameter change re-renders this card without touching the strategy.
    card.update({ analysis: noEscape.analysis, parameters: noEscape.parameters });

    expect(container.querySelector<HTMLTextAreaElement>('.strategy-reason')!.value).toBe(
      'Half a thought about the adjacent run',
    );
    expect(document.activeElement).toBe(reason);
  });

  it('marks an overridden class as the user’s and offers a revert (D26)', () => {
    const override: CorrectionEntry = {
      id: 'cor-strategy-1',
      timestamp: '2026-09-06T10:00:00.000Z',
      source: 'user',
      kind: 'strategy_override',
      strategy: 'spatial',
      reason: 'Direct approach after one error.',
    };
    const overridden = fixture('video-test50', { corrections: [override] });
    const { onRevert } = mount(overridden, override.id);

    expect(overridden.analysis.strategy.strategySource).toBe('corrected');
    expect(overridden.analysis.strategy.strategy).toBe('spatial');
    const block = container.querySelector('.strategy-block')!;
    expect(block.querySelector('.badge-user')!.textContent).toBe('user');
    expect(block.textContent).toContain(
      `automatic call was ${overridden.analysis.strategy.autoStrategy}`,
    );

    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Revert to automatic')!
      .click();
    expect(onRevert).toHaveBeenCalledWith('cor-strategy-1');
  });
});

describe('metricRows', () => {
  it('gives no frame to a value that has none, so nothing seeks arbitrarily', () => {
    const rows = metricRows({ analysis: noEscape.analysis, parameters: noEscape.parameters });
    const totalLatency = rows.find((r) => r.name === 'Total latency')!;
    expect(totalLatency.frame).toBeNull();
    expect(rows.find((r) => r.name === 'Corrections applied')!.frame).toBeNull();
  });

  it('finds the ending escape for a trial that escaped, and none for one that did not', () => {
    expect(endingEscape(escaped.analysis, escaped.parameters)).not.toBeNull();
    expect(endingEscape(noEscape.analysis, noEscape.parameters)).toBeNull();
  });

  it('takes the first target event from inside the trial window, as computeMetrics does', () => {
    // A correction may add an event outside the window, which the contract
    // keeps as an annotation. Searching every event would seek to the
    // annotation while printing a latency computed from something else.
    const all = escaped.analysis.events;
    const inside = withinTrial(escaped.analysis, all);
    expect(inside.length).toBeGreaterThan(0);

    const startFrame =
      escaped.analysis.cleanedTrack[escaped.analysis.trial.startFrame!]!.frameIndex;
    for (const event of inside) expect(event.startFrame).toBeGreaterThanOrEqual(startFrame);

    // With a trial start moved later by a correction, an event before it is an
    // annotation and must drop out — the case that made the card seek to an
    // event the metric was not computed from.
    const late = fixture('video-test53', {
      corrections: [
        {
          id: 'cor-start',
          timestamp: '2026-09-07T10:00:00.000Z',
          source: 'user',
          kind: 'trial_start',
          frameIndex: escaped.analysis.cleanedTrack[400]!.frameIndex,
        },
      ],
    });
    const lateStart = late.analysis.cleanedTrack[late.analysis.trial.startFrame!]!.frameIndex;
    expect(lateStart).toBeGreaterThan(0);

    const annotation = { ...all[0]!, id: 'annotation', startFrame: 0, isTarget: true };
    const kept = withinTrial(late.analysis, [...late.analysis.events, annotation]);
    expect(kept.map((e) => e.id)).not.toContain('annotation');
    for (const event of kept) expect(event.startFrame).toBeGreaterThanOrEqual(lateStart);
  });

  it('ignores an entry outside the trial window, as derive() does', () => {
    // derive() refuses to end a trial on an entry starting before the trial
    // start and flags it instead. Without the same test, "Total latency" would
    // seek to an event that did not produce the number beside it.
    const entry = endingEscape(escaped.analysis, escaped.parameters)!;
    const shifted = {
      ...escaped.analysis,
      trial: { ...escaped.analysis.trial, startFrame: escaped.analysis.cleanedTrack.length - 1 },
    };
    expect(entry.startFrame).toBeLessThan(
      escaped.analysis.cleanedTrack[shifted.trial.startFrame!]!.frameIndex,
    );
    expect(endingEscape(shifted, escaped.parameters)).toBeNull();
  });
});

describe('lifecycle', () => {
  it('removes itself on destroy', () => {
    const { card } = mount();
    card.destroy();
    expect(container.querySelector('.metrics-card')).toBeNull();
  });

  it('re-renders from new props', () => {
    const { card } = mount();
    card.update({ analysis: escaped.analysis, parameters: escaped.parameters });
    expect(valueControl('Escaped').textContent).toBe('yes');
  });
});
