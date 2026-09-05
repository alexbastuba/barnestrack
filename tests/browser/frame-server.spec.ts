/**
 * Runs the frame-server prototype page in Google Chrome and asserts its
 * verdict lines. The synthetic clip always runs (when ffmpeg is present);
 * the sample videos run when BARNESTRACK_SAMPLE_DIR is set and their
 * results JSON is written to test-results/frame-server/<name>.json for
 * prototypes/frame-server/RESULTS.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page, type Browser } from '@playwright/test';
import {
  SKIP_REASON,
  encodeSyntheticClip,
  ffmpegHasLibx264,
  type SyntheticClip,
} from '../video/synthetic-clip.js';

const PAGE_URL = '/prototypes/frame-server/';
const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
const RESULTS_DIR = 'test-results/frame-server';
/** Comma-separated page options for the sample-video runs: decode_order, latency, hardware. */
const OPTIONS = (process.env['BARNESTRACK_FRAME_SERVER_OPTIONS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OPTION_CHECKBOXES: Record<string, string> = {
  decode_order: '#optDecodeOrder',
  latency: '#optLatency',
  hardware: '#optHardware',
};

function chromeInstalled(): boolean {
  if (process.platform === 'darwin') return existsSync('/Applications/Google Chrome.app');
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].some(existsSync);
  }
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].some(existsSync);
}

interface Verdict {
  id: string;
  status: string;
  text: string;
}

async function runPage(
  page: Page,
  videoPath: string,
  options: string[] = [],
): Promise<{ verdicts: Verdict[]; json: string }> {
  await page.goto(PAGE_URL);
  for (const option of options) {
    const selector = OPTION_CHECKBOXES[option];
    if (!selector) throw new Error(`unknown option ${option}; use ${Object.keys(OPTION_CHECKBOXES).join(', ')}`);
    await page.check(selector);
  }
  await page.setInputFiles('#file', videoPath);
  await expect(page.locator('#status')).toHaveText(/^(Done|Failed)/, { timeout: 240_000 });
  const verdicts = await page.locator('li[data-verdict]').evaluateAll((items) =>
    items.map((li) => ({
      id: (li as HTMLElement).dataset['verdict'] ?? '',
      status: (li as HTMLElement).dataset['status'] ?? '',
      text: li.textContent ?? '',
    })),
  );
  const json = await page.locator('#json').inputValue();
  return { verdicts, json };
}

function verdictStatus(verdicts: Verdict[], id: string): string {
  return verdicts.find((v) => v.id === id)?.status ?? 'missing';
}

/** Peak resident memory (bytes) of Chrome's renderer and GPU processes, sampled with `ps` while `work` runs. */
async function withProcessMemory<T>(browser: Browser, work: () => Promise<T>): Promise<{ result: T; peaks: Record<string, number> }> {
  const peaks: Record<string, number> = {};
  if (process.platform === 'win32') return { result: await work(), peaks };
  const session = await browser.newBrowserCDPSession();
  const sample = async () => {
    try {
      const info = (await session.send('SystemInfo.getProcessInfo')) as {
        processInfo: { type: string; id: number }[];
      };
      for (const p of info.processInfo) {
        if (p.type !== 'renderer' && p.type !== 'GPU') continue;
        const rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(p.id)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
        if (Number.isFinite(rssKb)) peaks[p.type] = Math.max(peaks[p.type] ?? 0, rssKb * 1024);
      }
    } catch {
      // process list changed under us; sample again next tick
    }
  };
  const timer = setInterval(() => void sample(), 250);
  try {
    await sample();
    const result = await work();
    await sample();
    return { result, peaks };
  } finally {
    clearInterval(timer);
    await session.detach();
  }
}

test.describe('frame-server prototype', () => {
  test.skip(!chromeInstalled(), 'Google Chrome is not installed');

  test.describe('synthetic clip', () => {
    test.skip(!ffmpegHasLibx264(), SKIP_REASON);
    let clip: SyntheticClip;
    test.beforeAll(() => {
      clip = encodeSyntheticClip();
    });
    test.afterAll(() => clip?.cleanup());

    test('decodes every frame in order and random access matches the sequential pass', async ({ page }) => {
      const { verdicts, json } = await runPage(page, clip.path);
      test.info().attach('results.json', { body: json, contentType: 'application/json' });
      expect(verdictStatus(verdicts, 'sequential output count and order')).toBe('PASS');
      expect(verdictStatus(verdicts, 'random-access hash = sequential hash')).toBe('PASS');
      expect(verdicts.filter((v) => v.status === 'FAIL')).toEqual([]);
    });
  });

  test.describe('sample videos (BARNESTRACK_SAMPLE_DIR)', () => {
    test.skip(!SAMPLE_DIR, 'BARNESTRACK_SAMPLE_DIR is not set');
    for (const name of ['test50', 'test51', 'test53']) {
      test(`${name}: frame count, order, timestamps and random access`, async ({ page, browser }) => {
        const videoPath = join(SAMPLE_DIR!, `${name}.mp4`);
        test.skip(!existsSync(videoPath), `${videoPath} not found`);
        const { result, peaks } = await withProcessMemory(browser, () => runPage(page, videoPath, OPTIONS));
        const { verdicts, json } = result;
        mkdirSync(RESULTS_DIR, { recursive: true });
        const parsed = JSON.parse(json) as Record<string, unknown>;
        parsed['processPeakRssBytes'] = peaks;
        const suffix = OPTIONS.length ? `.${OPTIONS.join('+')}` : '';
        const out = join(RESULTS_DIR, `${name}${suffix}.json`);
        writeFileSync(out, JSON.stringify(parsed, null, 2));
        console.log(`${name}: ${verdicts.map((v) => `${v.status} ${v.id}`).join(' | ')}; process peaks ${JSON.stringify(peaks)}; written to ${out}`);
        test.info().attach(`${name}.json`, { body: JSON.stringify(parsed, null, 2), contentType: 'application/json' });
        if (OPTIONS.includes('decode_order')) {
          // The plain tie-break is expected to fail on these files; this run only records how.
          return;
        }
        expect(verdictStatus(verdicts, 'sequential output count and order')).toBe('PASS');
        expect(verdictStatus(verdicts, 't_s matches ffprobe fixture within 1 µs')).toBe('PASS');
        expect(verdictStatus(verdicts, 'random-access hash = sequential hash')).toBe('PASS');
        // Throughput and memory are recorded, not asserted: chunk 4 decides what to do with them.
      });
    }
  });
});
