/**
 * D70's visual check: every step at 1366 × 768 and 1400 × 866, at 100 % and
 * 200 % zoom, as screenshots for review plus the measurements the chunk report
 * asks for — is the step's primary button on screen without scrolling, does the
 * page scroll sideways, and does every button carry exactly one tier class.
 *
 *   npm run build && npx tsx scripts/screenshots.ts
 *
 * Serves `dist/` with `vite preview` on a port of its own (so it never reuses a
 * dev server another checkout left running), drives the installed Google
 * Chrome, and writes `notes/screens/chunk-13/<step>-<w>x<h>-<zoom>.png` and a
 * `summary.json` beside them. `notes/` is untracked; nothing here is committed.
 *
 * 200 % is emulated the way browser zoom works: the layout viewport is half the
 * window in CSS pixels and every CSS pixel is two device pixels, so the PNG is
 * still the window's size and the layout is the one a zoomed user sees.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { LOAD_BUTTON_LABEL } from '../src/demo/example-cohort-ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4317;
const BASE_URL = `http://localhost:${PORT}/`;
const OUT_DIR = join(ROOT, 'notes/screens/chunk-13');
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1400, height: 866 },
] as const;
const ZOOMS = [1, 2] as const;
const STEPS = ['videos', 'maze', 'track', 'review'] as const;
const TIERS = ['btn-primary', 'btn-secondary', 'btn-quiet'];

type Step = (typeof STEPS)[number];

interface PrimaryButton {
  text: string;
  disabled: boolean;
  inViewport: boolean;
  top: number;
}

interface Measurement {
  step: Step;
  size: string;
  zoom: string;
  file: string | null;
  horizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  pageHeight: number;
  viewportHeight: number;
  primaries: PrimaryButton[];
  /** A filled (enabled) primary fully inside the first screen. */
  primaryVisibleWithoutScroll: boolean;
  buttonsWithoutTier: string[];
  buttonsWithSeveralTiers: string[];
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite preview did not answer on ${url} within ${timeoutMs} ms`);
}

async function measure(page: Page, step: Step, size: string, zoom: string, file: string | null): Promise<Measurement> {
  const facts = await page.evaluate(
    ({ step, tiers }) => {
      const visible = (node: Element): boolean => (node as HTMLElement).checkVisibility();
      const name = (node: Element): string =>
        (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const tierCount = (node: Element): number => tiers.filter((tier) => node.classList.contains(tier)).length;
      const panel = document.getElementById(`panel-${step}`);
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      // The example cohort's panel is built in src/demo/, outside this chunk's
      // files; its buttons are reported separately in the chunk record.
      const ours = buttons.filter((node) => node.closest('.example-cohort, .example-dialog') === null);
      const root = document.documentElement;
      return {
        horizontalScroll: root.scrollWidth > root.clientWidth,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        pageHeight: root.scrollHeight,
        viewportHeight: window.innerHeight,
        primaries: [...(panel?.querySelectorAll<HTMLButtonElement>('.btn-primary') ?? [])]
          .filter(visible)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              text: name(node),
              disabled: node.disabled,
              inViewport:
                rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
              top: Math.round(rect.top),
            };
          }),
        buttonsWithoutTier: ours.filter((node) => tierCount(node) === 0).map(name),
        buttonsWithSeveralTiers: ours.filter((node) => tierCount(node) > 1).map(name),
      };
    },
    { step, tiers: TIERS },
  );
  return {
    step,
    size,
    zoom,
    file,
    ...facts,
    primaryVisibleWithoutScroll: facts.primaries.some((primary) => !primary.disabled && primary.inViewport),
  };
}

async function showStep(page: Page, step: Step): Promise<void> {
  await page.locator(`#tab-${step}`).click();
  await page.locator(`#panel-${step}`).waitFor({ state: 'visible' });
  if (step === 'review') await page.locator('#review-export').waitFor({ state: 'attached' });
  // Let the canvases and the figures draw before the picture is taken.
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('no dist/ — run `npm run build` first');
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  const results: Measurement[] = [];
  const consoleErrors: string[] = [];
  try {
    await waitForServer(BASE_URL, 30_000);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      for (const { width, height } of SIZES) {
        for (const zoom of ZOOMS) {
          const size = `${width}x${height}`;
          const zoomLabel = `${zoom * 100}`;
          const context = await browser.newContext({
            viewport: { width: Math.round(width / zoom), height: Math.round(height / zoom) },
            deviceScaleFactor: zoom,
          });
          // tsx compiles with esbuild's keepNames, which wraps the named arrow
          // functions inside `page.evaluate` in a `__name` helper the page lacks.
          await context.addInitScript('globalThis.__name = (fn) => fn;');
          const page = await context.newPage();
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(`${size}@${zoomLabel}: ${message.text()}`);
          });
          await page.goto(BASE_URL);
          await page.locator('#panel-videos').waitFor({ state: 'visible' });

          // The empty Videos step, measured only: it is the state with no primary.
          results.push(await measure(page, 'videos', size, `${zoomLabel} (empty)`, null));

          await page.getByRole('button', { name: LOAD_BUTTON_LABEL }).click();
          await page.locator('.example-results-only').click();
          await page.locator('.video-card').nth(2).waitFor({ state: 'visible' });

          for (const step of STEPS) {
            await showStep(page, step);
            const file = `${step}-${size}-${zoomLabel}.png`;
            await page.screenshot({ path: join(OUT_DIR, file) });
            results.push(await measure(page, step, size, zoomLabel, file));
          }
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
  }

  writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify({ results, consoleErrors }, null, 2)}\n`);
  for (const r of results) {
    const primaries = r.primaries
      .map((p) => `${p.text}${p.disabled ? ' (disabled)' : ''}${p.inViewport ? '' : ` @${p.top}px`}`)
      .join('; ');
    console.log(
      [
        r.step.padEnd(6),
        r.size,
        r.zoom.padEnd(11),
        `primary on first screen: ${r.primaryVisibleWithoutScroll ? 'yes' : 'no '}`,
        `h-scroll: ${r.horizontalScroll ? `YES (${r.scrollWidth} > ${r.clientWidth})` : 'no'}`,
        `page ${r.pageHeight}/${r.viewportHeight}px`,
        `primaries [${primaries}]`,
        r.buttonsWithoutTier.length > 0 ? `UNTIERED ${JSON.stringify(r.buttonsWithoutTier)}` : '',
        r.buttonsWithSeveralTiers.length > 0 ? `MULTI-TIER ${JSON.stringify(r.buttonsWithSeveralTiers)}` : '',
      ]
        .filter((part) => part !== '')
        .join(' · '),
    );
  }
  if (consoleErrors.length > 0) console.log(`console errors:\n${consoleErrors.join('\n')}`);
  console.log(`wrote ${results.filter((r) => r.file !== null).length} screenshots to ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
