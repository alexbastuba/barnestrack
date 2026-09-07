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
  parameterAt,
  parameterPaths,
  validateParameters,
} from '../../../src/analysis/parameters.js';
import type { Parameters } from '../../../src/contracts/parameters.js';
import {
  ANALYSIS_PARAMETER_BOUNDS,
  hasSlider,
} from '../../../src/ui/components/analysis-parameter-bounds.js';
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
    // 24 analysis leaves (16 plus D55's eight) and 15 tracking ones.
    expect(paths.length).toBe(39);

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

describe('the thresholds D55 moved into Parameters', () => {
  /**
   * The eight paths that were un-hashed `AnalysisOptions` before D55. They are
   * listed here rather than derived so that the test states what it is about;
   * the first assertion checks the list against the contract, so it cannot
   * drift into naming a path that no longer exists.
   */
  const D55_PATHS = [
    'trialCensoring.censorToCutoff',
    'strategy.spatialMaxErrors',
    'strategy.spatialMaxHoleDistance',
    'strategy.spatialMaxCentreCrossings',
    'strategy.serialMinRun',
    'strategy.centreZoneRadiusFraction',
    'quality.goodMinPositionedFraction',
    'quality.poorMaxPositionedFraction',
  ] as const;

  const TOGGLE = 'trialCensoring.censorToCutoff';

  /** A copy of `parameters` with one leaf replaced, for trying a value out. */
  function withValueAt(path: string, value: number): Parameters {
    const next = structuredClone(parameters);
    const keys = path.split('.');
    let node = next as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[keys[keys.length - 1]!] = value;
    return next;
  }

  it('are all still leaves of the contract', () => {
    const paths = new Set<string>(parameterPaths(parameters));
    for (const path of D55_PATHS) expect(paths.has(path), `${path} is gone`).toBe(true);
  });

  it('has a slider range for every numeric one, and none for the switch', () => {
    for (const path of D55_PATHS) {
      expect(hasSlider(path), `${path}`).toBe(path !== TOGGLE);
    }
  });

  it('renders an editable control for each, not a read-only row', () => {
    mount();
    for (const path of D55_PATHS) {
      const input = numberFor(path);
      expect(input.disabled, `${path} is disabled`).toBe(false);
      expect(input.readOnly, `${path} is read-only`).toBe(false);
      expect(input.type, `${path} has the wrong control`).toBe(
        path === TOGGLE ? 'checkbox' : 'number',
      );
      expect(input.closest('.param-row')!.classList.contains('is-readonly')).toBe(false);
    }
  });

  it('emits a valid Parameters carrying the new value, for every one of them', async () => {
    for (const path of D55_PATHS) {
      container.replaceChildren();
      const { onParametersChange } = mount();
      const input = numberFor(path);

      const before = parameterAt(parameters, path);
      let expected: number | boolean;
      if (path === TOGGLE) {
        expected = !(before as boolean);
        input.checked = expected;
        input.dispatchEvent(new Event('change'));
      } else {
        const bound = ANALYSIS_PARAMETER_BOUNDS[path];
        // A value inside the slider's range, different from the one already
        // there so a panel that silently kept the default would fail here, and
        // one the whole set still validates with: the two quality thresholds
        // constrain each other, so an endpoint of one of them is legitimately
        // refused and the panel is right to emit nothing for it.
        const candidate = [bound.min, (bound.min + bound.max) / 2, bound.max].find(
          (value) => value !== before && validateParameters(withValueAt(path, value)).length === 0,
        );
        expect(candidate, `no reachable value for ${path}`).toBeDefined();
        expected = candidate!;
        input.value = String(expected);
        input.dispatchEvent(new Event('input'));
      }
      await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

      expect(onParametersChange, `${path} emitted nothing`).toHaveBeenCalledTimes(1);
      const emitted = onParametersChange.mock.calls[0]![0] as Parameters;
      expect(validateParameters(emitted), `${path} emitted an invalid set`).toEqual([]);
      expect(parameterAt(emitted, path), `${path} did not carry its new value`).toBe(expected);
    }
  });

  it('no longer lists them as model options that are not hashed', () => {
    mount();
    const text = container.textContent ?? '';
    expect(text).not.toContain('Model options');
    expect(text).not.toContain('not hashed, not exported');
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

  it('marks the offending control for a screen reader, not only the summary', async () => {
    mount();
    const input = numberFor('kinematics.dropGapFactor');
    input.value = '0.1';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS * 5);

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)!.textContent).toContain('a factor above 1');

    // And the marking is removed once the value is legal again.
    input.value = '1.5';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
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

describe('update() while the user is editing', () => {
  it('never shows one value and emits another', async () => {
    // The harness updates all four panels on every re-derive, so an update can
    // land between a keystroke and the debounce. Overwriting the working value
    // of the focused row would leave the field showing 240 and the next commit
    // emitting 180.
    const { panel, onParametersChange } = mount();
    const input = numberFor('trialCutoff_s');
    input.focus();
    input.value = '240';
    input.dispatchEvent(new Event('input'));

    panel.update({ parameters });
    expect(input.value).toBe('240');

    // Touch another row; whatever is emitted must match what is on screen.
    const other = numberFor('noseConfidenceCutoff');
    other.value = '0.7';
    other.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);

    const emitted = onParametersChange.mock.calls.at(-1)![0] as Parameters;
    expect(emitted.trialCutoff_s).toBe(Number(input.value));
  });

  it('takes the incoming value for every row the user is not in', () => {
    const { panel } = mount();
    const focused = numberFor('trialCutoff_s');
    focused.focus();
    focused.value = '240';
    focused.dispatchEvent(new Event('input'));

    panel.update({ parameters: { ...parameters, noseConfidenceCutoff: 0.9 } });
    expect(numberFor('noseConfidenceCutoff').value).toBe('0.9');
    expect(focused.value).toBe('240');
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

  it('removes only its own nodes, never a sibling it did not create', () => {
    const sibling = document.createElement('p');
    sibling.id = 'not-mine';
    container.append(sibling);
    const { panel } = mount();
    panel.destroy();
    expect(container.querySelector('#not-mine')).toBe(sibling);
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
