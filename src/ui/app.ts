/**
 * The shell: header, four-step stepper, live status region, session controls
 * and footer. D4, D24, D28, D37, D41, D47.
 *
 * The stepper is a real ARIA tablist over real buttons, so it is operable
 * from the keyboard without any of this code handling Tab. Every state change
 * is announced in a polite live region. There is no network request anywhere
 * in this file — no fonts, no icons, no analytics (D2); the mark is an inline
 * SVG (D41).
 */
import type { SessionStore } from '../session/session-store.js';
import {
  parseSessionDocument,
  serializeSessionFile,
  sessionFileName,
} from '../session/session-file.js';
import { button, disclosure, el, replaceChildren } from './dom.js';
import { downloadText, pickFiles } from './download.js';
import type { AppContext, Step, StepId } from './step.js';

const SUPPORTED_BROWSERS = 'Chrome or Edge 94 and later, Safari 16.4 and later, or Firefox 130 and later';
const PRIVACY_LINE = 'Everything runs in this browser. No video and no result leaves your computer.';
const READY_MESSAGE = 'Ready. Start by loading the videos of one cohort.';

export interface App {
  context: AppContext;
  refresh(): void;
  showStep(id: StepId): void;
  element: HTMLElement;
}

export function mountApp(
  root: HTMLElement,
  store: SessionStore,
  toolVersion: string,
  makeSteps: (context: AppContext) => Step[],
): App {
  const status = el('p', {
    class: 'status',
    id: 'app-status',
    text: READY_MESSAGE,
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  let steps: Step[] = [];

  const context: AppContext = {
    store,
    toolVersion,
    announce(message) {
      status.textContent = message;
    },
    showStep(id) {
      showStep(id);
    },
  };

  steps = makeSteps(context);

  const tablist = el('div', {
    class: 'stepper',
    attrs: { role: 'tablist', 'aria-label': 'Analysis steps' },
  });
  const panels = el('main', { class: 'panels' });
  const tabs = new Map<StepId, HTMLButtonElement>();
  const tabStates = new Map<StepId, HTMLElement>();
  const panelFor = new Map<StepId, HTMLElement>();
  const emptyFor = new Map<StepId, HTMLElement>();

  steps.forEach((step, position) => {
    const state = el('span', { class: 'step-state' });
    const tab = el(
      'button',
      {
        class: 'step-tab',
        id: `tab-${step.id}`,
        attrs: {
          role: 'tab',
          'aria-selected': 'false',
          'aria-controls': `panel-${step.id}`,
          tabindex: '-1',
        },
      },
      [
        el('span', { class: 'step-number', text: String(position + 1), attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'step-label', text: step.label }),
        state,
      ],
    );
    tab.type = 'button';
    tab.addEventListener('click', () => showStep(step.id));
    tab.addEventListener('keydown', (event) => onTabKeydown(event, position));
    tabs.set(step.id, tab);
    tabStates.set(step.id, state);
    tablist.append(tab);

    const empty = el('p', { class: 'empty' });
    emptyFor.set(step.id, empty);
    const panel = el(
      'section',
      {
        class: 'panel',
        id: `panel-${step.id}`,
        attrs: { role: 'tabpanel', 'aria-labelledby': `tab-${step.id}`, tabindex: '0' },
      },
      [
        el('h2', { text: `Step ${position + 1} — ${step.label}` }),
        el('p', { class: 'what', text: step.what }),
        disclosure('Definitions', step.definitions()),
        empty,
        step.body,
      ],
    );
    panel.hidden = true;
    panelFor.set(step.id, panel);
    panels.append(panel);
  });

  function onTabKeydown(event: KeyboardEvent, position: number): void {
    const last = steps.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = position === last ? 0 : position + 1;
    else if (event.key === 'ArrowLeft') next = position === 0 ? last : position - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    const step = steps[next];
    if (step) {
      showStep(step.id);
      tabs.get(step.id)?.focus();
    }
  }

  function showStep(id: StepId): void {
    for (const step of steps) {
      const selected = step.id === id;
      const tab = tabs.get(step.id);
      const panel = panelFor.get(step.id);
      if (tab) {
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle('is-current', selected);
      }
      if (panel) panel.hidden = !selected;
    }
    refresh();
    steps.find((s) => s.id === id)?.onShow?.();
  }

  function refresh(): void {
    for (const step of steps) {
      const reason = step.blocked();
      const empty = emptyFor.get(step.id);
      const state = tabStates.get(step.id);
      if (empty) {
        empty.textContent = reason === null ? '' : `Nothing to show yet — ${reason}`;
        empty.hidden = reason === null;
      }
      // Three states, not two: a step that can run reads "ready", and one whose
      // work is finished says so in its own words ("3 videos loaded").
      if (state) {
        state.textContent =
          reason !== null
            ? 'nothing to show yet'
            : step.done()
              ? (step.doneLabel?.() ?? 'done')
              : 'ready';
        state.classList.toggle('is-done', reason === null && step.done());
      }
      step.body.hidden = reason !== null;
      step.refresh();
    }
    // An autosave completing must not rewrite a field the user is typing in.
    if (document.activeElement !== sessionName) sessionName.value = store.current.name;
    saveButton.disabled = store.current.videos.length === 0;
    const state = store.autosaveState;
    saveState.textContent =
      state === 'saved'
        ? 'All changes saved in this browser'
        : state === 'pending'
          ? 'Saving…'
          : 'Could not save to this browser’s storage — use Save session file to keep your work';
    saveState.className = `save-state is-${state}`;
  }

  // ---- session controls -----------------------------------------------------

  const sessionName = el('input', { id: 'session-name', class: 'session-name' });
  sessionName.type = 'text';
  sessionName.value = store.current.name;
  sessionName.addEventListener('change', () => {
    store.setName(sessionName.value.trim() || store.current.name);
    context.announce(`Session renamed to ${store.current.name}.`);
  });

  const saveState = el('span', { class: 'save-state', attrs: { role: 'status', 'aria-live': 'polite' } });

  const saveButton = button('Save session file', () => {
    void saveSession();
  });

  async function saveSession(): Promise<void> {
    await store.flush();
    const session = store.current;
    downloadText(sessionFileName(session.name), serializeSessionFile(session));
    // A maze without its platform diameter is not in the file (D14, D47), and
    // the user must hear that before they reset and load it back.
    const unfinishedMaze = session.mazeMap === null && store.workingMazeMap !== null;
    context.announce(
      `Saved ${sessionFileName(session.name)}.` +
        (unfinishedMaze
          ? ' The maze is not in it: enter the platform diameter on the Maze step, then save again.'
          : ''),
    );
  }

  const loadButton = button('Load session file', () => {
    void loadSession();
  });

  async function loadSession(): Promise<void> {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    const result = parseSessionDocument(await file.text());
    if (!result.ok) {
      context.announce(result.message);
      showLoadError(result.message);
      return;
    }
    showLoadError(null);
    store.replaceSession(result.session);
    refresh();
    context.announce(
      `Loaded ${file.name}: ${result.session.videos.length} video${result.session.videos.length === 1 ? '' : 's'}. Drop each video file again to re-attach it.`,
    );
  }

  const loadError = el('p', { class: 'error' });
  loadError.hidden = true;
  function showLoadError(message: string | null): void {
    loadError.textContent = message ?? '';
    loadError.hidden = message === null;
  }

  // ---- reset, with an inline two-step confirm --------------------------------

  const confirmRow = el('span', { class: 'confirm', attrs: { role: 'group', 'aria-label': 'Confirm reset' } });
  const confirmButton = button('Yes, reset everything', () => {
    void doReset();
  }, { class: 'danger' });
  const cancelButton = button('Cancel', () => closeConfirm(true));
  confirmRow.append(
    el('span', { class: 'confirm-text', text: 'Delete every video, the maze and all corrections?' }),
    confirmButton,
    cancelButton,
  );
  confirmRow.hidden = true;

  const resetButton = button('Reset session', () => openConfirm());

  function openConfirm(): void {
    confirmRow.hidden = false;
    resetButton.hidden = true;
    confirmButton.focus();
    context.announce('Confirm reset: this deletes every video, the maze and all corrections.');
  }

  function closeConfirm(announce: boolean): void {
    confirmRow.hidden = true;
    resetButton.hidden = false;
    resetButton.focus();
    if (announce) context.announce('Reset cancelled. Nothing was deleted.');
  }

  confirmRow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirm(true);
    }
  });

  async function doReset(): Promise<void> {
    await store.reset();
    confirmRow.hidden = true;
    resetButton.hidden = false;
    showLoadError(null);
    refresh();
    showStep('videos');
    resetButton.focus();
    context.announce('Session reset. No videos, no maze, no corrections.');
  }

  // ---- chrome ---------------------------------------------------------------

  const capability = el('p', {
    class: 'banner',
    attrs: { role: 'alert' },
    text: `This browser cannot decode video frames, so BarnesTrack cannot read your videos. Use ${SUPPORTED_BROWSERS}.`,
  });
  capability.hidden = 'VideoDecoder' in globalThis;

  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, [logoMark(), el('h1', { text: 'BarnesTrack' })]),
    el('p', {
      class: 'tagline',
      text: 'Barnes maze videos in, auditable behavioral metrics out. ' + PRIVACY_LINE,
    }),
    el('div', { class: 'session-controls' }, [
      el('label', { text: 'Session name', attrs: { for: 'session-name' } }),
      sessionName,
      saveButton,
      loadButton,
      resetButton,
      confirmRow,
      saveState,
    ]),
    loadError,
  ]);

  const footer = el('footer', { class: 'app-footer' }, [
    el('span', { text: toolVersion }),
    el('span', { text: PRIVACY_LINE }),
  ]);

  const skip = el('a', { class: 'skip-link', text: 'Skip to the current step', attrs: { href: '#panels' } });
  panels.id = 'panels';

  replaceChildren(root, [skip, header, capability, status, tablist, panels, footer]);

  // One subscription keeps the chrome honest: every store change re-derives the
  // step readiness, the session name field and whether saving is possible.
  store.subscribe(refresh);

  showStep('videos');

  return { context, refresh, showStep, element: root };
}

/**
 * The mark, drawn on a 128-unit square: a transparent platform with a rim,
 * twelve small holes and one enlarged target at twelve o'clock, and a mouse
 * seen from above facing it. Every path fills with `currentColor`, so the mark
 * takes the header's text colour in both themes. The same artwork is inlined
 * as the favicon data URI in index.html (D41).
 */
const MARK_PATHS: ReadonlyArray<{ d: string; evenOdd?: true }> = [
  // Transparent platform with a currentColor rim.
  {
    d: 'M64 3.5a60.5 60.5 0 1 1 0 121 60.5 60.5 0 0 1 0-121Z' +
      'm0 5a55.5 55.5 0 1 0 0 111 55.5 55.5 0 0 0 0-111Z',
    evenOdd: true,
  },
  // Twelve small holes and one enlarged target at 12 o'clock.
  {
    d: [
      'M64 11.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z',
      'M44 22.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M84 22.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M29 31.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M99 31.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M20 47.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M108 47.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M18 66.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M110 66.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M25 84.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M103 84.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M39 98.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
      'M89 98.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z',
    ].join(' '),
  },
  // Compact mouse silhouette; deliberately no tail.
  {
    d: [
      'M64 60a21 25 0 1 1 0 50 21 25 0 0 1 0-50Z',
      'M49 56a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
      'M79 56a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
    ].join(' '),
  },
  // Head, with the two eyes knocked out of it by the even-odd rule.
  {
    d: 'M64 35c-6 4-12 20-12 33 0 10 5 16 12 16s12-6 12-16c0-13-6-29-12-33Z' +
      'm-5 17.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z' +
      'm10 0a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z',
    evenOdd: true,
  },
];

/** An original mark: a mouse facing the target hole of a Barnes maze ring. D41. */
function logoMark(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('class', 'logo');
  svg.setAttribute('role', 'img');
  // Both the label and the <title>, byte-identical: the title is what an SVG
  // reader looks for, the aria-label is what an accessibility tree check looks
  // for, and neither on its own satisfies both (D37, D41). The elements carry
  // no ids and nothing points at them by id, so two marks on one page — the
  // header and any future reuse — cannot collide.
  svg.setAttribute('aria-label', 'BarnesTrack');
  const title = document.createElementNS(ns, 'title');
  title.textContent = 'BarnesTrack';
  const desc = document.createElementNS(ns, 'desc');
  desc.textContent =
    'A mouse viewed from above faces the enlarged target hole in a Barnes maze ring.';
  svg.append(title, desc);

  for (const { d, evenOdd } of MARK_PATHS) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    if (evenOdd) path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
