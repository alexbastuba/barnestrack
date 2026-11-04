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
 * Chrome, and writes `notes/screens/chunk-15/<step>-<w>x<h>-<zoom>.png` and a
 * `summary.json` beside them. `notes/` is untracked; nothing here is committed.
 *
 * Chunk 15 adds a Review shot taken after `]` selects the first queued event,
 * with the bounding boxes of the regions a decision needs on one screen: the
 * video, the selected event's card, its evidence, the correction toolbar, the
 * queue's previous / next and the clip selector. It then focuses the selected
 * card and its Keep in turn and reports any side of the focus ring a scroll box
 * clips.
 *
 * 200 % is emulated the way browser zoom works: the layout viewport is half the
 * window in CSS pixels and every CSS pixel is two device pixels, so the PNG is
 * still the window's size and the layout is the one a zoomed user sees.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { LOAD_BUTTON_LABEL } from '../src/demo/example-cohort-ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4317;
const BASE_URL = `http://localhost:${PORT}/`;
const OUT_DIR = join(ROOT, 'notes/screens/chunk-17');
/** The regions of the selected-event Review shot, by selector. */
const REVIEW_REGIONS = {
  video: '#panel-review .viewport',
  card: '#review-selected .event-card',
  evidence: '#review-selected .event-evidence',
  actions: '#review-selected .event-actions',
  toolbar: '#panel-review .review-tools',
  queueNav: '#review-current-event .current-event-actions',
  clipSelector: '#panel-review .review-top select',
} as const;

/*
 * D76 (chunk 17): what counts as prose on the Review step's first screen. A
 * text node is prose when the nearest of its ancestors matching either list
 * matches PROSE — so a sentence in a `<p>` or a `.hint` counts; the text of a
 * button, a label, a heading or a table cell does not; and the reason and
 * consequence lines on an event card count although the card is a button.
 * The evidence sentence, the flag message and the shadow clauses are the D19
 * evidence the decision is made on — D76 names the evidence strip a visual —
 * and are counted separately, beside the prose. Text inside a closed
 * `<details>` is one click away, not on the screen, and is not counted.
 */
const PROSE_SELECTOR =
  'p, caption, .hint, .what, .empty, .error, .orphan, .mirror-summary, .event-reason, .event-consequence, .current-event-line, .selection-line, .event-how';
const NOT_PROSE_SELECTOR =
  'button, label, th, td, h1, h2, h3, h4, summary, select, option, input, textarea, .badge, .event-fact';
const EVIDENCE_SELECTOR = '.event-evidence, .event-flag, .event-shadow';
/** The word-count target D76 sets for the Review step's first screen. */
const PROSE_WORD_LIMIT = 120;
/** CI's screen size, at which chunk 14b found the Review bar over the video's lowest 50 px. */
const FOLD_SIZE = { width: 1920, height: 1080 } as const;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  inViewport: boolean;
  /** Pixels of the box actually visible after its scrolling ancestors and the window clip it. */
  shownPx: number;
}

interface ProseCount {
  words: number;
  evidenceWords: number;
  /** The elements carrying the most prose words, `element · n`, largest first. */
  top: string[];
}

/** The words of prose, and of evidence, whose text is on screen now (PROSE_SELECTOR above). */
async function proseCount(page: Page): Promise<ProseCount> {
  return page.evaluate(
    ({ prose, notProse, evidence }) => {
      const words = (text: string): number => text.split(/\s+/).filter((w) => w.length > 0).length;
      const describe = (el: Element): string =>
        `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}`;
      const onScreen = (node: Text): boolean => {
        const parent = node.parentElement;
        if (!parent || !parent.checkVisibility()) return false;
        for (let up: Element | null = parent; up; up = up.parentElement) {
          if (up instanceof HTMLDetailsElement && !up.open) {
            const summary = parent.closest('summary');
            if (!summary || summary.parentElement !== up) return false;
          }
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      };
      /** The nearest ancestor matching `yes`, unless one matching `no` comes first. */
      const decide = (node: Text, yes: string, no: string): Element | null => {
        for (let up = node.parentElement; up; up = up.parentElement) {
          if (up.matches(yes)) return up;
          if (up.matches(no)) return null;
        }
        return null;
      };
      let proseWords = 0;
      let evidenceWords = 0;
      const byElement = new Map<Element, number>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const n = words(node.data);
        if (n === 0 || !onScreen(node)) continue;
        const proseElement = decide(node, prose, notProse);
        if (proseElement) {
          proseWords += n;
          byElement.set(proseElement, (byElement.get(proseElement) ?? 0) + n);
          continue;
        }
        if (decide(node, evidence, '.badge')) evidenceWords += n;
      }
      const top = [...byElement]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([el, n]) => `${describe(el)} ${n}`);
      return { words: proseWords, evidenceWords, top };
    },
    { prose: PROSE_SELECTOR, notProse: NOT_PROSE_SELECTOR, evidence: EVIDENCE_SELECTOR },
  );
}

interface FoldCheck {
  scrollY: number;
  video: { top: number; bottom: number; left: number; right: number } | null;
  bar: { top: number; bottom: number; left: number; right: number } | null;
  /** The element under the video's centre column at each of its lowest 50 px, `y → element`. */
  under: string[];
  /** True when a probe in the video's lowest 50 px landed on the action bar. */
  covered: boolean;
}

/**
 * Whether the Review step's action bar covers the video's lowest 50 px
 * (chunk 14b's finding at 1920 × 1080; D75 for the Maze step). Probes the
 * video's centre column 1, 25 and 49 px above its bottom edge, or at the fold
 * when the bottom edge is below the window, with `elementFromPoint`.
 */
async function foldCheck(page: Page): Promise<FoldCheck> {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left), right: Math.round(r.right) };
    };
    const video = box(document.querySelector('#panel-review .viewport'));
    const bar = box(document.querySelector('#panel-review .next-step'));
    const under: string[] = [];
    let covered = false;
    if (video && video.top < window.innerHeight) {
      const x = Math.round((video.left + video.right) / 2);
      for (const dy of [1, 25, 49]) {
        const y = Math.round(Math.min(video.bottom - dy, window.innerHeight - 1));
        if (y < 0) continue;
        const el = document.elementFromPoint(x, y);
        const name = el
          ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}`
          : 'nothing';
        if (el && (el.closest('.next-step') !== null || /next-step|action-bar/.test(el.className))) covered = true;
        under.push(`y ${y} → ${name}`);
      }
    }
    return { scrollY: Math.round(window.scrollY), video, bar, under, covered };
  });
}

/**
 * The header heights chunk 14b found fractional (§4.2 of chunk 17): the
 * Reviewer field's hint line, the step heading and the stepper, plus where
 * the step's stage starts in the document.
 */
async function headerHeights(page: Page, step: Step): Promise<Record<string, number | string>> {
  return page.evaluate((step) => {
    const height = (selector: string): number | string => {
      const el = document.querySelector(selector);
      return el ? Math.round(el.getBoundingClientRect().height * 1000) / 1000 : 'absent';
    };
    const stage = document.querySelector(`#panel-${step} .review-stage, #panel-${step} .maze-stage`);
    return {
      reviewerHint: height('.app-header .hint'),
      stepHeading: height(`#panel-${step} > h2`),
      stepper: height('.stepper'),
      status: height('#app-status'),
      stageDocumentTop: stage ? Math.round((stage.getBoundingClientRect().top + window.scrollY) * 1000) / 1000 : 'absent',
    };
  }, step);
}
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
  /** axe `color-contrast` failures on the whole page (D70: ≥ 4.5:1 for text). */
  contrastFailures: string[];
  /** The step's action bar height, CSS px, and the document's `scroll-padding-bottom` while the step is shown (§4.3 of chunk 17). */
  barHeight: number | null;
  scrollPaddingBottom: string;
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
      // Every visible button, the example cohort's panel included now that it is tiered.
      const ours = [...document.querySelectorAll('button')].filter(visible);
      const root = document.documentElement;
      const bar = panel?.querySelector('.next-step') ?? null;
      return {
        barHeight: bar ? Math.round(bar.getBoundingClientRect().height * 100) / 100 : null,
        scrollPaddingBottom: getComputedStyle(root).scrollPaddingBottom,
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
  const contrast = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const contrastFailures = contrast.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.target.join(' ')} · ${node.failureSummary?.split('\n').pop()?.trim() ?? ''}`),
  );
  return {
    step,
    size,
    zoom,
    file,
    ...facts,
    contrastFailures,
    primaryVisibleWithoutScroll: facts.primaries.some((primary) => !primary.disabled && primary.inViewport),
  };
}

/** The bounding box of each region in viewport pixels, and whether it is wholly on screen. */
async function regionBoxes(page: Page): Promise<Record<keyof typeof REVIEW_REGIONS, Box | null>> {
  return page.evaluate((regions) => {
    const out: Record<string, Box | null> = {};
    for (const [key, selector] of Object.entries(regions)) {
      const node = document.querySelector(selector);
      if (!node || !(node as HTMLElement).checkVisibility()) {
        out[key] = null;
        continue;
      }
      const rect = node.getBoundingClientRect();
      // What is actually shown: the box clipped by every scrolling ancestor and by the window.
      let top = Math.max(rect.top, 0);
      let bottom = Math.min(rect.bottom, window.innerHeight);
      for (let up = node.parentElement; up; up = up.parentElement) {
        const overflow = getComputedStyle(up).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        const clip = up.getBoundingClientRect();
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      out[key] = {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
        shownPx: Math.max(0, Math.round(bottom - top)),
      };
    }
    return out as Record<keyof typeof regions, Box | null>;
  }, REVIEW_REGIONS);
}

/** The selected card and its Keep, focused in turn: which sides of the 2 px focus ring a clipping ancestor cuts off. */
const RING_TARGETS = {
  card: '#review-selected .event-card',
  keep: '#review-selected .event-actions button:first-of-type',
} as const;

interface Ring {
  /** `rendered` when the element matched :focus-visible; otherwise the ring is sized from the `--focus` tokens. */
  measured: 'rendered' | 'tokens';
  /** The ring is taller than a scroll box it sits in, so that box cannot show all of it at once. */
  tallerThanBox: boolean;
  clippedSides: string[];
  file: string | null;
}

async function focusRings(page: Page, prefix: string): Promise<Record<keyof typeof RING_TARGETS, Ring | null>> {
  const out: Record<string, Ring | null> = {};
  for (const [key, selector] of Object.entries(RING_TARGETS)) {
    const facts = await page.evaluate((selector) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node || !node.checkVisibility() || (node as HTMLButtonElement).disabled) return null;
      // `focusVisible` asks for the keyboard ring even when a click came last.
      node.focus({ focusVisible: true } as FocusOptions);
      const visible = node.matches(':focus-visible');
      const px = (value: string): number => Number.parseFloat(value) || 0;
      let reach: number;
      if (visible) {
        const style = getComputedStyle(node);
        reach = px(style.outlineWidth) + px(style.outlineOffset);
      } else {
        const root = getComputedStyle(document.documentElement);
        reach = px(root.getPropertyValue('--focus')) + px(root.getPropertyValue('--focus-offset'));
      }
      const rect = node.getBoundingClientRect();
      const ring = { top: rect.top - reach, bottom: rect.bottom + reach, left: rect.left - reach, right: rect.right + reach };
      // Each clipped side and by how many pixels; a box shorter than the element must clip one end.
      const sides = new Map<string, number>();
      const clipped = (side: string, by: number): void => {
        if (by > 0.5) sides.set(side, Math.max(sides.get(side) ?? 0, Math.round(by)));
      };
      let tallerThanBox = false;
      for (let up = node.parentElement; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        // An overflow box clips at its padding box.
        const box = up.getBoundingClientRect();
        const clip = {
          top: box.top + up.clientTop,
          left: box.left + up.clientLeft,
          bottom: box.top + up.clientTop + up.clientHeight,
          right: box.left + up.clientLeft + up.clientWidth,
        };
        if (ring.bottom - ring.top > clip.bottom - clip.top) tallerThanBox = true;
        clipped('top', clip.top - ring.top);
        clipped('bottom', ring.bottom - clip.bottom);
        clipped('left', clip.left - ring.left);
        clipped('right', ring.right - clip.right);
      }
      const measured: Ring['measured'] = visible ? 'rendered' : 'tokens';
      return { measured, tallerThanBox, clippedSides: [...sides].map(([side, by]) => `${side} ${by}px`) };
    }, selector);
    if (facts === null) {
      out[key] = null;
      continue;
    }
    const file = `${prefix}-focus-${key}.png`;
    await page.screenshot({ path: join(OUT_DIR, file) });
    out[key] = { ...facts, file };
  }
  return out as Record<keyof typeof RING_TARGETS, Ring | null>;
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
  const selections: {
    size: string;
    zoom: string;
    file: string;
    scrollY: number;
    boxes: Record<string, Box | null>;
    rings: Record<string, Ring | null>;
  }[] = [];
  const consoleErrors: string[] = [];
  /** D76 word counts and the fold probes of the Review step, by state. */
  const readings: { size: string; state: string; prose: ProseCount; fold: FoldCheck }[] = [];
  let heights: Record<string, number | string> | null = null;
  try {
    await waitForServer(BASE_URL, 30_000);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      // The Review step at CI's size, unselected and after `]`: is the video ever under the bar?
      {
        const context = await browser.newContext({ viewport: { ...FOLD_SIZE }, deviceScaleFactor: 1 });
        await context.addInitScript('globalThis.__name = (fn) => fn;');
        const page = await context.newPage();
        await page.goto(BASE_URL);
        await page.locator('#panel-videos').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: LOAD_BUTTON_LABEL }).click();
        await page.locator('.example-results-only').click();
        await page.locator('.video-card').nth(2).waitFor({ state: 'visible' });
        await showStep(page, 'review');
        const size = `${FOLD_SIZE.width}x${FOLD_SIZE.height}`;
        readings.push({ size, state: 'unselected', prose: await proseCount(page), fold: await foldCheck(page) });
        await page.locator('#panel-review .timeline-surface').focus();
        await page.keyboard.press(']');
        await page.locator('#review-selected .event-item').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        readings.push({ size, state: 'selected', prose: await proseCount(page), fold: await foldCheck(page) });
        await page.screenshot({ path: join(OUT_DIR, `review-selected-${size}-100.png`) });
        await context.close();
      }
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
          // The D76 counts and the fold probe at the laptop size, before anything is selected.
          const laptop = width === 1366 && zoom === 1;
          if (laptop) {
            heights = await headerHeights(page, 'review');
            readings.push({ size, state: 'unselected', prose: await proseCount(page), fold: await foldCheck(page) });
          }

          // Review with the first queued event selected from the keyboard, as a reviewer starts.
          await page.locator('#panel-review .timeline-surface').focus();
          await page.keyboard.press(']');
          await page.locator('#review-selected .event-item').waitFor({ state: 'visible' });
          await page.waitForTimeout(400);
          if (laptop) readings.push({ size, state: 'selected', prose: await proseCount(page), fold: await foldCheck(page) });
          const selectedFile = `review-selected-${size}-${zoomLabel}.png`;
          await page.screenshot({ path: join(OUT_DIR, selectedFile) });
          // The boxes first: focusing the card and Keep may scroll them.
          const selectedScrollY = await page.evaluate(() => Math.round(window.scrollY));
          const selectedBoxes = await regionBoxes(page);
          selections.push({
            size,
            zoom: zoomLabel,
            file: selectedFile,
            scrollY: selectedScrollY,
            boxes: selectedBoxes,
            rings: await focusRings(page, `review-selected-${size}-${zoomLabel}`),
          });

          // An escape entry, whose card (evidence, flag, three actions) is the longest there is:
          // the first video that has one, selected by clicking its card in the events list.
          const videoSelect = page.locator('#panel-review .review-top select');
          for (const value of await videoSelect.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))) {
            await videoSelect.selectOption(value);
            const entryCard = page
              .locator('#review-events li.event-item')
              .filter({ has: page.locator('.event-kind', { hasText: /escape entry/i }) })
              .first();
            if ((await entryCard.count()) === 0) continue;
            await entryCard.locator('.event-card').click();
            await page.locator('#review-selected .event-item').waitFor({ state: 'visible' });
            await page.waitForTimeout(400);
            const entryFile = `review-entry-${size}-${zoomLabel}.png`;
            await page.screenshot({ path: join(OUT_DIR, entryFile) });
            const entryScrollY = await page.evaluate(() => Math.round(window.scrollY));
            const entryBoxes = await regionBoxes(page);
            selections.push({
              size,
              zoom: `${zoomLabel} entry`,
              file: entryFile,
              scrollY: entryScrollY,
              boxes: entryBoxes,
              rings: await focusRings(page, `review-entry-${size}-${zoomLabel}`),
            });
            break;
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

  writeFileSync(
    join(OUT_DIR, 'summary.json'),
    `${JSON.stringify({ results, selections, readings, heights, consoleErrors }, null, 2)}\n`,
  );
  for (const r of readings) {
    const over = r.prose.words > PROSE_WORD_LIMIT ? ` OVER ${PROSE_WORD_LIMIT}` : '';
    console.log(
      `review prose ${r.size} ${r.state.padEnd(10)} scrollY ${r.fold.scrollY}: ${r.prose.words} words of prose${over} · ${r.prose.evidenceWords} words of evidence · top: ${r.prose.top.join('; ')}`,
    );
    const video = r.fold.video ? `video y ${r.fold.video.top}–${r.fold.video.bottom}` : 'video absent';
    const bar = r.fold.bar ? `bar y ${r.fold.bar.top}–${r.fold.bar.bottom}, x ${r.fold.bar.left}–${r.fold.bar.right}` : 'bar absent';
    console.log(
      `review fold  ${r.size} ${r.state.padEnd(10)} scrollY ${r.fold.scrollY}: ${video} · ${bar} · ${r.fold.under.join(', ')}${r.fold.covered ? ' · COVERED BY THE BAR' : ' · not under the bar'}`,
    );
  }
  if (heights) {
    console.log(
      `header heights 1366x768 100: ${Object.entries(heights)
        .map(([k, v]) => `${k} ${v}${typeof v === 'number' && !Number.isInteger(v) ? ' (fractional)' : ''}`)
        .join(' · ')}`,
    );
  }
  for (const s of selections) {
    const boxes = Object.entries(s.boxes)
      .map(([key, box]) =>
        box === null
          ? `${key} —`
          : `${key} y ${box.top}–${box.bottom} (${box.shownPx} px shown)${box.inViewport ? '' : ' OFF-SCREEN'}`,
      )
      .join(' · ');
    const all = Object.values(s.boxes).every((box) => box?.inViewport === true);
    console.log(`review selected ${s.size} ${s.zoom.padEnd(3)} scrollY ${s.scrollY} · all on screen: ${all ? 'yes' : 'NO '} · ${boxes}`);
    const rings = Object.entries(s.rings)
      .map(([key, ring]) =>
        ring === null
          ? `${key} — (absent or disabled)`
          : `${key} ${ring.clippedSides.length === 0 ? 'not clipped' : `CLIPPED ${ring.clippedSides.join(', ')}`}${ring.tallerThanBox ? ' (taller than its scroll box)' : ''} (${ring.measured})`,
      )
      .join(' · ');
    console.log(`  focus ring: ${rings}`);
  }
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
        `bar ${r.barHeight ?? '—'}px / scroll-padding-bottom ${r.scrollPaddingBottom}`,
        `primaries [${primaries}]`,
        r.buttonsWithoutTier.length > 0 ? `UNTIERED ${JSON.stringify(r.buttonsWithoutTier)}` : '',
        r.buttonsWithSeveralTiers.length > 0 ? `MULTI-TIER ${JSON.stringify(r.buttonsWithSeveralTiers)}` : '',
        `contrast failures: ${r.contrastFailures.length}`,
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
