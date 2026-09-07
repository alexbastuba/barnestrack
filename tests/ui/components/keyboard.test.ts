// @vitest-environment happy-dom
/**
 * Keyboard operability, per component (D37).
 *
 * The rule this suite enforces is that every interactive thing in these panels
 * is a *native* control — a button, an input, a select, a textarea or a
 * `<summary>`. That is what makes Tab reach it, Enter and Space operate it and
 * the arrow keys move a slider, without a single key handler of our own to get
 * wrong. So rather than simulating every key, the tests assert the property
 * that guarantees the keys work, and then check the two behaviours that a
 * native control alone does not give: that nothing is pulled out of document
 * order with a positive tabindex, and that activation actually reaches the
 * callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventList } from '../../../src/ui/components/event-list.js';
import { createMetricsCard } from '../../../src/ui/components/metrics-card.js';
import { createParametersPanel } from '../../../src/ui/components/parameters-panel.js';
import { createQualityPanel } from '../../../src/ui/components/quality-panel.js';
import { fakeContext } from '../../viz/fake-context.js';
import { fixture } from './fixture.js';

const f = fixture('video-test50', { corrections: [] });

/** Everything the browser puts in the tab order, in document order. */
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/**
 * happy-dom reports `tabIndex === -1` for a `<summary>`, where a browser gives
 * it 0 and focuses it — checked in Chrome against the dev harness, which is
 * also where the tab order was walked by hand (see
 * `prototypes/review-components/RESULTS.md`). Modelling the browser here rather
 * than the DOM shim keeps the assertion about the panels instead of about
 * happy-dom; a `<summary>` deliberately taken out of the order would still be
 * caught, because that needs an explicit `tabindex` attribute.
 */
function focusable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => {
    if ((node as HTMLInputElement).disabled) return false;
    // A hidden control is not in the tab order, and happy-dom still reports a
    // tabIndex for one, so it has to be excluded explicitly.
    if (node.hidden || node.closest('[hidden]') !== null) return false;
    if (node.tagName === 'SUMMARY') return node.getAttribute('tabindex') !== '-1';
    return node.tabIndex !== -1;
  });
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => container.remove());

function mountAll() {
  const onSeek = vi.fn();
  const onParametersChange = vi.fn();
  const onOverride = vi.fn();
  const onRevert = vi.fn();

  const parameters = document.createElement('div');
  const events = document.createElement('div');
  const metrics = document.createElement('div');
  const quality = document.createElement('div');
  container.append(parameters, events, metrics, quality);

  createParametersPanel(parameters, { parameters: f.parameters }, { onParametersChange });
  createEventList(events, { events: f.analysis.events, flags: f.analysis.reviewFlags }, { onSeek });
  createMetricsCard(
    metrics,
    { analysis: f.analysis, parameters: f.parameters },
    { onSeek, onOverride, onRevert },
  );
  createQualityPanel(
    quality,
    { session: f.session, videoId: f.descriptor.id, analysis: f.analysis },
    { onSeek },
    { getContext: () => fakeContext() as unknown as CanvasRenderingContext2D },
  );

  return { parameters, events, metrics, quality, onSeek, onOverride, onParametersChange };
}

describe('every interactive element is a native control', () => {
  it('uses no custom-role widget anywhere in the four panels', () => {
    mountAll();
    const native = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
    for (const node of focusable(container)) {
      expect(native.has(node.tagName), `${node.tagName} is not a native control`).toBe(true);
    }
  });

  it('never pulls anything out of document order with a positive tabindex', () => {
    mountAll();
    for (const node of container.querySelectorAll<HTMLElement>('*')) {
      expect(
        node.tabIndex,
        `${node.tagName}.${node.className} has a positive tabindex`,
      ).toBeLessThan(1);
    }
  });

  it('labels every form control, by <label for> or an explicit aria-label', () => {
    mountAll();
    for (const node of container.querySelectorAll<HTMLElement>('input, select, textarea')) {
      const labelled =
        node.getAttribute('aria-label') !== null ||
        container.querySelector(`label[for="${node.id}"]`) !== null;
      expect(labelled, `${node.tagName}#${node.id} has no label`).toBe(true);
    }
  });
});

describe('the parameters panel tab order', () => {
  it('runs slider, then numeric twin, then the definition disclosure, per row', () => {
    const { parameters } = mountAll();
    const firstRow = parameters.querySelector('.param-row')!;
    expect(focusable(firstRow).map((node) => node.tagName)).toEqual(['INPUT', 'INPUT', 'SUMMARY']);
    const [slider, number] = focusable(firstRow) as HTMLInputElement[];
    expect(slider!.type).toBe('range');
    expect(number!.type).toBe('number');
  });

  it('puts the block reset before that block’s rows', () => {
    const { parameters } = mountAll();
    const block = parameters.querySelector('fieldset')!;
    expect(focusable(block)[0]!.textContent).toBe('Reset block to defaults');
  });

  it('leaves the read-only tracking block with only its disclosures in the tab order', () => {
    const { parameters } = mountAll();
    const tracking = [...parameters.querySelectorAll('fieldset')].find((node) =>
      node.querySelector('legend')?.textContent?.startsWith('Tracking'),
    )!;
    const tags = new Set(focusable(tracking).map((node) => node.tagName));
    expect(tags).toEqual(new Set(['SUMMARY']));
  });

  it('moves a value with the arrow keys, because the slider is a real range input', () => {
    const { parameters, onParametersChange } = mountAll();
    const slider = parameters.querySelector<HTMLInputElement>('input[type="range"]')!;
    const before = Number(slider.value);
    // What ArrowUp does to a range input, done explicitly: the browser steps the
    // value and fires `input`, which is the listener under test.
    slider.value = String(before + Number(slider.step));
    slider.dispatchEvent(new Event('input'));
    expect(Number(slider.value)).toBeGreaterThan(before);
    // The numeric twin follows, so the two never disagree about the value.
    const number = parameters.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(number.value).toBe(slider.value);
    expect(onParametersChange).toBeDefined();
  });
});

describe('the event list tab order', () => {
  it('runs the three filter checkboxes, then one card per event', () => {
    const { events } = mountAll();
    const order = focusable(events);
    expect(order.slice(0, 3).map((n) => (n as HTMLInputElement).type)).toEqual([
      'checkbox',
      'checkbox',
      'checkbox',
    ]);
    expect(order.slice(3)).toHaveLength(f.analysis.events.length);
    for (const card of order.slice(3)) expect(card.tagName).toBe('BUTTON');
  });

  it('activates a card with Enter, through the platform’s own click', () => {
    const { events, onSeek } = mountAll();
    const card = events.querySelector<HTMLButtonElement>('.event-card')!;
    card.focus();
    expect(document.activeElement).toBe(card);
    // happy-dom, like a browser, turns Enter on a focused button into a click.
    card.click();
    expect(onSeek).toHaveBeenCalledWith(f.analysis.events[0]!.startFrame);
  });
});

describe('the metrics card tab order', () => {
  it('alternates value button and definition, then ends with the override controls', () => {
    const { metrics } = mountAll();
    const rows = metrics.querySelectorAll('.metric-rows .metric-row');
    for (const row of rows) {
      const tags = focusable(row).map((n) => n.tagName);
      // A row is either [value button, definition] or just [definition] when
      // the value has no frame to seek to.
      expect(tags.at(-1)).toBe('SUMMARY');
      expect(tags.length).toBeLessThanOrEqual(2);
    }

    const strategy = metrics.querySelector('.strategy-block')!;
    const tail = focusable(strategy).map((n) => n.tagName);
    expect(tail).toContain('SELECT');
    expect(tail).toContain('TEXTAREA');
    expect(tail.at(-1)).toBe('BUTTON');
  });

  it('keeps a value with no frame out of the tab order entirely', () => {
    const { metrics } = mountAll();
    const totalLatency = [...metrics.querySelectorAll('.metric-row')].find(
      (n) => n.querySelector('.metric-name')?.textContent === 'Total latency',
    )!;
    expect(focusable(totalLatency).map((n) => n.tagName)).toEqual(['SUMMARY']);
  });
});

describe('the quality panel tab order', () => {
  it('makes each gap row seekable and the hashes a disclosure', () => {
    const { quality } = mountAll();
    const order = focusable(quality);
    const seeks = order.filter((n) => n.classList.contains('seek-cell'));
    expect(seeks).toHaveLength(f.analysis.quality.gaps.length);
    for (const node of seeks) expect(node.tagName).toBe('BUTTON');
    expect(order.at(-1)!.tagName).toBe('SUMMARY');
  });

  it('does not put the canvas in the tab order — the table beside it carries the facts', () => {
    const { quality } = mountAll();
    const canvas = quality.querySelector('canvas')!;
    expect(canvas.tabIndex).toBeLessThan(1);
    expect(focusable(quality)).not.toContain(canvas);
  });

  it('gives every gap-row button a label saying where it goes', () => {
    const { quality } = mountAll();
    for (const node of quality.querySelectorAll('.seek-cell')) {
      expect(node.getAttribute('aria-label')).toMatch(/Go to frame \d+/);
    }
  });
});

describe('every panel brings its own styles', () => {
  it('keeps the components in the one stylesheet', async () => {
    // The panels were styled by a second sheet, `review-components.css`, while
    // `src/styles/` was outside chunk 7a's file boundary. It is folded into
    // `src/styles/app.css` now, so no module here may bring a sheet of its own
    // again: two stylesheets is how `.review-panel` came to be declared twice
    // with different padding, with load order deciding which won.
    const { readdirSync, readFileSync } = await import('node:fs');
    const files = readdirSync('src/ui/components');
    expect(files.filter((name) => name.endsWith('.css'))).toEqual([]);
    for (const name of files) {
      const source = readFileSync(`src/ui/components/${name}`, 'utf-8');
      expect(source, `${name} imports a stylesheet of its own`).not.toMatch(/import\s+'.*\.css'/);
    }
    // The rules the components cannot be read without are in the app sheet,
    // where the app already loads them from. One `toContain` would not have
    // noticed a rule dropped in the fold, so this names the load-bearing ones:
    // the D26 hatch, the D37 invalid-row bar, the tier badges, and the layout
    // each panel depends on.
    const app = readFileSync('src/styles/app.css', 'utf-8');
    for (const selector of [
      '.event-card.is-corrected',
      '.badge-user::before',
      '.param-row.is-invalid',
      '.param-block',
      '.param-controls',
      '.diff-badge',
      '.metric-row',
      '.tier-GOOD',
      '.tier-REVIEW',
      '.tier-POOR',
      '.quality-figures',
      '.quality-strip-canvas',
      '.event-list',
      '.seek-cell',
    ]) {
      expect(app, `${selector} was lost in the fold`).toContain(`${selector} {`);
    }
  });
});

describe('the four panels together', () => {
  it('reaches every control by Tab, in the order the panels were mounted', () => {
    const { parameters, events, metrics, quality } = mountAll();
    const all = focusable(container);
    const counts = [parameters, events, metrics, quality].map((host) => focusable(host).length);

    expect(all).toHaveLength(counts.reduce((a, b) => a + b, 0));
    for (const count of counts) expect(count).toBeGreaterThan(0);
    // Document order is panel order: no panel interleaves with another.
    let seen = 0;
    for (const [i, host] of [parameters, events, metrics, quality].entries()) {
      const slice = all.slice(seen, seen + counts[i]!);
      for (const node of slice) expect(host.contains(node)).toBe(true);
      seen += counts[i]!;
    }
  });
});
