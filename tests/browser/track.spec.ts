/**
 * Tracking in a real worker on a real decoder, in two parts.
 *
 * 1. **A generated maze clip, every run (chunk 11).** `encodeSyntheticMazeClip`
 *    draws a platform and a mouse-sized blob walking to a hole, ffmpeg encodes
 *    it with libx264, and the clip goes through the shipped intake input,
 *    the maze fields, a tracking pass, the Review step and the export — decode
 *    → track → analyse → export with no committed video (D35). The assertions
 *    read the DOM tables and the downloaded ZIP (D37), never pixels. Skipped
 *    only when ffmpeg with libx264 is missing; CI installs it.
 *
 * 2. **The sample videos (chunk 4).** The acceptance checks a manual pass
 *    cannot make honestly: that a real pass produces a real automatic layer,
 *    that cancelling leaves nothing behind, and that re-tracking does not touch
 *    a corrections layer. Skipped unless BARNESTRACK_SAMPLE_DIR points at the
 *    sample-data folder. The rest of chunk 4's acceptance list is a manual
 *    Chrome pass, recorded in README.md.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  SKIP_REASON,
  encodeSyntheticMazeClip,
  ffmpegHasLibx264,
  type SyntheticMazeClip,
} from '../video/synthetic-clip.js';
import { column, csvRows, downloadBundle } from './bundle-download.js';

const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
const APP_URL = '/';

interface Platform {
  cx: number;
  cy: number;
  r: number;
  diameter_cm: number;
}

/** test53 and test50 share a rig: platform at (327.8, 239.7) px, radius 208.5. */
const PLATFORM: Platform = { cx: 327.8, cy: 239.7, r: 208.5, diameter_cm: 92 };

const sample = (name: string): string => join(SAMPLE_DIR ?? '', name);

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
async function buildMaze(page: Page, platform: Platform = PLATFORM): Promise<void> {
  await page.getByRole('tab', { name: /Maze/ }).click();
  await setNumber(page, 'Centre x (px)', platform.cx);
  await setNumber(page, 'Centre y (px)', platform.cy);
  await setNumber(page, 'Radius (px)', platform.r);
  await setNumber(page, 'Platform diameter (cm)', platform.diameter_cm);
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

test.describe('a generated maze clip, decode → track → analyse → export', () => {
  // Skips on a machine without ffmpeg, never in CI: there the job installs it,
  // and a skip would turn the one end-to-end tracking check green by omission.
  test.skip(!ffmpegHasLibx264() && process.env['CI'] === undefined, SKIP_REASON);
  let clip: SyntheticMazeClip;
  test.beforeAll(() => {
    clip = encodeSyntheticMazeClip();
  });
  test.afterAll(() => clip?.cleanup());

  test('a blob that walks to the target hole is positioned, investigates it and exports one trial', async ({
    page,
  }) => {
    // The shipped intake input, the way frame-server.spec.ts hands over its clip.
    await page.setInputFiles('#choose-videos', clip.path);
    await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });

    await buildMaze(page, { ...clip.platform, diameter_cm: clip.platformDiameter_cm });
    await setNumber(page, 'Target hole number', clip.targetHole);

    await page.getByRole('tab', { name: /Track/ }).click();
    const card = trackCard(page);
    await card.getByRole('button', { name: 'Track', exact: true }).click();
    await expect(card.locator('.track-status')).toContainText('Tracked ·', { timeout: 120_000 });
    console.log(`synthetic clip: ${await card.locator('.track-status').textContent()}`);
    console.log(`synthetic clip: ${await card.locator('.track-detail').textContent()}`);
    await expect(card.locator('.track-detail')).toContainText(`${clip.frameCount} frames`);

    await page.getByRole('tab', { name: /Review/ }).click();
    await expect(page.locator('#panel-review .review-timing')).toContainText('Recomputed in');

    // The quality panel's headline figure, read as text from its <dl>.
    const positioned = page
      .locator('#review-quality .quality-figure')
      .filter({ has: page.locator('dt', { hasText: /^Positioned \(trial window\)$/ }) })
      .locator('dd')
      .first();
    await expect(positioned).toHaveText(/^\d+(\.\d+)? %$/);
    const positionedPercent = Number.parseFloat((await positioned.textContent()) ?? '');
    console.log(`synthetic clip: positioned (trial window) ${positionedPercent} %`);
    expect(positionedPercent).toBeGreaterThanOrEqual(90);

    // The blob parks on the ring, so the event list has something in it.
    await expect(page.locator('#panel-review .event-count')).not.toHaveText(/^0 investigations/);
    console.log(`synthetic clip: ${await page.locator('#panel-review .event-count').textContent()}`);
    // `.first()`: each row carries its own "Evidence" disclosure inside this one.
    await page.locator('#review-events-mirror summary').first().click();
    const eventRows = page.locator('#review-events-mirror tbody tr');
    await expect(eventRows.first()).toBeVisible();
    const headers = await page.locator('#review-events-mirror thead th').allTextContents();
    for (const row of await eventRows.all()) {
      // The first cell is the row's header (the seek button), the rest are data.
      const cells = await row.locator(':scope > th, :scope > td').allTextContents();
      console.log(
        `synthetic clip: event ${headers
          .slice(0, 11)
          .map((header, i) => `${header}=${cells[i]?.trim() ?? ''}`)
          .join(' · ')}`,
      );
    }
    expect(await eventRows.count()).toBeGreaterThanOrEqual(1);

    const bundle = await downloadBundle(page);
    const trials = csvRows(bundle.text('trials.csv'));
    expect(trials.slice(1)).toHaveLength(1);
    const status = column(trials, 'status')[0];
    console.log(
      `synthetic clip: trials.csv status=${status} escaped=${column(trials, 'escaped')[0]} ` +
        `primary_latency_s=${column(trials, 'primary_latency_s')[0]} ` +
        `tracked_fraction=${column(trials, 'tracked_fraction')[0]}`,
    );
    // The animal stays visible at the target, so there is no escape entry: the
    // trial is `review` by construction, and must never be `unresolved`.
    expect(status).not.toBe('unresolved');
  });
});

test.describe('the sample videos (BARNESTRACK_SAMPLE_DIR)', () => {
  test.skip(
    SAMPLE_DIR === undefined,
    'set BARNESTRACK_SAMPLE_DIR to the sample-data folder to run the tracking browser checks',
  );

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

    const firstHash = await page.evaluate(() => {
      const store = (window as unknown as { __barnestrackStore?: unknown }).__barnestrackStore;
      const session = (
        store as { current: { analyses: Record<string, { auto: { parametersHash: string } }> } }
      ).current;
      return session.analyses['vid_01']?.auto.parametersHash ?? '';
    });
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);

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

    const after = await page.evaluate(() => {
      const store = (window as unknown as { __barnestrackStore?: unknown }).__barnestrackStore;
      const session = (
        store as {
          current: {
            analyses: Record<
              string,
              { auto: { parametersHash: string; frames: unknown[] }; corrections: { entries: unknown[] } }
            >;
          };
        }
      ).current;
      const analysis = session.analyses['vid_01'];
      return {
        corrections: analysis?.corrections.entries.length ?? -1,
        hash: analysis?.auto.parametersHash ?? '',
        frames: analysis?.auto.frames.length ?? -1,
      };
    });
    expect(after.corrections).toBe(1);
    // The other half of the title: the layer was genuinely replaced, under the
    // hash of the changed parameters, not left as the first run's.
    expect(after.hash).not.toBe(firstHash);
    expect(after.frames).toBe(905);
  });
});
