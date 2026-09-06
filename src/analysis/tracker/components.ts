/**
 * 8-connected components of a binary image inside a rectangle, with area,
 * bounding box, raw moments (for centroid and ellipse), summed difference
 * (for contrast) and the farthest distance from the platform centre (for rim
 * contact). The label map and the flood-fill stack are reused across frames.
 */
import type { PixelRect } from './mask.js';

export interface Component {
  label: number;
  area: number;
  /** Inclusive pixel bounds. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  /** Sum of the difference image over the component (0 when no difference image was given). */
  sumDiff: number;
  /** Largest squared distance of a pixel from the reference centre. */
  maxDist2: number;
  /** Linear index of the first pixel found (top-most, then left-most). */
  firstIndex: number;
}

export interface LabelScratch {
  width: number;
  height: number;
  labels: Int32Array;
  stack: Int32Array;
}

export function createLabelScratch(width: number, height: number): LabelScratch {
  return {
    width,
    height,
    labels: new Int32Array(width * height),
    stack: new Int32Array(width * height),
  };
}

function newComponent(): Component {
  return {
    label: 0,
    area: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumYY: 0,
    sumXY: 0,
    sumDiff: 0,
    maxDist2: 0,
    firstIndex: 0,
  };
}

/**
 * Labels the set pixels of `binary` inside `bbox` (which must contain every
 * set pixel that should be reached). Labels are 1-based in `scratch.labels`,
 * cleared over `bbox` first. `out` is reused: entries beyond the returned
 * count are stale.
 */
export function labelComponents(
  binary: Uint8Array,
  bbox: PixelRect,
  scratch: LabelScratch,
  diff: Uint8Array | null,
  centreX: number,
  centreY: number,
  out: Component[],
): number {
  const { width, labels, stack } = scratch;
  for (let y = bbox.y0; y < bbox.y1; y++) labels.fill(0, y * width + bbox.x0, y * width + bbox.x1);

  let count = 0;
  for (let y = bbox.y0; y < bbox.y1; y++) {
    for (let x = bbox.x0; x < bbox.x1; x++) {
      const start = y * width + x;
      if (binary[start] === 0 || labels[start] !== 0) continue;
      const label = ++count;
      let c = out[count - 1];
      if (!c) {
        c = newComponent();
        out.push(c);
      }
      c.label = label;
      c.area = 0;
      c.minX = x;
      c.minY = y;
      c.maxX = x;
      c.maxY = y;
      c.sumX = 0;
      c.sumY = 0;
      c.sumXX = 0;
      c.sumYY = 0;
      c.sumXY = 0;
      c.sumDiff = 0;
      c.maxDist2 = 0;
      c.firstIndex = start;

      labels[start] = label;
      let top = 0;
      stack[top++] = start;
      while (top > 0) {
        const p = stack[--top]!;
        const py = (p / width) | 0;
        const px = p - py * width;
        c.area++;
        c.sumX += px;
        c.sumY += py;
        c.sumXX += px * px;
        c.sumYY += py * py;
        c.sumXY += px * py;
        if (diff) c.sumDiff += diff[p]!;
        const ddx = px - centreX;
        const ddy = py - centreY;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > c.maxDist2) c.maxDist2 = d2;
        if (px < c.minX) c.minX = px;
        if (px > c.maxX) c.maxX = px;
        if (py < c.minY) c.minY = py;
        if (py > c.maxY) c.maxY = py;

        const y0 = py > bbox.y0 ? py - 1 : py;
        const y1 = py + 1 < bbox.y1 ? py + 1 : py;
        const x0 = px > bbox.x0 ? px - 1 : px;
        const x1 = px + 1 < bbox.x1 ? px + 1 : px;
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const q = ny * width + nx;
            if (binary[q] !== 0 && labels[q] === 0) {
              labels[q] = label;
              stack[top++] = q;
            }
          }
        }
      }
    }
  }
  return count;
}
