/**
 * Per-pixel temporal median background over uniformly spaced sample frames
 * (D6), and a check that the background itself does not contain a
 * mouse-sized dark blob inside the platform (a stationary animal or the start
 * cylinder present in more than half the samples). The check warns; it never
 * corrects.
 */
import type { TrackingParametersPx } from './calibration.js';
import { cm2FromPx2 } from './calibration.js';
import { createLabelScratch, labelComponents, type Component } from './components.js';
import { otsuSplit } from './foreground.js';
import type { PlatformMask } from './mask.js';
import { CONFIDENCE_MODEL, isFrameExcluded, type FrameRange } from './params.js';
import { ellipseFromComponent } from './shape.js';

/**
 * Deterministic sample frame indices: `count` frames spaced uniformly over
 * the frames not covered by `excludeRanges` (fewer when fewer are eligible).
 */
export function backgroundSampleIndices(
  frameCount: number,
  count: number,
  excludeRanges: readonly FrameRange[] = [],
): number[] {
  const eligible: number[] = [];
  for (let i = 0; i < frameCount; i++) if (!isFrameExcluded(i, excludeRanges)) eligible.push(i);
  const n = Math.min(Math.max(0, Math.floor(count)), eligible.length);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(eligible[Math.floor(((k + 0.5) * eligible.length) / n)]!);
  return out;
}

/**
 * Lower median of every pixel across `samples`, with a 256-bin count per
 * pixel (no per-pixel sort, O(256) scratch, bounded memory whatever the
 * sample count).
 */
export function medianBackground(
  samples: readonly Uint8Array[],
  width: number,
  height: number,
): Uint8Array {
  const n = samples.length;
  const size = width * height;
  if (n === 0) throw new RangeError('medianBackground needs at least one sample frame');
  for (let s = 0; s < n; s++) {
    if (samples[s]!.length !== size) {
      throw new RangeError(`sample ${s} has ${samples[s]!.length} bytes, expected ${size}`);
    }
  }
  const out = new Uint8Array(size);
  const counts = new Uint32Array(256);
  const half = (n - 1) >> 1;
  for (let p = 0; p < size; p++) {
    for (let s = 0; s < n; s++) {
      const v = samples[s]![p]!;
      counts[v] = counts[v]! + 1;
    }
    let acc = 0;
    let v = 0;
    for (; v < 255; v++) {
      acc += counts[v]!;
      if (acc > half) break;
    }
    out[p] = v;
    for (let s = 0; s < n; s++) counts[samples[s]![p]!] = 0;
  }
  return out;
}

export interface ContaminationBlob {
  area_px2: number;
  area_cm2: number;
  cx: number;
  cy: number;
  /** Major ÷ minor axis of the second-moment ellipse. */
  elongation: number;
  /** Area relative to the median dark blob (≈ one hole). */
  areaRatio: number;
  flagged: boolean;
}

export interface ContaminationCheck {
  /** Otsu split of the background inside the mask: pixels ≤ this are "dark". */
  darkBelow: number;
  blobs: ContaminationBlob[];
  warnings: string[];
}

/**
 * Dark components of the background inside the mask, excluding those that
 * reach the rim zone (the surround is dark too and cannot be told apart from
 * an animal at the edge). With twenty similar holes the median dark blob is
 * hole-sized; a blob much larger than it, or mouse-sized and elongated, is
 * reported as a warning naming the `backgroundExcludeRanges` remedy.
 */
export function checkBackgroundContamination(
  background: Uint8Array,
  mask: PlatformMask,
  px: TrackingParametersPx,
): ContaminationCheck {
  const { width, height, spans } = mask;
  const histogram = new Uint32Array(256);
  for (let y = mask.bbox.y0; y < mask.bbox.y1; y++) {
    const row = y * width;
    for (let p = row + spans[2 * y]!; p < row + spans[2 * y + 1]!; p++) {
      const v = background[p]!;
      histogram[v] = histogram[v]! + 1;
    }
  }
  const darkBelow = otsuSplit(histogram);
  const dark = new Uint8Array(width * height);
  for (let y = mask.bbox.y0; y < mask.bbox.y1; y++) {
    const row = y * width;
    for (let p = row + spans[2 * y]!; p < row + spans[2 * y + 1]!; p++) {
      if (background[p]! <= darkBelow) dark[p] = 1;
    }
  }
  const scratch = createLabelScratch(width, height);
  const components: Component[] = [];
  const count = labelComponents(dark, mask.bbox, scratch, null, mask.cx, mask.cy, components);

  const rimZone2 = px.rimZoneRadius_px * px.rimZoneRadius_px;
  const kept: ContaminationBlob[] = [];
  for (let i = 0; i < count; i++) {
    const c = components[i]!;
    if (c.area < px.minBlobArea_px2 || c.maxDist2 >= rimZone2) continue;
    const e = ellipseFromComponent(c);
    kept.push({
      area_px2: c.area,
      area_cm2: cm2FromPx2(c.area, px.pxPerCm),
      cx: e.cx,
      cy: e.cy,
      elongation: e.minor > 0 ? e.major / e.minor : Infinity,
      areaRatio: 1,
      flagged: false,
    });
  }
  const areas = Float64Array.from(kept, (b) => b.area_px2).sort();
  const medianArea = areas.length > 0 ? areas[(areas.length - 1) >> 1]! : 0;
  const warnings: string[] = [];
  for (const b of kept) {
    b.areaRatio = medianArea > 0 ? b.area_px2 / medianArea : 1;
    const tooLarge = kept.length >= 2 && b.areaRatio >= CONFIDENCE_MODEL.contaminationAreaFactor;
    const elongated =
      b.area_px2 <= px.maxBlobArea_px2 && b.elongation >= CONFIDENCE_MODEL.contaminationElongation;
    if (tooLarge || elongated) {
      b.flagged = true;
      warnings.push(
        `background contains a dark blob of ${b.area_cm2.toFixed(1)} cm² at (${b.cx.toFixed(0)}, ${b.cy.toFixed(0)})` +
          ` — ${b.areaRatio.toFixed(1)}× the typical dark blob (a hole), elongation ${b.elongation.toFixed(1)}:` +
          ' a stationary animal or object may be baked into the background; exclude its frames with backgroundExcludeRanges.',
      );
    }
  }
  kept.sort((a, b) => b.area_px2 - a.area_px2 || a.cy - b.cy || a.cx - b.cx);
  return { darkBelow, blobs: kept, warnings };
}
