/**
 * The Review step's export (D11, D12): one button that writes the whole bundle
 * — three tidy CSVs, `parameters.json`, the session file and the XLSX — as a
 * ZIP, with the tool version and the parameters hash stated on screen beside it
 * so the numbers on the page and the numbers in the file can be reconciled six
 * months later.
 *
 * Nothing is exported from a cache. `prepareExport` re-derives the whole cohort
 * first and refuses if any video's analysis still disagrees with the parameters
 * in force (trust audit A2); the store's own invalidation should make that
 * unreachable, which is why a refusal is worded as a defect rather than a
 * setting to change.
 */
import { hashParameters } from '../analysis/parameters.js';
import type { SessionFile } from '../contracts/session.js';
import { buildExportBundle, XLSX_FILE_NAME } from '../export/index.js';
import { prepareExport } from '../session/analyse.js';
import type { SessionStore } from '../session/session-store.js';
import { sessionFileName } from '../session/session-file.js';
import { button, el, replaceChildren } from './dom.js';
import { downloadBlob } from './download.js';
import { notAnalysedCount } from './review-figures.js';

/** The six entries D11 names, in the order `buildExportBundle` writes them. */
export function bundleContents(session: SessionFile): string[] {
  return [
    'trials.csv',
    'events.csv',
    'quality.csv',
    'parameters.json',
    sessionFileName(session.name),
    XLSX_FILE_NAME,
  ];
}

/**
 * "N of M videos not analysed yet — they are omitted from the CSVs", or null.
 * An unanalysed video has no row to write; saying so on the button's own line
 * is the difference between an omission and a silent one.
 */
export function notAnalysedInExport(session: SessionFile): string | null {
  const { notAnalysed, total } = notAnalysedCount(session);
  if (notAnalysed === 0) return null;
  return `${notAnalysed} of ${total} video${total === 1 ? '' : 's'} not analysed yet — ${notAnalysed === 1 ? 'it is' : 'they are'} omitted from the CSVs.`;
}

/** What the ZIP holds, which version wrote it and which parameters it names (D12). */
export function exportDescription(session: SessionFile, toolVersion: string): string {
  const hash = session.parameters === null ? null : hashParameters(session.parameters);
  return `The ZIP holds ${bundleContents(session).join(', ')} — written by ${toolVersion}${
    hash === null ? '' : `, parameters ${hash}`
  }.`;
}

export interface ReviewExportCallbacks {
  onAnnounce(message: string): void;
}

export interface ReviewExport {
  update(): void;
  destroy(): void;
}

export function createReviewExport(
  container: HTMLElement,
  store: SessionStore,
  toolVersion: string,
  callbacks: ReviewExportCallbacks,
): ReviewExport {
  const root = el('section', { id: 'review-export', class: 'review-export' });
  const heading = el('h3', { id: 'review-export-heading', text: 'Export' });
  root.setAttribute('aria-labelledby', heading.id);

  const contents = el('p', { class: 'export-contents' });
  const missing = el('p', { class: 'figure-missing' });
  const blocked = el('p', { class: 'export-blocked hint', attrs: { id: 'review-export-reason' } });
  const exportButton = button('Export bundle (.zip)', () => {
    void run();
  });
  // The reason a disabled button is disabled has to reach a screen reader too,
  // not only the sentence under it (D37).
  exportButton.setAttribute('aria-describedby', blocked.id);

  const list = el('ul', { class: 'export-files' });

  async function run(): Promise<void> {
    exportButton.disabled = true;
    callbacks.onAnnounce('Re-deriving every video, then building the export…');
    try {
      const readiness = prepareExport(store);
      if (readiness.blocked !== null) {
        callbacks.onAnnounce(`Export refused: ${readiness.blocked}`);
        update();
        return;
      }
      const session = store.current;
      const bundle = await buildExportBundle(session, toolVersion);
      downloadBlob(bundle.zipName, bundle.zip);
      callbacks.onAnnounce(
        `Saved ${bundle.zipName}: ${bundle.files.length} files, ${Math.round(bundle.zip.size / 1024)} kB, ${readiness.analysed} video${readiness.analysed === 1 ? '' : 's'} re-derived in ${readiness.deriveMs.toFixed(1)} ms first.`,
      );
    } catch (error) {
      callbacks.onAnnounce(`The export could not be built: ${(error as Error).message}`);
    } finally {
      update();
    }
  }

  function update(): void {
    const session = store.current;
    const { notAnalysed, total } = notAnalysedCount(session);
    const analysed = total - notAnalysed;

    contents.textContent = exportDescription(session, toolVersion);
    replaceChildren(
      list,
      bundleContents(session).map((name) => el('li', { text: name })),
    );

    const line = notAnalysedInExport(session);
    missing.hidden = line === null;
    missing.textContent = line ?? '';

    const reason =
      total === 0
        ? 'No videos are loaded yet, so there is nothing to export.'
        : analysed === 0
          ? 'No video has been analysed yet, so every CSV would be empty. Track a video and open it here first.'
          : '';
    exportButton.disabled = reason !== '';
    blocked.hidden = reason === '';
    blocked.textContent = reason;
  }

  root.append(
    heading,
    contents,
    el('details', { class: 'disclosure' }, [el('summary', { text: 'What is in the ZIP' }), list]),
    exportButton,
    blocked,
    missing,
  );
  container.append(root);
  update();

  return {
    update,
    destroy(): void {
      root.remove();
    },
  };
}
