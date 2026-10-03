/**
 * Chunk 9b — the demo state end to end, in the installed Google Chrome.
 *
 * Two halves, because two of the pieces this flow needs land in other chunks.
 *
 * 1. **The loader, against `npm run dev`.** Chunk 9c mounts the "Load example
 *    cohort" button into the Videos step; until it does there is no button to
 *    click, so these tests drive the loader module itself through
 *    `import('/src/demo/example-cohort.ts')` and the store `main.ts` exposes
 *    under `import.meta.env.DEV`. Everything after that is the real app: the
 *    real store, the real IndexedDB autosave, the real Videos step rendering.
 *    These run today.
 *
 * 2. **The whole flow, against `npm run preview` of the built `dist/`.** Load
 *    the example cohort by its results-only button, read a metric with no
 *    video attached, keep an event from the keyboard, move a threshold and
 *    watch the event count and the diff badge change, download the export
 *    bundle and read the ZIP, then reload once the autosave has landed and find
 *    the session and the correction still there. Skips only when `dist/` has
 *    not been built; CI builds it first.
 *
 * Both servers are started here rather than in `playwright.config.ts`: that
 * config is shared with the other specs and outside this chunk's boundary.
 *
 * The live sample-data request is deliberately not exercised here — the fetch
 * verifier is covered offline in `tests/demo/fetch-sample-clip.test.ts`, and
 * making the browser suite depend on GitHub would undermine the claim that the
 * app makes no network requests of its own (D2).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
// The label the panel actually renders, so renaming the button breaks the
// locator rather than quietly widening the skip below.
import { LOAD_BUTTON_LABEL } from '../../src/demo/example-cohort-ui.js';
import { hashParameters } from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import { column, csvRows, downloadBundle } from './bundle-download.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Chosen to miss the config's own dev server on 5173 and vite preview's 4173,
// so a normal `npx playwright test` run does not fight itself for a port.
const DEV_PORT = 5175;
const PREVIEW_PORT = 4175;
const DEV_URL = `http://localhost:${DEV_PORT}/`;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/`;

const DIST_INDEX = join(REPO_ROOT, 'dist/index.html');
const SERVER_START_TIMEOUT_MS = 60_000;

/** Only serious and critical fail the build; the full list is always printed. */
const FAILING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Violations this scan found in code chunk 9b does not own, recorded in
 * `docs/known-limitations.md` rather than silently tolerated. Keyed by step,
 * rule *and the exact nodes it matched*, so a new serious violation, the same
 * rule on another step, or a second offending node under the same rule all
 * still fail. Delete an entry when its defect is fixed.
 */
const KNOWN_VIOLATIONS = new Set<string>([
  // Empty: chunk 10b fixed the maze step's scroll container (`scrollRegion` in
  // `src/ui/dom.ts` puts it in the tab order with a name), so its entry is gone
  // per the rule above. Add one here only with its defect recorded in
  // `docs/known-limitations.md`.
]);

const servers: ChildProcess[] = [];

function startServer(script: string, port: number): ChildProcess {
  const child = spawn('npm', ['run', script, '--', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    // Its own process group, so killing it takes the vite child with it rather
    // than leaving a port held for the next run.
    detached: true,
  });
  servers.push(child);
  return child;
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`${url} did not come up in 60 s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function stopServers(): void {
  for (const child of servers) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  servers.length = 0;
}

const distBuilt = existsSync(DIST_INDEX);

test.beforeAll(async () => {
  startServer('dev', DEV_PORT);
  if (distBuilt) startServer('preview', PREVIEW_PORT);

  await waitForServer(DEV_URL);
  if (distBuilt) await waitForServer(PREVIEW_URL);
});

test.afterAll(() => {
  stopServers();
});

/** A clean browser: the autosave record survives a reload, which is the point of it. */
async function clearStoredSession(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('barnestrack');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
}

interface LoadOutcome {
  kind: string;
  videos: number;
  attached: number;
}

/**
 * Drives the loader module directly. This is what chunk 9c's button will call;
 * until it exists, calling it here still exercises the real store and the real
 * rendering path, so the assertions below are about the app, not about a mock.
 */
async function loadExampleViaModule(page: Page): Promise<LoadOutcome> {
  return page.evaluate(async () => {
    // Through a variable, so this is a request the dev server answers at
    // runtime rather than a module specifier the typechecker tries to resolve.
    const specifier = '/src/demo/example-cohort.ts';
    const module = (await import(specifier)) as {
      loadExampleCohort: (store: unknown) => Promise<{ kind: string }>;
    };
    const store = (globalThis as unknown as Record<string, unknown>)['__barnestrackStore'];
    if (store === undefined) throw new Error('__barnestrackStore is not exposed on this build');
    const typed = store as {
      videos: { id: string }[];
      isAttached: (id: string) => boolean;
    };
    const result = (await module.loadExampleCohort(typed)) as { kind: string };
    return {
      kind: result.kind,
      videos: typed.videos.length,
      attached: typed.videos.filter((video) => typed.isAttached(video.id)).length,
    };
  });
}

interface AxeViolation {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
  targets: string[];
}

async function scanForViolations(page: Page): Promise<AxeViolation[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
}

function reportViolations(step: string, violations: AxeViolation[]): AxeViolation[] {
  for (const violation of violations) {
    console.log(
      `axe [${step}] ${violation.impact ?? 'unknown'} · ${violation.id} · ${violation.help} · ` +
        `${violation.nodes} node(s) · ${violation.targets.join(' | ')}`,
    );
  }
  if (violations.length === 0) console.log(`axe [${step}] no violations`);

  const failing = violations.filter((violation) => FAILING_IMPACTS.has(violation.impact ?? ''));
  return failing.filter((violation) => {
    const known = KNOWN_VIOLATIONS.has(`${step}:${violation.id}:${violation.targets.join(',')}`);
    if (known) {
      console.log(
        `axe [${step}] ${violation.id} is a recorded defect (docs/known-limitations.md), not a regression`,
      );
    }
    return !known;
  });
}

test.describe('the example cohort, driven through the loader module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEV_URL);
    await clearStoredSession(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  });

  test('loads three videos with results and no video attached', async ({ page }) => {
    const started = Date.now();
    const outcome = await loadExampleViaModule(page);

    expect(outcome.kind).toBe('loaded');
    expect(outcome.videos).toBe(3);
    expect(outcome.attached).toBe(0);

    await expect(page.locator('.video-card')).toHaveCount(3);
    await expect(page.locator('.video-card h3')).toHaveText([
      'test50.mp4',
      'test51.mp4',
      'test53.mp4',
    ]);
    await expect(page.locator('.video-card .badge')).toHaveText([
      'video not attached',
      'video not attached',
      'video not attached',
    ]);

    // The 10 s budget in the chunk's acceptance list, measured from the click
    // that starts the load to the three cards being on screen.
    const elapsedMs = Date.now() - started;
    console.log(`example cohort: loaded and rendered in ${elapsedMs} ms`);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  test('brings the maze and a result for every video, with no file present', async ({ page }) => {
    await loadExampleViaModule(page);

    const summary = await page.evaluate(() => {
      const store = (globalThis as unknown as Record<string, unknown>)['__barnestrackStore'] as {
        current: { name: string; mazeMap: unknown; parameters: unknown };
        videos: { id: string }[];
        analysisFor: (id: string) => unknown;
      };
      return {
        name: store.current.name,
        hasMaze: store.current.mazeMap !== null,
        hasParameters: store.current.parameters !== null,
        analysed: store.videos.filter((video) => store.analysisFor(video.id) !== undefined).length,
      };
    });

    expect(summary).toEqual({
      name: 'Example cohort',
      hasMaze: true,
      hasParameters: true,
      analysed: 3,
    });
  });

  test('is idempotent: loading it twice leaves one cohort', async ({ page }) => {
    await loadExampleViaModule(page);
    const again = await loadExampleViaModule(page);

    expect(again.kind).toBe('already-loaded');
    expect(again.videos).toBe(3);
    await expect(page.locator('.video-card')).toHaveCount(3);
  });

  test('survives a reload, still unattached', async ({ page }) => {
    await loadExampleViaModule(page);
    // The autosave is debounced; the header says when the write has landed.
    await expect(page.locator('.save-state')).toHaveText('All changes saved in this browser');

    await page.reload();

    await expect(page.locator('.video-card')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('.video-card .badge')).toHaveText([
      'video not attached',
      'video not attached',
      'video not attached',
    ]);
    await expect(page.locator('#session-name')).toHaveValue('Example cohort');
  });

  test('Reset session clears it and returns to the Videos step', async ({ page }) => {
    await loadExampleViaModule(page);
    await expect(page.locator('.video-card')).toHaveCount(3);

    await page.getByRole('button', { name: 'Reset session' }).click();
    await page.getByRole('button', { name: 'Yes, reset everything' }).click();

    await expect(page.locator('.video-card')).toHaveCount(0);
    await expect(page.locator('#app-status')).toContainText(
      'Session reset. No videos, no maze, no corrections.',
    );
  });

  /**
   * Makes sure the Videos step has the panel on it, so the axe scan and the
   * assertions below see the controls the demo state actually added.
   *
   * Chunk 9c-a mounted `mountExampleCohortPanel` into `src/ui/videos-step.ts`,
   * so on a current build the panel is already there and this only waits for
   * it. Appending a second one would leave every `.example-*` locator and the
   * load button matching twice, which Playwright's strict mode rejects. The
   * append branch is kept so the spec still says what it is testing when run
   * against a tree where the mount has been reverted.
   */
  async function mountPanel(page: Page): Promise<void> {
    await page.evaluate(async () => {
      if (document.querySelector('.example-cohort') !== null) return;
      const specifier = '/src/demo/example-cohort-ui.ts';
      const module = (await import(specifier)) as {
        mountExampleCohortPanel: (context: unknown) => HTMLElement;
      };
      const store = (globalThis as unknown as Record<string, unknown>)['__barnestrackStore'];
      const panel = module.mountExampleCohortPanel({
        store,
        announce: () => {},
      });
      const host = document.querySelector('#panel-videos .pickers') ?? document.body;
      host.append(panel);
    });
    await expect(page.locator('.example-cohort')).toBeVisible();
  }

  test('the panel this chunk adds is itself accessible', async ({ page }) => {
    await loadExampleViaModule(page);
    await mountPanel(page);

    // Its own controls, with the banner showing. The per-clip fetch button is
    // gone: chunk 10b folded consent and all three downloads into one dialog.
    await expect(page.locator('.example-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: LOAD_BUTTON_LABEL })).toBeVisible();

    const failures = reportViolations('Videos+panel', await scanForViolations(page));
    expect(failures, `serious/critical violations: ${JSON.stringify(failures, null, 2)}`).toEqual(
      [],
    );
  });

  test('Escape cancels the replace confirmation, even after tabbing inside it', async ({ page }) => {
    // A session with work in it, so loading has to ask first.
    await page.evaluate(() => {
      const store = (globalThis as unknown as Record<string, unknown>)['__barnestrackStore'] as {
        addVideo: (video: unknown) => unknown;
      };
      store.addVideo({
        filename: 'mine.mp4',
        fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'a'.repeat(64) },
        referenceResolution: { width: 640, height: 480 },
      });
    });
    await mountPanel(page);

    await page.getByRole('button', { name: LOAD_BUTTON_LABEL }).click();
    // Chunk 10b: the load button opens the network-consent dialog first (D2),
    // and the replace confirmation follows it.
    await page.locator('.example-dialog .primary').click();
    const confirm = page.locator('.example-cohort .confirm');
    await expect(confirm).toBeVisible();

    // Tab first: `{ once: true }` on the keydown listener used to be consumed
    // by this, leaving Escape dead.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');

    await expect(confirm).toBeHidden();
    // Focus comes back to the button, which must not be left disabled.
    const load = page.getByRole('button', { name: LOAD_BUTTON_LABEL });
    await expect(load).toBeEnabled();
    await expect(load).toBeFocused();
    // Cancelled means the user's own video is still there.
    await expect(page.locator('.video-card h3')).toHaveText(['mine.mp4']);
  });

  test('says on screen where the example numbers came from', async ({ page }) => {
    await loadExampleViaModule(page);
    await mountPanel(page);

    await expect(page.locator('.example-provenance')).toHaveText(
      'These are real results: the tracking run recorded in the demo at commit bc81fe7, ' +
        'with the corrections made during it.',
    );
  });

  test('has no serious or critical accessibility violations on the steps that render', async ({
    page,
  }) => {
    await loadExampleViaModule(page);
    await expect(page.locator('.video-card')).toHaveCount(3);

    const failures: AxeViolation[] = [];
    for (const step of ['Videos', 'Maze', 'Track']) {
      await page.getByRole('tab', { name: new RegExp(step) }).click();
      await expect(page.locator(`#panel-${step.toLowerCase()}`)).toBeVisible();
      failures.push(...reportViolations(step, await scanForViolations(page)));
    }

    // The Review step is a placeholder until chunk 6; scanning it here would
    // report on markup that is about to be replaced wholesale.
    expect(failures, `serious/critical violations: ${JSON.stringify(failures, null, 2)}`).toEqual(
      [],
    );
  });
});

/** The six entries of D11, in the order `buildExportBundle` writes them. */
const BUNDLE_ENTRIES = [
  'trials.csv',
  'events.csv',
  'quality.csv',
  'parameters.json',
  'Example cohort.barnestrack.json',
  'barnestrack_export.xlsx',
];

/** The identifier columns `trials.csv` opens with (docs/data-contracts.md §7, D11). */
const TRIAL_IDENTITY_COLUMNS = ['session_id', 'video_id', 'animal', 'day', 'trial_label', 'group'];

/** The one `.empty` the example cohort shows on purpose: test50 has no gap in its trial window. */
const EXPECTED_VISIBLE_EMPTY = ['No gaps in the trial window: every frame was positioned.'];

test.describe('the whole demo flow through the shipped UI', () => {
  test.skip(!distBuilt, 'no dist/ — run `npm run build` first');

  test('load, review, correct, retune, export, reload', async ({ page }) => {
    // The results-only path makes no request off the page's own origin (D2,
    // D33). Every other request is recorded and fails the run below; the
    // sample-data repository is also refused outright, so a regression cannot
    // download three clips before the assertion catches it.
    const networkRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(PREVIEW_URL) && !/^(data|blob):/.test(url)) networkRequests.push(url);
    });
    await page.route('https://raw.githubusercontent.com/**', (route) => route.abort());
    await page.goto(PREVIEW_URL);
    await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
    await clearStoredSession(page);
    await page.reload();

    // 1. The example cohort, through the button and the "results only" choice.
    await page.getByRole('button', { name: LOAD_BUTTON_LABEL }).click();
    await page.getByRole('button', { name: 'Load the results only' }).click();
    await expect(page.locator('.video-card')).toHaveCount(3);
    await expect(page.locator('.video-card .badge')).toHaveText([
      'video not attached',
      'video not attached',
      'video not attached',
    ]);

    // 2. A metric of the first trial, read with no video attached.
    await page.getByRole('tab', { name: /Review/ }).click();
    const reviewPanel = page.locator('#panel-review');
    await expect(reviewPanel).toBeVisible();
    const primaryErrors = page
      .locator('#review-metrics .metric-row')
      .filter({ has: page.locator('.metric-name', { hasText: /^Primary errors$/ }) })
      .locator('.metric-value');
    await expect(primaryErrors).toHaveText(/^\d+$/);
    const errorsBefore = Number(await primaryErrors.textContent());
    console.log(`shipped UI: vid_01 primary errors ${errorsBefore} with no video attached`);
    await expect(reviewPanel.locator('canvas').first()).toBeVisible();

    // Every `.empty` placeholder on the page is hidden, bar the one that is
    // content: the quality panel's "no gaps" line for a gap-free trial.
    const visibleEmpty = await page
      .locator('.empty')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).getClientRects().length > 0)
          .map((node) => node.textContent ?? ''),
      );
    expect(visibleEmpty).toEqual(EXPECTED_VISIBLE_EMPTY);

    // 3. Select an event from the keyboard and keep it: one more correction.
    const corrections = page.locator('#panel-review .corrections-list li');
    const correctionsBefore = await corrections.count();
    await page.locator('#panel-review .timeline-surface').focus();
    await page.keyboard.press('e');
    await expect(page.locator('#review-events-mirror tbody tr.is-selected')).toHaveCount(1);
    await page.keyboard.press('k');
    await expect(corrections).toHaveCount(correctionsBefore + 1);
    await expect(corrections.last()).toContainText('confirmed by the user, no change');
    // Matched to its automatic event under the parameters it was made with; the
    // retune below orphans it, and the reload check compares that state.
    await expect(corrections.last()).not.toContainText('no longer matches');
    const keptEvent = /Event (\S+) confirmed by the user/.exec((await corrections.last().textContent()) ?? '')?.[1];
    expect(keptEvent).toBeDefined();
    console.log(`shipped UI: kept ${keptEvent} with K; corrections ${correctionsBefore} → ${correctionsBefore + 1}`);

    // 4. A threshold through the parameters panel: the block opens first.
    const qualityHash = page
      .locator('#review-quality .metric-note')
      .filter({ hasText: /^Parameters hash: / });
    const hashBefore = await qualityHash.textContent();
    const eventCount = reviewPanel.locator('.event-count');
    const countBefore = await eventCount.textContent();
    const badge = reviewPanel.locator('#review-parameters .diff-badge');
    const badgeBefore = await badge.textContent();
    const block = page.locator('#review-parameters details.param-block[data-block="holeInvestigation"]');
    // `:scope >`: each row inside carries its own "Definition" disclosure.
    await block.locator(':scope > summary').click();
    await expect(block).toHaveAttribute('open', '');
    const radiusFactor = block.getByLabel('Radius factor', { exact: true });
    await radiusFactor.fill('3');
    await radiusFactor.blur();
    await expect(eventCount).not.toHaveText(countBefore ?? '');
    await expect(qualityHash).not.toHaveText(hashBefore ?? '');
    await expect(badge).not.toHaveText(badgeBefore ?? '');
    await expect(badge).toHaveText(/\S/);
    console.log(`shipped UI: event count "${countBefore}" → "${await eventCount.textContent()}"`);
    console.log(`shipped UI: diff badge "${await badge.textContent()}"`);
    const errorsAfter = Number(await primaryErrors.textContent());

    // 5. The bundle the browser downloads, opened and read.
    const bundle = await downloadBundle(page);
    console.log(`shipped UI: ${bundle.zipName} holds ${JSON.stringify([...bundle.entries.keys()])}`);
    expect([...bundle.entries.keys()]).toEqual(BUNDLE_ENTRIES);
    const trials = csvRows(bundle.text('trials.csv'));
    console.log(`shipped UI: trials.csv header ${trials[0]!.join(',')}`);
    expect(trials[0]!.slice(0, TRIAL_IDENTITY_COLUMNS.length)).toEqual(TRIAL_IDENTITY_COLUMNS);
    expect(trials.slice(1)).toHaveLength(3);

    // parameters.json is the parameter set itself (data-contracts §7), so its
    // hash is reconciled here rather than read from a field: the set shipped in
    // the ZIP hashes to every row's parameters_hash and to the hash on screen.
    const shownHash = (await qualityHash.textContent())!.replace('Parameters hash: ', '');
    const parametersJson = JSON.parse(bundle.text('parameters.json')) as Parameters;
    expect(hashParameters(parametersJson)).toBe(shownHash);
    expect(column(trials, 'parameters_hash')).toEqual([shownHash, shownHash, shownHash]);
    for (const version of column(trials, 'tool_version')) expect(version).toMatch(/^barnestrack v\d+\.\d+\.\d+/);
    // The number on screen is the number in the file.
    expect(column(trials, 'primary_errors')[0]).toBe(String(errorsAfter));
    expect(networkRequests).toEqual([]);

    // 6. Reload once the autosave has landed (§1.2): the header's settled
    // signal, driven by the store's autosaveState. The correction is compared
    // as it reads now, after the retune: a parameter change can orphan an event
    // correction (docs/known-limitations.md), and the list says so.
    const correctionBeforeReload = await corrections.last().textContent();
    expect(correctionBeforeReload).toContain(`Event ${keptEvent} confirmed by the user`);
    await expect(page.locator('.save-state.is-saved')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator('.video-card')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('#session-name')).toHaveValue('Example cohort');
    await page.getByRole('tab', { name: /Review/ }).click();
    await expect(corrections).toHaveCount(correctionsBefore + 1);
    await expect(corrections.last()).toHaveText(correctionBeforeReload ?? '');
    await expect(qualityHash).toHaveText(`Parameters hash: ${shownHash}`);
  });
});
