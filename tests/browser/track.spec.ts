/**
 * The chunk-4 acceptance checks a manual pass cannot make honestly: that a
 * real tracking pass in a real worker produces a real automatic layer, that
 * cancelling leaves nothing behind, and that re-tracking does not touch a
 * corrections layer.
 *
 * Like the other browser specs this runs against the installed Google Chrome
 * and is not part of CI; it is skipped unless BARNESTRACK_SAMPLE_DIR points at
 * the sample-data folder. The rest of the chunk's acceptance list is a manual
 * Chrome pass, recorded in README.md.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
const APP_URL = '/';

/** test53 and test50 share a rig: platform at (327.8, 239.7) px, radius 208.5. */
const PLATFORM = { cx: 327.8, cy: 239.7, r: 208.5, diameter_cm: 92 };

const sample = (name: string): string => join(SAMPLE_DIR ?? '', name);

test.skip(
  SAMPLE_DIR === undefined,
  'set BARNESTRACK_SAMPLE_DIR to the sample-data folder to run the tracking browser checks',
);

interface DroppedFile {
  name: string;
  base64: string;
}

async function dropFiles(page: Page, paths: string[]): Promise<void> {
  const files: DroppedFile[] = paths.map((path) => ({
    name: basename(path),
    base64: readFileSync(path).toString('base64'),
  }));
  await page.evaluate((dropped: DroppedFile[]) => {
    const transfer = new DataTransfer();
    for (const file of dropped) {
      const binary = atob(file.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], file.name, { type: 'video/mp4' }));
    }
    const zone = document.querySelector('.drop-zone');
    if (!zone) throw new Error('no drop zone on the page');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, files);
}

async function setNumber(page: Page, label: string, value: number): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
}

/** A finished maze built from the numeric fields alone — no clicking on the image. */
async function buildMaze(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Maze/ }).click();
  await setNumber(page, 'Centre x (px)', PLATFORM.cx);
  await setNumber(page, 'Centre y (px)', PLATFORM.cy);
  await setNumber(page, 'Radius (px)', PLATFORM.r);
  await setNumber(page, 'Platform diameter (cm)', PLATFORM.diameter_cm);
}

function trackCard(page: Page) {
  return page.locator('.track-card').first();
}

/**
 * Waits for the autosave to land. A reload inside the debounce window can lose
 * the last change — a documented limitation the header exists to warn about —
 * so a test that reloads must wait for the same signal a user is told to.
 */
async function waitForSave(page: Page): Promise<void> {
  await expect(page.locator('.save-state')).toHaveText('All changes saved in this browser', {
    timeout: 30_000,
  });
}

async function openTrackingParameters(page: Page): Promise<void> {
  await page.locator('#panel-track summary', { hasText: 'Tracking parameters' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  await page.evaluate(() => indexedDB.deleteDatabase('barnestrack'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
});

test('the Track step says why it is blocked until the maze is finished', async ({ page }) => {
  await dropFiles(page, [sample('test53.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });

  await page.getByRole('tab', { name: /Track/ }).click();
  await expect(page.locator('#panel-track')).toContainText('the maze is not finished');

  await buildMaze(page);
  await page.getByRole('tab', { name: /Track/ }).click();
  await expect(trackCard(page).getByRole('button', { name: 'Track', exact: true })).toBeEnabled();
});

test('a pass writes an automatic layer that survives a reload', async ({ page }) => {
  await dropFiles(page, [sample('test53.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });
  await buildMaze(page);

  await page.getByRole('tab', { name: /Track/ }).click();
  const card = trackCard(page);
  await card.getByRole('button', { name: 'Track', exact: true }).click();

  // The thumbnail must be labelled provisional the whole time it is shown.
  await expect(card.locator('.track-preview-caption')).toContainText(
    'provisional — final track computed at end of pass',
    { timeout: 120_000 },
  );

  await expect(card.locator('.track-status')).toContainText('Tracked ·', { timeout: 240_000 });
  await expect(card.locator('.track-status')).toContainText('% of frames');

  // test53 is 905 frames; the layer must be the whole video, not a prefix.
  const frames = await page.evaluate(() => document.querySelector('.track-detail')?.textContent ?? '');
  expect(frames).toContain('905 frames');

  await waitForSave(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  await page.getByRole('tab', { name: /Track/ }).click();
  await expect(trackCard(page).locator('.track-status')).toContainText('905 frames on record', {
    timeout: 30_000,
  });
});

test('cancelling mid-pass leaves the video untracked, never half-written', async ({ page }) => {
  await dropFiles(page, [sample('test50.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 120_000 });
  await buildMaze(page);

  await page.getByRole('tab', { name: /Track/ }).click();
  const card = trackCard(page);
  await card.getByRole('button', { name: 'Track', exact: true }).click();

  await expect(card.locator('.track-status')).toContainText('Tracking', { timeout: 120_000 });
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(card.locator('.track-status')).toContainText('Cancelled', { timeout: 60_000 });
  await expect(card.locator('.track-status')).toContainText('still untracked');

  const analyses = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('barnestrack');
        request.onerror = () => reject(new Error('could not open the database'));
        request.onsuccess = () => {
          const tx = request.result.transaction('sessions', 'readonly');
          const get = tx.objectStore('sessions').get('current');
          get.onsuccess = () => {
            const record = get.result as { file?: { analyses?: Record<string, unknown> } } | undefined;
            resolve(Object.keys(record?.file?.analyses ?? {}));
          };
          get.onerror = () => reject(new Error('could not read the record'));
        };
      }),
  );
  expect(analyses).toEqual([]);
});

test('re-tracking replaces the automatic layer and leaves corrections alone', async ({ page }) => {
  // Two full passes over the same video, plus intake.
  test.setTimeout(600_000);
  await dropFiles(page, [sample('test53.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });
  await buildMaze(page);

  await page.getByRole('tab', { name: /Track/ }).click();
  const card = trackCard(page);
  await card.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(card.locator('.track-status')).toContainText('Tracked ·', { timeout: 240_000 });

  // A correction made by hand between the two runs. The correction UI lands in
  // a later chunk, so this plants one directly in the layer the store holds.
  await page.evaluate(() => {
    const store = (window as unknown as { __barnestrackStore?: unknown }).__barnestrackStore;
    if (!store) throw new Error('the session store is not exposed for testing');
    const session = (store as { current: { analyses: Record<string, Record<string, unknown>> } }).current;
    const analysis = session.analyses['vid_01'];
    if (!analysis) throw new Error('no analysis to correct');
    analysis['corrections'] = {
      entries: [
        {
          kind: 'point',
          id: 'corr_test',
          timestamp: '2026-09-06T12:00:00.000Z',
          source: 'user',
          frameIndex: 200,
          point: 'nose',
          value: { x: 1, y: 2, confidence: 1, valid: true },
        },
      ],
    };
  });

  // Change a threshold so the second run has a different parameters hash.
  await openTrackingParameters(page);
  await setNumber(page, 'Smallest blob (cm²)', 5);

  await card.getByRole('button', { name: 'Track again', exact: true }).click();
  await expect(card.locator('.track-status')).toContainText('Tracked ·', { timeout: 240_000 });

  const kept = await page.evaluate(() => {
    const store = (window as unknown as { __barnestrackStore?: unknown }).__barnestrackStore;
    const session = (store as { current: { analyses: Record<string, { corrections: { entries: unknown[] } }> } })
      .current;
    return session.analyses['vid_01']?.corrections.entries.length ?? -1;
  });
  expect(kept).toBe(1);
});
