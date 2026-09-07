/**
 * The DOM for the demo state (D33), kept here so chunk 9c mounts it with one
 * call and writes none of it:
 *
 *   import { mountExampleCohortPanel } from '../demo/example-cohort-ui.js';
 *   pickers.append(mountExampleCohortPanel({ store, announce: context.announce }));
 *
 * Accessibility is part of the feature, not a pass afterwards (D37): the
 * controls are real buttons with real labels, progress and outcome go to a live
 * region rather than colour, the confirmation is a labelled group that Escape
 * cancels, and the banner is text.
 */
import type { SessionStore } from '../session/session-store.js';
import { button, el } from '../ui/dom.js';
import {
  EXAMPLE_BANNER_TEXT,
  EXAMPLE_SESSION_NAME,
  SAMPLE_DATA_URL,
  loadExampleCohort,
  type ExampleLoaderOptions,
} from './example-cohort.js';
import {
  FETCH_BUTTON_HINT,
  FETCH_BUTTON_LABEL,
  SAMPLE_CLIP_FILENAME,
  attachFetchedClip,
  fetchSampleClip,
  type FetchProgress,
} from './fetch-sample-clip.js';

export const LOAD_BUTTON_LABEL = 'Load example cohort';
export const CONFIRM_TEXT = 'Replace the videos and corrections already loaded?';
export const CONFIRM_ACCEPT_LABEL = 'Yes, load the example';
export const CONFIRM_CANCEL_LABEL = 'Cancel';

export interface ExampleCohortPanelContext {
  store: SessionStore;
  /** The app shell's live region, so outcomes are announced once. */
  announce: (message: string) => void;
  /** Called after the store changes, so the step can re-render. */
  onChange?: () => void;
  /** Injected in tests. */
  loaderOptions?: ExampleLoaderOptions;
}

function formatProgress(progress: FetchProgress): string {
  const received = Math.round(progress.receivedBytes / 1024);
  if (progress.totalBytes === null) return `Downloading ${SAMPLE_CLIP_FILENAME}: ${received} kB…`;
  const total = Math.round(progress.totalBytes / 1024);
  return `Downloading ${SAMPLE_CLIP_FILENAME}: ${received} of ${total} kB…`;
}

export function mountExampleCohortPanel(context: ExampleCohortPanelContext): HTMLElement {
  const { store, announce } = context;

  // Outcomes only. The shell already owns a polite live region (`#app-status`)
  // and `say()` writes that one, so this must not also announce or every
  // outcome is spoken twice.
  const status = el('p', { class: 'example-status' });

  // Progress is deliberately outside any live region: one utterance per stream
  // chunk would bury the outcome under a running commentary.
  const progress = el('p', { class: 'example-progress', attrs: { 'aria-live': 'off' } });

  const banner = el('p', { class: 'example-banner', text: `${EXAMPLE_BANNER_TEXT} ` }, [
    el('a', {
      text: 'Sample-data repository',
      // Opens away from the app rather than navigating out of a half-finished
      // demo; noopener because target is set.
      attrs: { href: SAMPLE_DATA_URL, target: '_blank', rel: 'noopener noreferrer' },
    }),
  ]);
  banner.hidden = true;

  const confirmRow = el('span', {
    class: 'confirm',
    attrs: { role: 'group', 'aria-label': 'Confirm loading the example cohort' },
  });
  confirmRow.hidden = true;

  const loadButton = button(LOAD_BUTTON_LABEL, () => void onLoad(), { class: 'example-load' });
  const fetchButton = button(FETCH_BUTTON_LABEL, () => void onFetch(), { class: 'example-fetch' });
  const fetchHint = el('span', { class: 'hint', text: FETCH_BUTTON_HINT });
  const fetchRow = el('div', { class: 'example-fetch-row' }, [fetchButton, fetchHint]);
  fetchRow.hidden = true;

  const root = el('div', { class: 'example-cohort' }, [
    loadButton,
    confirmRow,
    banner,
    fetchRow,
    progress,
    status,
  ]);

  /** One outcome, spoken once, through the shell's live region. */
  function say(message: string): void {
    status.textContent = message;
    progress.textContent = '';
    announce(message);
  }

  function refresh(): void {
    const loaded = store.videos.length > 0 && store.current.name === EXAMPLE_SESSION_NAME;
    banner.hidden = !loaded;
    // Only offered once there is a descriptor to verify the download against.
    fetchRow.hidden = !loaded || attachedAlready();
    context.onChange?.();
  }

  function attachedAlready(): boolean {
    const clip = store.videos.find((video) => video.filename === SAMPLE_CLIP_FILENAME);
    return clip !== undefined && store.isAttached(clip.id);
  }

  /**
   * The inline confirm, in the shape the shell's Reset already uses: the
   * question in words, two real buttons, Escape to cancel. Resolves false if
   * the row is dismissed, so nothing is replaced by default.
   */
  function askToReplace(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (answer: boolean): void => {
        if (settled) return;
        settled = true;
        confirmRow.hidden = true;
        confirmRow.replaceChildren();
        loadButton.hidden = false;
        // The caller disabled the button before asking, and focusing a disabled
        // button is a no-op that drops focus to <body> — a keyboard user would
        // lose their place mid-flow (D37). Re-enable, then focus.
        loadButton.disabled = false;
        loadButton.focus();
        resolve(answer);
      };

      confirmRow.replaceChildren(
        el('span', { class: 'confirm-text', text: CONFIRM_TEXT }),
        button(CONFIRM_ACCEPT_LABEL, () => finish(true), { class: 'danger' }),
        button(CONFIRM_CANCEL_LABEL, () => finish(false)),
      );
      confirmRow.hidden = false;
      loadButton.hidden = true;
      // `once` so repeated confirmations do not stack listeners on the row.
      confirmRow.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') finish(false);
        },
        { once: true },
      );
      confirmRow.querySelector('button')?.focus();
    });
  }

  async function onLoad(): Promise<void> {
    loadButton.disabled = true;
    say('Loading the example cohort…');
    try {
      const result = await loadExampleCohort(store, {
        ...context.loaderOptions,
        confirmReplace: askToReplace,
      });

      switch (result.kind) {
        case 'loaded':
          say(
            `Example cohort loaded: ${result.session.videos.length} videos with results, ` +
              'no video files attached.',
          );
          break;
        case 'already-loaded':
          say('The example cohort is already loaded.');
          break;
        case 'cancelled':
          say('Left your session as it was.');
          break;
        case 'failed':
          say(result.message);
          break;
      }
    } finally {
      loadButton.disabled = false;
      refresh();
    }
  }

  async function onFetch(): Promise<void> {
    const clip = store.videos.find((video) => video.filename === SAMPLE_CLIP_FILENAME);
    if (clip === undefined) {
      say(`This session has no ${SAMPLE_CLIP_FILENAME} to attach the download to.`);
      return;
    }

    fetchButton.disabled = true;
    say(`Contacting the sample-data repository for ${SAMPLE_CLIP_FILENAME}…`);
    try {
      const result = await fetchSampleClip(clip, {
        onProgress: (received) => {
          progress.textContent = formatProgress(received);
        },
      });
      if (result.kind === 'failed') {
        say(result.message);
        return;
      }

      const attached = await attachFetchedClip(store, result.file);
      say(
        attached.kind === 'attached'
          ? `${SAMPLE_CLIP_FILENAME} verified and attached — frames and corrections are available.`
          : attached.message,
      );
    } finally {
      fetchButton.disabled = false;
      refresh();
    }
  }

  refresh();
  return root;
}
