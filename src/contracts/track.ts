/**
 * Frame identity, time and per-frame track representation. D7, D8, D15.
 */

/** Position in the MP4 sample table, sorted by presentation time. Never a nominal-rate index. */
export type FrameIndex = number;

/** Seconds, from the sample table's composition time minus edit-list offset over the track timescale. D7. */
export type TimeSeconds = number;

export type PointSource = 'auto' | 'corrected' | 'filled' | 'imported';

export type NamedPointId = 'centroid' | 'nose';

/**
 * A single named point estimate. Never a bare (x, y): confidence, valid and
 * source travel with every coordinate. Coordinates are native video pixels,
 * y down, at the video's reference resolution (D15).
 */
export interface NamedPoint {
  x: number;
  y: number;
  /** 0–1. */
  confidence: number;
  valid: boolean;
  source: PointSource;
}

export type DetectionState = 'tracked' | 'not_detected' | 'ambiguous' | 'low_confidence';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One frame of a track. The automatic layer never contains a frame with
 * `source: 'filled'` on either point (D8, D16) — filling only happens in the
 * derived layer.
 */
export interface TrackFrame {
  frameIndex: FrameIndex;
  t_s: TimeSeconds;
  centroid: NamedPoint;
  nose: NamedPoint;
  detectionState: DetectionState;
  /** Why detectionState took this value, e.g. "foreground blob below area prior". */
  reason: string;
  blobArea_px2: number;
  boundingBox: BoundingBox | null;
  /** Confidence in the nose-heading estimate used to choose the head end of the body ellipse. 0–1. */
  noseHeadingConfidence: number;
}

export type Track = readonly TrackFrame[];
