/**
 * The single configuration module (D20, D51, D55). Every threshold that
 * changes a number — an event, a cleaning step, a metric, the strategy rules,
 * the quality tier — lives here with its default and the one-sentence
 * definition the UI shows verbatim beside its control. Defaults are the
 * provisional O-decisions of `docs/decisions.md`, verbatim: O1, O4, O5, O6,
 * O7, O9, O10, O11, O16, O17, the D30 tier thresholds, plus the O8 maze
 * defaults and the tracking block (D6) re-exported from
 * `src/analysis/tracker/params.ts`.
 *
 * Nothing under `src/analysis/` may hold a number of its own: fixed model
 * constants live in `ANALYSIS_MODEL`, everything else is a `Parameters` field
 * and therefore part of `parametersHash` (D55).
 */
import type { Parameters, TrackingParameters } from '../contracts/parameters.js';
import { sha256Hex } from '../video/sha256.js';
import { DEFAULT_TRACKING_PARAMETERS, TRACKING_PARAMETER_DEFINITIONS } from './tracker/params.js';

export type { Parameters, TrackingParameters } from '../contracts/parameters.js';

// ---------------------------------------------------------------------------
// Defaults (O1, O4, O5, O6, O7, O9, O10, O11, O16, O17; D30; tracking D6)
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMETERS: Parameters = {
  holeInvestigation: { radiusFactor: 1.5, minDuration_s: 0.2, mergeGap_s: 0.5 },
  escapeEntry: { radiusFactor: 1.0, minDuration_s: 1.0, persistCutoff_s: 3 },
  trialCutoff_s: 180,
  targetQuadrant: { holeSpan: 2.5 },
  kinematicsSmoothingWindowFrames: 3,
  gapFilling: { enabled: true, maxDuration_s: 0.1 },
  kinematics: { speedWindowFrames: 2, duplicateTimestampFactor: 0.25, dropGapFactor: 1.5 },
  noseConfidenceCutoff: 0.5,
  outlierVelocityThreshold_cmPerS: 150,
  trialCensoring: { censorToCutoff: false },
  strategy: {
    spatialMaxErrors: 3,
    spatialMaxHoleDistance: 2,
    spatialMaxCentreCrossings: 1,
    serialMinRun: 3,
    centreZoneRadiusFraction: 0.5,
  },
  quality: { goodMinPositionedFraction: 0.9, poorMaxPositionedFraction: 0.7 },
  tracking: DEFAULT_TRACKING_PARAMETERS,
};

// ---------------------------------------------------------------------------
// Definitions, keyed by dotted path. Shown verbatim in the UI (chunk 7) and
// on the XLSX parameters sheet (chunk 8). A path that has a definition is a
// leaf: `tracking.threshold` covers its `mode` and `manualValue` together, as
// the tracker's own definitions do.
// ---------------------------------------------------------------------------

export type AnalysisParameterPath =
  | 'holeInvestigation.radiusFactor'
  | 'holeInvestigation.minDuration_s'
  | 'holeInvestigation.mergeGap_s'
  | 'escapeEntry.radiusFactor'
  | 'escapeEntry.minDuration_s'
  | 'escapeEntry.persistCutoff_s'
  | 'trialCutoff_s'
  | 'targetQuadrant.holeSpan'
  | 'kinematicsSmoothingWindowFrames'
  | 'gapFilling.enabled'
  | 'gapFilling.maxDuration_s'
  | 'kinematics.speedWindowFrames'
  | 'kinematics.duplicateTimestampFactor'
  | 'kinematics.dropGapFactor'
  | 'noseConfidenceCutoff'
  | 'outlierVelocityThreshold_cmPerS'
  | 'trialCensoring.censorToCutoff'
  | 'strategy.spatialMaxErrors'
  | 'strategy.spatialMaxHoleDistance'
  | 'strategy.spatialMaxCentreCrossings'
  | 'strategy.serialMinRun'
  | 'strategy.centreZoneRadiusFraction'
  | 'quality.goodMinPositionedFraction'
  | 'quality.poorMaxPositionedFraction';

export type TrackingParameterPath = `tracking.${keyof TrackingParameters}`;

export type ParameterPath = AnalysisParameterPath | TrackingParameterPath;

const ANALYSIS_PARAMETER_DEFINITIONS: Record<AnalysisParameterPath, string> = {
  'holeInvestigation.radiusFactor':
    'An investigation is counted while the event point (the nose when its heading confidence clears the cutoff, otherwise the centroid) is within this multiple of the hole radius of a hole centre (× hole radius; O1).',
  'holeInvestigation.minDuration_s':
    'Time at a hole, from the first to the last frame within the radius, that a bout needs to count as an investigation (seconds; O1).',
  'holeInvestigation.mergeGap_s':
    'Bouts at the same hole separated by less than this merge into one investigation; a longer gap makes the return a separate event (seconds; O1).',
  'escapeEntry.radiusFactor':
    'An escape-box entry is a run of frames at the target hole in which the animal is not detected, or is seen only as a small or fragmented blob within this multiple of the hole radius of the target centre; a full-size detection anywhere ends the run (× hole radius; O4).',
  'escapeEntry.minDuration_s':
    'A run at the target must last at least this long, from its first to its last frame and with no full-size detection elsewhere during it, to be an entry; the same run at a non-target hole is an investigation flagged physically unlikely, and a loss of detection this long away from any hole is a tracking failure (seconds; O4).',
  'escapeEntry.persistCutoff_s':
    'The trial ends at the first entry that lasts at least this long or to the end of the video; total latency is the time of its first lost frame (seconds; O4).',
  trialCutoff_s:
    'The trial ends this long after the trial start when the animal has not entered the escape box; total latency is then left blank, escaped is false and the status is review (seconds; O5).',
  'targetQuadrant.holeSpan':
    'The target quadrant is the sector of the platform reaching this many hole spacings either side of the target hole; 2.5 holes on a 20-hole ring is a 90° sector (holes; O6).',
  kinematicsSmoothingWindowFrames:
    'Width of the median filter applied to centroid positions before path length and speed are computed; the stored track and the events use the raw positions (frames; O9).',
  'gapFilling.enabled':
    'Whether short gaps in the derived track are filled by linear interpolation between the frames either side; filled points are marked filled, drawn hollow and counted, and the automatic track is never changed (on/off; O10).',
  'gapFilling.maxDuration_s':
    'Only gaps no longer than this, measured between the positioned frames either side, are filled — and never when either of those frames is within one hole radius of a hole, because a gap at a hole is evidence, not noise (seconds; O10).',
  'kinematics.speedWindowFrames':
    'Speed at a frame is the path travelled over the centred window of this many frames either side, divided by the span of their timestamps (frames; O11).',
  'kinematics.duplicateTimestampFactor':
    'Consecutive frames whose timestamps differ by less than this fraction of the nominal frame interval carry a duplicate stamp: the second is skipped for speed and for the outlier test, while its position still counts for path length (fraction of the nominal interval; O11).',
  'kinematics.dropGapFactor':
    'Consecutive frames whose timestamps differ by more than this multiple of the nominal frame interval are a dropped-frame gap: counted in the quality report, while path length keeps the straight segment (× nominal interval; O11).',
  noseConfidenceCutoff:
    'Events use the nose as the event point when its heading confidence is at least this, or when the nose was placed by hand; otherwise they use the centroid, and every event records which point was used (0–1; O16).',
  outlierVelocityThreshold_cmPerS:
    'A centroid that moves faster than this from the previous positioned frame is an outlier: the frame is marked invalid for events and kinematics and the point is kept, never replaced (cm/s; O17).',
  'trialCensoring.censorToCutoff':
    'When on, a trial that never reached the escape box reports the cutoff time as its total latency instead of a blank, for statistics; escaped stays false and the status stays review (on/off; O5).',
  'strategy.spatialMaxErrors':
    'Spatial search: reaching the target with no error before it is spatial by definition; otherwise at most this many non-target investigations before the target, all within the spatial hole distance, with at most the spatial number of centre crossings; the rules are tried in the order spatial, serial, random and the first to fire wins (count; O7).',
  'strategy.spatialMaxHoleDistance':
    'Spatial search: every error hole lies within this many holes of the target around the ring (holes; O7).',
  'strategy.spatialMaxCentreCrossings':
    'Spatial search: at most this many entries into the centre zone before the target (count; O7).',
  'strategy.serialMinRun':
    'Serial search: a run of at least this many investigations of adjacent holes in one direction around the ring — a change of direction ends the run — with no centre crossing during it, before or ending at the target visit (count; O7).',
  'strategy.centreZoneRadiusFraction':
    'The centre zone is the disc of this fraction of the platform radius; entering it between two investigations is one centre crossing (fraction; O7).',
  'quality.goodMinPositionedFraction':
    'A video is GOOD when at least this fraction of the trial frames were positioned by the tracker (tracked or low confidence; filled frames do not count); judged over the trial window so empty pre-trial frames do not count against it (fraction; D30).',
  'quality.poorMaxPositionedFraction':
    'A video is POOR when fewer than this fraction of the trial frames were positioned by the tracker (tracked or low confidence); between the two thresholds it is REVIEW (fraction; D30).',
};

const TRACKING_KEYS = Object.keys(TRACKING_PARAMETER_DEFINITIONS) as (keyof TrackingParameters)[];

export const PARAMETER_DEFINITIONS: Record<ParameterPath, string> = {
  ...ANALYSIS_PARAMETER_DEFINITIONS,
  ...(Object.fromEntries(
    TRACKING_KEYS.map((key) => [`tracking.${key}`, TRACKING_PARAMETER_DEFINITIONS[key]]),
  ) as Record<TrackingParameterPath, string>),
};

/** Unit of each parameter, for the parameters sheet and the controls. */
export const PARAMETER_UNITS: Record<ParameterPath, string> = {
  'holeInvestigation.radiusFactor': '× hole radius',
  'holeInvestigation.minDuration_s': 's',
  'holeInvestigation.mergeGap_s': 's',
  'escapeEntry.radiusFactor': '× hole radius',
  'escapeEntry.minDuration_s': 's',
  'escapeEntry.persistCutoff_s': 's',
  trialCutoff_s: 's',
  'targetQuadrant.holeSpan': 'holes',
  kinematicsSmoothingWindowFrames: 'frames',
  'gapFilling.enabled': 'on/off',
  'gapFilling.maxDuration_s': 's',
  'kinematics.speedWindowFrames': 'frames',
  'kinematics.duplicateTimestampFactor': '× nominal interval',
  'kinematics.dropGapFactor': '× nominal interval',
  noseConfidenceCutoff: '0–1',
  outlierVelocityThreshold_cmPerS: 'cm/s',
  'trialCensoring.censorToCutoff': 'on/off',
  'strategy.spatialMaxErrors': 'count',
  'strategy.spatialMaxHoleDistance': 'holes',
  'strategy.spatialMaxCentreCrossings': 'count',
  'strategy.serialMinRun': 'count',
  'strategy.centreZoneRadiusFraction': 'fraction',
  'quality.goodMinPositionedFraction': 'fraction',
  'quality.poorMaxPositionedFraction': 'fraction',
  'tracking.backgroundSampleCount': 'frames',
  'tracking.backgroundExcludeRanges': 'frame ranges',
  'tracking.platformMaskMargin_cm': 'cm',
  'tracking.threshold': 'otsu | manual (0–255)',
  'tracking.minBlobArea_cm2': 'cm²',
  'tracking.maxBlobArea_cm2': 'cm²',
  'tracking.expectedBlobArea_cm2': 'cm²',
  'tracking.oversizedBlobFactor': '× expected area',
  'tracking.smallBlobFactor': '× expected area',
  'tracking.tailOpeningRadius_cm': 'cm',
  'tracking.noseCueWindowFrames': 'frames',
  'tracking.noseMovingSpeed_cmPerS': 'cm/s',
  'tracking.rimContactMargin_cm': 'cm',
  'tracking.proximityRadius_cm': 'cm',
  'tracking.fragmentMergeDistance_cm': 'cm',
};

/** The decision each parameter's default comes from, for the parameters sheet. */
export const PARAMETER_DECISIONS: Record<ParameterPath, string> = Object.fromEntries(
  (Object.keys(PARAMETER_DEFINITIONS) as ParameterPath[]).map((path) => {
    if (path.startsWith('tracking.')) return [path, 'D6'];
    const match = /\b([OD]\d+)\)\.?$/.exec(PARAMETER_DEFINITIONS[path]);
    return [path, match?.[1] ?? ''];
  }),
) as Record<ParameterPath, string>;

/**
 * Every leaf path of a `Parameters` value, in definition order: a path that
 * has a definition is a leaf even when its value is an object.
 */
export function parameterPaths(parameters: Parameters): ParameterPath[] {
  const out: ParameterPath[] = [];
  const walk = (value: unknown, prefix: string): void => {
    if (prefix !== '' && prefix in PARAMETER_DEFINITIONS) {
      out.push(prefix as ParameterPath);
      return;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        walk((value as Record<string, unknown>)[key], prefix === '' ? key : `${prefix}.${key}`);
      }
      return;
    }
    out.push(prefix as ParameterPath);
  };
  walk(parameters, '');
  return out;
}

export function parameterAt(parameters: Parameters, path: ParameterPath): unknown {
  let value: unknown = parameters;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// ---------------------------------------------------------------------------
// O8 · maze geometry defaults, used by `src/maze/ring.ts` and the maze step.
// ---------------------------------------------------------------------------

export const MAZE_DEFAULTS = {
  holeCount: 20,
  ringRatio: 0.89,
  holeDiameter_cm: 5,
  typicalPlatformDiameter_cm: 92,
} as const;

export const MAZE_DEFAULT_DEFINITIONS: Record<keyof typeof MAZE_DEFAULTS, string> = {
  holeCount:
    'Number of holes on the ring, evenly spaced; per-hole nudges cover a maze that is not (holes; O8).',
  ringRatio:
    'Radius of the hole ring as a fraction of the platform radius, measured on the sample videos (fraction; O8).',
  holeDiameter_cm: 'Diameter of one hole; the one hole dimension a user may change (cm; O8).',
  typicalPlatformDiameter_cm:
    'The hint shown beside the calibration field; the user must enter the real platform diameter before anything is computed (cm; O8).',
};

// ---------------------------------------------------------------------------
// Fixed model constants of the analysis (not user-adjustable; changing one is
// a tool version change), visible and documented so no number is buried.
// ---------------------------------------------------------------------------

export const ANALYSIS_MODEL = {
  /** The tracker reasons that read as "part of the animal is still visible": a frame carrying one of these, positioned within the entry radius of a hole, belongs to an entry run (O4, D48). */
  entryPartialReasons: ['small_blob', 'fragmented'] as const,
  /** Frames before a loss whose blob areas form the area trend in the loss evidence (O4, D19). */
  blobTrendWindowFrames: 10,
  /** The evidence says the blob area "fell" when the last area is below this fraction of the first (D19). */
  blobTrendFallRatio: 0.8,
  /** The evidence says the blob area "rose" when the last area is above this multiple of the first (D19). */
  blobTrendRiseRatio: 1.25,
  /** Smoothed steps shorter than this do not contribute heading change to tortuosity, cm (O7). */
  tortuosityMinStep_cm: 1,
  /** Equal-width bins of the nose-heading-confidence histogram over [0, 1] (D30). */
  noseConfidenceHistogramBins: 5,
  /** Upper bound on the detection passes derive makes while event corrections move the trial end (D20). */
  trialEndPasses: 3,
  /** Tolerance on the trial-cutoff boundary, seconds: far below any sample-table tick, so `start + cutoff` lands on the frame it names (O5). */
  cutoffTolerance_s: 1e-9,
} as const;

export const ANALYSIS_MODEL_DEFINITIONS: Record<keyof typeof ANALYSIS_MODEL, string> = {
  entryPartialReasons:
    'The low-confidence detection reasons that mean the animal is only partly visible (its rear at a hole, a body split by a hole shadow); such a frame within the entry radius of a hole is part of an entry run rather than a full-size detection (O4).',
  blobTrendWindowFrames:
    'Number of frames before a loss of detection over which the blob-area trend (shrinking as the animal enters a hole) is described in the event evidence.',
  blobTrendFallRatio:
    'The loss evidence reads "blob area fell" when the last positioned area before the loss is below this fraction of the first area in the trend window (D19).',
  blobTrendRiseRatio:
    'The loss evidence reads "blob area rose" when the last positioned area before the loss is above this multiple of the first area in the trend window; between the two it "was steady" (D19).',
  tortuosityMinStep_cm:
    'Heading change is accumulated only over smoothed steps at least this long, so a stationary animal does not read as tortuous (cm).',
  noseConfidenceHistogramBins:
    'Number of equal-width bins the quality report uses for the nose-heading-confidence histogram.',
  trialEndPasses:
    'How many times derive may re-detect events while event corrections move the first persistent escape entry; the end only moves within the trial, so the loop settles in one or two passes.',
  cutoffTolerance_s:
    'A frame whose timestamp is within this many seconds past the trial cutoff still counts as inside it, so floating-point rounding cannot drop the frame the cutoff names (seconds).',
};

/**
 * The one convention for a number the contract types as `number` but that
 * cannot be computed (no trial start, no tracked time, no usable nose): it is
 * `NaN`, which JSON serialises as `null`. Consumers treat non-finite and null
 * alike and never average them in.
 */
export function isRecorded(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Hashing (D51): SHA-256 of the canonical JSON — object keys sorted by code
// unit, arrays in order, no whitespace, scalars as JSON.stringify writes them,
// `undefined` properties dropped. The tracking hash keys the auto layer; the
// full hash keys the derived layer and stamps every export.
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const v = record[key];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

function hashCanonical(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

export function hashParameters(parameters: Parameters): string {
  return hashCanonical(parameters);
}

export function hashTrackingParameters(tracking: TrackingParameters): string {
  return hashCanonical(tracking);
}

// ---------------------------------------------------------------------------
// Validation: every problem names the parameter's dotted path.
// ---------------------------------------------------------------------------

type Check = (value: number) => boolean;

const finite: Check = (v) => Number.isFinite(v);
const positive: Check = (v) => finite(v) && v > 0;
const nonNegative: Check = (v) => finite(v) && v >= 0;
const integerAtLeast =
  (min: number): Check =>
  (v) =>
    Number.isInteger(v) && v >= min;
const unit: Check = (v) => finite(v) && v >= 0 && v <= 1;

interface Rule {
  path: string;
  check: Check;
  expects: string;
}

const RULES: Rule[] = [
  { path: 'holeInvestigation.radiusFactor', check: positive, expects: 'a positive number' },
  { path: 'holeInvestigation.minDuration_s', check: nonNegative, expects: 'zero or more seconds' },
  { path: 'holeInvestigation.mergeGap_s', check: nonNegative, expects: 'zero or more seconds' },
  { path: 'escapeEntry.radiusFactor', check: positive, expects: 'a positive number' },
  { path: 'escapeEntry.minDuration_s', check: nonNegative, expects: 'zero or more seconds' },
  { path: 'escapeEntry.persistCutoff_s', check: nonNegative, expects: 'zero or more seconds' },
  { path: 'trialCutoff_s', check: positive, expects: 'a positive number of seconds' },
  { path: 'targetQuadrant.holeSpan', check: positive, expects: 'a positive number of holes' },
  {
    path: 'kinematicsSmoothingWindowFrames',
    check: (v) => integerAtLeast(1)(v) && v % 2 === 1,
    expects: 'an odd whole number of frames, at least 1',
  },
  { path: 'gapFilling.maxDuration_s', check: nonNegative, expects: 'zero or more seconds' },
  {
    path: 'kinematics.speedWindowFrames',
    check: integerAtLeast(1),
    expects: 'a whole number of frames, at least 1',
  },
  {
    path: 'kinematics.duplicateTimestampFactor',
    check: (v) => finite(v) && v >= 0 && v < 1,
    expects: 'a fraction from 0 up to (not including) 1',
  },
  {
    path: 'kinematics.dropGapFactor',
    check: (v) => finite(v) && v > 1,
    expects: 'a factor above 1',
  },
  { path: 'noseConfidenceCutoff', check: unit, expects: 'a value from 0 to 1' },
  { path: 'outlierVelocityThreshold_cmPerS', check: positive, expects: 'a positive speed in cm/s' },
  {
    path: 'strategy.spatialMaxErrors',
    check: integerAtLeast(0),
    expects: 'a whole number of investigations',
  },
  {
    path: 'strategy.spatialMaxHoleDistance',
    check: integerAtLeast(0),
    expects: 'a whole number of holes',
  },
  {
    path: 'strategy.spatialMaxCentreCrossings',
    check: integerAtLeast(0),
    expects: 'a whole number of crossings',
  },
  {
    path: 'strategy.serialMinRun',
    check: integerAtLeast(1),
    expects: 'a whole number of investigations, at least 1',
  },
  {
    path: 'strategy.centreZoneRadiusFraction',
    check: (v) => finite(v) && v > 0 && v <= 1,
    expects: 'a fraction of the platform radius above 0 and up to 1',
  },
  { path: 'quality.goodMinPositionedFraction', check: unit, expects: 'a fraction from 0 to 1' },
  { path: 'quality.poorMaxPositionedFraction', check: unit, expects: 'a fraction from 0 to 1' },
  {
    path: 'tracking.backgroundSampleCount',
    check: integerAtLeast(1),
    expects: 'a whole number of frames, at least 1',
  },
  { path: 'tracking.platformMaskMargin_cm', check: nonNegative, expects: 'zero or more cm' },
  {
    path: 'tracking.threshold.manualValue',
    check: (v) => finite(v) && v >= 0 && v <= 255,
    expects: 'a gray-level difference from 0 to 255',
  },
  { path: 'tracking.minBlobArea_cm2', check: positive, expects: 'a positive area in cm²' },
  { path: 'tracking.maxBlobArea_cm2', check: positive, expects: 'a positive area in cm²' },
  { path: 'tracking.oversizedBlobFactor', check: positive, expects: 'a positive factor' },
  { path: 'tracking.smallBlobFactor', check: unit, expects: 'a fraction from 0 to 1' },
  { path: 'tracking.tailOpeningRadius_cm', check: nonNegative, expects: 'zero or more cm' },
  {
    path: 'tracking.noseCueWindowFrames',
    check: integerAtLeast(0),
    expects: 'a whole number of frames',
  },
  { path: 'tracking.noseMovingSpeed_cmPerS', check: nonNegative, expects: 'zero or more cm/s' },
  { path: 'tracking.rimContactMargin_cm', check: nonNegative, expects: 'zero or more cm' },
  { path: 'tracking.proximityRadius_cm', check: positive, expects: 'a positive distance in cm' },
  { path: 'tracking.fragmentMergeDistance_cm', check: nonNegative, expects: 'zero or more cm' },
];

function valueAt(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Problems with a parameter set; an empty list means it is valid. */
export function validateParameters(parameters: Parameters): string[] {
  const problems: string[] = [];
  for (const rule of RULES) {
    const value = valueAt(parameters, rule.path);
    if (typeof value !== 'number' || !rule.check(value)) {
      problems.push(`${rule.path} must be ${rule.expects}, got ${String(value)}`);
    }
  }
  if (typeof parameters.gapFilling?.enabled !== 'boolean') {
    problems.push(
      `gapFilling.enabled must be true or false, got ${String(parameters.gapFilling?.enabled)}`,
    );
  }
  if (typeof parameters.trialCensoring?.censorToCutoff !== 'boolean') {
    problems.push(
      `trialCensoring.censorToCutoff must be true or false, got ${String(parameters.trialCensoring?.censorToCutoff)}`,
    );
  }
  const q = parameters.quality;
  if (
    q &&
    Number.isFinite(q.goodMinPositionedFraction) &&
    Number.isFinite(q.poorMaxPositionedFraction) &&
    q.poorMaxPositionedFraction > q.goodMinPositionedFraction
  ) {
    problems.push(
      `quality.poorMaxPositionedFraction must not exceed quality.goodMinPositionedFraction, got ${q.poorMaxPositionedFraction} and ${q.goodMinPositionedFraction}`,
    );
  }
  const k = parameters.kinematics;
  if (
    k &&
    Number.isFinite(k.duplicateTimestampFactor) &&
    Number.isFinite(k.dropGapFactor) &&
    k.duplicateTimestampFactor >= k.dropGapFactor
  ) {
    problems.push(
      `kinematics.duplicateTimestampFactor must be below kinematics.dropGapFactor, got ${k.duplicateTimestampFactor} and ${k.dropGapFactor}`,
    );
  }
  const t = parameters.tracking;
  if (t) {
    if (
      Number.isFinite(t.minBlobArea_cm2) &&
      Number.isFinite(t.maxBlobArea_cm2) &&
      t.minBlobArea_cm2 >= t.maxBlobArea_cm2
    ) {
      problems.push(
        `tracking.minBlobArea_cm2 must be below tracking.maxBlobArea_cm2, got ${t.minBlobArea_cm2} and ${t.maxBlobArea_cm2}`,
      );
    }
    if (t.expectedBlobArea_cm2 !== null && !positive(t.expectedBlobArea_cm2)) {
      problems.push(
        `tracking.expectedBlobArea_cm2 must be empty or a positive area in cm², got ${String(t.expectedBlobArea_cm2)}`,
      );
    }
    if (t.threshold?.mode !== 'otsu' && t.threshold?.mode !== 'manual') {
      problems.push(
        `tracking.threshold.mode must be otsu or manual, got ${String(t.threshold?.mode)}`,
      );
    }
    if (!Array.isArray(t.backgroundExcludeRanges)) {
      problems.push('tracking.backgroundExcludeRanges must be a list of frame ranges');
    } else {
      t.backgroundExcludeRanges.forEach((range, i) => {
        if (
          !integerAtLeast(0)(range?.startFrame) ||
          !integerAtLeast(0)(range?.endFrame) ||
          range.startFrame > range.endFrame
        ) {
          problems.push(
            `tracking.backgroundExcludeRanges[${i}] must be a frame range with 0 ≤ start ≤ end, got ${JSON.stringify(range)}`,
          );
        }
      });
    }
  }
  return problems;
}

export function assertValidParameters(parameters: Parameters): void {
  const problems = validateParameters(parameters);
  if (problems.length > 0) throw new RangeError(`invalid parameters: ${problems.join('; ')}`);
}
