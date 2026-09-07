/**
 * The `parameters` sheet and `parameters.json`: every threshold in force for
 * this export, with its value, unit and the one-line definition the UI shows
 * (D11, D12). Flattening keeps the dotted path, so a row here can be matched
 * back to a field of `Parameters` without guessing.
 *
 * Definitions and units come from the single configuration module
 * (`PARAMETER_DEFINITIONS`, `PARAMETER_UNITS`; D20, D55), so the sheet can
 * never disagree with the controls. A leaf the module describes only as a
 * group (`tracking.threshold.mode` under `tracking.threshold`) inherits its
 * nearest ancestor's text.
 */
import { PARAMETER_DEFINITIONS, PARAMETER_UNITS } from '../analysis/parameters.js';
import type { Parameters } from '../contracts/parameters.js';

export interface ParameterRow {
  /** Dotted path into `Parameters`, e.g. `holeInvestigation.radiusFactor`. */
  name: string;
  value: string | number | boolean;
  unit: string;
  definition: string;
}

/**
 * Looks a definition up by dotted path. A supplied lookup wins outright, so a
 * caller with its own text (a test, a future translation) never gets two
 * sources of definition text in one export.
 */
export type ParameterDefinitionLookup = (path: string) => string | undefined;

/** Units of the leaves the configuration module describes only as a group, or with a note. */
const UNIT_OVERRIDES: Record<string, string> = {
  'tracking.threshold.mode': '',
  'tracking.threshold.manualValue': '0–255',
  'tracking.expectedBlobArea_cm2': 'cm² (blank = learn from the video)',
};

const DEFINITIONS: Record<string, string> = PARAMETER_DEFINITIONS;
const UNITS: Record<string, string> = PARAMETER_UNITS;

/** The entry for a path, or for its nearest ancestor that has one. */
function nearest(table: Record<string, string>, path: string): string | undefined {
  let candidate = path;
  for (;;) {
    const text = table[candidate];
    if (text !== undefined) return text;
    const cut = candidate.lastIndexOf('.');
    if (cut < 0) return undefined;
    candidate = candidate.slice(0, cut);
  }
}

function unitFor(path: string): string {
  return UNIT_OVERRIDES[path] ?? nearest(UNITS, path) ?? '';
}

function definitionFor(path: string, lookup?: ParameterDefinitionLookup): string {
  return lookup?.(path) ?? nearest(DEFINITIONS, path) ?? '';
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
