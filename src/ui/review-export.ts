/**
 * The Review step's export (D11, D12, D70): one button that writes the whole
 * bundle — three tidy CSVs, `parameters.json`, the session file and the XLSX —
 * as a ZIP, above it a manifest of what the ZIP will hold: the ZIP's name, the
 * tool version and build, the parameters hash, and one row per file with how
 * many rows it carries and what it is for. The numbers on the page and the
 * numbers in the file can then be reconciled six months later.
 *
 * Nothing is exported from a cache. `prepareExport` re-derives the whole cohort
 * first and refuses if any video's analysis still disagrees with the parameters
 * in force (trust audit A2); the store's own invalidation should make that
 * unreachable, which is why a refusal is worded as a defect rather than a
 * setting to change.
 */
import { hashParameters } from '../analysis/parameters.js';
import type { SessionFile } from '../contracts/session.js';
import {
  buildExportBundle,
  eventRows,
  exportZipName,
  qualityRows,
  trialRows,
  XLSX_FILE_NAME,
} from '../export/index.js';
import { prepareExport, staleAnalyses } from '../session/analyse.js';
import type { SessionStore } from '../session/session-store.js';
import { sessionFileName } from '../session/session-file.js';
import { button, el, replaceChildren, scrollRegion } from './dom.js';
import { downloadBlob } from './download.js';
import { notAnalysedCount } from './review-figures.js';

/**
 * The six entries D11 names, in the order `buildExportBundle` writes them.
 * `src/export` exports the workbook's name but not `parameters.json`'s, so that
 * one literal is repeated here; `tests/ui/review-export.test.ts` pins this list
 * to the names the bundle actually writes.
 */
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

/** The workbook's sheets, in the order `buildWorkbook` adds them (pinned by the test). */
export const XLSX_SHEETS = ['trials', 'events', 'quality', 'parameters', 'readme'] as const;

/** What a count cell says when no video has been analysed yet, and only then. */
export const NOT_ANALYSED_MARK = '—';

export interface ManifestRow {
  name: string;
  /** A row count, `—` when nothing is analysed, or what the file is in place of rows. */
  rows: string;
  contents: string;
}

export interface ExportManifest {
  zipName: string;
  toolVersion: string;
  parametersHash: string | null;
  files: ManifestRow[];
}

/**
 * The session as it stands, minus any analysis whose derived hash disagrees
 * with the parameters in force (D56). Such a cache is not counted. The export
 * re-derives every video before writing, so a stale cache that can be
 * re-derived does reach the CSVs. If one is still stale after that, the export
 * is refused as a whole rather than row by row.
 */
function exportableSession(session: SessionFile): SessionFile {
  const stale = new Set(staleAnalyses(session));
  if (stale.size === 0) return session;
  const analyses = Object.fromEntries(
    Object.entries(session.analyses).map(([id, analysis]) => [
      id,
      stale.has(id) ? { ...analysis, derived: null } : analysis,
    ]),
  ) as SessionFile['analyses'];
  return { ...session, analyses };
}

/**
 * The manifest D70 puts above the export button. Row counts come from the same
 * row functions the CSVs are written with, so the table cannot promise a row the
 * file will not hold.
 */
export function exportManifest(
  session: SessionFile,
  toolVersion: string,
  now: Date = new Date(),
): ExportManifest {
  const exportable = exportableSession(session);
  const { notAnalysed, total } = notAnalysedCount(exportable);
  const anyAnalysed = total - notAnalysed > 0;
  const count = (rows: readonly unknown[]): string =>
    anyAnalysed ? String(rows.length) : NOT_ANALYSED_MARK;
  const [trials, events, quality, parameters, sessionFile, workbook] = bundleContents(session);

  return {
    zipName: exportZipName(session, now),
    toolVersion,
    parametersHash: session.parameters === null ? null : hashParameters(session.parameters),
    files: [
      {
        name: trials!,
        rows: count(trialRows(exportable, toolVersion)),
        contents:
          'One row per analysed video: latencies, errors, path measures, search strategy and status.',
      },
      {
        name: events!,
        rows: count(eventRows(exportable, toolVersion)),
        contents:
          'One row per event across the analysed videos: the hole, the frames, the evidence and whether a person corrected it.',
      },
      {
        name: quality!,
        rows: count(qualityRows(exportable, toolVersion)),
        contents:
          'One row per analysed video: how much of the track is positioned, filled or flagged, and its quality tier.',
      },
      {
        name: parameters!,
        rows: '1 file',
        contents: 'Every threshold in force, as machine-readable JSON. Its hash is the one above.',
      },
      {
        name: sessionFile!,
        rows: '1 file',
        contents:
          'The session: videos, maze map, tracks and corrections. Load it here to reproduce these numbers.',
      },
      {
        name: workbook!,
        rows: `${XLSX_SHEETS.length} sheets`,
        contents: `The same tables in one workbook, with the parameters and a readme: ${XLSX_SHEETS.join(', ')}.`,
      },
    ],
  };
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

export interface ReviewExportCallbacks {
  onAnnounce(message: string): void;
  /**
   * Runs the cohort re-derive with the step's rendering held off. Without it
   * `setDerivedLayer`'s notification per video costs a full re-render — and a
   * figure redraw — for each one, in the middle of building a file.
   */
  runQuietly?<T>(work: () => T): T;
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

  const meta = el('dl', { class: 'export-meta' });
  const manifestBody = el('tbody');
  const manifest = scrollRegion('Files in the export bundle', [
    el('table', { class: 'mirror-table manifest-table' }, [
      el('caption', {
        text: `What the ZIP will hold. Rows are counted from the analysed videos; ${NOT_ANALYSED_MARK} means no video is analysed yet.`,
      }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'File', attrs: { scope: 'col' } }),
          el('th', { text: 'Rows', attrs: { scope: 'col' } }),
          el('th', { text: 'Contents', attrs: { scope: 'col' } }),
        ]),
      ]),
      manifestBody,
    ]),
  ], 'table-scroll manifest-scroll');
  const missing = el('p', { class: 'figure-missing' });
  const blocked = el('p', { class: 'export-blocked hint', attrs: { id: 'review-export-reason' } });
  const exportButton = button('Export bundle (.zip)', () => {
    void run();
  }, { class: 'btn-primary' });
  // The reason a disabled button is disabled has to reach a screen reader too,
  // not only the sentence under it (D37).
  exportButton.setAttribute('aria-describedby', blocked.id);

  async function run(): Promise<void> {
    // Redraw the manifest first: its ZIP name carries today's date, and the
    // step may have stayed open since yesterday with no store change to refresh it.
    update();
    exportButton.disabled = true;
    callbacks.onAnnounce('Re-deriving every video, then building the export…');
    try {
      const quietly = callbacks.runQuietly ?? ((work) => work());
      const readiness = quietly(() => prepareExport(store));
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

    const plan = exportManifest(session, toolVersion);
    replaceChildren(meta, [
      el('dt', { text: 'ZIP file' }),
      el('dd', {}, [el('code', { text: plan.zipName })]),
      el('dt', { text: 'Written by' }),
      el('dd', { text: plan.toolVersion }),
      el('dt', { text: 'Parameters hash' }),
      el('dd', {}, [el('code', { text: plan.parametersHash ?? NOT_ANALYSED_MARK })]),
    ]);
    replaceChildren(
      manifestBody,
      plan.files.map((file) =>
        el('tr', {}, [
          el('th', { text: file.name, attrs: { scope: 'row' } }),
          el('td', { text: file.rows }),
          el('td', { class: 'manifest-contents', text: file.contents }),
        ]),
      ),
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
    meta,
    manifest,
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
