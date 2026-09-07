/**
 * What a parameter change did, in a sentence (D20).
 *
 * "The consequence of a threshold is visible the moment it changes" is only
 * true if the user can see *what* changed. A re-derived analysis differs from
 * the last one in a handful of places at most, and this names them:
 *
 *   `+2 investigations, −1; primary errors 4 → 3; strategy unchanged`
 *
 * Two rules keep it honest. First, events are compared by id, not by count, so
 * two investigations appearing while two others disappear reads as `+2, −2`
 * rather than "no change" — the user changed the events even though the total
 * stands still. Second, the headline judgements (strategy, status, tier) are
 * always named, `unchanged` included: a badge that goes quiet about the
 * strategy is indistinguishable from one that has not noticed it moved.
 *
 * Pure over two `DerivedAnalysis` values: no DOM, no session, no clock.
 */
import type { DerivedAnalysis } from '../../analysis/derive.js';
import type { EventKind, EventRecord } from '../../contracts/events.js';
import { isRecorded } from '../../analysis/parameters.js';
import {
  formatChange,
  formatCm,
  formatDelta,
  formatSeconds,
  formatSpeed,
  pluralise,
} from './format.js';

/** What the badge says when the two analyses are the same in every way it looks at. */
export const NO_CHANGE = 'No change.';

/** The order kinds are reported in — the order the event list uses. */
const KINDS: readonly EventKind[] = ['investigation', 'escape_entry', 'tracking_failure'];

const KIND_WORDS: Record<EventKind, { singular: string; plural: string }> = {
  investigation: { singular: 'investigation', plural: 'investigations' },
  escape_entry: { singular: 'escape entry', plural: 'escape entries' },
  tracking_failure: { singular: 'tracking failure', plural: 'tracking failures' },
};

export interface EventDelta {
  kind: EventKind;
  added: number;
  removed: number;
}

/**
 * Events gained and lost per kind, compared by id. An event whose id survives
 * but whose hole or frames moved is not counted here — that is a correction,
 * not a consequence of a threshold, and the event list shows it directly.
 */
export function eventDeltas(
  before: readonly EventRecord[],
  after: readonly EventRecord[],
): EventDelta[] {
  const beforeIds = new Map<string, EventKind>(before.map((event) => [event.id, event.kind]));
  const afterIds = new Map<string, EventKind>(after.map((event) => [event.id, event.kind]));

  const deltas = new Map<EventKind, EventDelta>(
    KINDS.map((kind) => [kind, { kind, added: 0, removed: 0 }]),
  );
  for (const [id, kind] of afterIds) {
    if (!beforeIds.has(id)) deltas.get(kind)!.added += 1;
  }
  for (const [id, kind] of beforeIds) {
    if (!afterIds.has(id)) deltas.get(kind)!.removed += 1;
  }
  return KINDS.map((kind) => deltas.get(kind)!);
}

function describeEvents(deltas: readonly EventDelta[]): string | null {
  const parts: string[] = [];
  for (const delta of deltas) {
    if (delta.added === 0 && delta.removed === 0) continue;
    const words = KIND_WORDS[delta.kind];
    const net = delta.added - delta.removed;
    const noun = Math.abs(net) === 1 ? words.singular : words.plural;
    if (delta.added > 0 && delta.removed > 0) {
      // Both directions are shown: a swap is not the same event set as before,
      // and a net of zero would otherwise be reported as nothing happening.
      parts.push(`${formatDelta(delta.added)} ${words.plural}, ${formatDelta(-delta.removed)}`);
    } else {
      parts.push(`${formatDelta(net)} ${noun}`);
    }
  }
  return parts.length === 0 ? null : parts.join(', ');
}

function latency(value: number | null): string {
  return isRecorded(value) ? formatSeconds(value) : 'none';
}

/**
 * How close two recomputed floats have to be to count as the same number.
 * Below the precision the card prints them at, so the badge can never say a
 * value moved when the two displayed values are identical, nor stay silent
 * when they differ on screen.
 */
const MEASURE_TOLERANCE = 5e-3;

function changed(before: number, after: number): boolean {
  if (!isRecorded(before) || !isRecorded(after)) return before !== after;
  return Math.abs(before - after) > MEASURE_TOLERANCE;
}

/** The continuous per-trial measures, with the unit each is written in. */
const MEASURES: readonly {
  key: 'pathLength_cm' | 'pathLengthSmoothed_cm' | 'meanSpeed_cmPerS' | 'targetQuadrantTime_s';
  name: string;
  format(value: number): string;
}[] = [
  { key: 'pathLength_cm', name: 'path length', format: formatCm },
  { key: 'pathLengthSmoothed_cm', name: 'smoothed path length', format: formatCm },
  { key: 'meanSpeed_cmPerS', name: 'mean speed', format: formatSpeed },
  { key: 'targetQuadrantTime_s', name: 'target quadrant time', format: formatSeconds },
];

/**
 * The badge sentence for a re-derivation. `previous` is null the first time an
 * analysis is shown, when there is nothing to compare against.
 */
export function describeDiff(
  previous: DerivedAnalysis | null | undefined,
  next: DerivedAnalysis | null | undefined,
): string {
  if (!next) return 'No analysis yet.';
  if (!previous) return 'First analysis — nothing to compare with yet.';

  const clauses: string[] = [];

  const events = describeEvents(eventDeltas(previous.events, next.events));
  if (events) clauses.push(events);

  const a = previous.metrics;
  const b = next.metrics;

  if (a.primaryErrors !== b.primaryErrors) {
    clauses.push(
      `primary errors ${formatChange(String(a.primaryErrors), String(b.primaryErrors))}`,
    );
  }
  if (a.totalErrors !== b.totalErrors) {
    clauses.push(`total errors ${formatChange(String(a.totalErrors), String(b.totalErrors))}`);
  }
  if (a.primaryLatency_s !== b.primaryLatency_s) {
    clauses.push(
      `primary latency ${formatChange(latency(a.primaryLatency_s), latency(b.primaryLatency_s))}`,
    );
  }
  if (a.totalLatency_s !== b.totalLatency_s) {
    clauses.push(
      `total latency ${formatChange(latency(a.totalLatency_s), latency(b.totalLatency_s))}`,
    );
  }
  if (a.escaped !== b.escaped) {
    clauses.push(`escaped ${formatChange(a.escaped ? 'yes' : 'no', b.escaped ? 'yes' : 'no')}`);
  }
  // The continuous measures. They are floats recomputed from scratch, so they
  // are compared with a tolerance rather than by identity — but they must be
  // compared: `targetQuadrant.holeSpan` and `kinematicsSmoothingWindowFrames`
  // move only these, and a badge that ignored them would read "No change."
  // while the card beside it showed the quadrant time doubling.
  for (const measure of MEASURES) {
    const before = a[measure.key];
    const after = b[measure.key];
    if (!changed(before, after)) continue;
    clauses.push(`${measure.name} ${formatChange(measure.format(before), measure.format(after))}`);
  }

  if (previous.cleaning.filledFrames !== next.cleaning.filledFrames) {
    clauses.push(
      `filled frames ${formatChange(
        String(previous.cleaning.filledFrames),
        String(next.cleaning.filledFrames),
      )}`,
    );
  }

  // The three judgements are always stated, changed or not: silence about a
  // classification reads as "it did not move", which is a claim the badge would
  // otherwise be making without checking.
  clauses.push(
    a.strategy === b.strategy
      ? 'strategy unchanged'
      : `strategy ${formatChange(a.strategy, b.strategy)}`,
  );
  clauses.push(
    a.status === b.status ? 'status unchanged' : `status ${formatChange(a.status, b.status)}`,
  );
  clauses.push(
    previous.quality.tier === next.quality.tier
      ? 'quality tier unchanged'
      : `quality tier ${formatChange(previous.quality.tier, next.quality.tier)}`,
  );

  // Only the three always-present clauses, all of them "unchanged": nothing the
  // badge watches actually moved.
  const moved = clauses.filter((clause) => !clause.endsWith('unchanged'));
  if (moved.length === 0) return NO_CHANGE;

  return `${clauses.join('; ')}.`;
}

/** The count line the event list shows: `14 investigations · 1 escape entry · 2 tracking failures`. */
export function describeEventCounts(events: readonly EventRecord[]): string {
  return KINDS.map((kind) => {
    const words = KIND_WORDS[kind];
    const count = events.filter((event) => event.kind === kind).length;
    return pluralise(count, words.singular, words.plural);
  }).join(' · ');
}
