/**
 * The parameters hash that keys the auto layer and stamps every export
 * (D12, D51).
 *
 * D51 fixes the definition: the SHA-256 of the canonical JSON of the value,
 * where canonical means object keys sorted and no whitespace. The auto layer
 * is keyed by the hash of the *tracking* block alone, because nothing else
 * changes a tracking run; the derived layer is keyed by the hash of the full
 * parameter set, so changing an event threshold does not invalidate an hour
 * of tracking.
 *
 * The canonicalisation is written down in `docs/data-contracts.md` §6 as well
 * as here, because two implementations that disagree by a byte would silently
 * invalidate every stored layer. Anything downstream that needs one of these
 * hashes must import this module rather than re-derive it.
 */
import type { Parameters, ParametersHash, TrackingParameters } from '../contracts/parameters.js';
import { sha256Hex } from '../video/sha256.js';

/**
 * JSON with object keys sorted by code unit and no whitespace anywhere.
 * Arrays keep their order — it is part of the value. `undefined` members are
 * dropped exactly as `JSON.stringify` drops them, so an absent optional field
 * and one explicitly set to `undefined` hash alike.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = sortKeys(source[key]);
  }
  return out;
}

function hashCanonical(value: unknown): ParametersHash {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

/** D51 · keys the `auto` layer: the tracking block only. */
export function hashTrackingParameters(tracking: TrackingParameters): ParametersHash {
  return hashCanonical(tracking);
}

/** D51 · keys the `derived` layer and stamps exports: the whole parameter set. */
export function hashParameters(parameters: Parameters): ParametersHash {
  return hashCanonical(parameters);
}
