/**
 * The `parameters` sheet and `parameters.json`: every threshold in force for
 * this export, with its value, unit and the one-line definition the UI shows
 * (D11, D12). Flattening keeps the dotted path, so a row here can be matched
 * back to a field of `Parameters` without guessing.
 */
import { TRACKING_PARAMETER_DEFINITIONS } from '../analysis/tracker/params.js';
import type { Parameters } from '../contracts/parameters.js';

export interface ParameterRow {
  /** Dotted path into `Parameters`, e.g. `holeInvestigation.radiusFactor`. */
  name: string;
  value: string | number | boolean;
  unit: string;
  definition: string;
}

/**
 * Looks a definition up by dotted path. This is the hook chunk 5's definitions
 * module plugs into; when it is supplied it wins outright, so there is never
 * more than one source of definition text in an export.
 */
export type ParameterDefinitionLookup = (path: string) => string | undefined;

/**
 * TEMPORARY. The analysis engine (chunk 5) owns the real definitions module and
 * will supply them through `ParameterDefinitionLookup`; these one-liners exist
 * only so the parameters sheet is not blank until then. Keep this map minimal —
 * do not grow it into a second definitions source. The tracking subtree already
 * has its definitions in `src/analysis/tracker/params.ts` and is read from
 * there, never duplicated here.
 */
const ANALYSIS_PARAMETER_DEFINITIONS: Record<string, string> = {
  holeInvestigation:
    'A hole is investigated when the event point stays within radiusFactor × hole radius of the hole centre for at least minDuration_s; bouts closer together than mergeGap_s are one investigation (O1).',
  escapeEntry:
    'An escape-box entry is a loss of detection within radiusFactor × hole radius of the target hole lasting at least minDuration_s, ending the trial once it persists for persistCutoff_s or to the end of the clip (O4).',
  trialCutoff_s:
    'Trials longer than this are cut off; total latency is left blank and the trial is flagged for review (O5).',
  targetQuadrant:
    'The target quadrant is the sector centred on the target hole, holeSpan holes to either side (O6).',
  kinematicsSmoothingWindowFrames:
    'Width of the centred median filter applied to positions before path length and speed only; events use raw positions (O9).',
  gapFilling:
    'Gaps no longer than maxDuration_s are linearly filled in the derived layer and marked source: filled; never at a hole (O10).',
  kinematics:
    'Speed uses a centred window of speedWindowFrames frames; a step below duplicateTimestampFactor × the nominal interval is a duplicate timestamp, above dropGapFactor × it is a dropped-frame gap (O11).',
  noseConfidenceCutoff:
    'Events use the nose when its heading confidence reaches this value, and the body centroid otherwise; point_used records which (O16).',
  outlierVelocityThreshold_cmPerS:
    'A centroid velocity jump above this marks the frame invalid for kinematics; the position is never replaced (O17).',
};

const UNIT_OVERRIDES: Record<string, string> = {
  'holeInvestigation.radiusFactor': '× hole radius',
  'escapeEntry.radiusFactor': '× hole radius',
  'targetQuadrant.holeSpan': 'holes',
  noseConfidenceCutoff: '0–1',
  'gapFilling.enabled': 'on/off',
  'tracking.threshold.mode': '',
  'tracking.threshold.manualValue': '0–255',
  'tracking.expectedBlobArea_cm2': 'cm² (blank = learn from the video)',
};

function unitFor(path: string): string {
  const override = UNIT_OVERRIDES[path];
  if (override !== undefined) return override;
  const leaf = path.slice(path.lastIndexOf('.') + 1);
  if (leaf.endsWith('_cm2')) return 'cm²';
  if (leaf.endsWith('_cmPerS')) return 'cm/s';
  if (leaf.endsWith('_cm')) return 'cm';
  if (leaf.endsWith('_s')) return 's';
  if (leaf.endsWith('Frames')) return 'frames';
  if (leaf.endsWith('Count')) return 'count';
  if (leaf.endsWith('Factor') || leaf.endsWith('Ratio')) return 'ratio';
  return '';
}

/** Definitions of the tracking subtree, keyed by the path they appear under. */
const TRACKING_DEFINITIONS: Record<string, string> = Object.fromEntries(
  Object.entries(TRACKING_PARAMETER_DEFINITIONS).map(([key, text]) => [`tracking.${key}`, text]),
);

/**
 * The definition for a path: the supplied lookup first, then an exact match,
 * then the nearest ancestor — so `tracking.threshold.mode` inherits the
 * definition written for `tracking.threshold`.
 */
function definitionFor(path: string, lookup?: ParameterDefinitionLookup): string {
  const supplied = lookup?.(path);
  if (supplied !== undefined) return supplied;
  let candidate = path;
  for (;;) {
    const text = TRACKING_DEFINITIONS[candidate] ?? ANALYSIS_PARAMETER_DEFINITIONS[candidate];
    if (text !== undefined) return text;
    const cut = candidate.lastIndexOf('.');
    if (cut < 0) return '';
    candidate = candidate.slice(0, cut);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatten(
  value: unknown,
  path: string,
  out: ParameterRow[],
  lookup?: ParameterDefinitionLookup,
): void {
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, path ? `${path}.${key}` : key, out, lookup);
    }
    return;
  }
  const scalar =
    typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
      ? value
      : value === null
        ? ''
        : JSON.stringify(value);
  out.push({
    name: path,
    value: scalar,
    unit: unitFor(path),
    definition: definitionFor(path, lookup),
  });
}

export function parameterRows(
  parameters: Parameters,
  definitions?: ParameterDefinitionLookup,
): ParameterRow[] {
  const rows: ParameterRow[] = [];
  flatten(parameters, '', rows, definitions);
  return rows;
}

/** `parameters.json`: the parameter set itself, pretty-printed, nothing added. */
export function parametersJson(parameters: Parameters): string {
  return `${JSON.stringify(parameters, null, 2)}\n`;
}
