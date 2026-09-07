/**
 * The chunk-6 acceptance checks that need a real decoder, a real worker and a
 * real keyboard: a correction made through the review step's keys recomputes
 * the analysis and reaches the DOM mirrors, a relabel through the hole select
 * marks the event as the user's, a threshold change leaves both pinned, all of
 * it survives a reload through the autosave (D27), and Space plays at the
 * video's own frame rate.
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

/** test53's rig: platform at (327.8, 239.7) px, radius 208.5. */
const PLATFORM = { cx: 327.8, cy: 239.7, r: 208.5, diameter_cm: 92 };

const sample = (name: string): string => join(SAMPLE_DIR ?? '', name);

test.skip(
  SAMPLE_DIR === undefined,
  'set BARNESTRACK_SAMPLE_DIR to the sample-data folder to run the review browser checks',
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

async function trackFirstVideo(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Track/ }).click();
  const card = page.locator('.track-card').first();
  await card.getByRole('button', { name: 'Track', exact: true }).click();
  await expect(card.locator('.track-status')).toContainText('Tracked ·', { timeout: 240_000 });
}

async function waitForSave(page: Page): Promise<void> {
  await expect(page.locator('.save-state')).toHaveText('All changes saved in this browser', {
    timeout: 30_000,
  });
}

async function openReview(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Review/ }).click();
  await expect(page.locator('#panel-review .review-timing')).toContainText('Recomputed in');
}

/** The review step's keys are read from the step; the timeline is its keyboard home. */
async function focusTimeline(page: Page): Promise<void> {
  await page.locator('#panel-review .timeline-surface').focus();
}

async function seekTo(page: Page, frame: number): Promise<void> {
  await focusTimeline(page);
  await page.keyboard.press('f');
  await page.locator('#panel-review .frame-number').fill(String(frame));
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-review .frame-readout')).toContainText(`Frame ${frame} of`);
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  await page.evaluate(() => indexedDB.deleteDatabase('barnestrack'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
});

test('corrections made from the keyboard recompute, stay pinned across a threshold change and survive a reload', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await dropFiles(page, [sample('test53.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });
  await buildMaze(page);
  await trackFirstVideo(page);
  await openReview(page);

  const status = page.locator('#app-status');
  const rows = page.locator('#review-events tbody tr');
  await expect(rows.first()).toBeVisible();
  const eventCount = await rows.count();
  expect(eventCount).toBeGreaterThan(0);

  // A nose placed by hand on the first event's first frame: one coalesced entry,
  // the frame's nose source reads "corrected", and the analysis recomputed.
  const framesText = await rows.first().locator('td').nth(2).textContent();
  const startFrame = Number(framesText?.split('–')[0]);
  expect(Number.isInteger(startFrame)).toBe(true);
  await seekTo(page, startFrame);
  await page.keyboard.press('n');
  await expect(status).toContainText('Nose armed');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(status).toContainText(`Nose placed by hand on frame ${startFrame}`);
  await expect(status).toContainText('Recomputed in');
  await expect(page.locator('.corrections-list li')).toHaveCount(1);
  const frameRow = page.locator('#panel-review .mirror-table tbody tr.is-target').first();
  await expect(frameRow).toContainText('corrected');
  await page.keyboard.press('Escape');

  // A frame the tracker did not position at all (test53's empty platform before the animal is
  // placed): the first nudge seeds the point from the keyboard instead of refusing.
  await seekTo(page, 10);
  await page.keyboard.press('n');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(status).toContainText('was not positioned on frame 10, so it was placed at the platform centre');
  await expect(page.locator('.corrections-list li')).toHaveCount(2);
  await page.keyboard.press('Escape');
  // Undo that one so the rest of the scenario counts entries as before.
  await page.locator('.corrections-list li').last().getByRole('button', { name: 'Revert to automatic' }).click();
  await expect(page.locator('.corrections-list li')).toHaveCount(1);

  // The first event moved to the next hole through the hole select: the row is
  // hatched, says "user" and keeps the automatic hole beside it.
  await rows.first().locator('button').click();
  await expect(rows.first()).toHaveClass(/is-selected/);
  const holeText = await rows.first().locator('td').nth(0).textContent();
  const hole = Number(holeText);
  const nextHole = (hole + 1) % 20;
  await focusTimeline(page);
  await page.keyboard.press('h');
  await page.locator('#panel-review select[aria-label="Hole of the selected event"]').selectOption(String(nextHole));
  await expect(status).toContainText(`Event moved from hole ${hole} to hole ${nextHole}`);
  await expect(rows.first()).toHaveClass(/is-corrected/);
  await expect(rows.first()).toContainText(`user (auto: hole ${hole}`);
  await expect(page.locator('.corrections-list li')).toHaveCount(2);

  // A threshold change recomputes everything and leaves both corrections pinned (D20).
  const hashBefore = await page.locator('#panel-review .review-timing').textContent();
  await setNumber(page, 'holeInvestigation.minDuration_s (s)', 2);
  await expect(status).toContainText('holeInvestigation.minDuration_s set to 2');
  await expect(page.locator('#panel-review .review-timing')).not.toHaveText(hashBefore ?? '');
  await expect(rows.first()).toHaveClass(/is-corrected/);
  await expect(rows.first()).toContainText(`user (auto: hole ${hole}`);
  await expect(page.locator('.corrections-list li')).toHaveCount(2);

  // Everything above came back from IndexedDB, not from memory (D27).
  await waitForSave(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  await openReview(page);
  await expect(page.locator('.corrections-list li')).toHaveCount(2);
  await expect(page.locator('#review-events tbody tr').first()).toHaveClass(/is-corrected/);
  await expect(page.locator('#review-events tbody tr').first()).toContainText(`user (auto: hole ${hole}`);
  await expect(page.getByLabel('holeInvestigation.minDuration_s (s)', { exact: true })).toHaveValue('2');
  await expect(page.locator('#panel-review .review-note')).toBeVisible();
  await expect(page.locator('#panel-review .review-note')).toContainText('not attached');
});

test('Space plays at the video’s own frame rate and pauses on the frame it reached', async ({ page }) => {
  test.setTimeout(600_000);
  await dropFiles(page, [sample('test53.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(1, { timeout: 60_000 });
  await buildMaze(page);
  await trackFirstVideo(page);
  await openReview(page);

  await seekTo(page, 100);
  await page.keyboard.press('Space');
  await expect(page.locator('#app-status')).toContainText('Playing at normal speed');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Space');
  const paused = await page.locator('#app-status').textContent();
  const match = /Paused at frame (\d+)/.exec(paused ?? '');
  expect(match).not.toBeNull();
  // test53 is 30 fps: one second of play is about 30 frames, allowing for the decoder.
  const frame = Number(match![1]);
  expect(frame).toBeGreaterThan(115);
  expect(frame).toBeLessThan(145);
});
