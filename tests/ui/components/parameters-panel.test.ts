// @vitest-environment happy-dom
/**
 * The parameters panel (D20, D31, D55).
 *
 * The load-bearing test is the first one: it walks `parameterPaths()` rather
 * than naming parameters, so a threshold added to the contract and forgotten
 * here fails the suite instead of quietly going missing from the UI. The rest
 * pin the two behaviours a live-recompute panel can get dangerously wrong —
 * emitting a half-typed value, and emitting a tracking block it has altered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PARAMETERS,
  PARAMETER_DECISIONS,
  PARAMETER_DEFINITIONS,
  parameterPaths,
  validateParameters,
} from '../../../src/analysis/parameters.js';
import type { Parameters } from '../../../src/contracts/parameters.js';
import {
  CHANGE_DEBOUNCE_MS,
  createParametersPanel,
  labelForPath,
  problemsByPath,
} from '../../../src/ui/components/parameters-panel.js';
import { fixture } from './fixture.js';

const { parameters } = fixture('video-test50');

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  vi.useRealTimers();
  container.remove();
});

function mount(props: Parameters = parameters) {
  const onParametersChange = vi.fn();
  const onAnnounce = vi.fn();
  const panel = createParametersPanel(
    container,
    { parameters: props },
    { onParametersChange, onAnnounce },
  );
  return { panel, onParametersChange, onAnnounce };
}

/** The number input of a row, found by its visible label. */
function numberFor(path: string): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].find(
    (node) => node.textContent === labelForPath(path as never),
  );
  if (!label) throw new Error(`no control labelled for ${path}`);
  const input = container.querySelector<HTMLInputElement>(`#${label.htmlFor}`);
  if (!input) throw new Error(`label for ${path} points at nothing`);
  return input;
}

describe('every parameter is on screen with its definition', () => {
  it('renders a row for every leaf of Parameters, walked rather than listed', () => {
    mount();
    const paths = parameterPaths(parameters);
    expect(paths.length).toBe(31);

    const text = container.textContent ?? '';
    for (const path of paths) {
      expect(text, `${path} has no control label`).toContain(labelForPath(path));
      expect(text, `${path} has no definition`).toContain(PARAMETER_DEFINITIONS[path]);
      const decision = PARAMETER_DECISIONS[path];
      if (decision) {
        expect(text, `${path} does not name its decision`).toContain(`decision ${decision}`);
      }
    }
  });

  it('names each parameter unit beside its control', () => {
    mount();
    const units = [...container.querySelectorAll('.param-unit')].map((n) => n.textContent);
    expect(units).toContain('× hole radius');
    expect(units).toContain('s');
    expect(units).toContain('cm/s');
    expect(units).toContain('on/off');
  });

  it('gives every numeric row a slider and a numeric twin sharing one value', () => {
    mount();
    const row = numberFor('trialCutoff_s').closest('.param-row')!;
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(slider.value).toBe('180');
    expect(number.value).toBe('180');
    expect(slider.getAttribute('aria-label')).toBe('Trial cutoff slider');
  });
});

describe('the tracking block', () => {
  it('is shown in full but has no editable control (D51)', () => {
    mount();
    const trackingBlock = [...container.querySelectorAll('fieldset')].find((node) =>
      node.querySelector('legend')?.textContent?.startsWith('Tracking'),
    )!;
    expect(trackingBlock).toBeDefined();
    expect(trackingBlock.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(trackingBlock.textContent).toContain('needs a new tracking pass');
    // Every tracking leaf is still present, with its value.
    expect(trackingBlock.textContent).toContain('otsu (chosen from the video)');
    expect(trackingBlock.textContent).toContain('Background exclude ranges');
  });

  it('passes the tracking block through byte-identical when another value changes', async () => {
    const { onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    input.value = '120';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

    expect(onParametersChange).toHaveBeenCalledTimes(1);
    const emitted = onParametersChange.mock.calls[0]![0] as Parameters;
    expect(emitted.tracking).toEqual(parameters.tracking);
    expect(emitted.trialCutoff_s).toBe(120);
  });
});

describe('emitting a change', () => {
  it('emits a valid, complete Parameters after the debounce', async () => {
    const { onParametersChange } = mount();
    const input = numberFor('noseConfidenceCutoff');
    input.value = '0.7';
    input.dispatchEvent(new Event('input'));

    expect(onParametersChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

    const emitted = onParametersChange.mock.calls[0]![0] as Parameters;
    expect(validateParameters(emitted)).toEqual([]);
    expect(emitted.noseConfidenceCutoff).toBe(0.7);
  });

  it('coalesces a burst of keystrokes into one recompute', async () => {
    const { onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    for (const value of ['1', '12', '120']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(onParametersChange).toHaveBeenCalledTimes(1);
    expect((onParametersChange.mock.calls[0]![0] as Parameters).trialCutoff_s).toBe(120);
  });

  it('moves the value when the slider is dragged, and syncs the numeric twin', async () => {
    const { onParametersChange } = mount();
    const row = numberFor('trialCutoff_s').closest('.param-row')!;
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    const number = row.querySelector<HTMLInputElement>('input[type="number"]')!;

    slider.value = '90';
    slider.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

    expect(number.value).toBe('90');
    expect((onParametersChange.mock.calls[0]![0] as Parameters).trialCutoff_s).toBe(90);
  });

  it('announces what changed, for the shell live region (D37)', async () => {
    const { onAnnounce } = mount();
    const input = numberFor('trialCutoff_s');
    input.value = '120';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(onAnnounce).toHaveBeenCalledWith('Trial cutoff set to 120.');
  });
});

describe('refusing an invalid value', () => {
  it('emits nothing and says what is wrong beside the offending row', async () => {
    const { onParametersChange } = mount();
    // dropGapFactor must exceed duplicateTimestampFactor; 0.1 breaks the pair.
    const input = numberFor('kinematics.dropGapFactor');
    input.value = '0.1';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);

    expect(onParametersChange).not.toHaveBeenCalled();
    const row = input.closest('.param-row')!;
    expect(row.classList.contains('is-invalid')).toBe(true);
    expect(row.querySelector('.param-error')!.textContent).toContain('a factor above 1');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'nothing has been recomputed',
    );
  });

  it('keeps what the user typed rather than snapping the field back', async () => {
    mount();
    const input = numberFor('trialCutoff_s');
    input.value = '-5';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);
    expect(input.value).toBe('-5');
  });

  it('treats an emptied field as a problem, not as zero', async () => {
    const { onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);
    expect(onParametersChange).not.toHaveBeenCalled();
  });

  it('cancels a pending valid change when a later keystroke makes it invalid', async () => {
    const { onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    input.value = '120';
    input.dispatchEvent(new Event('input'));
    input.value = '-1';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);
    expect(onParametersChange).not.toHaveBeenCalled();
  });
});

describe('reset block to defaults', () => {
  it('restores only its own block', async () => {
    const changed: Parameters = {
      ...parameters,
      trialCutoff_s: 90,
      holeInvestigation: { radiusFactor: 2.5, minDuration_s: 1, mergeGap_s: 2 },
    };
    const { onParametersChange } = mount(changed);

    const block = [...container.querySelectorAll('fieldset')].find((node) =>
      node.querySelector('legend')?.textContent?.startsWith('Hole investigation'),
    )!;
    block.querySelector<HTMLButtonElement>('.reset-block')!.click();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

    const emitted = onParametersChange.mock.calls[0]![0] as Parameters;
    expect(emitted.holeInvestigation).toEqual(DEFAULT_PARAMETERS.holeInvestigation);
    // The other block is untouched: reset is per block, not per panel.
    expect(emitted.trialCutoff_s).toBe(90);
  });

  it('is not offered for the read-only tracking block', () => {
    mount();
    const trackingBlock = [...container.querySelectorAll('fieldset')].find((node) =>
      node.querySelector('legend')?.textContent?.startsWith('Tracking'),
    )!;
    expect(trackingBlock.querySelector('.reset-block')).toBeNull();
  });
});

describe('the diff badge', () => {
  it('reads the sentence describeDiff produces for the two analyses', () => {
    const before = fixture('video-test50');
    const after = fixture('video-test50', {
      parameters: {
        ...parameters,
        holeInvestigation: { ...parameters.holeInvestigation, minDuration_s: 10 },
      },
    });
    const panel = createParametersPanel(
      container,
      { parameters, previous: before.analysis, next: after.analysis },
      { onParametersChange: vi.fn() },
    );
    const badge = container.querySelector('.diff-badge')!;
    expect(badge.textContent).toContain('−7 investigations');
    expect(badge.textContent).toContain('strategy serial → random');
    panel.destroy();
  });

  it('says there is nothing to compare with on a first analysis', () => {
    mount();
    expect(container.querySelector('.diff-badge')!.textContent).toBe('No analysis yet.');
  });
});

describe('the D55 divergence', () => {
  it('lists the analysis options and states that they are not hashed or exported', () => {
    mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Model options — not hashed, not exported (D55)');
    expect(text).toContain('Spatial max errors');
    expect(text).toContain('Good min positioned fraction');
    expect(text).toContain('not covered by the parameters hash');
  });
});

describe('problemsByPath', () => {
  it('attaches a message to the longest leaf path that prefixes it', () => {
    const paths = parameterPaths(DEFAULT_PARAMETERS);
    const mapped = problemsByPath(
      [
        'tracking.threshold.manualValue must be a gray-level difference from 0 to 255, got 900',
        'tracking.backgroundExcludeRanges[0] must be a frame range with 0 ≤ start ≤ end, got {}',
        'trialCutoff_s must be a positive number of seconds, got -1',
      ],
      paths,
    );
    expect([...mapped.keys()].sort()).toEqual([
      'tracking.backgroundExcludeRanges',
      'tracking.threshold',
      'trialCutoff_s',
    ]);
  });

  it('does not let a shorter path swallow a longer one', () => {
    const mapped = problemsByPath(
      ['kinematics.dropGapFactor must be a factor above 1, got 0.1'],
      parameterPaths(DEFAULT_PARAMETERS),
    );
    expect(mapped.has('kinematics.dropGapFactor')).toBe(true);
    expect(mapped.has('kinematicsSmoothingWindowFrames')).toBe(false);
  });
});

describe('lifecycle', () => {
  it('takes its nodes out of the container on destroy', () => {
    const { panel } = mount();
    expect(container.querySelector('.parameters-panel')).not.toBeNull();
    panel.destroy();
    expect(container.querySelector('.parameters-panel')).toBeNull();
  });

  it('does not emit a change queued before destroy', async () => {
    const { panel, onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    input.value = '120';
    input.dispatchEvent(new Event('input'));
    panel.destroy();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);
    expect(onParametersChange).not.toHaveBeenCalled();
  });
});
