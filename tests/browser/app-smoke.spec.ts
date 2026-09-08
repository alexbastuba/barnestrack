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
 *    the example cohort, read metrics and figures with no video attached, move
 *    a threshold and watch the event count change, download the export bundle,
 *    reload and find the session still there. This is what §4 asks for; it is
 *    skipped with a message naming the missing mount until chunks 6 and 9c are
 *    merged, and needs no edit when they are.
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

  test('says on screen that the example numbers are illustrative', async ({ page }) => {
    await loadExampleViaModule(page);
    await mountPanel(page);

    await expect(page.locator('.example-provenance')).toHaveText(
      'These results are illustrative, not a real tracking run of these clips.',
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

test.describe('the whole demo flow through the shipped UI', () => {
  test.skip(!distBuilt, 'no dist/ — run `npm run build` first');

  test('load, review, retune, export, reload', async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
    await clearStoredSession(page);
    await page.reload();

    const loadButton = page.getByRole('button', { name: LOAD_BUTTON_LABEL });
    if ((await loadButton.count()) === 0) {
      test.skip(
        true,
        'mountExampleCohortPanel is not mounted into src/ui/videos-step.ts, so there is no ' +
          '"Load example cohort" button in the built app.',
      );
    }
    await loadButton.click();
    // Chunk 10b: consent to the one network request before it is made (D2).
    await page.locator('.example-dialog .primary').click();
    await expect(page.locator('.video-card')).toHaveCount(3);
    await expect(page.locator('.video-card .badge')).toHaveText([
      'video not attached',
      'video not attached',
      'video not attached',
    ]);

    // Review renders every result with no video attached.
    await page.getByRole('tab', { name: /Review/ }).click();
    const reviewPanel = page.locator('#panel-review');
    await expect(reviewPanel).toBeVisible();

    // Everything from here is chunk 7b's: the parameters panel to retune, the
    // live event count to watch, and the export button — which 7b ships as
    // "Export bundle (.zip)". Chunk 9c-a mounted the loader while 7b was still
    // in flight, which un-skipped this test through the guard above, so the
    // skip moved here rather than letting it fail on 7b's absence. Chunk 9c-b
    // deletes this block once 7b is merged.
    if ((await reviewPanel.getByRole('button', { name: /Export bundle/i }).count()) === 0) {
      test.skip(
        true,
        "chunk 7b's Review export has not landed, so there is no \"Export bundle\" button to " +
          'download and no live event count to retune against. Chunk 9c-b un-skips this after ' +
          '7b is merged.',
      );
    }

    await expect(reviewPanel.locator('.empty')).toHaveCount(0);
    await expect(reviewPanel.locator('canvas').first()).toBeVisible();

    // A threshold change moves the event count (D20).
    const eventCount = reviewPanel.locator('[data-testid="event-count"]').first();
    const before = await eventCount.textContent();
    const radiusFactor = page.getByLabel(/radius factor/i).first();
    await radiusFactor.fill('3');
    await radiusFactor.blur();
    await expect(eventCount).not.toHaveText(before ?? '');

    // The export bundle carries the six files of D11.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      // Chunk 7b's button, which did not exist when this spec was written.
      page.getByRole('button', { name: /Export bundle \(\.zip\)/i }).click(),
    ]);
    const zipPath = await download.path();
    const { readFileSync } = await import('node:fs');
    // Entry names are stored uncompressed in the local headers, so the six
    // files of D11 are readable without unpacking the archive.
    const zipText = readFileSync(zipPath).toString('latin1');
    for (const name of [
      'trials.csv',
      'events.csv',
      'quality.csv',
      'parameters.json',
      'barnestrack_export.xlsx',
      '.barnestrack.json',
    ]) {
      expect(zipText, `${name} missing from the export bundle`).toContain(name);
    }

    await page.reload();
    await expect(page.locator('.video-card')).toHaveCount(3, { timeout: 30_000 });
  });
});
