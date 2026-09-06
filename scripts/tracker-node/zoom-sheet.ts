/**
 * Zoomed evidence for the eyeballed tables: for each frame a 2× crop around
 * the selected blob (or the frame centre when nothing was selected) with the
 * same overlay as the contact sheet, and a stage view for chosen frames
 * (gray, difference, thresholded foreground, opened body with candidate
 * boxes) recomputed with the module's own stage functions.
 */
import type { TrackFrame } from '../../src/contracts/track.js';
import type { TrackingParametersPx } from '../../src/analysis/tracker/calibration.js';
import {
  createLabelScratch,
  labelComponents,
  type Component,
} from '../../src/analysis/tracker/components.js';
import { binarizeForeground } from '../../src/analysis/tracker/foreground.js';
import { growRect, type PlatformMask } from '../../src/analysis/tracker/mask.js';
import { discOffsets, openBinary } from '../../src/analysis/tracker/morphology.js';
import type { BodyAxis } from '../../src/analysis/tracker/tracker.js';
import { IndexedCanvas, contactPalette, grayIndex } from './contact-sheet.js';
import { encodePng } from './png.js';

const CROP = 80;
const ZOOM = 2;
const TILE = CROP * ZOOM;
const COLUMNS = 6;
const GAP = 3;
const C = {
  red: 240,
  green: 241,
  cyan: 242,
  yellow: 243,
  magenta: 244,
  black: 245,
  white: 246,
  orange: 247,
} as const;

export interface ZoomTile {
  gray: Uint8Array;
  frame: TrackFrame;
  axis: BodyAxis | null;
  tag?: string;
}

function cropOrigin(f: TrackFrame, width: number, height: number): { x0: number; y0: number } {
  const cx = f.centroid.valid ? f.centroid.x : width / 2;
  const cy = f.centroid.valid ? f.centroid.y : height / 2;
  return {
    x0: Math.max(0, Math.min(width - CROP, Math.round(cx - CROP / 2))),
    y0: Math.max(0, Math.min(height - CROP, Math.round(cy - CROP / 2))),
  };
}

function blit(
  canvas: IndexedCanvas,
  ox: number,
  oy: number,
  gray: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  zoom: number,
  toIndex: (v: number) => number,
): void {
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const v = toIndex(gray[(y0 + y) * width + (x0 + x)]!);
      for (let dy = 0; dy < zoom; dy++)
        for (let dx = 0; dx < zoom; dx++) canvas.set(ox + x * zoom + dx, oy + y * zoom + dy, v);
    }
  }
}

function overlay(
  canvas: IndexedCanvas,
  ox: number,
  oy: number,
  x0: number,
  y0: number,
  f: TrackFrame,
  axis: BodyAxis | null,
): void {
  const X = (x: number) => ox + (x - x0) * ZOOM;
  const Y = (y: number) => oy + (y - y0) * ZOOM;
  if (f.boundingBox) {
    const b = f.boundingBox;
    canvas.rect(X(b.x), Y(b.y), X(b.x + b.width), Y(b.y + b.height), C.yellow);
  }
  if (axis) {
    canvas.line(X(axis.ax), Y(axis.ay), X(axis.bx), Y(axis.by), C.cyan);
    if (axis.tail) {
      canvas.line(
        X(f.centroid.x),
        Y(f.centroid.y),
        X(f.centroid.x) + axis.tail.dx * 24,
        Y(f.centroid.y) + axis.tail.dy * 24,
        C.magenta,
      );
    }
  }
  if (f.centroid.valid) {
    canvas.fillCircle(X(f.centroid.x), Y(f.centroid.y), 4, C.black);
    canvas.fillCircle(X(f.centroid.x), Y(f.centroid.y), 2.6, C.green);
  }
  if (f.nose.valid) {
    const nx = X(f.nose.x);
    const ny = Y(f.nose.y);
    canvas.fillRect(nx - 4, ny - 4, nx + 4, ny + 4, C.black);
    if (f.noseHeadingConfidence >= 1) canvas.fillRect(nx - 3, ny - 3, nx + 3, ny + 3, C.red);
    else canvas.rect(nx - 3, ny - 3, nx + 3, ny + 3, C.red);
  }
}

const STATE_LETTER: Record<TrackFrame['detectionState'], string> = {
  tracked: 'T',
  low_confidence: 'L',
  ambiguous: 'A',
  not_detected: 'N',
};

function label(canvas: IndexedCanvas, ox: number, oy: number, text: string): void {
  const w = text.length * 4 * 2;
  canvas.fillRect(ox + 2, oy + 2, ox + 2 + w + 2, oy + 2 + 13, C.black);
  canvas.text(ox + 4, oy + 4, text, C.white, 2);
}

export function renderZoomSheet(
  tiles: readonly ZoomTile[],
  width: number,
  height: number,
  title: string,
): Uint8Array {
  const rows = Math.ceil(tiles.length / COLUMNS);
  const w = GAP + COLUMNS * (TILE + GAP);
  const titleH = 16;
  const legendH = 18;
  const h = titleH + GAP + rows * (TILE + GAP) + legendH;
  const canvas = new IndexedCanvas(w, h);
  canvas.text(GAP + 2, 3, title, C.white, 2);
  tiles.forEach((t, i) => {
    const ox = GAP + (i % COLUMNS) * (TILE + GAP);
    const oy = titleH + GAP + Math.floor(i / COLUMNS) * (TILE + GAP);
    const { x0, y0 } = cropOrigin(t.frame, width, height);
    blit(canvas, ox, oy, t.gray, width, x0, y0, ZOOM, grayIndex);
    overlay(canvas, ox, oy, x0, y0, t.frame, t.axis);
    canvas.rect(ox, oy, ox + TILE - 1, oy + TILE - 1, C.white);
    const f = t.frame;
    label(
      canvas,
      ox,
      oy,
      `${f.frameIndex} ${STATE_LETTER[f.detectionState]}${t.tag ?? ''} ${f.reason.replace(/_/g, ' ')} N${f.noseHeadingConfidence}`,
    );
  });
  canvas.text(
    GAP + 2,
    h - legendH + 4,
    '2X CROPS AROUND THE CENTROID. LABEL: FRAME, STATE (T/L/A/N), REASON, NOSE HEADING CONFIDENCE N0/N0.5/N1. GREEN=CENTROID RED=NOSE (HOLLOW=ONE CUE) CYAN=BODY AXIS MAGENTA=TAIL YELLOW=BBOX',
    C.white,
    2,
  );
  return encodePng(w, h, canvas.pixels, { type: 'indexed', palette: contactPalette() });
}

export interface StageInput {
  gray: Uint8Array;
  background: Uint8Array;
  mask: PlatformMask;
  threshold: number;
  px: TrackingParametersPx;
  frame: TrackFrame;
  axis: BodyAxis | null;
}

/** Four 2× panels: gray, difference (×2), thresholded foreground, opened body with components (area labels). */
export function renderStageView(input: StageInput): Uint8Array {
  const { gray, background, mask, threshold, px, frame, axis } = input;
  const { width, height } = mask;
  const diff = new Uint8Array(width * height);
  const fg = new Uint8Array(width * height);
  const extent = binarizeForeground(background, gray, mask, threshold, diff, fg);
  const eroded = new Uint8Array(width * height);
  const body = new Uint8Array(width * height);
  const disc = discOffsets(px.tailOpeningRadius_px);
  const bodyBox =
    extent.count > 0 ? openBinary(fg, width, height, extent.bbox, disc, eroded, body) : extent.bbox;
  const components: Component[] = [];
  const scratch = createLabelScratch(width, height);
  const n =
    bodyBox.x1 > bodyBox.x0
      ? labelComponents(
          body,
          growRect(bodyBox, 1, width, height),
          scratch,
          diff,
          mask.cx,
          mask.cy,
          components,
        )
      : 0;

  const titleH = 16;
  const w = GAP + 4 * (TILE + GAP);
  const h = titleH + GAP + TILE + GAP + 40;
  const canvas = new IndexedCanvas(w, h);
  // centre the crop on the foreground extent when there is one
  const cx =
    extent.count > 0
      ? (extent.bbox.x0 + extent.bbox.x1) / 2
      : frame.centroid.valid
        ? frame.centroid.x
        : width / 2;
  const cy =
    extent.count > 0
      ? (extent.bbox.y0 + extent.bbox.y1) / 2
      : frame.centroid.valid
        ? frame.centroid.y
        : height / 2;
  const x0 = Math.max(0, Math.min(width - CROP, Math.round(cx - CROP / 2)));
  const y0 = Math.max(0, Math.min(height - CROP, Math.round(cy - CROP / 2)));
  const panels: { name: string; buf: Uint8Array; map: (v: number) => number }[] = [
    { name: 'GRAY', buf: gray, map: grayIndex },
    { name: 'DIFF X2', buf: diff, map: (v) => grayIndex(Math.min(255, v * 2)) },
    { name: `FG >= ${threshold}`, buf: fg, map: (v) => (v ? 239 : 0) },
    { name: `BODY (OPENED R${disc.radius})`, buf: body, map: (v) => (v ? 239 : 0) },
  ];
  panels.forEach((p, i) => {
    const ox = GAP + i * (TILE + GAP);
    const oy = titleH + GAP;
    blit(canvas, ox, oy, p.buf, width, x0, y0, ZOOM, p.map);
    if (i === 0) overlay(canvas, ox, oy, x0, y0, frame, axis);
    if (i === 3) {
      for (let k = 0; k < n; k++) {
        const c = components[k]!;
        const X = (x: number) => ox + (x - x0) * ZOOM;
        const Y = (y: number) => oy + (y - y0) * ZOOM;
        const plausible = c.area >= px.minBlobArea_px2;
        canvas.rect(
          X(c.minX) - 1,
          Y(c.minY) - 1,
          X(c.maxX + 1),
          Y(c.maxY + 1),
          plausible ? C.yellow : C.orange,
        );
        canvas.text(X(c.minX), Y(c.maxY + 1) + 3, `${c.area}`, plausible ? C.yellow : C.orange, 1);
      }
    }
    canvas.rect(ox, oy, ox + TILE - 1, oy + TILE - 1, C.white);
    label(canvas, ox, oy, p.name);
  });
  const f = frame;
  canvas.text(
    GAP + 2,
    3,
    `FRAME ${f.frameIndex}  ${f.detectionState.toUpperCase()} / ${f.reason.replace(/_/g, ' ').toUpperCase()}  FG PX ${extent.count}  BODY COMPONENTS ${n} (${components
      .slice(0, n)
      .map((c) => c.area)
      .sort((a, b) => b - a)
      .join(
        ', ',
      )})  NOSE CONF ${f.noseHeadingConfidence}  TAIL PX ${axis ? axis.tailPixels : 0} OFFSET ${axis ? axis.tailOffset_px.toFixed(1) : '-'}`,
    C.white,
    2,
  );
  canvas.text(
    GAP + 2,
    h - 34,
    `CROP ${CROP}X${CROP} PX AT (${x0}, ${y0}) SHOWN AT 2X. MIN AREA ${px.minBlobArea_px2.toFixed(0)} MAX ${px.maxBlobArea_px2.toFixed(0)} PX2. RIM ZONE FROM ${px.rimZoneRadius_px.toFixed(0)} PX OF CENTRE.`,
    C.white,
    2,
  );
  canvas.text(
    GAP + 2,
    h - 18,
    'PANELS: GRAY WITH OVERLAY / BACKGROUND MINUS FRAME (X2) / FOREGROUND AT THRESHOLD / OPENED BODY WITH COMPONENT AREAS (ORANGE = BELOW MIN AREA)',
    C.white,
    2,
  );
  return encodePng(w, h, canvas.pixels, { type: 'indexed', palette: contactPalette() });
}
