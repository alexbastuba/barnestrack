/**
 * Chunk 14 — the maze's drag handles and the two-column stage (D69, D50), in
 * the installed Google Chrome against the config's dev server, on the example
 * cohort with no video attached: the step draws the geometry on an empty stage,
 * which is all a handle needs. Nothing here needs ffmpeg or the sample videos,
 * so it runs in CI.
 *
 * Where a handle is on screen comes from the typed fields and the same geometry
 * module the step uses, mapped through the frame layer's bounding box — the CSS
 * transform the overlay has to agree with — so a drift between the two layers
 * would fail these drags rather than pass them. Every assertion reads the DOM:
 * the fields, the chip, the layout boxes; never pixels (D37).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LOAD_BUTTON_LABEL } from '../../src/demo/example-cohort-ui.js';
import {
  handlePositions,
  PLATFORM_HANDLE_BEARING_DEG,
  RING_HANDLE_BEARING_DEG,
  type HandleKind,
} from '../../src/maze/handles.js';

const APP_URL = '/';

/** D69's breakpoint is 1200 px; D70 checks every step at this size. */
test.use({ viewport: { width: 1366, height: 768 } });

interface Geometry {
  cx: number;
  cy: number;
  r: number;
  ratio: number;
}

interface FrameBox {
  left: number;
  top: number;
  /** Screen pixels per video pixel: the frame layer's drawn width over its canvas width. */
  zoom: number;
}

function field(page: Page, label: string): Locator {
  return page.locator('#panel-maze').getByLabel(label, { exact: true });
}

async function geometry(page: Page): Promise<Geometry> {
  const read = async (label: string): Promise<number> => Number(await field(page, label).inputValue());
  return {
    cx: await read('Centre x (px)'),
    cy: await read('Centre y (px)'),
    r: await read('Radius (px)'),
    ratio: await read('Ring radius ÷ platform radius'),
  };
}

/**
 * The frame's origin and scale as the step maps a pointer: through the
 * viewport's border box. The frame layer sits inside the viewport's 1 px
 * border, so its own box is a border's width further in; that cancels in a
 * drag at one zoom, but not across a zoom made mid-drag.
 */
async function frameBox(page: Page): Promise<FrameBox> {
  const frame = page.locator('#panel-maze .frame-layer');
  const box = await frame.boundingBox();
  expect(box, 'the frame layer has a box').not.toBeNull();
  const width = await frame.evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  expect(width).toBeGreaterThan(0);
  const border = await page.locator('#panel-maze .viewport').evaluate((el) => {
    const style = getComputedStyle(el);
    return { left: parseFloat(style.borderLeftWidth), top: parseFloat(style.borderTopWidth) };
  });
  return { left: box!.x - border.left, top: box!.y - border.top, zoom: box!.width / width };
}

async function handleOnScreen(page: Page, kind: HandleKind): Promise<{ x: number; y: number }> {
  const g = await geometry(page);
  const f = await frameBox(page);
  const p = handlePositions({ cx: g.cx, cy: g.cy, r: g.r }, { ringRatio: g.ratio })[kind];
  return { x: f.left + p.x * f.zoom, y: f.top + p.y * f.zoom };
}

interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

interface Drag {
  /** The press and the release, in whole screen pixels. */
  start: Point;
  end: Point;
  /** The press and the release in video pixels: the press over the frame as it was, plus the travel over the zoom. */
  from: Point;
  to: Point;
  /** How far the frame moved on screen while the pointer was held. */
  shift: number;
}

/**
 * Press on the handle, move in eight steps, release. The points are whole
 * screen pixels — the pointer lands on whole pixels whatever is asked for.
 *
 * The frame's box is read before the press and again while the pointer is
 * held. A selection used to be announced on the press, and a one-line message
 * where the two-line "Example cohort loaded" banner stood reflowed the page by
 * a line under the held pointer; the step now announces on release and maps
 * every move from the press point, so the shift is reported and the pointer's
 * own travel is what must land.
 */
async function drag(page: Page, kind: HandleKind, dx: number, dy: number): Promise<Drag> {
  const raw = await handleOnScreen(page, kind);
  const start = { x: Math.round(raw.x), y: Math.round(raw.y) };
  const end = { x: Math.round(start.x + dx), y: Math.round(start.y + dy) };
  const before = await frameBox(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const held = await frameBox(page);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  const from = { x: (start.x - before.left) / before.zoom, y: (start.y - before.top) / before.zoom };
  return {
    start,
    end,
    from,
    to: { x: from.x + (end.x - start.x) / before.zoom, y: from.y + (end.y - start.y) / before.zoom },
    shift: held.top - before.top,
  };
}

/** A unit step outward along a rim handle's own bearing, in screen pixels. */
function outward(kind: Exclude<HandleKind, 'centre'>): { x: number; y: number } {
  const bearing = kind === 'platformRim' ? PLATFORM_HANDLE_BEARING_DEG : RING_HANDLE_BEARING_DEG;
  const radians = (bearing * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

async function chip(page: Page): Promise<number> {
  const text = await page.locator('#panel-maze .status-chip').textContent();
  const match = /^(\d+) clicks? on the image$/.exec(text ?? '');
  expect(match, `the chip reads "${text}"`).not.toBeNull();
  return Number(match![1]);
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();
  await page.evaluate(() => indexedDB.deleteDatabase('barnestrack'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'BarnesTrack' })).toBeVisible();

  // The example cohort's map, with no video file: the results-only path (D33).
  await page.getByRole('button', { name: LOAD_BUTTON_LABEL }).click();
  await page.getByRole('button', { name: 'Load the results only' }).click();
  await expect(page.locator('.video-card')).toHaveCount(3);
  await page.getByRole('tab', { name: /Maze/ }).click();
  await expect(page.locator('#panel-maze')).toBeVisible();
  await expect(field(page, 'Radius (px)')).not.toHaveValue('');
  await expect
    .poll(() => page.locator('#panel-maze .frame-layer').evaluate((c) => (c as HTMLCanvasElement).width))
    .toBeGreaterThan(0);
  // The stage sits below the header, the banner and the stepper, which is past
  // the fold at 768 px: a pointer cannot reach a handle that is off screen.
  await page.locator('#panel-maze .canvas-view').evaluate((el) => el.scrollIntoView({ block: 'start' }));
});

test('a centre drag moves the centre fields by the drag over the view scale, and counts one click', async ({
  page,
}) => {
  const before = await geometry(page);
  const clicks = await chip(page);
  const { zoom } = await frameBox(page);

  const hover = await handleOnScreen(page, 'centre');
  await page.mouse.move(hover.x, hover.y);
  await expect(page.locator('#panel-maze .viewport')).toHaveClass(/is-over-handle/);
  const { start, end, from, to, shift } = await drag(page, 'centre', 40, 25);

  const after = await geometry(page);
  const dx = after.cx - before.cx;
  const dy = after.cy - before.cy;
  console.log(
    `maze handles: centre drag (+${end.x - start.x}, +${end.y - start.y}) screen px at zoom ${zoom.toFixed(4)} → ` +
      `Δcx ${dx.toFixed(2)}, Δcy ${dy.toFixed(2)} video px (expected ${(to.x - from.x).toFixed(2)}, ` +
      `${(to.y - from.y).toFixed(2)}); the frame shifted ${shift.toFixed(2)} px while held`,
  );
  expect(end.x - start.x).toBe(40);
  expect(end.y - start.y).toBe(25);
  // The fields show one decimal, so the match is to a tenth of a pixel.
  expect(Math.abs(dx - 40 / zoom)).toBeLessThan(0.15);
  expect(Math.abs(dy - 25 / zoom)).toBeLessThan(0.15);
  // Nothing is announced on the press, so nothing reflows under the pointer.
  expect(shift).toBe(0);
  expect(after.r).toBe(before.r);
  expect(after.ratio).toBe(before.ratio);
  expect(await chip(page)).toBe(clicks + 1);
  await expect(page.locator('#app-status')).toContainText(/^Platform for test\d+\.mp4: centre/);
});

test('a platform-edge drag outward grows the radius and leaves the ring ratio alone', async ({ page }) => {
  const before = await geometry(page);
  const ratioText = await field(page, 'Ring radius ÷ platform radius').inputValue();
  const clicks = await chip(page);
  const { zoom } = await frameBox(page);
  const centre = { x: before.cx, y: before.cy };
  const u = outward('platformRim');

  const { from, to } = await drag(page, 'platformRim', u.x * 30, u.y * 30);

  const after = await geometry(page);
  const dr = after.r - before.r;
  // What the step sees: the pointer's change in distance from the centre, in video px.
  const expected = distance(to, centre) - distance(from, centre);
  console.log(
    `maze handles: platform-edge drag 30 screen px outward at zoom ${zoom.toFixed(4)} → ` +
      `Δr ${dr.toFixed(2)} video px (expected ${expected.toFixed(2)}; ${(30 / zoom).toFixed(2)} before rounding the pointer to whole pixels)`,
  );
  expect(dr).toBeGreaterThan(20);
  expect(Math.abs(dr - expected)).toBeLessThan(0.15);
  expect(Math.abs(dr - 30 / zoom)).toBeLessThan(0.8);
  expect(await field(page, 'Ring radius ÷ platform radius').inputValue()).toBe(ratioText);
  expect(after.cx).toBe(before.cx);
  expect(after.cy).toBe(before.cy);
  expect(await chip(page)).toBe(clicks + 1);
});

test('a ring-edge drag inward lowers the ratio and leaves the radius alone', async ({ page }) => {
  const before = await geometry(page);
  const radiusText = await field(page, 'Radius (px)').inputValue();
  const clicks = await chip(page);
  const { zoom } = await frameBox(page);
  const centre = { x: before.cx, y: before.cy };
  const u = outward('ringRim');

  const { from, to } = await drag(page, 'ringRim', -u.x * 12, -u.y * 12);

  const after = await geometry(page);
  const dRatio = after.ratio - before.ratio;
  const expected = (distance(to, centre) - distance(from, centre)) / before.r;
  console.log(
    `maze handles: ring-edge drag 12 screen px inward at zoom ${zoom.toFixed(4)} → ` +
      `Δratio ${dRatio.toFixed(4)} (expected ${expected.toFixed(4)}; ${(-12 / zoom / before.r).toFixed(4)} before rounding the pointer); ` +
      `radius ${radiusText} unchanged`,
  );
  expect(dRatio).toBeLessThan(0);
  // The field shows three decimals.
  expect(Math.abs(dRatio - expected)).toBeLessThan(0.002);
  expect(await field(page, 'Radius (px)').inputValue()).toBe(radiusText);
  expect(await chip(page)).toBe(clicks + 1);
  await expect(page.locator('#app-status')).toContainText('applies to every video in this session');
});

test('a centre drag on an unscrolled 1920 × 1080 page lands where the pointer went', async ({ page }) => {
  // With nothing scrolled there is no scroll anchoring to hide a reflow: a
  // message announced on the press used to move the frame a whole line up
  // under the pointer and the drag committed 19 video px too far down.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const before = await geometry(page);
  const { zoom } = await frameBox(page);

  const { from, to, shift } = await drag(page, 'centre', 40, 25);

  const after = await geometry(page);
  const dx = after.cx - before.cx;
  const dy = after.cy - before.cy;
  console.log(
    `maze handles: 1920 × 1080, scrollY 0: centre drag (+40, +25) at zoom ${zoom.toFixed(4)} → ` +
      `Δcx ${dx.toFixed(2)}, Δcy ${dy.toFixed(2)} video px (expected ${(to.x - from.x).toFixed(2)}, ` +
      `${(to.y - from.y).toFixed(2)}); the frame shifted ${shift.toFixed(2)} px while held`,
  );
  expect(Math.abs(dx - 40 / zoom)).toBeLessThan(0.15);
  expect(Math.abs(dy - 25 / zoom)).toBeLessThan(0.15);
  expect(shift).toBe(0);
});

test('a zoom made mid-drag keeps the pixel under the pointer as the one that lands', async ({ page }) => {
  const before = await geometry(page);
  const raw = await handleOnScreen(page, 'centre');
  const start = { x: Math.round(raw.x), y: Math.round(raw.y) };
  const boxBefore = await frameBox(page);
  const from = { x: (start.x - boxBefore.left) / boxBefore.zoom, y: (start.y - boxBefore.top) / boxBefore.zoom };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 25, { steps: 8 });
  // Ctrl with the wheel zooms about the pointer, three notches.
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  const end = { x: start.x + 41, y: start.y + 25 };
  await page.mouse.move(end.x, end.y);
  // Read the frame before the release: the commit is announced on release,
  // and the banner's reflow then moves the page half a pixel under scroll
  // anchoring — after the step has already mapped the release point.
  const boxAfter = await frameBox(page);
  await page.mouse.up();

  const to = { x: (end.x - boxAfter.left) / boxAfter.zoom, y: (end.y - boxAfter.top) / boxAfter.zoom };
  const after = await geometry(page);
  console.log(
    `maze handles: zoom ${boxBefore.zoom.toFixed(4)} → ${boxAfter.zoom.toFixed(4)} mid-drag; ` +
      `frame origin (${boxBefore.left.toFixed(2)}, ${boxBefore.top.toFixed(2)}) → ` +
      `(${boxAfter.left.toFixed(2)}, ${boxAfter.top.toFixed(2)}); ` +
      `Δcx ${(after.cx - before.cx).toFixed(2)}, Δcy ${(after.cy - before.cy).toFixed(2)} video px ` +
      `(the pointer's own path ${(to.x - from.x).toFixed(2)}, ${(to.y - from.y).toFixed(2)})`,
  );
  expect(boxAfter.zoom).toBeGreaterThan(boxBefore.zoom * 1.3);
  expect(Math.abs(after.cx - before.cx - (to.x - from.x))).toBeLessThan(0.15);
  expect(Math.abs(after.cy - before.cy - (to.y - from.y))).toBeLessThan(0.15);
});

test('a press that only selects a handle counts nothing', async ({ page }) => {
  const before = await geometry(page);
  const clicks = await chip(page);
  const start = await handleOnScreen(page, 'centre');

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.up();

  await expect(page.locator('.handle-group button', { hasText: /^Centre$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await geometry(page)).toEqual(before);
  expect(await chip(page)).toBe(clicks);
});

test('the arrow keys nudge the selected centre by 1 px, and by 10 with Shift, without counting', async ({
  page,
}) => {
  const before = await geometry(page);
  const clicks = await chip(page);

  await page.locator('.handle-group button', { hasText: /^Centre$/ }).click();
  await expect(page.locator('#panel-maze .viewport')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const afterOne = await geometry(page);
  await page.keyboard.press('Shift+ArrowRight');
  const afterTen = await geometry(page);

  console.log(
    `maze handles: ArrowRight → Δcx ${(afterOne.cx - before.cx).toFixed(1)}; Shift+ArrowRight → Δcx ${(afterTen.cx - afterOne.cx).toFixed(1)}`,
  );
  expect(afterOne.cx - before.cx).toBeCloseTo(1, 6);
  expect(afterTen.cx - afterOne.cx).toBeCloseTo(10, 6);
  expect(afterTen.cy).toBe(before.cy);
  expect(await chip(page)).toBe(clicks);

  await page.keyboard.press('Escape');
  await expect(page.locator('.handle-group button', { hasText: /^Centre$/ })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ArrowRight');
  expect((await geometry(page)).cx).toBe(afterTen.cx);
});

test('at 1366 × 768 the frame and the Platform controls are on screen together, with no sideways scroll', async ({
  page,
}) => {
  const stage = page.locator('#panel-maze .maze-stage');
  const columns = await stage.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(2);

  await page.locator('#panel-maze .canvas-view').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const canvas = await page.locator('#panel-maze .viewport').boundingBox();
  const platform = await page
    .locator('#panel-maze fieldset')
    .filter({ has: page.locator('legend', { hasText: /^Platform$/ }) })
    .boundingBox();
  const scroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: test.info().outputPath('maze-1366x768.png') });

  console.log(
    `maze stage: columns "${columns}"; canvas top ${canvas!.y.toFixed(0)} px, ` +
      `Platform fieldset ${platform!.y.toFixed(0)}–${(platform!.y + platform!.height).toFixed(0)} px of 768, ` +
      `x ${platform!.x.toFixed(0)}–${(platform!.x + platform!.width).toFixed(0)} px of 1366; ` +
      `scrollWidth ${scroll.scrollWidth} ≤ clientWidth ${scroll.clientWidth}`,
  );
  expect(canvas!.y).toBeGreaterThanOrEqual(0);
  expect(canvas!.y).toBeLessThan(120);
  expect(platform!.y).toBeGreaterThanOrEqual(0);
  expect(platform!.y + platform!.height).toBeLessThanOrEqual(768);
  expect(platform!.x).toBeGreaterThanOrEqual(0);
  expect(platform!.x + platform!.width).toBeLessThanOrEqual(1366);
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
});
