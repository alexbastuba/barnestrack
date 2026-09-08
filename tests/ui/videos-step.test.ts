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
import { describe, expect, it, vi } from 'vitest';
import type { SessionFile, VideoDescriptor } from '../../src/contracts/session.js';
import { EXAMPLE_SESSION_NAME } from '../../src/demo/example-cohort.js';
import { LOAD_BUTTON_LABEL, mountExampleCohortPanel } from '../../src/demo/example-cohort-ui.js';
import { createSessionFile } from '../../src/session/session-file.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import type { AppContext } from '../../src/ui/step.js';
import type { Step } from '../../src/ui/step.js';
import { createNextStepButton, videosMissing } from '../../src/ui/next-step.js';
import { createVideosStep } from '../../src/ui/videos-step.js';

const TOOL_VERSION = 'barnestrack v0.0.0 (test)';

function makeStep(): { step: Step; body: HTMLElement; announced: string[]; store: SessionStore } {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION);
  const announced: string[] = [];
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce: (message) => announced.push(message),
    showStep: () => {},
  };
  const step = createVideosStep(context);
  return { step, body: step.body, announced, store };
}

/** The shape `replaceSession` sees when an example cohort arrives from anywhere. */
function exampleSessionFile(): SessionFile {
  const video: VideoDescriptor = {
    id: 'video-test53',
    filename: 'test53.mp4',
    fingerprint: { byteLength: 496_723, durationSeconds: 30.2, frameCount: 905, sha256: 'a'.repeat(64) },
    referenceResolution: { width: 640, height: 480 },
    mazeTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 1 },
    metadata: {},
  };
  return { ...createSessionFile(EXAMPLE_SESSION_NAME, TOOL_VERSION), videos: [video] };
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
    for (const selector of ['.example-banner', '.example-provenance']) {
      expect(body.querySelector<HTMLElement>(selector)?.hidden, selector).toBe(true);
    }
  });

  it('catches up when the session is replaced from outside the panel', () => {
    // The autosave restoring an example cohort on reload, "Load session file"
    // in the header, and Reset all replace the session without the panel's
    // handlers running. Before the remount, the banner explaining how to attach
    // a video stayed hidden through all three.
    const { step, body, store } = makeStep();
    expect(body.querySelector<HTMLElement>('.example-banner')?.hidden).toBe(true);

    store.replaceSession(exampleSessionFile());
    step.refresh();

    expect(body.querySelectorAll('.example-cohort')).toHaveLength(1);
    expect(body.querySelector<HTMLElement>('.example-banner')?.hidden).toBe(false);
    expect(body.querySelector<HTMLElement>('.example-provenance')?.hidden).toBe(false);
  });

  it('leaves the panel in place while one of its controls is disabled', () => {
    // The real sequence of the panel's own load: it disables its button, then
    // awaits a 500 kB fetch. A browser blurs a button it has just disabled, so
    // by the time the session is replaced the active element is <body> and the
    // focus guard below does not fire. Remounting here would send the panel's
    // own "Example cohort loaded: …" to a detached node and leave the status
    // line on the page empty.
    const { step, body, store } = makeStep();
    const panelBefore = body.querySelector('.example-cohort');
    const load = [...body.querySelectorAll('button')].find(
      (button) => button.textContent === LOAD_BUTTON_LABEL,
    );
    if (load) load.disabled = true;
    expect(panelBefore?.contains(document.activeElement)).toBe(false);

    store.replaceSession(exampleSessionFile());
    step.refresh();

    expect(body.querySelector('.example-cohort')).toBe(panelBefore);
  });

  it('leaves the panel in place while it holds focus', () => {
    // The panel's own load replaces the session from inside `onLoad`, with
    // focus on its button. Replacing it there would drop focus to <body>
    // mid-flow and leave the panel writing to a detached node (D37).
    const { step, body, store } = makeStep();
    document.body.append(body);
    const load = [...body.querySelectorAll('button')].find(
      (button) => button.textContent === LOAD_BUTTON_LABEL,
    );
    const panelBefore = body.querySelector('.example-cohort');
    load?.focus();
    expect(panelBefore?.contains(document.activeElement)).toBe(true);

    store.replaceSession(exampleSessionFile());
    step.refresh();

    expect(body.querySelector('.example-cohort')).toBe(panelBefore);
    expect(document.activeElement).toBe(load);
    body.remove();
  });

  it('gives the panel the shell live region rather than one of its own', () => {
    const { body } = makeStep();
    // The shell owns #app-status; a second polite region inside the step would
    // read every outcome twice (D37).
    expect(body.querySelectorAll('[aria-live="polite"]')).toHaveLength(0);
    expect(body.querySelector('.example-progress')?.getAttribute('aria-live')).toBe('off');
  });
});

describe('the Videos step says when it is done and how to go on', () => {
  const nextButton = (body: HTMLElement): HTMLButtonElement =>
    body.querySelector<HTMLButtonElement>('.next-step-button')!;

  it('offers a Next step button, disabled with a reason while no video is loaded', () => {
    const { step, body } = makeStep();
    step.refresh();
    const next = nextButton(body);
    expect(next.textContent).toBe('Next step → Maze');
    expect(next.disabled).toBe(true);
    expect(next.classList.contains('primary')).toBe(false);
    const hint = body.querySelector<HTMLElement>('.next-step-hint')!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Load at least one video to go on.');
  });

  it('enables it as the primary action once a video is in, and drops the hint', () => {
    const { step, body, store } = makeStep();
    store.replaceSession(exampleSessionFile());
    step.refresh();
    const next = nextButton(body);
    expect(next.disabled).toBe(false);
    expect(next.classList.contains('primary')).toBe(true);
    expect(body.querySelector<HTMLElement>('.next-step-hint')!.hidden).toBe(true);
  });

  it('is not done with no video, and done in its own words with one', () => {
    const { step, store } = makeStep();
    expect(step.done()).toBe(false);
    store.replaceSession(exampleSessionFile());
    step.refresh();
    expect(step.done()).toBe(true);
    expect(step.doneLabel?.()).toBe('1 video loaded');
  });

  it('goes to the Maze step when the button is pressed', () => {
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION);
    const shown: string[] = [];
    const step = createVideosStep({
      store,
      toolVersion: TOOL_VERSION,
      announce: () => {},
      showStep: (id) => shown.push(id),
    });
    store.replaceSession(exampleSessionFile());
    step.refresh();
    nextButton(step.body).click();
    expect(shown).toEqual(['maze']);
  });

  it('puts focus on the way forward after the example cohort loads, not on <body>', async () => {
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION);
    document.body.replaceChildren();
    const next = createNextStepButton(
      { store, toolVersion: TOOL_VERSION, announce: () => {}, showStep: () => {} },
      'maze',
      'Maze',
    );
    document.body.append(next.element);

    const panel = mountExampleCohortPanel({
      store,
      announce: () => {},
      onChange: () => next.update(videosMissing(store)),
      onLoaded: () => next.focus(),
      loaderOptions: { fetchImpl: fakeBundleFetch() },
    });
    document.body.append(panel);
    next.update(videosMissing(store));

    const load = [...panel.querySelectorAll('button')].find(
      (button) => button.textContent === LOAD_BUTTON_LABEL,
    )!;
    load.click();
    // The load button opens the network-consent dialog; confirming it is what
    // starts the load (D2).
    panel.querySelector<HTMLButtonElement>('.example-dialog .primary')!.click();
    // `onLoad` is async: it disables the focused button, awaits the bundle, and
    // that await is what used to leave focus on <body>.
    await vi.waitFor(() => expect(store.videos.length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('.next-step-button')),
    );
    document.body.replaceChildren();
  });
});

/** Serves the example bundle from memory, so no test touches the network (D2). */
function fakeBundleFetch(): (input: string | URL) => Promise<Response> {
  const body = JSON.stringify(exampleSessionFile());
  return () =>
    Promise.resolve(
      new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')), {
        status: 200,
        headers: { 'content-type': 'application/gzip' },
      }),
    );
}
