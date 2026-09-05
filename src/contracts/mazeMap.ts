/**
 * Maze map file: a parametric hole ring fit to a platform circle, reusable
 * across videos by a similarity transform. D10.
 */
export const MAZE_MAP_SCHEMA_VERSION = 1;

export interface Resolution {
  width: number;
  height: number;
}

export interface PlatformCircle {
  cx: number;
  cy: number;
  r: number;
}

/** Per-hole nudge for a hole whose parametric position is visibly off. D13. */
export interface HoleOffset {
  holeIndex: number;
  dx_px: number;
  dy_px: number;
}

export interface HoleRing {
  n: number;
  /** Hole-ring radius as a fraction of the platform radius. O8 default ≈ 0.89. */
  ringRatio: number;
  holeRadius_px: number;
  /** Angle of hole 0 from platform centre, degrees. */
  phase_deg: number;
  offsets?: HoleOffset[];
}

export interface Calibration {
  platformDiameter_cm: number;
}

/** Translate / rotate / scale fit from one video's maze map onto another. D10. */
export interface SimilarityTransform {
  translateX: number;
  translateY: number;
  rotationDeg: number;
  scale: number;
}

export interface MazeMapFile {
  schemaVersion: typeof MAZE_MAP_SCHEMA_VERSION;
  referenceResolution: Resolution;
  platform: PlatformCircle;
  holes: HoleRing;
  target: {
    holeIndex: number;
  };
  calibration: Calibration;
  /** Video id (or fingerprint) this map was originally fit from. */
  createdFrom: string;
}
