// @vitest-environment happy-dom
/**
 * The Review step's export section (D11, D12): what it says is in the ZIP, what
 * it says about videos that are not, and the two states in which the button is
 * disabled with the reason on screen.
 *
 * The bundle itself is covered by `tests/export/bundle.test.ts`; what is here
 * is the wiring — that the sentence on screen names the same six files and the
 * same hash the bundle actually carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { buildExportBundle } from '../../src/export/index.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import {
  bundleContents,
  createReviewExport,
  exportDescription,
  notAnalysedInExport,
} from '../../src/ui/review-export.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const TOOL_VERSION = 'barnestrack v0.1.0 (exp0000)';

function storeWith(session: SessionFile): SessionStore {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(session);
  return store;
}

describe('what the export section says is in the ZIP', () => {
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

  it('names the same six the bundle actually writes', async () => {
    const bundle = await buildExportBundle(session, TOOL_VERSION, { now: new Date('2026-09-07T12:00:00Z') });
    expect(bundle.files.map((file) => file.name)).toEqual(bundleContents(session));
    expect(bundle.files).toHaveLength(6);
  });

  it('states the tool version and the parameters hash (D12)', () => {
    const text = exportDescription(session, TOOL_VERSION);
    expect(text).toContain(TOOL_VERSION);
    expect(text).toContain(hashParameters(session.parameters!));
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

  it('offers the button with the contents and the hash beside it', () => {
    const store = storeWith(syntheticSession());
    analyseAllVideos(store); // `replaceSession` drops the caches (A2); Review derives on show
    createReviewExport(container, store, TOOL_VERSION, { onAnnounce: announce });

    const button = container.querySelector<HTMLButtonElement>('#review-export button')!;
    expect(button.textContent).toBe('Export bundle (.zip)');
    expect(button.disabled).toBe(false);
    expect(container.querySelector('.export-contents')!.textContent).toContain(TOOL_VERSION);
    expect([...container.querySelectorAll('.export-files li')].map((li) => li.textContent)).toEqual(
      bundleContents(store.current),
    );
  });

  it('disables the button and says why when nothing is loaded', () => {
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
    createReviewExport(container, store, TOOL_VERSION, { onAnnounce: announce });

    const button = container.querySelector<HTMLButtonElement>('#review-export button')!;
    const reason = container.querySelector<HTMLElement>('.export-blocked')!;
    expect(button.disabled).toBe(true);
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toContain('nothing to export');
    // The reason has to reach a screen reader on the button itself, not only
    // as a sentence somewhere under it (D37).
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('disables the button and says why when no video has been analysed', () => {
    const session = syntheticSession();
    const analyses = Object.fromEntries(
      Object.entries(session.analyses).map(([id, analysis]) => [id, { ...analysis, derived: null }]),
    );
    createReviewExport(container, storeWith({ ...session, analyses }), TOOL_VERSION, {
      onAnnounce: announce,
    });

    const button = container.querySelector<HTMLButtonElement>('#review-export button')!;
    expect(button.disabled).toBe(true);
    expect(container.querySelector('.export-blocked')!.textContent).toContain('No video has been analysed');
  });

  it('re-reads the session on update, so the count follows a recompute', () => {
    const session = syntheticSession();
    const store = storeWith(session);
    const exporter = createReviewExport(container, store, TOOL_VERSION, { onAnnounce: announce });
    const missing = container.querySelector<HTMLElement>('.figure-missing')!;
    // `replaceSession` drops the caches, so nothing is analysed until a derive.
    expect(missing.hidden).toBe(false);
    expect(missing.textContent).toContain('3 of 3 videos not analysed yet');

    store.setDerivedLayer(session.videos[0]!.id, syntheticSession().analyses[session.videos[0]!.id]!.derived);
    exporter.update();

    expect(missing.textContent).toContain('2 of 3 videos not analysed yet');
  });
});
