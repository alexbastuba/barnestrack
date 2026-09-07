/**
 * The figure gallery: every figure in `src/viz/` drawn from the synthetic
 * session, with PNG export at 2× and 3×, a print-theme switch and the export
 * bundle behind one button.
 *
 * Dev-only evidence page, in the same spirit as `prototypes/frame-server/`. It
 * is not part of the shipped build — `vite build` takes only the root
 * `index.html` as its entry — and it is the page the chunk's grayscale and
 * export checks are made on.
 */
import { buildExportBundle } from '../../src/export/index.js';
import { downloadBlob } from '../../src/ui/download.js';
import { METRIC_LABELS, FIGURES } from '../../src/viz/index.js';
import { figurePngName, renderFigureToPng } from '../../src/viz/figure-export.js';
import type {
  FigureData,
  FigureOpts,
  FigureSpec,
  PlottableMetric,
  ThemeName,
} from '../../src/viz/types.js';
import { syntheticSession } from '../../tests/fixtures/synthetic-analysis.js';

const session = syntheticSession();

const videoSelect = document.querySelector<HTMLSelectElement>('#video')!;
const metricSelect = document.querySelector<HTMLSelectElement>('#metric')!;
const themeSelect = document.querySelector<HTMLSelectElement>('#theme')!;
const bundleButton = document.querySelector<HTMLButtonElement>('#bundle')!;
const allPngsButton = document.querySelector<HTMLButtonElement>('#allPngs')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const container = document.querySelector<HTMLDivElement>('#figures')!;

for (const video of session.videos) {
  const option = document.createElement('option');
  option.value = video.id;
  const { animal, day, trial } = video.metadata;
  option.textContent = `${video.filename} — ${animal ?? '?'}, day ${day ?? '?'}, trial ${trial ?? '?'}`;
  videoSelect.append(option);
}

for (const [metric, label] of Object.entries(METRIC_LABELS)) {
  const option = document.createElement('option');
  option.value = metric;
  option.textContent = label;
  metricSelect.append(option);
}

function currentData(): FigureData {
  return {
    session,
    videoId: videoSelect.value,
    metric: metricSelect.value as PlottableMetric,
  };
}

function currentTheme(): ThemeName {
  return themeSelect.value === 'print' ? 'print' : 'light';
}

interface Card {
  figure: FigureSpec;
  canvas: HTMLCanvasElement;
  note: HTMLParagraphElement;
  table: HTMLElement;
}

const cards: Card[] = FIGURES.map((figure) => {
  const card = document.createElement('section');
  card.className = 'card';

  const heading = document.createElement('h2');
  heading.textContent = `${figure.title} · ${figure.scope}`;
  card.append(heading);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  card.append(canvas);

  const note = document.createElement('p');
  note.className = 'unavailable';
  card.append(note);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  for (const scale of [2, 3]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `PNG ${scale}×`;
    // Nine cards would otherwise put the same two names on eighteen buttons.
    button.setAttribute('aria-label', `Download ${figure.title} as a PNG at ${scale}×`);
    button.addEventListener('click', () => {
      void exportOne(figure, scale);
    });
    actions.append(button);
  }
  card.append(actions);

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'What this figure says, as a table';
  const table = document.createElement('div');
  details.append(summary, table);
  card.append(details);

  container.append(card);
  return { figure, canvas, note, table };
});

async function exportOne(figure: FigureSpec, scale: number): Promise<void> {
  const data = currentData();
  status.textContent = `Rendering ${figure.title} at ${scale}×…`;
  try {
    const blob = await renderFigureToPng(figure, data, { scale, theme: currentTheme() }, scale);
    downloadBlob(figurePngName(figure, data, scale), blob);
    status.textContent = `Saved ${figurePngName(figure, data, scale)} (${Math.round(blob.size / 1024)} kB).`;
  } catch (error) {
    status.textContent = `Could not render ${figure.title}: ${String(error)}`;
  }
}

function renderTable(card: Card, data: FigureData): void {
  const description = card.figure.describe(data);
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = description.summary;
  const head = document.createElement('tr');
  for (const column of description.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    head.append(th);
  }
  table.append(caption, head);
  for (const row of description.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell === null ? '—' : String(cell);
      tr.append(td);
    }
    table.append(tr);
  }
  card.table.replaceChildren(table);
  card.canvas.setAttribute('aria-label', `${description.title}. ${description.summary}`);
}

function drawAll(): void {
  const data = currentData();
  const theme = currentTheme();
  // Screen preview at the device's pixel ratio: still 1× in figure units, just
  // not blurry on a retina display. The buttons produce genuine 2× and 3× files.
  const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

  for (const card of cards) {
    const { width, height } = card.figure.defaultSize;
    card.canvas.width = Math.round(width * ratio);
    card.canvas.height = Math.round(height * ratio);
    card.canvas.style.width = `${width}px`;
    card.canvas.style.height = `${height}px`;
    const ctx = card.canvas.getContext('2d');
    if (!ctx) continue;
    const opts: FigureOpts = { scale: ratio, theme, width, height };
    card.figure.draw(ctx, data, opts);
    const reason = card.figure.unavailable(data);
    card.note.textContent = reason ?? '';
    renderTable(card, data);
  }
  status.textContent = `${cards.length} figures drawn from the synthetic session at ${ratio}× device pixels, ${theme} theme.`;
}

async function exportAll(): Promise<void> {
  allPngsButton.disabled = true;
  for (const card of cards) {
    await exportOne(card.figure, 3);
  }
  allPngsButton.disabled = false;
  status.textContent = `Saved ${cards.length} PNGs at 3×.`;
}

bundleButton.addEventListener('click', () => {
  void (async () => {
    bundleButton.disabled = true;
    status.textContent = 'Building the export bundle…';
    try {
      const bundle = await buildExportBundle(session, session.toolVersion);
      downloadBlob(bundle.zipName, bundle.zip);
      status.textContent = `Saved ${bundle.zipName} (${Math.round(bundle.zip.size / 1024)} kB) containing ${bundle.files.map((file) => file.name).join(', ')}.`;
    } catch (error) {
      status.textContent = `Could not build the bundle: ${String(error)}`;
    }
    bundleButton.disabled = false;
  })();
});

allPngsButton.addEventListener('click', () => {
  void exportAll();
});

for (const control of [videoSelect, metricSelect, themeSelect]) {
  control.addEventListener('change', drawAll);
}

drawAll();
