// @vitest-environment happy-dom
/**
 * The Review step's export section (D11, D12, D70): the manifest above the
 * button — which ZIP, which build, which parameters, and one row per file with
 * its row count — what it says about videos that are not in the bundle, and the
 * two states in which the button is disabled with the reason on screen.
 *
 * The bundle itself is covered by `tests/export/bundle.test.ts`; what is here
 * is the wiring — that the manifest names the same six files, the same ZIP
 * name, the same hash and the same row counts the bundle actually carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { buildExportBundle, buildWorkbook, eventRows } from '../../src/export/index.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import {
  bundleContents,
  createReviewExport,
  exportManifest,
  NOT_ANALYSED_MARK,
  notAnalysedInExport,
  XLSX_SHEETS,
} from '../../src/ui/review-export.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const TOOL_VERSION = 'barnestrack v0.1.0 (exp0000)';
const NOW = new Date('2026-09-07T12:00:00Z');

function storeWith(session: SessionFile): SessionStore {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(session);
  return store;
}

function emptyStore(): SessionStore {
  return new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
}

/** Data lines in a CSV the bundle wrote: every line but the header. */
async function csvDataLines(blob: Blob): Promise<number> {
  return (await blob.text()).trimEnd().split('\n').length - 1;
}

function withoutDerived(session: SessionFile): SessionFile {
  const analyses = Object.fromEntries(
    Object.entries(session.analyses).map(([id, analysis]) => [id, { ...analysis, derived: null }]),
  ) as SessionFile['analyses'];
  return { ...session, analyses };
}

describe('what the manifest says is in the ZIP', () => {
  const session = syntheticSession();

  it('names the six files D11 lists', () => {
    expect(bundleContents(session)).toEqual([
      'trials.csv',
      'events.csv',
      'quality.csv',
      'parameters.json',
      'Barnes cohort A.barnestrack.json',
      'barnestrack_export.xlsx',
    ]);
  });

  it('names the same six, in the same order, that the bundle actually writes', async () => {
    const bundle = await buildExportBundle(session, TOOL_VERSION, { now: NOW });
    expect(bundle.files.map((file) => file.name)).toEqual(bundleContents(session));
    expect(exportManifest(session, TOOL_VERSION, NOW).files.map((file) => file.name)).toEqual(
      bundleContents(session),
    );
  });

  it('states the ZIP name the bundle is saved under, the build and the parameters hash (D12)', async () => {
    const bundle = await buildExportBundle(session, TOOL_VERSION, { now: NOW });
    const manifest = exportManifest(session, TOOL_VERSION, NOW);
    expect(manifest.zipName).toBe(bundle.zipName);
    expect(manifest.toolVersion).toBe(TOOL_VERSION);
    expect(manifest.parametersHash).toBe(hashParameters(session.parameters!));
  });

  it('counts the rows the CSVs will hold, from the rows the bundle writes', async () => {
    const bundle = await buildExportBundle(session, TOOL_VERSION, { now: NOW });
    const rows = exportManifest(session, TOOL_VERSION, NOW).files.map((file) => file.rows);
    expect(rows[0]).toBe(String(await csvDataLines(bundle.files[0]!.blob)));
    expect(rows[0]).toBe(String(session.videos.length));
    // Evidence sentences may hold quoted line breaks, so events are compared
    // with the row function the CSV is written from rather than by lines.
    expect(rows[1]).toBe(String(eventRows(session, TOOL_VERSION).length));
    expect(Number(rows[1])).toBeGreaterThan(0);
    expect(rows[2]).toBe(String(await csvDataLines(bundle.files[2]!.blob)));
  });

  it('says what the two JSON files are instead of counting them, and the workbook in sheets', async () => {
    const files = exportManifest(session, TOOL_VERSION, NOW).files;
    expect(files[3]!.rows).toBe('1 file');
    expect(files[4]!.rows).toBe('1 file');
    expect(files[5]!.rows).toBe(`${XLSX_SHEETS.length} sheets`);
    const workbook = await buildWorkbook(session, TOOL_VERSION, { now: NOW });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([...XLSX_SHEETS]);
  });

  it('gives every file a plain-language contents cell', () => {
    for (const file of exportManifest(session, TOOL_VERSION, NOW).files) {
      expect(file.contents.length).toBeGreaterThan(20);
    }
  });

  it('does not count a row the export would refuse as stale (D56)', () => {
    const stale = structuredClone(session);
    const first = session.videos[0]!.id;
    stale.analyses[first]!.derived!.quality.parametersHash = 'not-the-hash-in-force';
    const rows = exportManifest(stale, TOOL_VERSION, NOW).files.map((file) => file.rows);
    expect(rows[0]).toBe(String(session.videos.length - 1));
    expect(rows[2]).toBe(String(session.videos.length - 1));
  });

  it('marks the counts "—" when no video is analysed, and only the counts', () => {
    const manifest = exportManifest(withoutDerived(session), TOOL_VERSION, NOW);
    expect(manifest.files.map((file) => file.rows)).toEqual([
      NOT_ANALYSED_MARK,
      NOT_ANALYSED_MARK,
      NOT_ANALYSED_MARK,
      '1 file',
      '1 file',
      `${XLSX_SHEETS.length} sheets`,
    ]);
  });

  it('has no hash to state for an empty session', () => {
    const manifest = exportManifest(emptyStore().current, TOOL_VERSION, NOW);
    expect(manifest.parametersHash).toBeNull();
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.slice(0, 3).every((file) => file.rows === NOT_ANALYSED_MARK)).toBe(true);
  });
});

describe('the "N of M not analysed" line beside the button', () => {
  it('says nothing when every video has a row', () => {
    expect(notAnalysedInExport(syntheticSession())).toBeNull();
  });

  it('says the unanalysed videos are omitted from the CSVs, not dropped', () => {
    const session = syntheticSession();
    const last = session.videos[2]!;
    const withGap: SessionFile = {
      ...session,
      analyses: { ...session.analyses, [last.id]: { ...session.analyses[last.id]!, derived: null } },
    };
    expect(notAnalysedInExport(withGap)).toBe(
      '1 of 3 videos not analysed yet — it is omitted from the CSVs.',
    );
  });
});

describe('the mounted export section', () => {
  let container: HTMLElement;
  const announce = vi.fn();

  beforeEach(() => {
    announce.mockClear();
    container = document.createElement('div');
    document.body.append(container);
  });

  function manifestRows(): string[][] {
    return [...container.querySelectorAll('.manifest-table tbody tr')].map((tr) =>
      [...tr.children].map((cell) => cell.textContent ?? ''),
    );
  }

  it('offers one primary button under a manifest with counts, the build and the hash', () => {
    const store = storeWith(syntheticSession());
    analyseAllVideos(store); // `replaceSession` drops the caches (A2); Review derives on show
    createReviewExport(container, store, TOOL_VERSION, { onAnnounce: announce });

    const buttons = container.querySelectorAll<HTMLButtonElement>('#review-export button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0]!;
    expect(button.textContent).toBe('Export bundle (.zip)');
    expect(button.classList.contains('btn-primary')).toBe(true);
    expect(button.disabled).toBe(false);

    const meta = container.querySelector('.export-meta')!.textContent!;
    expect(meta).toContain(TOOL_VERSION);
    expect(meta).toContain(hashParameters(store.current.parameters!));
    expect(meta).toMatch(/barnestrack_export_barnes-cohort-a_\d{8}\.zip/);

    const expected = exportManifest(store.current, TOOL_VERSION).files;
    expect(manifestRows()).toEqual(expected.map((file) => [file.name, file.rows, file.contents]));
    expect(manifestRows()[0]![1]).toBe('3');
  });

  it('renders the table with "—" counts and says why the button is disabled when nothing is loaded', () => {
    createReviewExport(container, emptyStore(), TOOL_VERSION, { onAnnounce: announce });

    const button = container.querySelector<HTMLButtonElement>('#review-export button')!;
    const reason = container.querySelector<HTMLElement>('.export-blocked')!;
    expect(button.disabled).toBe(true);
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toContain('nothing to export');
    // The reason has to reach a screen reader on the button itself, not only
    // as a sentence somewhere under it (D37).
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);

    const rows = manifestRows();
    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 3).map((row) => row[1])).toEqual([
      NOT_ANALYSED_MARK,
      NOT_ANALYSED_MARK,
      NOT_ANALYSED_MARK,
    ]);
  });

  it('disables the button and says why when no video has been analysed', () => {
    createReviewExport(container, storeWith(withoutDerived(syntheticSession())), TOOL_VERSION, {
      onAnnounce: announce,
    });

    const button = container.querySelector<HTMLButtonElement>('#review-export button')!;
    expect(button.disabled).toBe(true);
    expect(container.querySelector('.export-blocked')!.textContent).toContain('No video has been analysed');
    expect(manifestRows()[0]![1]).toBe(NOT_ANALYSED_MARK);
  });

  it('re-reads the session on update, so the counts follow a recompute', () => {
    const session = syntheticSession();
    const store = storeWith(session);
    const exporter = createReviewExport(container, store, TOOL_VERSION, { onAnnounce: announce });
    const missing = container.querySelector<HTMLElement>('.figure-missing')!;
    // `replaceSession` drops the caches, so nothing is analysed until a derive.
    expect(missing.hidden).toBe(false);
    expect(missing.textContent).toContain('3 of 3 videos not analysed yet');
    expect(manifestRows()[0]![1]).toBe(NOT_ANALYSED_MARK);

    store.setDerivedLayer(session.videos[0]!.id, syntheticSession().analyses[session.videos[0]!.id]!.derived);
    exporter.update();

    expect(missing.textContent).toContain('2 of 3 videos not analysed yet');
    expect(manifestRows()[0]![1]).toBe('1');
  });
});
