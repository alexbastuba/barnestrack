/**
 * A complete, contract-valid synthetic session: three videos mirroring the
 * sample clips (test50 / test51 / test53), each with a scripted trajectory, an
 * event list derived from that trajectory, metrics and a quality report.
 *
 * Deterministic by construction — a seeded LCG, never `Math.random` — so the
 * export tests, the figure tests and the gallery page all see byte-identical
 * data.
 *
 * This is a *fixture*, not a source of truth. The analysis engine owns the real
 * parameter defaults (imported here so the fixture can never drift from them),
 * the real event detection and the real metric definitions; the events,
 * metrics and quality values here are scripted to look plausible, not derived.
 */
import {
  DEFAULT_PARAMETERS,
  hashParameters,
  hashTrackingParameters,
} from '../../src/analysis/parameters.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { MazeMapFile, PlatformCircle } from '../../src/contracts/mazeMap.js';
import { MAZE_MAP_SCHEMA_VERSION } from '../../src/contracts/mazeMap.js';
import type { TrialMetrics } from '../../src/contracts/metrics.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { GapRecord, HistogramBin, QualityReport } from '../../src/contracts/quality.js';
import type {
  CorrectionEntry,
  SearchStrategy,
  SessionFile,
  VideoAnalysis,
  VideoDescriptor,
  VideoMetadata,
} from '../../src/contracts/session.js';
import { SESSION_SCHEMA_VERSION } from '../../src/contracts/session.js';
import type { DetectionState, NamedPoint, TrackFrame } from '../../src/contracts/track.js';
import { holeCentres, holeRadiusPx, pxPerCm } from '../../src/maze/ring.js';
import {
  IDENTITY_TRANSFORM,
  transformFromCircles,
  transformMap,
} from '../../src/maze/similarity.js';
import type { Point } from '../../src/maze/types.js';

/** A build-time version string of the shape D12 specifies. */
export const FIXTURE_TOOL_VERSION = 'barnestrack v0.1.0 (5e11c0a)';

/** The engine's own defaults (D20, D51): the fixture is analysed "as shipped". */
export const FIXTURE_PARAMETERS: Parameters = DEFAULT_PARAMETERS;

/** The real D51 layer keys of those defaults, from the one hasher. */
export const FIXTURE_TRACKING_HASH = hashTrackingParameters(FIXTURE_PARAMETERS.tracking);
export const FIXTURE_PARAMETERS_HASH = hashParameters(FIXTURE_PARAMETERS);

export const PLATFORM_DIAMETER_CM = 92;
export const HOLE_DIAMETER_CM = 5;
export const HOLE_COUNT = 20;
export const RING_RATIO = 0.89;
export const TARGET_HOLE = 7;

const VIDEO_RESOLUTION = { width: 640, height: 480 };

/** Platform circles measured on the sample clips (chunk 2, `prototypes/tracker/RESULTS.md`). */
const PLATFORM_TEST50: PlatformCircle = { cx: 327.8, cy: 239.7, r: 208.5 };
const PLATFORM_TEST51: PlatformCircle = { cx: 280.0, cy: 239.9, r: 222.5 };
const PLATFORM_TEST53: PlatformCircle = { cx: 327.8, cy: 239.7, r: 208.5 };

const MAP_PX_PER_CM = PLATFORM_TEST50.r / (PLATFORM_DIAMETER_CM / 2);

/**
 * The one shared maze map (D10, D44, D49): the platform circle and hole ring of
 * the maze itself, fit from test50. Where that maze sits in each video is the
 * video's own `mazeTransform`.
 */
export const FIXTURE_MAZE_MAP: MazeMapFile = {
  schemaVersion: MAZE_MAP_SCHEMA_VERSION,
  referenceResolution: VIDEO_RESOLUTION,
  platform: PLATFORM_TEST50,
  holes: {
    n: HOLE_COUNT,
    ringRatio: RING_RATIO,
    holeRadius_px: holeRadiusPx(HOLE_DIAMETER_CM, MAP_PX_PER_CM),
    // Hole 0 at the top of the frame; y points down, so angles run clockwise.
    phase_deg: 270,
  },
  target: { holeIndex: TARGET_HOLE },
  calibration: { platformDiameter_cm: PLATFORM_DIAMETER_CM },
  createdFrom: 'test50',
};

/**
 * How far the body centroid sits back from a hole centre while the animal noses
 * into it, in cm. Without it every dwell would put the centroid exactly on the
 * hole and every reported distance would be zero.
 */
const BODY_SETBACK_CM = 3;

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** One move-then-linger step of a scripted search. */
interface ScriptLeg {
  /** Hole the animal moves to, or `null` for the platform centre. */
  holeIndex: number | null;
  /** Distance from the platform centre as a fraction of the platform radius. */
  radiusFrac: number;
  travel_s: number;
  dwell_s: number;
}

interface VideoScript {
  id: string;
  filename: string;
  frameCount: number;
  fps: number;
  platform: PlatformCircle;
  metadata: VideoMetadata;
  strategy: SearchStrategy;
  trialStart_s: number;
  legs: ScriptLeg[];
  /** Fraction of the clip at which the animal enters the escape box, or `null`. */
  escapeAt: number | null;
  /** A mid-trial loss of detection away from any hole — a tracking failure (O4). */
  failure: { atFraction: number; duration_s: number } | null;
  /**
   * Where to put a short loss of detection, as a fraction of the clip. Whether
   * it is actually filled depends on the video's frame rate against O10's
   * 0.1 s ceiling: at 30 fps a two-frame gap just fits, and at test51's
   * 14.985 fps even a one-frame gap does not, so that video keeps the gap.
   */
  fillableGapAt: number | null;
  seed: number;
}

/** Walk the ring hole by hole: a serial search that runs out of clip (O5 cutoff). */
const SERIAL_LEGS: ScriptLeg[] = [
  { holeIndex: null, radiusFrac: 0, travel_s: 0, dwell_s: 3 },
  { holeIndex: 0, radiusFrac: RING_RATIO, travel_s: 4, dwell_s: 6 },
  { holeIndex: 1, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 7 },
  { holeIndex: 2, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 5 },
  { holeIndex: 3, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 9 },
  { holeIndex: 4, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 6 },
  { holeIndex: 5, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 8 },
  { holeIndex: 6, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 11 },
  { holeIndex: 7, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 4 },
  { holeIndex: 8, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 6 },
  { holeIndex: 9, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 9 },
  { holeIndex: 10, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 7 },
  { holeIndex: 11, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 5 },
  { holeIndex: 12, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 8 },
  { holeIndex: 7, radiusFrac: RING_RATIO, travel_s: 6, dwell_s: 12 },
];

/** Straight to the target with one neighbouring check: a spatial search. */
const SPATIAL_LEGS: ScriptLeg[] = [
  { holeIndex: null, radiusFrac: 0, travel_s: 0, dwell_s: 2 },
  { holeIndex: 6, radiusFrac: RING_RATIO, travel_s: 5, dwell_s: 3 },
  { holeIndex: 7, radiusFrac: RING_RATIO, travel_s: 2, dwell_s: 4 },
  { holeIndex: 8, radiusFrac: RING_RATIO, travel_s: 2, dwell_s: 2 },
  { holeIndex: 7, radiusFrac: RING_RATIO, travel_s: 2, dwell_s: 6 },
];

/** Holes far apart with centre crossings between them: a random search. */
const RANDOM_LEGS: ScriptLeg[] = [
  { holeIndex: null, radiusFrac: 0, travel_s: 0, dwell_s: 1.5 },
  { holeIndex: 3, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 2 },
  { holeIndex: null, radiusFrac: 0.1, travel_s: 2.5, dwell_s: 0.5 },
  { holeIndex: 14, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 2.5 },
  { holeIndex: null, radiusFrac: 0.15, travel_s: 2.5, dwell_s: 0.5 },
  { holeIndex: 9, radiusFrac: RING_RATIO, travel_s: 3, dwell_s: 2 },
  { holeIndex: 18, radiusFrac: RING_RATIO, travel_s: 3.5, dwell_s: 1.5 },
  { holeIndex: 7, radiusFrac: RING_RATIO, travel_s: 4, dwell_s: 3 },
];

const SCRIPTS: readonly VideoScript[] = [
  {
    id: 'video-test50',
    filename: 'test50.mp4',
    frameCount: 5539,
    fps: 30,
    platform: PLATFORM_TEST50,
    metadata: { animal: 'M12', day: '1', trial: '1', group: 'control' },
    strategy: 'serial',
    trialStart_s: 2.4,
    legs: SERIAL_LEGS,
    escapeAt: null,
    failure: { atFraction: 0.3, duration_s: 1.2 },
    fillableGapAt: 0.42,
    seed: 50,
  },
  {
    id: 'video-test51',
    filename: 'test51.mp4',
    frameCount: 741,
    fps: 14.985,
    platform: PLATFORM_TEST51,
    metadata: { animal: 'M12', day: '4', trial: '1', group: 'control' },
    strategy: 'spatial',
    trialStart_s: 1.2,
    legs: SPATIAL_LEGS,
    escapeAt: 0.93,
    failure: null,
    fillableGapAt: 0.35,
    seed: 51,
  },
  {
    id: 'video-test53',
    filename: 'test53.mp4',
    frameCount: 905,
    fps: 30,
    platform: PLATFORM_TEST53,
    metadata: { animal: 'M07', day: '1', trial: '1', group: 'lesion' },
    strategy: 'random',
    trialStart_s: 1.0,
    legs: RANDOM_LEGS,
    escapeAt: 0.94,
    failure: { atFraction: 0.45, duration_s: 1.6 },
    fillableGapAt: null,
    seed: 53,
  },
];

export function videoDescriptors(): VideoDescriptor[] {
  return SCRIPTS.map((script) => ({
    id: script.id,
    filename: script.filename,
    fingerprint: {
      byteLength: 1_000_000 + script.frameCount * 137,
      durationSeconds: round(script.frameCount / script.fps, 3),
      frameCount: script.frameCount,
      sha256: fakeSha(script.id),
    },
    referenceResolution: VIDEO_RESOLUTION,
    mazeTransform:
      script.platform === PLATFORM_TEST50
        ? IDENTITY_TRANSFORM
        : (transformFromCircles(FIXTURE_MAZE_MAP.platform, script.platform) ?? IDENTITY_TRANSFORM),
    metadata: script.metadata,
  }));
}

/** A stable, obviously synthetic 64-hex digest. */
function fakeSha(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  const next = lcg(hash);
  let out = '';
  while (out.length < 64)
    out += Math.floor(next() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return out.slice(0, 64);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface Segment {
  start_s: number;
  end_s: number;
  from: Point;
  to: Point;
  /** True while the animal lingers at a hole — where investigations come from. */
  dwelling: boolean;
  holeIndex: number | null;
}

/**
 * Turn the leg list into a timed sequence of positions in this video's pixels,
 * stretched to fill the trial (up to the escape, or to the end of the clip).
 */
function buildSegments(script: VideoScript, map: MazeMapFile): Segment[] {
  const centres = holeCentres(map);
  const centre: Point = { x: map.platform.cx, y: map.platform.cy };
  const pixelsPerCm = pxPerCm(map.platform, map.calibration.platformDiameter_cm) ?? MAP_PX_PER_CM;
  const setback = (BODY_SETBACK_CM * pixelsPerCm) / map.platform.r;
  const waypoint = (leg: ScriptLeg): Point => {
    if (leg.holeIndex === null) {
      return leg.radiusFrac === 0
        ? centre
        : lerp(centre, centres[0] ?? centre, leg.radiusFrac / RING_RATIO);
    }
    const hole = centres[leg.holeIndex] ?? centre;
    // The body stops short of the hole; the nose reaches it.
    return lerp(centre, hole, (leg.radiusFrac - setback) / RING_RATIO);
  };

  const scripted = script.legs.reduce((sum, leg) => sum + leg.travel_s + leg.dwell_s, 0);
  const duration = script.frameCount / script.fps;
  const trialEnd = (script.escapeAt ?? 1) * duration;
  const scale = (trialEnd - script.trialStart_s) / scripted;

  const segments: Segment[] = [];
  let t = script.trialStart_s;
  let position = waypoint(
    script.legs[0] ?? { holeIndex: null, radiusFrac: 0, travel_s: 0, dwell_s: 0 },
  );
  for (const leg of script.legs) {
    const target = waypoint(leg);
    if (leg.travel_s > 0) {
      const end = t + leg.travel_s * scale;
      segments.push({
        start_s: t,
        end_s: end,
        from: position,
        to: target,
        dwelling: false,
        holeIndex: null,
      });
      t = end;
    }
    if (leg.dwell_s > 0) {
      const end = t + leg.dwell_s * scale;
      segments.push({
        start_s: t,
        end_s: end,
        from: target,
        to: target,
        dwelling: true,
        holeIndex: leg.holeIndex,
      });
      t = end;
    }
    position = target;
  }
  return segments;
}

function positionAt(segments: readonly Segment[], t: number): { point: Point; segment: Segment } {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (t <= first.start_s) return { point: first.from, segment: first };
  if (t >= last.end_s) return { point: last.to, segment: last };
  for (const segment of segments) {
    if (t >= segment.start_s && t < segment.end_s) {
      const span = segment.end_s - segment.start_s;
      return {
        point: lerp(segment.from, segment.to, span === 0 ? 0 : (t - segment.start_s) / span),
        segment,
      };
    }
  }
  return { point: last.to, segment: last };
}

/**
 * Where to put the short loss of detection: snapped forward from the requested
 * fraction of the clip to the middle of the next stretch of travel, so it lands
 * between holes. O10 never fills a gap within one hole radius of a hole — a gap
 * at a hole is evidence, not noise — so a fixture whose fillable gap sat inside
 * an investigation would be demonstrating something the rule forbids.
 */
function shortGapStartFrame(
  script: VideoScript,
  segments: readonly Segment[],
  values: readonly number[],
): number | null {
  if (script.fillableGapAt === null) return null;
  const wanted = values[Math.round(script.fillableGapAt * script.frameCount)] ?? 0;
  const travelling = segments.filter((segment) => !segment.dwelling && segment.end_s > wanted);
  const chosen = travelling[0] ?? segments.find((segment) => !segment.dwelling);
  if (!chosen) return null;
  const frame = frameAtTime(values, (chosen.start_s + chosen.end_s) / 2);
  return frame > 0 ? frame : null;
}

/**
 * Presentation timestamps with the anomalies the sample clips actually show
 * (D7, O11): a few repeated timestamps and a few dropped-frame gaps.
 */
function timestamps(script: VideoScript): {
  values: number[];
  duplicateTimestampCount: number;
  droppedFrameGapCount: number;
  driftSeconds: number;
} {
  const nominal = 1 / script.fps;
  const next = lcg(script.seed * 7919);
  const values: number[] = [];
  let t = 0;
  let duplicates = 0;
  let drops = 0;
  for (let i = 0; i < script.frameCount; i++) {
    values.push(round(t, 6));
    const roll = next();
    if (i > 0 && roll < 0.004) {
      duplicates++;
      t += nominal * 0.1;
    } else if (roll > 0.997) {
      drops++;
      t += nominal * 2.1;
    } else {
      t += nominal;
    }
  }
  const drift = round(values[values.length - 1]! - (script.frameCount - 1) * nominal, 3);
  return {
    values,
    duplicateTimestampCount: duplicates,
    droppedFrameGapCount: drops,
    driftSeconds: drift,
  };
}

function namedPoint(
  point: Point,
  confidence: number,
  valid: boolean,
  source: NamedPoint['source'],
): NamedPoint {
  return {
    x: round(point.x, 2),
    y: round(point.y, 2),
    confidence: round(confidence, 3),
    valid,
    source,
  };
}

const INVALID_POINT: NamedPoint = { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' };

interface BuiltTrack {
  auto: TrackFrame[];
  cleaned: TrackFrame[];
  segments: Segment[];
  timebase: ReturnType<typeof timestamps>;
  pixelsPerCm: number;
  /** Frame index at which the escape-box entry begins, or null. */
  escapeFrame: number | null;
  failureRange: { startFrame: number; endFrame: number } | null;
  filledRange: { startFrame: number; endFrame: number } | null;
}

function buildTrack(script: VideoScript, map: MazeMapFile): BuiltTrack {
  const segments = buildSegments(script, map);
  const timebase = timestamps(script);
  const pixelsPerCm = pxPerCm(map.platform, map.calibration.platformDiameter_cm) ?? MAP_PX_PER_CM;
  const noise = lcg(script.seed * 104729);

  const escapeFrame =
    script.escapeAt === null ? null : Math.round(script.escapeAt * script.frameCount);
  const failureRange = script.failure
    ? {
        startFrame: Math.round(script.failure.atFraction * script.frameCount),
        endFrame:
          Math.round(script.failure.atFraction * script.frameCount) +
          Math.round(script.failure.duration_s * script.fps),
      }
    : null;
  /*
   * The short loss of detection always happens; whether the cleaning step is
   * allowed to fill it is a separate question, answered from this video's own
   * timestamps against O10's ceiling. A two-frame loss is 0.067 s at 30 fps and
   * fillable; the same two frames at test51's 14.985 fps are 0.20 s and are
   * not, so that video keeps a visible gap. Both cases are worth having: D31
   * asks for cleaning to be shown rather than applied invisibly.
   */
  const shortGapStart = shortGapStartFrame(script, segments, timebase.values);
  const shortGapRange =
    shortGapStart !== null && shortGapStart > 0
      ? { startFrame: shortGapStart, endFrame: shortGapStart + 2 }
      : null;
  const boundingGapSeconds = (range: { startFrame: number; endFrame: number }): number =>
    (timebase.values[range.endFrame] ?? Infinity) - (timebase.values[range.startFrame - 1] ?? 0);
  const filledRange =
    shortGapRange &&
    shortGapRange.endFrame < script.frameCount &&
    boundingGapSeconds(shortGapRange) <= FIXTURE_PARAMETERS.gapFilling.maxDuration_s
      ? shortGapRange
      : null;

  const auto: TrackFrame[] = [];
  let previous: Point | null = null;
  let heading = { x: 1, y: 0 };

  for (let frameIndex = 0; frameIndex < script.frameCount; frameIndex++) {
    const t_s = timebase.values[frameIndex]!;
    const { point, segment } = positionAt(segments, t_s);
    const jitter = segment.dwelling ? 0.18 : 0.1;
    const centroid: Point = {
      x: point.x + (noise() - 0.5) * jitter * pixelsPerCm,
      y: point.y + (noise() - 0.5) * jitter * pixelsPerCm,
    };
    if (previous) {
      const dx = centroid.x - previous.x;
      const dy = centroid.y - previous.y;
      const length = Math.hypot(dx, dy);
      if (length > 0.2) heading = { x: dx / length, y: dy / length };
    }
    const noseOffset = 2.4 * pixelsPerCm;
    const nose: Point = {
      x: centroid.x + heading.x * noseOffset,
      y: centroid.y + heading.y * noseOffset,
    };

    const inEscapeBox = escapeFrame !== null && frameIndex >= escapeFrame;
    const inFailure =
      failureRange !== null &&
      frameIndex >= failureRange.startFrame &&
      frameIndex < failureRange.endFrame;
    const inShortGap =
      shortGapRange !== null &&
      frameIndex >= shortGapRange.startFrame &&
      frameIndex < shortGapRange.endFrame;

    let detectionState: DetectionState = 'tracked';
    let reason = 'single mouse-sized component inside the platform mask';
    if (inEscapeBox) {
      detectionState = 'not_detected';
      reason = 'no foreground component inside the platform mask (last seen at the target hole)';
    } else if (inFailure) {
      detectionState = 'not_detected';
      reason = 'no foreground component above the area prior';
    } else if (inShortGap) {
      detectionState = 'not_detected';
      reason = 'foreground component below the area prior for two frames';
    } else if (noise() < 0.012) {
      detectionState = 'low_confidence';
      reason = 'blob smaller than half the expected body area (small_blob)';
    } else if (noise() < 0.006) {
      detectionState = 'ambiguous';
      reason = 'component larger than three times the expected body area (oversized_blob)';
    }

    const detected = detectionState !== 'not_detected';
    const confidence = detectionState === 'tracked' ? 0.82 + noise() * 0.15 : 0.35 + noise() * 0.2;
    const noseHeadingConfidence = segment.dwelling ? 0.5 : 0.55 + noise() * 0.3;

    auto.push({
      frameIndex,
      t_s,
      centroid: detected ? namedPoint(centroid, confidence, true, 'auto') : INVALID_POINT,
      nose: detected
        ? namedPoint(nose, Math.min(confidence, noseHeadingConfidence), true, 'auto')
        : INVALID_POINT,
      detectionState,
      reason,
      blobArea_px2: detected ? round((14 + noise() * 5) * pixelsPerCm ** 2, 1) : 0,
      boundingBox: detected
        ? {
            x: round(centroid.x - 3 * pixelsPerCm, 1),
            y: round(centroid.y - 2 * pixelsPerCm, 1),
            width: round(6 * pixelsPerCm, 1),
            height: round(4 * pixelsPerCm, 1),
          }
        : null,
      noseHeadingConfidence: round(noseHeadingConfidence, 3),
    });
    if (detected) previous = centroid;
  }

  // O10: the short gap is linearly filled in the derived layer only, and every
  // filled point is marked `source: 'filled'` so the figures can draw it hollow.
  const cleaned = auto.map((frame) => ({ ...frame }));
  if (filledRange) {
    const before = auto[filledRange.startFrame - 1];
    const after = auto[filledRange.endFrame];
    if (before && after && before.centroid.valid && after.centroid.valid) {
      for (let i = filledRange.startFrame; i < filledRange.endFrame; i++) {
        const t =
          (i - filledRange.startFrame + 1) / (filledRange.endFrame - filledRange.startFrame + 1);
        const frame = cleaned[i]!;
        cleaned[i] = {
          ...frame,
          centroid: namedPoint(lerp(before.centroid, after.centroid, t), 0.4, true, 'filled'),
          nose: namedPoint(lerp(before.nose, after.nose, t), 0.4, true, 'filled'),
          detectionState: 'low_confidence',
          reason: `linearly filled across a ${round(after.t_s - before.t_s, 3)} s gap away from any hole (O10)`,
        };
      }
    }
  }

  return { auto, cleaned, segments, timebase, pixelsPerCm, escapeFrame, failureRange, filledRange };
}

function frameAtTime(values: readonly number[], t: number): number {
  for (let i = 0; i < values.length; i++) {
    if (values[i]! >= t) return i;
  }
  return values.length - 1;
}

/** Closest approach of each named point to a hole, over a frame range, in cm. */
function closestApproach(
  frames: readonly TrackFrame[],
  startFrame: number,
  endFrame: number,
  hole: Point,
  pixelsPerCm: number,
): { nose_cm: number; centroid_cm: number; noseHeadingConfidence: number } {
  let nose = Infinity;
  let centroid = Infinity;
  let confidence = 0;
  for (let i = startFrame; i <= endFrame && i < frames.length; i++) {
    const frame = frames[i]!;
    if (!frame.centroid.valid) continue;
    const dc = Math.hypot(frame.centroid.x - hole.x, frame.centroid.y - hole.y) / pixelsPerCm;
    if (dc < centroid) {
      centroid = dc;
      confidence = frame.noseHeadingConfidence;
    }
    if (frame.nose.valid) {
      nose = Math.min(nose, Math.hypot(frame.nose.x - hole.x, frame.nose.y - hole.y) / pixelsPerCm);
    }
  }
  return {
    nose_cm: Number.isFinite(nose) ? round(nose, 2) : 0,
    centroid_cm: Number.isFinite(centroid) ? round(centroid, 2) : 0,
    noseHeadingConfidence: confidence,
  };
}

/**
 * Events implied by the script: a lingering visit to a hole is an investigation
 * (O1), the loss at the target hole is the escape entry (O4), and the loss away
 * from any hole is a tracking failure — reported, never an event row (O4).
 */
function buildEvents(script: VideoScript, map: MazeMapFile, track: BuiltTrack): EventRecord[] {
  const centres = holeCentres(map);
  const values = track.timebase.values;
  const events: EventRecord[] = [];
  let ordinal = 0;
  const nextId = (): string => `evt-${script.id.slice(-6)}-${String(++ordinal).padStart(3, '0')}`;

  for (const segment of track.segments) {
    if (!segment.dwelling || segment.holeIndex === null) continue;
    if (segment.end_s - segment.start_s < FIXTURE_PARAMETERS.holeInvestigation.minDuration_s)
      continue;
    const hole = centres[segment.holeIndex];
    if (!hole) continue;
    const startFrame = frameAtTime(values, segment.start_s);
    const endFrame = frameAtTime(values, segment.end_s);
    if (track.escapeFrame !== null && startFrame >= track.escapeFrame) continue;
    const approach = closestApproach(track.cleaned, startFrame, endFrame, hole, track.pixelsPerCm);
    const usesNose = approach.noseHeadingConfidence >= FIXTURE_PARAMETERS.noseConfidenceCutoff;
    events.push({
      id: nextId(),
      kind: 'investigation',
      holeIndex: segment.holeIndex,
      isTarget: segment.holeIndex === TARGET_HOLE,
      startFrame,
      endFrame,
      startTime_s: round(values[startFrame]!, 3),
      endTime_s: round(values[endFrame]!, 3),
      durationSeconds: round(values[endFrame]! - values[startFrame]!, 3),
      pointUsed: usesNose ? 'nose' : 'centroid',
      minNoseDistance_cm: approach.nose_cm,
      minCentroidDistance_cm: approach.centroid_cm,
      evidence: `${usesNose ? 'Nose' : 'Centroid'} within ${(usesNose ? approach.nose_cm : approach.centroid_cm).toFixed(1)} cm of hole ${segment.holeIndex} for ${round(values[endFrame]! - values[startFrame]!, 2).toFixed(2)} s.`,
      source: 'auto',
    });
  }

  if (track.escapeFrame !== null) {
    const hole = centres[TARGET_HOLE];
    const endFrame = script.frameCount - 1;
    const approach = hole
      ? closestApproach(
          track.cleaned,
          Math.max(0, track.escapeFrame - 15),
          track.escapeFrame,
          hole,
          track.pixelsPerCm,
        )
      : { nose_cm: 0, centroid_cm: 0, noseHeadingConfidence: 0 };
    events.push({
      id: nextId(),
      kind: 'escape_entry',
      holeIndex: TARGET_HOLE,
      isTarget: true,
      startFrame: track.escapeFrame,
      endFrame,
      startTime_s: round(values[track.escapeFrame]!, 3),
      endTime_s: round(values[endFrame]!, 3),
      durationSeconds: round(values[endFrame]! - values[track.escapeFrame]!, 3),
      pointUsed: 'centroid',
      minNoseDistance_cm: approach.nose_cm,
      minCentroidDistance_cm: approach.centroid_cm,
      evidence: `Detection lost with the last tracked point ${approach.centroid_cm.toFixed(1)} cm from hole ${TARGET_HOLE}; no reappearance for the rest of the clip.`,
      source: 'auto',
    });
  }

  if (track.failureRange) {
    const { startFrame, endFrame } = track.failureRange;
    events.push({
      id: nextId(),
      kind: 'tracking_failure',
      holeIndex: null,
      isTarget: false,
      startFrame,
      endFrame,
      startTime_s: round(values[startFrame]!, 3),
      endTime_s: round(values[Math.min(endFrame, script.frameCount - 1)]!, 3),
      durationSeconds: round(
        values[Math.min(endFrame, script.frameCount - 1)]! - values[startFrame]!,
        3,
      ),
      pointUsed: 'centroid',
      minNoseDistance_cm: 0,
      minCentroidDistance_cm: 0,
      evidence:
        'Detection lost on open platform, away from any hole; blob area fell below the area prior and the animal reappeared 14 cm from the loss point.',
      source: 'auto',
    });
  }

  // One human-corrected event per video, keeping the automatic values alongside
  // it rather than overwriting them (D11, D26).
  const correctable = events.findIndex(
    (event) => event.kind === 'investigation' && !event.isTarget,
  );
  const target = correctable >= 0 ? events[correctable] : undefined;
  if (target) {
    events[correctable] = {
      ...target,
      holeIndex: target.holeIndex === null ? null : target.holeIndex,
      endFrame: target.endFrame + 4,
      source: 'corrected',
      evidence: `${target.evidence} Reviewer extended the bout: the animal was still nose-down at the hole when the automatic rule ended it.`,
      autoShadow: {
        holeIndex: target.holeIndex,
        startFrame: target.startFrame,
        endFrame: target.endFrame,
      },
    };
  }

  return events;
}

function corrections(events: readonly EventRecord[]): CorrectionEntry[] {
  const corrected = events.find((event) => event.source === 'corrected');
  if (!corrected) return [];
  return [
    {
      id: `cor-${corrected.id}`,
      timestamp: '2026-09-05T14:22:31.000Z',
      source: 'user',
      kind: 'event',
      action: 'edit',
      eventId: corrected.id,
      holeIndex: corrected.holeIndex ?? undefined,
      startFrame: corrected.startFrame,
      endFrame: corrected.endFrame,
    },
  ];
}

/** Median of a centred 3-frame window (O9), applied to path length only. */
function medianFiltered(points: readonly Point[]): Point[] {
  const median3 = (a: number, b: number, c: number): number =>
    a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
  return points.map((point, i) => {
    const previous = points[i - 1] ?? point;
    const next = points[i + 1] ?? point;
    return {
      x: median3(previous.x, point.x, next.x),
      y: median3(previous.y, point.y, next.y),
    };
  });
}

function pathLengthCm(points: readonly Point[], pixelsPerCm: number): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total / pixelsPerCm;
}

function buildMetrics(
  script: VideoScript,
  map: MazeMapFile,
  track: BuiltTrack,
  events: readonly EventRecord[],
  correctionCount: number,
): TrialMetrics {
  const values = track.timebase.values;
  const trialStartFrame = frameAtTime(values, script.trialStart_s);
  const inTrial = track.cleaned.filter(
    (frame) => frame.frameIndex >= trialStartFrame && frame.centroid.valid,
  );
  const points = inTrial.map((frame) => ({ x: frame.centroid.x, y: frame.centroid.y }));
  const length = pathLengthCm(points, track.pixelsPerCm);
  const smoothed = pathLengthCm(medianFiltered(points), track.pixelsPerCm);

  const trackedSeconds =
    inTrial.length > 1 ? inTrial[inTrial.length - 1]!.t_s - inTrial[0]!.t_s : 0;

  const investigations = events.filter((event) => event.kind === 'investigation');
  const firstTarget = investigations.find((event) => event.isTarget);
  const primaryErrors = firstTarget
    ? investigations.filter((event) => !event.isTarget && event.startFrame < firstTarget.startFrame)
        .length
    : investigations.filter((event) => !event.isTarget).length;
  const escape = events.find((event) => event.kind === 'escape_entry');

  // O6: time inside the sector centred on the target hole.
  const centres = holeCentres(map);
  const targetHole = centres[TARGET_HOLE];
  const centre: Point = { x: map.platform.cx, y: map.platform.cy };
  const halfSector = (FIXTURE_PARAMETERS.targetQuadrant.holeSpan * 360) / HOLE_COUNT;
  const targetAngle = targetHole ? Math.atan2(targetHole.y - centre.y, targetHole.x - centre.x) : 0;
  let quadrantFrames = 0;
  for (const frame of inTrial) {
    const angle = Math.atan2(frame.centroid.y - centre.y, frame.centroid.x - centre.x);
    let delta = ((angle - targetAngle) * 180) / Math.PI;
    delta = ((delta + 540) % 360) - 180;
    if (Math.abs(delta) <= halfSector) quadrantFrames++;
  }

  const trackedFraction =
    track.cleaned.filter((frame) => frame.detectionState === 'tracked').length /
    track.cleaned.length;

  return {
    trialStart_s: round(script.trialStart_s, 3),
    primaryLatency_s: firstTarget ? round(firstTarget.startTime_s - script.trialStart_s, 3) : null,
    totalLatency_s: escape ? round(escape.startTime_s - script.trialStart_s, 3) : null,
    primaryErrors,
    totalErrors: investigations.filter((event) => !event.isTarget).length,
    pathLength_cm: round(length, 2),
    pathLengthSmoothed_cm: round(smoothed, 2),
    meanSpeed_cmPerS: trackedSeconds > 0 ? round(length / trackedSeconds, 2) : null,
    targetQuadrantTime_s: round(quadrantFrames / script.fps, 3),
    strategy: script.strategy,
    strategySource: 'auto',
    escaped: escape !== undefined,
    status: escape && !events.some((event) => event.kind === 'tracking_failure') ? 'ok' : 'review',
    trackedFraction: round(trackedFraction, 4),
    correctionCount,
  };
}

function buildQuality(script: VideoScript, map: MazeMapFile, track: BuiltTrack): QualityReport {
  const frames = track.cleaned;
  const counts: Record<DetectionState, number> = {
    tracked: 0,
    not_detected: 0,
    ambiguous: 0,
    low_confidence: 0,
  };
  for (const frame of frames) counts[frame.detectionState]++;

  const gaps: GapRecord[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= frames.length; i++) {
    const lost = i < frames.length && frames[i]!.detectionState === 'not_detected';
    if (lost && runStart === null) runStart = i;
    if (!lost && runStart !== null) {
      const endFrame = i - 1;
      const atEscape = track.escapeFrame !== null && runStart >= track.escapeFrame;
      gaps.push({
        startFrame: runStart,
        endFrame,
        durationSeconds: round(frames[endFrame]!.t_s - frames[runStart]!.t_s, 3),
        locationClass: atEscape ? 'hole' : 'open_platform',
        ...(atEscape ? { holeIndex: TARGET_HOLE } : {}),
      });
      runStart = null;
    }
  }

  const histogram: HistogramBin[] = Array.from({ length: 10 }, (_, bin) => ({
    min: round(bin / 10, 1),
    max: round((bin + 1) / 10, 1),
    count: 0,
  }));
  for (const frame of frames) {
    const bin = Math.min(9, Math.max(0, Math.floor(frame.noseHeadingConfidence * 10)));
    histogram[bin]!.count++;
  }

  const trackedFraction = counts.tracked / frames.length;
  const tier = trackedFraction >= 0.9 ? 'GOOD' : trackedFraction >= 0.75 ? 'REVIEW' : 'POOR';

  return {
    videoId: script.id,
    detectionStateFractions: {
      tracked: round(counts.tracked / frames.length, 4),
      not_detected: round(counts.not_detected / frames.length, 4),
      ambiguous: round(counts.ambiguous / frames.length, 4),
      low_confidence: round(counts.low_confidence / frames.length, 4),
    },
    gaps,
    longestGapSeconds: round(
      gaps.reduce((max, gap) => Math.max(max, gap.durationSeconds), 0),
      3,
    ),
    noseConfidenceHistogram: histogram,
    timebaseAnomalies: {
      duplicateTimestampCount: track.timebase.duplicateTimestampCount,
      droppedFrameGapCount: track.timebase.droppedFrameGapCount,
      driftSeconds: track.timebase.driftSeconds,
    },
    platformDiameter_cm: map.calibration.platformDiameter_cm,
    pxPerCm: round(track.pixelsPerCm, 4),
    parametersHash: FIXTURE_PARAMETERS_HASH,
    tier,
  };
}

/** The maze map expressed in one video's pixels — the only way to place holes. */
export function videoMazeMap(descriptor: VideoDescriptor): MazeMapFile {
  return transformMap(FIXTURE_MAZE_MAP, descriptor.mazeTransform, descriptor.referenceResolution);
}

/**
 * The whole fixture: a `SessionFile` with three tracked videos. Calling it twice
 * produces equal (but not identical) objects, so a test may mutate its own copy.
 */
export function syntheticSession(): SessionFile {
  const videos = videoDescriptors();
  const analyses: Record<string, VideoAnalysis> = {};

  videos.forEach((descriptor, index) => {
    const script = SCRIPTS[index]!;
    const map = videoMazeMap(descriptor);
    const track = buildTrack(script, map);
    const events = buildEvents(script, map, track);
    const entries = corrections(events);
    analyses[descriptor.id] = {
      auto: { parametersHash: FIXTURE_TRACKING_HASH, frames: track.auto },
      corrections: { entries },
      derived: {
        cleanedTrack: track.cleaned,
        events,
        metrics: buildMetrics(script, map, track, events, entries.length),
        quality: buildQuality(script, map, track),
      },
    };
  });

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    toolVersion: FIXTURE_TOOL_VERSION,
    name: 'Barnes cohort A',
    videos,
    mazeMap: FIXTURE_MAZE_MAP,
    parameters: FIXTURE_PARAMETERS,
    analyses,
  };
}
