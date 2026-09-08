/**
 * The DOM for the demo state (D33), kept here so chunk 9c mounts it with one
 * call and writes none of it:
 *
 *   import { mountExampleCohortPanel } from '../demo/example-cohort-ui.js';
 *   pickers.append(mountExampleCohortPanel({ store, announce: context.announce }));
 *
 * Accessibility is part of the feature, not a pass afterwards (D37): the
 * controls are real buttons with real labels, the outcome goes to the shell's
 * live region rather than colour, progress updates stay out of it so a screen
 * reader is not read one line per network chunk, the confirmation is a labelled
 * group that Escape cancels, and the banner is text.
 */
import type { SessionStore } from '../session/session-store.js';
import { button, el, formatBytes, uniqueId } from '../ui/dom.js';
import {
  EXAMPLE_BANNER_TEXT,
  EXAMPLE_PROVENANCE_TEXT,
  EXAMPLE_SESSION_NAME,
  SAMPLE_DATA_URL,
  loadExampleCohort,
  type ExampleLoaderOptions,
} from './example-cohort.js';
import {
  FETCH_BUTTON_HINT,
  SAMPLE_CLIPS,
  SAMPLE_CLIPS_TOTAL_BYTES,
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
  /**
   * Called once the cohort is in. `onLoad` disables its own focused button
   * before awaiting, which drops focus to `<body>`; the step uses this to put
   * focus on the way forward instead of nowhere (D37).
   */
  onLoaded?: () => void;
  /** Injected in tests. */
  loaderOptions?: ExampleLoaderOptions;
}

function formatProgress(progress: FetchProgress, filename = SAMPLE_CLIP_FILENAME): string {
  const received = Math.round(progress.receivedBytes / 1024);
  if (progress.totalBytes === null) return `Downloading ${filename}: ${received} kB…`;
  const total = Math.round(progress.totalBytes / 1024);
  return `Downloading ${filename}: ${received} of ${total} kB…`;
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

  // Said on screen, next to the numbers it qualifies, not buried in the docs.
  const provenance = el('p', {
    class: 'example-provenance',
    text: EXAMPLE_PROVENANCE_TEXT,
  });
  provenance.hidden = true;

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

  const loadButton = button(LOAD_BUTTON_LABEL, () => openConsent(), { class: 'example-load' });

  /*
   * The one network request in the product, asked for before it is made (D2).
   * A native <dialog> opened with showModal(): the browser traps focus in it,
   * Escape closes it and the page behind it is inert, none of which a hand-made
   * overlay gets right. It says the file names and their exact sizes, so
   * "0.5 MB" is not the only thing a user has to go on.
   */
  const consentTitleId = uniqueId('consent-title');
  const consentDialog = el('dialog', {
    class: 'example-dialog',
    attrs: { 'aria-labelledby': consentTitleId },
  });
  const consentConfirm = button('Load the example and fetch the clips', () => {
    closeConsent();
    void onLoad();
  }, { class: 'primary' });
  consentDialog.append(
    el('h3', { id: consentTitleId, text: 'Load the example cohort?' }),
    el('p', { text: FETCH_BUTTON_HINT }),
    el(
      'ul',
      { class: 'example-file-list' },
      SAMPLE_CLIPS.map((clip) =>
        el('li', { text: `${clip.filename} — ${formatBytes(clip.byteLength)}` }),
      ),
    ),
    el('p', {
      class: 'hint',
      text: `${formatBytes(SAMPLE_CLIPS_TOTAL_BYTES)} in total, downloaded one after another. The results load either way; without the files there are no frames to correct.`,
    }),
    el('div', { class: 'example-dialog-actions' }, [
      button('Cancel', () => closeConsent(), {}),
      consentConfirm,
    ]),
  );

  function openConsent(): void {
    // happy-dom has no modal dialog; the flag is what the tests and the
    // handlers read either way.
    if (typeof consentDialog.showModal === 'function') consentDialog.showModal();
    else consentDialog.open = true;
    consentConfirm.focus();
  }

  function closeConsent(): void {
    if (typeof consentDialog.close === 'function') consentDialog.close();
    else consentDialog.open = false;
  }

  const root = el('div', { class: 'example-cohort' }, [
    loadButton,
    consentDialog,
    confirmRow,
    provenance,
    banner,
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
    provenance.hidden = !loaded;
    context.onChange?.();
  }

  /**
   * The inline confirm, in the shape the shell's Reset already uses: the
   * question in words, two real buttons, Escape to cancel. Resolves false if
   * the row is dismissed, so nothing is replaced by default.
   */
  function askToReplace(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') finish(false);
      };
      const finish = (answer: boolean): void => {
        if (settled) return;
        settled = true;
        // Removed explicitly rather than with `{ once: true }`: `once` fires on
        // the first keydown of any kind, so a Tab from "Yes" to "Cancel" would
        // consume it and leave Escape dead (D37).
        confirmRow.removeEventListener('keydown', onKeydown);
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
      confirmRow.addEventListener('keydown', onKeydown);
      confirmRow.querySelector('button')?.focus();
    });
  }

  async function onLoad(): Promise<void> {
    loadButton.disabled = true;
    say('Loading the example cohort…');
    let loaded = false;
    try {
      const result = await loadExampleCohort(store, {
        ...context.loaderOptions,
        confirmReplace: askToReplace,
      });

      switch (result.kind) {
        case 'loaded':
          loaded = true;
          say(
            `Example cohort loaded: ${result.session.videos.length} videos with results, ` +
              `no video files attached. ${EXAMPLE_PROVENANCE_TEXT}`,
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
      // After the re-render, so the button focus lands on is the current one.
      if (loaded) context.onLoaded?.();
    }
    // The user consented to both in one dialog, so the clips follow the bundle
    // without a second press. The results are already on screen while they
    // download, and a failure here leaves them there.
    if (loaded) await fetchAllClips();
  }

  /**
   * The three clips, one after another rather than at once: three parallel
   * downloads on a lab connection is three slow ones, and a serial run lets the
   * progress line name the file it is on. One clip failing does not stop the
   * others — offline, every one fails with its own message and the results the
   * bundle brought are still on screen.
   */
  async function fetchAllClips(): Promise<void> {
    let attachedCount = 0;
    const failures: string[] = [];

    for (const clip of SAMPLE_CLIPS) {
      const descriptor = store.videos.find((video) => video.filename === clip.filename);
      if (descriptor === undefined) {
        failures.push(`this session has no ${clip.filename} to attach a download to`);
        continue;
      }
      if (store.isAttached(descriptor.id)) {
        attachedCount += 1;
        continue;
      }
      status.textContent = `Contacting the sample-data repository for ${clip.filename}…`;
      const result = await fetchSampleClip(descriptor, {
        url: clip.url,
        // The same injection point the bundle load uses, so a test that stubs
        // the network stubs all of it and no test reaches raw.githubusercontent.
        ...(context.loaderOptions?.fetchImpl === undefined
          ? {}
          : { fetchImpl: context.loaderOptions.fetchImpl }),
        onProgress: (received) => {
          progress.textContent = formatProgress(received, clip.filename);
        },
      });
      if (result.kind === 'failed') {
        failures.push(result.message);
        continue;
      }
      const attached = await attachFetchedClip(store, result.file);
      if (attached.kind === 'attached') attachedCount += 1;
      else failures.push(attached.message);
    }

    const verified = `${attachedCount} of ${SAMPLE_CLIPS.length} clips verified and attached`;
    say(
      failures.length === 0
        ? `${verified} — frames and corrections are available.`
        : `${verified}. ${failures.join(' ')}`,
    );
    refresh();
  }

  refresh();
  return root;
}
