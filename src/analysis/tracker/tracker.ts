/**
 * The D6 tracking pipeline as a pure module over `Uint8Array` gray frames:
 * background subtraction inside the platform mask, one threshold per video,
 * opening to strip the tail, connected components, candidate selection with
 * a state and a fixed reason per frame (D8, D16), and a nose post-pass.
 *
 * `onFrame` does the pixel work and keeps a small per-frame observation; it
 * never keeps a reference to the caller's frame buffer, which the decoder
 * reuses. `finish()` learns the expected blob area when it is not given,
 * selects a candidate per frame in order, assigns the nose and builds the
 * contract-exact `TrackFrame` records. Same input → identical output.
 */
import type { DetectionState, NamedPoint, TrackFrame } from '../../contracts/track.js';
import {
  backgroundSampleIndices,
  checkBackgroundContamination,
  medianBackground,
} from './background.js';
import {
  cm2FromPx2,
  pxPerCmFromPlatform,
  toPixelUnits,
  type PlatformCircle,
  type TrackingParametersPx,
} from './calibration.js';
import {
  createLabelScratch,
  labelComponents,
  type Component,
  type LabelScratch,
} from './components.js';
import { binarizeForeground, chooseThreshold, type ThresholdChoice } from './foreground.js';
import {
  clearRect,
  growRect,
  isEmptyRect,
  platformMask,
  type PixelRect,
  type PlatformMask,
} from './mask.js';
import { discOffsets, openBinary, type DiscOffsets } from './morphology.js';
import { assignNose, type HoleCircle, type NoseFrameInput } from './nose.js';
import { CONFIDENCE_MODEL, type TrackingParameters } from './params.js';
import {
  DETECTION_REASONS,
  selectCandidate,
  type DetectionReason,
  type Selection,
} from './select.js';
import { axisExtremes, ellipseFromComponent, tailDirection, type TailDirection } from './shape.js';

export interface TrackerOptions {
  width: number;
  height: number;
  platform: PlatformCircle;
  pxPerCm: number;
  params: TrackingParameters;
  background: Uint8Array;
  threshold: ThresholdChoice;
  /** Hole centres for the stationary nose cue; optional in this version. */
  holes?: readonly HoleCircle[];
  /** Warnings from preparation (background contamination), carried into the summary. */
  warnings?: readonly string[];
}

export interface Tracker {
  /** Frames must arrive in presentation order starting at 0; `gray` is not retained. */
  onFrame(gray: Uint8Array, presIndex: number, t_s: number): void;
  finish(): TrackerResult;
}

export interface NotDetectedRun {
  startFrame: number;
  endFrame: number;
  frames: number;
  /** The last valid centroid before the run, or null when there was none. */
  lastTrackedPoint: { frameIndex: number; x: number; y: number } | null;
}

export interface TrackerSummary {
  frameCount: number;
  stateCounts: Record<DetectionState, number>;
  reasonCounts: Record<DetectionReason, number>;
  threshold: ThresholdChoice;
  pxPerCm: number;
  platform: PlatformCircle;
  expectedBlobArea_px2: number | null;
  expectedBlobAreaSource: 'parameter' | 'learned' | 'unavailable';
  medianTrackedBlobArea_px2: number | null;
  medianTrackedBlobArea_cm2: number | null;
  longestNotDetectedRun: NotDetectedRun | null;
  /** Frames by nose-heading confidence, all frames with a selected blob. */
  noseHeadingConfidenceCounts: { c0: number; c05: number; c1: number };
  /** The same over frames whose centroid speed was at or above the moving threshold. */
  movingNoseHeadingConfidenceCounts: { c0: number; c05: number; c1: number };
  movingFrames: number;
  warnings: string[];
}

export interface TrackerTiming {
  frames: number;
  /** Time spent inside `onFrame` plus `finish()`, ms. */
  elapsedMs: number;
  fps: number;
}

/** Body geometry of the selected blob, for overlays and evidence; not part of the track contract. */
export interface BodyAxis {
  /** Contour extremes along the major axis (A farthest along +u, B along −u). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Semi-axis lengths, px. */
  major: number;
  minor: number;
  angle_rad: number;
  tail: TailDirection | null;
  /** Pixels attributed to the tail (before the direction checks) and their centroid's offset from the body centroid, px. */
  tailPixels: number;
  tailOffset_px: number;
}

/** Which head-direction cues were available per frame (evidence for O16); not part of the track contract. */
export interface NoseCueRecord {
  tail: boolean;
  velocity: boolean;
  hole: boolean;
  moving: boolean;
  speed_pxPerS: number | null;
}

/** A plausible component of one frame (evidence for the quality report and for reviewing ambiguous frames); not part of the track contract. */
export interface CandidateSummary {
  area_px2: number;
  cx: number;
  cy: number;
  rimContact: boolean;
}

export interface TrackerResult {
  frames: TrackFrame[];
  /** One entry per frame: every candidate at or above the minimum area, largest first. */
  candidates: CandidateSummary[][];
  /** One entry per frame: the selected blob's axis, or null when no blob was selected. */
  axes: (BodyAxis | null)[];
  /** One entry per frame: the nose cues that were available (all false when no blob was selected). */
  noseCues: NoseCueRecord[];
  summary: TrackerSummary;
  timing: TrackerTiming;
}

interface CandidateRecord {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  meanDiff: number;
  rimContact: boolean;
  ux: number;
  uy: number;
  major: number;
  minor: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tail: TailDirection | null;
  /** Pixels attributed to the tail before the direction checks, and their centroid's distance from the body centroid. */
  tailPixels: number;
  tailOffset_px: number;
}

interface Observation {
  presIndex: number;
  t_s: number;
  /** Components at or above the minimum area, largest first, capped. */
  candidates: CandidateRecord[];
  componentCount: number;
  foregroundPixels: number;
}

const EMPTY_RECT: PixelRect = { x0: 0, y0: 0, x1: 0, y1: 0 };

function invalidPoint(): NamedPoint {
  return { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lowerMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  return sorted[(sorted.length - 1) >> 1]!;
}

export function createTracker(options: TrackerOptions): Tracker {
  const { width, height, platform, pxPerCm, params, background, threshold } = options;
  const size = width * height;
  if (background.length !== size) {
    throw new RangeError(`background has ${background.length} bytes, expected ${size}`);
  }
  if (!(threshold.value >= 1 && threshold.value <= 255)) {
    throw new RangeError(`threshold must be 1–255, got ${threshold.value}`);
  }
  const px = toPixelUnits(params, platform, pxPerCm);
  const mask = platformMask(width, height, platform, px.maskRadius_px);
  const disc: DiscOffsets = discOffsets(px.tailOpeningRadius_px);
  const rimZone2 = px.rimZoneRadius_px * px.rimZoneRadius_px;

  // Allocated once; reused for every frame.
  const diff = new Uint8Array(size);
  const fg = new Uint8Array(size);
  const eroded = new Uint8Array(size);
  const body = new Uint8Array(size);
  const bodyScratch: LabelScratch = createLabelScratch(width, height);
  const rawScratch: LabelScratch = createLabelScratch(width, height);
  const bodyComponents: Component[] = [];
  const rawComponents: Component[] = [];
  let rawChildCount = new Int32Array(64);
  let rawChildIndex = new Int32Array(64);
  let tailSumX = new Float64Array(64);
  let tailSumY = new Float64Array(64);
  let tailCount = new Int32Array(64);
  let order: number[] = [];
  let previousRegion: PixelRect = EMPTY_RECT;

  const observations: Observation[] = [];
  let elapsedMs = 0;
  let finished = false;

  function onFrame(gray: Uint8Array, presIndex: number, t_s: number): void {
    if (finished) throw new Error('tracker already finished');
    if (gray.length !== size)
      throw new RangeError(`frame has ${gray.length} bytes, expected ${size}`);
    if (presIndex !== observations.length) {
      throw new Error(
        `frames must arrive in order: expected ${observations.length}, got ${presIndex}`,
      );
    }
    const started = performance.now();

    const extent = binarizeForeground(background, gray, mask, threshold.value, diff, fg);
    const observation: Observation = {
      presIndex,
      t_s,
      candidates: [],
      componentCount: 0,
      foregroundPixels: extent.count,
    };
    if (extent.count > 0) {
      clearRect(eroded, width, previousRegion);
      clearRect(body, width, previousRegion);
      previousRegion = growRect(extent.bbox, disc.radius, width, height);
      const bodyBox = openBinary(fg, width, height, extent.bbox, disc, eroded, body);
      if (!isEmptyRect(bodyBox)) {
        const nBody = labelComponents(
          body,
          bodyBox,
          bodyScratch,
          diff,
          mask.cx,
          mask.cy,
          bodyComponents,
        );
        const nRaw = labelComponents(
          fg,
          extent.bbox,
          rawScratch,
          null,
          mask.cx,
          mask.cy,
          rawComponents,
        );
        observation.componentCount = nBody;

        // Attribute the pixels the opening removed to the body they were attached to.
        if (rawChildCount.length < nRaw + 1) {
          rawChildCount = new Int32Array(nRaw + 1);
          rawChildIndex = new Int32Array(nRaw + 1);
        } else {
          rawChildCount.fill(0, 0, nRaw + 1);
        }
        if (tailCount.length < nBody) {
          tailSumX = new Float64Array(nBody);
          tailSumY = new Float64Array(nBody);
          tailCount = new Int32Array(nBody);
        } else {
          tailSumX.fill(0, 0, nBody);
          tailSumY.fill(0, 0, nBody);
          tailCount.fill(0, 0, nBody);
        }
        const rawLabels = rawScratch.labels;
        for (let b = 0; b < nBody; b++) {
          const r = rawLabels[bodyComponents[b]!.firstIndex]!;
          rawChildCount[r] = rawChildCount[r]! + 1;
          rawChildIndex[r] = b;
        }
        // A detached piece (no body of its own) close to exactly one body is that body's tail.
        const attachGap = CONFIDENCE_MODEL.tailAttachGapFactor * disc.radius;
        for (let r = 1; r <= nRaw; r++) {
          if (rawChildCount[r] !== 0) continue;
          const piece = rawComponents[r - 1]!;
          if (piece.area < CONFIDENCE_MODEL.noseTailMinPixels) continue;
          const pieceShape = ellipseFromComponent(piece);
          if (
            pieceShape.minor <= 0 ||
            pieceShape.major / pieceShape.minor < CONFIDENCE_MODEL.tailPieceMinElongation
          ) {
            continue;
          }
          let near = -1;
          let nearCount = 0;
          for (let b = 0; b < nBody; b++) {
            const c = bodyComponents[b]!;
            const gap = Math.max(
              0,
              piece.minX - c.maxX - 1,
              c.minX - piece.maxX - 1,
              piece.minY - c.maxY - 1,
              c.minY - piece.maxY - 1,
            );
            if (gap <= attachGap) {
              nearCount++;
              near = b;
            }
          }
          if (nearCount === 1) {
            rawChildCount[r] = 1;
            rawChildIndex[r] = near;
          }
        }
        for (let y = extent.bbox.y0; y < extent.bbox.y1; y++) {
          const row = y * width;
          for (let x = extent.bbox.x0; x < extent.bbox.x1; x++) {
            const p = row + x;
            if (fg[p] === 0 || body[p] !== 0) continue;
            const r = rawLabels[p]!;
            if (rawChildCount[r] !== 1) continue;
            const b = rawChildIndex[r]!;
            tailSumX[b] = tailSumX[b]! + x;
            tailSumY[b] = tailSumY[b]! + y;
            tailCount[b] = tailCount[b]! + 1;
          }
        }

        // Candidates: components at or above the minimum area, largest first.
        order.length = 0;
        for (let b = 0; b < nBody; b++) {
          if (bodyComponents[b]!.area >= px.minBlobArea_px2) order.push(b);
        }
        order.sort(
          (i, j) =>
            bodyComponents[j]!.area - bodyComponents[i]!.area ||
            bodyComponents[i]!.firstIndex - bodyComponents[j]!.firstIndex,
        );
        if (order.length > CONFIDENCE_MODEL.maxCandidatesPerFrame) {
          order = order.slice(0, CONFIDENCE_MODEL.maxCandidatesPerFrame);
        }
        for (const b of order) {
          const c = bodyComponents[b]!;
          const e = ellipseFromComponent(c);
          const ends = axisExtremes(bodyScratch.labels, width, c, e);
          observation.candidates.push({
            area: c.area,
            cx: e.cx,
            cy: e.cy,
            minX: c.minX,
            minY: c.minY,
            maxX: c.maxX,
            maxY: c.maxY,
            meanDiff: c.sumDiff / c.area,
            rimContact: c.maxDist2 >= rimZone2,
            ux: e.ux,
            uy: e.uy,
            major: e.major,
            minor: e.minor,
            ax: ends.ax,
            ay: ends.ay,
            bx: ends.bx,
            by: ends.by,
            tail: tailDirection(
              e.cx,
              e.cy,
              tailSumX[b]!,
              tailSumY[b]!,
              tailCount[b]!,
              CONFIDENCE_MODEL.noseTailMinPixels,
              CONFIDENCE_MODEL.noseTailMinOffsetFraction * e.major,
            ),
            tailPixels: tailCount[b]!,
            tailOffset_px:
              tailCount[b]! > 0
                ? Math.hypot(
                    tailSumX[b]! / tailCount[b]! - e.cx,
                    tailSumY[b]! / tailCount[b]! - e.cy,
                  )
                : 0,
          });
        }
      }
    }
    observations.push(observation);
    elapsedMs += performance.now() - started;
  }

  function finish(): TrackerResult {
    if (finished) throw new Error('tracker already finished');
    finished = true;
    const started = performance.now();
    const warnings = [...(options.warnings ?? [])];

    // Expected blob area: the parameter, or the median of the unambiguous frames.
    let expected_px2 = px.expectedBlobArea_px2;
    let expectedSource: TrackerSummary['expectedBlobAreaSource'] = 'parameter';
    if (expected_px2 === null) {
      const areas: number[] = [];
      for (const o of observations) {
        if (o.candidates.length !== 1) continue;
        const a = o.candidates[0]!.area;
        if (a >= px.minBlobArea_px2 && a <= px.maxBlobArea_px2) areas.push(a);
      }
      expected_px2 = lowerMedian(areas);
      expectedSource = expected_px2 === null ? 'unavailable' : 'learned';
      if (expected_px2 === null) {
        warnings.push(
          'expected blob area could not be learned: no frame has exactly one component inside the area range; oversized and small-blob rules used the area range only',
        );
      }
    }

    // Selection in order, with the last valid centroid as the previous position.
    const selections: Selection[] = new Array<Selection>(observations.length);
    let previous: { x: number; y: number } | null = null;
    for (let i = 0; i < observations.length; i++) {
      const o = observations[i]!;
      const s = selectCandidate(o.candidates, px, expected_px2, previous);
      selections[i] = s;
      if (s.index >= 0) {
        const c = o.candidates[s.index]!;
        previous = { x: c.cx, y: c.cy };
      }
    }

    const noseInputs: NoseFrameInput[] = observations.map((o, i) => {
      const s = selections[i]!;
      if (s.index < 0) return { t_s: o.t_s, shape: null };
      const c = o.candidates[s.index]!;
      return {
        t_s: o.t_s,
        shape: {
          cx: c.cx,
          cy: c.cy,
          ux: c.ux,
          uy: c.uy,
          ax: c.ax,
          ay: c.ay,
          bx: c.bx,
          by: c.by,
          tail: c.tail,
        },
      };
    });
    const noses = assignNose(noseInputs, px, options.holes ?? []);

    const frames: TrackFrame[] = new Array<TrackFrame>(observations.length);
    const axes: (BodyAxis | null)[] = new Array<BodyAxis | null>(observations.length);
    const noseCues: NoseCueRecord[] = new Array<NoseCueRecord>(observations.length);
    const candidatesOut: CandidateSummary[][] = new Array<CandidateSummary[]>(observations.length);
    const stateCounts: Record<DetectionState, number> = {
      tracked: 0,
      not_detected: 0,
      ambiguous: 0,
      low_confidence: 0,
    };
    const reasonCounts = Object.fromEntries(DETECTION_REASONS.map((r) => [r, 0])) as Record<
      DetectionReason,
      number
    >;
    const noseCounts = { c0: 0, c05: 0, c1: 0 };
    const movingNoseCounts = { c0: 0, c05: 0, c1: 0 };
    let movingFrames = 0;
    const trackedAreas: number[] = [];
    for (let i = 0; i < observations.length; i++) {
      const o = observations[i]!;
      const s = selections[i]!;
      const nose = noses[i]!;
      axes[i] = null;
      noseCues[i] = { ...nose.cues, moving: nose.moving, speed_pxPerS: nose.speed_pxPerS };
      candidatesOut[i] = o.candidates.map((c) => ({
        area_px2: c.area,
        cx: c.cx,
        cy: c.cy,
        rimContact: c.rimContact,
      }));
      stateCounts[s.state]++;
      reasonCounts[s.reason]++;
      let centroid = invalidPoint();
      let nosePoint = invalidPoint();
      let blobArea_px2 = 0;
      let boundingBox: TrackFrame['boundingBox'] = null;
      if (s.index >= 0) {
        const c = o.candidates[s.index]!;
        const areaFactor =
          expected_px2 === null
            ? 1
            : clamp01(
                1 -
                  Math.max(
                    0,
                    Math.abs(c.area / expected_px2 - 1) - CONFIDENCE_MODEL.areaTolerance,
                  ) /
                    CONFIDENCE_MODEL.areaTolerance,
              );
        const contrastFactor = clamp01(
          c.meanDiff / (CONFIDENCE_MODEL.contrastReference * threshold.value),
        );
        const candidateFactor = s.byProximity ? CONFIDENCE_MODEL.proximityCandidateFactor : 1;
        const rimFactor = c.rimContact ? CONFIDENCE_MODEL.rimContactFactor : 1;
        const confidence = areaFactor * contrastFactor * candidateFactor * rimFactor;
        centroid = { x: c.cx, y: c.cy, confidence, valid: true, source: 'auto' };
        nosePoint = {
          x: nose.valid ? nose.x : 0,
          y: nose.valid ? nose.y : 0,
          confidence: nose.valid ? confidence * nose.headingConfidence : 0,
          valid: nose.valid,
          source: 'auto',
        };
        blobArea_px2 = c.area;
        axes[i] = {
          ax: c.ax,
          ay: c.ay,
          bx: c.bx,
          by: c.by,
          major: c.major,
          minor: c.minor,
          angle_rad: Math.atan2(c.uy, c.ux),
          tail: c.tail,
          tailPixels: c.tailPixels,
          tailOffset_px: c.tailOffset_px,
        };
        boundingBox = {
          x: c.minX,
          y: c.minY,
          width: c.maxX - c.minX + 1,
          height: c.maxY - c.minY + 1,
        };
        if (s.state === 'tracked') trackedAreas.push(c.area);
        const key =
          nose.headingConfidence >= 1 ? 'c1' : nose.headingConfidence >= 0.5 ? 'c05' : 'c0';
        noseCounts[key]++;
        if (nose.moving) {
          movingFrames++;
          movingNoseCounts[key]++;
        }
      }
      frames[i] = {
        frameIndex: o.presIndex,
        t_s: o.t_s,
        centroid,
        nose: nosePoint,
        detectionState: s.state,
        reason: s.reason,
        blobArea_px2,
        boundingBox,
        noseHeadingConfidence: s.index >= 0 ? nose.headingConfidence : 0,
      };
    }

    const medianTracked = lowerMedian(trackedAreas);
    elapsedMs += performance.now() - started;
    const summary: TrackerSummary = {
      frameCount: frames.length,
      stateCounts,
      reasonCounts,
      threshold: { ...threshold },
      pxPerCm,
      platform: { ...platform },
      expectedBlobArea_px2: expected_px2,
      expectedBlobAreaSource: expectedSource,
      medianTrackedBlobArea_px2: medianTracked,
      medianTrackedBlobArea_cm2: medianTracked === null ? null : cm2FromPx2(medianTracked, pxPerCm),
      longestNotDetectedRun: longestNotDetectedRun(frames),
      noseHeadingConfidenceCounts: noseCounts,
      movingNoseHeadingConfidenceCounts: movingNoseCounts,
      movingFrames,
      warnings,
    };
    return {
      frames,
      candidates: candidatesOut,
      axes,
      noseCues,
      summary,
      timing: {
        frames: frames.length,
        elapsedMs,
        fps: elapsedMs > 0 ? (frames.length * 1000) / elapsedMs : 0,
      },
    };
  }

  return { onFrame, finish };
}

export function longestNotDetectedRun(frames: readonly TrackFrame[]): NotDetectedRun | null {
  let best: NotDetectedRun | null = null;
  let runStart = -1;
  const closeRun = (end: number) => {
    const length = end - runStart + 1;
    if (best === null || length > best.frames) {
      let last: NotDetectedRun['lastTrackedPoint'] = null;
      for (let j = runStart - 1; j >= 0; j--) {
        const f = frames[j]!;
        if (f.centroid.valid) {
          last = { frameIndex: f.frameIndex, x: f.centroid.x, y: f.centroid.y };
          break;
        }
      }
      best = {
        startFrame: frames[runStart]!.frameIndex,
        endFrame: frames[end]!.frameIndex,
        frames: length,
        lastTrackedPoint: last,
      };
    }
    runStart = -1;
  };
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.detectionState === 'not_detected') {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      closeRun(i - 1);
    }
  }
  if (runStart >= 0) closeRun(frames.length - 1);
  return best;
}

export interface FrameInput {
  gray: Uint8Array;
  presIndex: number;
  t_s: number;
}

/** Runs a whole sequence through a tracker (Node convenience). */
export function trackFrames(frames: Iterable<FrameInput>, options: TrackerOptions): TrackerResult {
  const tracker = createTracker(options);
  for (const f of frames) tracker.onFrame(f.gray, f.presIndex, f.t_s);
  return tracker.finish();
}

export interface PrepareOptions {
  width: number;
  height: number;
  platform: PlatformCircle;
  platformDiameter_cm: number;
  params: TrackingParameters;
  /** Sample frames (gray planes) chosen with `backgroundSampleIndices`. */
  samples: readonly Uint8Array[];
  /** A median background already computed from `samples` (skips recomputing it). */
  background?: Uint8Array;
}

export interface Preparation {
  pxPerCm: number;
  background: Uint8Array;
  threshold: ThresholdChoice;
  mask: PlatformMask;
  px: TrackingParametersPx;
  warnings: string[];
}

/** Background, threshold and contamination check from the sample frames — what the harness and the worker do before the pass. */
export function prepareTracking(options: PrepareOptions): Preparation {
  const { width, height, platform, params, samples } = options;
  const pxPerCm = pxPerCmFromPlatform(platform, options.platformDiameter_cm);
  const px = toPixelUnits(params, platform, pxPerCm);
  const mask = platformMask(width, height, platform, px.maskRadius_px);
  const background = options.background ?? medianBackground(samples, width, height);
  if (background.length !== width * height) {
    throw new RangeError(`background has ${background.length} bytes, expected ${width * height}`);
  }
  const threshold = chooseThreshold(background, samples, mask, params);
  const contamination = checkBackgroundContamination(background, mask, px);
  return { pxPerCm, background, threshold, mask, px, warnings: [...contamination.warnings] };
}

export { backgroundSampleIndices };
