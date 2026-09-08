/**
 * Session file: one JSON document per cohort. D9, D27, D28, D47.
 *
 * No separate calibration field: `platformDiameter_cm` lives once in the
 * shared `mazeMap` (D10, D44). A video's pixels-per-centimetre is derived
 * from the map's platform radius after that video's `mazeTransform` and
 * recorded in `derived.quality.pxPerCm`, never entered separately.
 *
 * A session exists before a maze or parameters do (D47): it is created the
 * moment a video is loaded, so autosave and reload work from the first drop
 * (D27). `mazeMap` is null until the maze step is finished and `parameters`
 * is null until the first analysis run stamps the defaults in force at that
 * time (D51). `analyses` has no entry for a video that has not been tracked,
 * and a tracked video's `derived` is null until it is analysed (D52) — never
 * a placeholder `auto`/`derived` layer.
 */
import type { ParametersHash, Parameters } from './parameters.js';
import type { MazeMapFile, SimilarityTransform } from './mazeMap.js';
import type { FrameIndex, NamedPointId, Track, TrackFrame } from './track.js';
import type { EventRecord } from './events.js';
import type { TrialMetrics } from './metrics.js';
import type { QualityReport } from './quality.js';
import type { ToolVersion } from './version.js';

export const SESSION_SCHEMA_VERSION = 1;

/**
 * Identifies video content independent of filename/path, so a session
 * re-attaches to "the same file dropped again" after a reload. D27.
 */
export interface VideoFingerprint {
  byteLength: number;
  durationSeconds: number;
  frameCount: number;
  sha256: string;
}

/** O12 · editable per-video metadata. No filename parsing. */
export interface VideoMetadata {
  animal?: string;
  day?: string;
  trial?: string;
  group?: string;
}

export interface VideoDescriptor {
  id: string;
  filename: string;
  fingerprint: VideoFingerprint;
  referenceResolution: { width: number; height: number };
  /** Fit of the session's shared maze map onto this video. D10, D28. */
  mazeTransform: SimilarityTransform;
  metadata: VideoMetadata;
}

/** A sparse, human-made edit. Always additive: never mutates the auto layer. D9, D25. */
export type CorrectionEntry =
  | PointCorrection
  | RangeCorrection
  | EventCorrection
  | TrialStartCorrection
  | StrategyOverrideCorrection
  | NoEscapeCorrection;

interface CorrectionBase {
  id: string;
  /** ISO 8601. */
  timestamp: string;
  source: 'user';
}

export interface PointCorrection extends CorrectionBase {
  kind: 'point';
  frameIndex: FrameIndex;
  point: NamedPointId;
  value: { x: number; y: number; confidence: number; valid: boolean };
}

export type RangeCorrectionType = 'not_visible' | 'in_escape_box';

export interface RangeCorrection extends CorrectionBase {
  kind: 'range';
  rangeType: RangeCorrectionType;
  startFrame: FrameIndex;
  endFrame: FrameIndex;
}

export interface EventCorrection extends CorrectionBase {
  kind: 'event';
  action: 'add' | 'edit' | 'delete';
  eventId?: string;
  holeIndex?: number;
  startFrame?: FrameIndex;
  endFrame?: FrameIndex;
}

export interface TrialStartCorrection extends CorrectionBase {
  kind: 'trial_start';
  frameIndex: FrameIndex;
}

export type SearchStrategy = 'spatial' | 'serial' | 'random';

export interface StrategyOverrideCorrection extends CorrectionBase {
  kind: 'strategy_override';
  strategy: SearchStrategy;
  reason: string;
}

/**
 * "Confirmed: the animal never entered the escape box" — one per video, with a
 * reason, revertable like every other correction (D63). It asserts nothing about
 * a frame: a trial with no escape entry is `review` by construction because the
 * tool cannot tell a non-escaper from a missed entry, and this is the human
 * saying which it was. An escape entry appearing afterwards contradicts it, and
 * the entry wins.
 */
export interface NoEscapeCorrection extends CorrectionBase {
  kind: 'no_escape';
  reason: string;
}

/** Immutable output of one tracking run, keyed by the parameters that produced it. D9. */
export interface AutoLayer {
  parametersHash: ParametersHash;
  frames: readonly TrackFrame[];
}

export interface CorrectionsLayer {
  entries: readonly CorrectionEntry[];
}

/** Everything recomputed from `auto ⊕ corrections` on load. Never persisted as authoritative — safe to drop and recompute. D9, D20. */
export interface DerivedLayer {
  cleanedTrack: Track;
  events: readonly EventRecord[];
  metrics: TrialMetrics;
  quality: QualityReport;
}

export interface VideoAnalysis {
  auto: AutoLayer;
  corrections: CorrectionsLayer;
  /**
   * Null until the first analysis run computes it (D52), in the same pattern
   * as `mazeMap` and `parameters` above: a video can be tracked long before it
   * is analysed. Recomputed on load and never stored as authoritative, so a
   * null here is honest where a fabricated layer would be a lie (D16).
   */
  derived: DerivedLayer | null;
}

export interface SessionFile {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  toolVersion: ToolVersion;
  /** User-editable cohort name; defaults to the first video's filename. D47. */
  name: string;
  videos: VideoDescriptor[];
  /**
   * The one shared source of calibration for the cohort (D10, D44); a cohort
   * using two mazes carries two maps. Null until the maze step is finished (D47).
   */
  mazeMap: MazeMapFile | null;
  /** Null until the first analysis run stamps the defaults in force at that time. D47, D51. */
  parameters: Parameters | null;
  /** No entry for a video that has not been tracked. */
  analyses: Record<string, VideoAnalysis>;
}
