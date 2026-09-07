/**
 * Frame-level track builder for the analysis tests: one entry per frame,
 * either a position, a detection failure, or a full spec. Deterministic.
 */
import type {
  DetectionState,
  NamedPoint,
  PointSource,
  TrackFrame,
} from '../../src/contracts/track.js';

export interface FrameSpec {
  x: number;
  y: number;
  /** Nose position; `null` for an invalid nose (default: 8 px to the right of the centroid). */
  nose?: { x: number; y: number } | null;
  noseConf?: number;
  state?: DetectionState;
  reason?: string;
  area?: number;
  confidence?: number;
  source?: PointSource;
}

export type FrameInput = null | 'oversized' | 'ambiguous' | [number, number] | FrameSpec;

const INVALID: NamedPoint = { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' };

export function timebase(
  n: number,
  fps = 30,
  anomalies: { duplicatesAt?: readonly number[]; dropsAt?: readonly number[] } = {},
): Float64Array {
  const dup = new Set(anomalies.duplicatesAt ?? []);
  const drop = new Set(anomalies.dropsAt ?? []);
  const t = new Float64Array(n);
  let time = 0;
  for (let i = 1; i < n; i++) {
    time += dup.has(i) ? 0 : drop.has(i) ? 2 / fps : 1 / fps;
    t[i] = time;
  }
  return t;
}

export function buildFrame(input: FrameInput, frameIndex: number, t_s: number): TrackFrame {
  const base = {
    frameIndex,
    t_s,
    blobArea_px2: 0,
    boundingBox: null,
    noseHeadingConfidence: 0,
  };
  if (input === null) {
    return {
      ...base,
      centroid: INVALID,
      nose: INVALID,
      detectionState: 'not_detected',
      reason: 'no_foreground',
    };
  }
  if (input === 'oversized') {
    return {
      ...base,
      centroid: INVALID,
      nose: INVALID,
      detectionState: 'ambiguous',
      reason: 'oversized_blob',
      blobArea_px2: 3000,
    };
  }
  if (input === 'ambiguous') {
    return {
      ...base,
      centroid: INVALID,
      nose: INVALID,
      detectionState: 'ambiguous',
      reason: 'multiple_blobs',
    };
  }
  const spec: FrameSpec = Array.isArray(input) ? { x: input[0], y: input[1] } : input;
  const source = spec.source ?? 'auto';
  const confidence = spec.confidence ?? 0.9;
  const nosePos = spec.nose === undefined ? { x: spec.x + 8, y: spec.y } : spec.nose;
  const noseConf = spec.noseConf ?? 0.5;
  return {
    ...base,
    centroid: { x: spec.x, y: spec.y, confidence, valid: true, source },
    nose:
      nosePos === null
        ? INVALID
        : { x: nosePos.x, y: nosePos.y, confidence: confidence * noseConf, valid: true, source },
    detectionState: spec.state ?? 'tracked',
    reason: spec.reason ?? 'single_blob',
    blobArea_px2: spec.area ?? 500,
    noseHeadingConfidence: nosePos === null ? 0 : noseConf,
  };
}

export function buildTrack(
  inputs: readonly FrameInput[],
  t?: Float64Array | readonly number[],
): TrackFrame[] {
  const times = t ?? timebase(inputs.length);
  return inputs.map((input, i) => buildFrame(input, i, times[i]!));
}

/** Deep-freezes an object graph in place (arrays included) and returns it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
