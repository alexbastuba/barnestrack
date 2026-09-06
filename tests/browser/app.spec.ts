/**
 * The three acceptance checks of chunk 3 that a manual pass cannot make
 * honestly: a real `drop` event (the file picker exercises a different code
 * path), re-attaching by fingerprint across a reload, and the session file
 * surviving save → reset → load unchanged.
 *
 * Everything else in the chunk's acceptance list is a manual Chrome pass,
 * recorded in `tests/browser/README.md`. Like chunk 1's spec this runs against
 * the installed Google Chrome and is not part of CI; it is skipped unless
 * BARNESTRACK_SAMPLE_DIR points at the sample-data folder.
 */
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
const APP_URL = '/';

const sample = (name: string): string => join(SAMPLE_DIR ?? '', name);

test.skip(
  SAMPLE_DIR === undefined,
  'set BARNESTRACK_SAMPLE_DIR to the sample-data folder to run the app browser checks',
);

interface DroppedFile {
  name: string;
  base64: string;
}

/**
 * A genuine drop: a `DataTransfer` carrying real `File` objects, dispatched at
 * the drop zone. `setInputFiles` would exercise the picker instead.
 */
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

function cardFor(page: Page, filename: string) {
  return page.locator('.video-card').filter({ has: page.getByRole('heading', { name: filename, exact: true }) });
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
});

test('a real drop of three sample videos loads three cards', async ({ page }) => {
  await dropFiles(page, [sample('test53.mp4'), sample('test51.mp4'), sample('test50.mp4')]);

  await expect(page.locator('.video-card')).toHaveCount(3, { timeout: 60_000 });
  // Load order is preserved.
  await expect(page.locator('.video-card h3')).toHaveText(['test53.mp4', 'test51.mp4', 'test50.mp4']);
  await expect(page.locator('.video-card .badge')).toHaveText([
    'file attached',
    'file attached',
    'file attached',
  ]);
  await expect(cardFor(page, 'test53.mp4')).toContainText('905');
  await expect(cardFor(page, 'test51.mp4')).toContainText('14.985 fps');
  await expect(cardFor(page, 'test50.mp4')).toContainText('5539');
  await expect(page.locator('.privacy-note').first()).toHaveText(
    'Processed locally — this file never leaves your computer.',
  );

  // Dropping the same content again is reported, not added twice.
  await dropFiles(page, [sample('test51.mp4')]);
  await expect(page.locator('.notes li')).toContainText('already loaded');
  await expect(page.locator('.video-card')).toHaveCount(3);
});

test('a reload re-attaches by content, not by filename', async ({ page }) => {
  const scratch = mkdtempSync(join(tmpdir(), 'barnestrack-'));
  const renamed = join(scratch, 'mouse-07-day-3.mp4');
  copyFileSync(sample('test51.mp4'), renamed);

  await dropFiles(page, [sample('test53.mp4'), sample('test51.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator('.save-state')).toHaveText('All changes saved in this browser');

  await page.reload();
  await expect(page.locator('.video-card')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('.video-card .badge')).toHaveText(['video not attached', 'video not attached']);
  await expect(cardFor(page, 'test51.mp4')).toContainText('Drop test51.mp4 again to re-attach');

  // A renamed copy of test51 still re-attaches, and does not become a fourth video.
  await dropFiles(page, [renamed]);
  await expect(cardFor(page, 'test51.mp4').locator('.badge')).toHaveText('file attached', { timeout: 30_000 });
  await expect(page.locator('.video-card')).toHaveCount(2);
  await expect(cardFor(page, 'test53.mp4').locator('.badge')).toHaveText('video not attached');
  await expect(page.locator('#app-status')).toContainText('re-attached to test51.mp4');
});

test('save → reset → load returns the same session', async ({ page }) => {
  await dropFiles(page, [sample('test53.mp4'), sample('test51.mp4')]);
  await expect(page.locator('.video-card')).toHaveCount(2, { timeout: 60_000 });

  // Some state worth losing: metadata and a maze fitted from typed numbers only.
  await cardFor(page, 'test53.mp4').getByLabel('Animal').fill('07');
  await cardFor(page, 'test53.mp4').getByLabel('Group').fill('control');
  await cardFor(page, 'test53.mp4').getByLabel('Group').blur();
  await page.getByRole('tab', { name: /Maze/ }).click();
  await page.getByLabel('Centre x (px)').fill('327.8');
  await page.getByLabel('Centre y (px)').fill('239.7');
  await page.getByLabel('Radius (px)').fill('208.5');
  await page.getByLabel('Radius (px)').blur();
  await page.getByLabel('Ring angle of hole 0 (°)').fill('353.68');
  await page.getByLabel('Ring angle of hole 0 (°)').blur();
  await page.getByLabel('Target hole number').fill('11');
  await page.getByLabel('Target hole number').blur();
  await page.getByLabel('Platform diameter (cm)').fill('92');
  await page.getByLabel('Platform diameter (cm)').blur();
  await expect(page.locator('.scale-readout')).toContainText('px/cm');
  await expect(page.locator('.save-state')).toHaveText('All changes saved in this browser');

  const before = await saveSession(page);
  expect(before.name).toBe('test53');
  expect(before.mazeMap?.target.holeIndex).toBe(11);

  await page.getByRole('button', { name: 'Reset session' }).click();
  await page.getByRole('button', { name: 'Yes, reset everything' }).click();
  await expect(page.locator('.video-card')).toHaveCount(0);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load session file' }).click(),
  ]);
  await chooser.setFiles({
    name: 'test53.barnestrack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await expect(page.locator('.video-card')).toHaveCount(2);

  const after = await saveSession(page);
  // Deep equality on the parsed document: key order is not part of the contract.
  expect(after).toEqual(before);
});

interface SessionDocument {
  schemaVersion: number;
  name: string;
  videos: { id: string; filename: string }[];
  mazeMap: { target: { holeIndex: number } } | null;
  parameters: unknown;
}

async function saveSession(page: Page): Promise<SessionDocument> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save session file' }).click(),
  ]);
  const path = await download.path();
  return JSON.parse(readFileSync(path, 'utf-8')) as SessionDocument;
}
