// @vitest-environment happy-dom
/**
 * The Videos step's mount of the demo state (D33).
 *
 * Chunk 9b built `mountExampleCohortPanel` and could not touch `src/ui/`, so
 * for a chunk nothing imported it and the shipped bundle tree-shook the whole
 * demo away without a single test noticing. That is the failure this file
 * exists to catch: that the panel is on the step, reachable, and labelled the
 * way the browser specs locate it.
 *
 * It asserts the wiring, not the panel — the panel's own behaviour is covered
 * offline in `tests/demo/` and in Chrome in `tests/browser/app-smoke.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { LOAD_BUTTON_LABEL } from '../../src/demo/example-cohort-ui.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import type { AppContext } from '../../src/ui/step.js';
import { createVideosStep } from '../../src/ui/videos-step.js';

const TOOL_VERSION = 'barnestrack v0.0.0 (test)';

function makeStep(): { body: HTMLElement; announced: string[]; store: SessionStore } {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION);
  const announced: string[] = [];
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce: (message) => announced.push(message),
    showStep: () => {},
  };
  return { body: createVideosStep(context).body, announced, store };
}

describe('the Videos step mounts the example cohort panel', () => {
  it('renders the panel inside the step, with no video loaded', () => {
    const { body, store } = makeStep();
    expect(store.videos).toHaveLength(0);
    expect(body.querySelectorAll('.example-cohort')).toHaveLength(1);
  });

  it('puts it under the pickers rather than loose in the drop zone', () => {
    const { body } = makeStep();
    const panel = body.querySelector('.example-cohort');
    expect(panel?.parentElement?.classList.contains('pickers')).toBe(true);
  });

  it('offers the load button the browser specs locate, enabled and in the tab order', () => {
    const { body } = makeStep();
    const buttons = [...body.querySelectorAll('button')];
    const load = buttons.find((button) => button.textContent === LOAD_BUTTON_LABEL);
    expect(load, `no button labelled "${LOAD_BUTTON_LABEL}" on the Videos step`).toBeDefined();
    expect(load?.disabled).toBe(false);
    expect(load?.hidden).toBe(false);
    // A real <button> with no negative tabindex is reachable by Tab; the panel
    // sets no tabindex at all, which is the point (D37).
    expect(load?.getAttribute('tabindex')).toBeNull();
    expect(load?.type).toBe('button');
  });

  it('starts with the banner, the provenance line and the fetch row hidden', () => {
    const { body } = makeStep();
    // Nothing is loaded, so none of the three has anything to qualify yet.
    for (const selector of ['.example-banner', '.example-provenance', '.example-fetch-row']) {
      expect(body.querySelector<HTMLElement>(selector)?.hidden, selector).toBe(true);
    }
  });

  it('gives the panel the shell live region rather than one of its own', () => {
    const { body } = makeStep();
    // The shell owns #app-status; a second polite region inside the step would
    // read every outcome twice (D37).
    expect(body.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(body.querySelector('.example-progress')?.getAttribute('aria-live')).toBe('off');
  });
});
