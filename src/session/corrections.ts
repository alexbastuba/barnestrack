// Adapted from talmolab/vibes/event-annotator (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * Pure operations over a corrections layer (D9, D25): every operation takes a
 * layer and returns a new one, the automatic layer is never touched, and the
 * id and timestamp of a new entry are injected by the caller, so nothing here
 * reads a clock or a random source and every result is reproducible.
 *
 * Borrowed from event-annotator: the idea that the rows a timeline shows are
 * derived from a flat list of segments and never stored, and the four-case
 * range algebra — contain / split / trim-left / trim-right — for painting and
 * erasing ranges. Re-implemented over the D9 contract: corrections are sparse
 * entries with a source and a timestamp rather than coloured segments; repeated
 * edits of one item coalesce into one entry, so "revert to automatic" is one
 * action per item (D25); event edits address events by the deterministic ids
 * of `src/analysis/events.ts`; and nothing carries meaning by colour.
 */
import type { ReviewFlag } from '../analysis/types.js';
import type {
  CorrectionEntry,
  CorrectionsLayer,
  EventCorrection,
  NoEscapeCorrection,
  PointCorrection,
  RangeCorrection,
  RangeCorrectionType,
  SearchStrategy,
  StrategyOverrideCorrection,
  TrialStartCorrection,
} from '../contracts/session.js';
import type { NamedPointId } from '../contracts/track.js';

/** The identity of a new entry, chosen by the caller (the UI uses a UUID and the wall clock). */
export interface CorrectionMeta {
  id: string;
  /** ISO 8601. */
  timestamp: string;
}

export const NO_CORRECTIONS: CorrectionsLayer = { entries: [] };

/** The prefix of the id of an event the user added, as `src/analysis/events.ts` names it. */
const USER_EVENT_PREFIX = 'user-';

function layerOf(entries: CorrectionEntry[]): CorrectionsLayer {
  return { entries };
}

function drop(layer: CorrectionsLayer, gone: (entry: CorrectionEntry) => boolean): CorrectionEntry[] {
  return layer.entries.filter((entry) => !gone(entry));
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export function pointCorrectionAt(
  layer: CorrectionsLayer,
  frameIndex: number,
  point: NamedPointId,
): PointCorrection | null {
  for (const entry of layer.entries) {
    if (entry.kind === 'point' && entry.frameIndex === frameIndex && entry.point === point) {
      return entry;
    }
  }
  return null;
}

/**
 * Places a named point by hand on one frame, or declares it invalid. A second
 * placement on the same frame and point replaces the first — one entry per
 * item, keeping the original id so the corrections list stays stable.
 */
export function setPoint(
  layer: CorrectionsLayer,
  frameIndex: number,
  point: NamedPointId,
  value: PointCorrection['value'],
  meta: CorrectionMeta,
): CorrectionsLayer {
  const existing = pointCorrectionAt(layer, frameIndex, point);
  const entry: PointCorrection = {
    kind: 'point',
    id: existing?.id ?? meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    frameIndex,
    point,
    value: { ...value },
  };
  return layerOf([...drop(layer, (e) => e === existing), entry]);
}

export function clearPoint(
  layer: CorrectionsLayer,
  frameIndex: number,
  point: NamedPointId,
): CorrectionsLayer {
  const existing = pointCorrectionAt(layer, frameIndex, point);
  return existing === null ? layer : layerOf(drop(layer, (e) => e === existing));
}

// ---------------------------------------------------------------------------
// Ranges: "animal not visible from here to here", "animal in the escape box"
// ---------------------------------------------------------------------------

function ordered(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Erases [start, end] from every range entry: a range wholly inside the span
 * goes; one that reaches past both ends splits in two; one overlapping an end
 * is trimmed. The split halves take the meta id with a suffix so both stay
 * addressable.
 */
function eraseFrames(
  entries: readonly CorrectionEntry[],
  start: number,
  end: number,
  meta: CorrectionMeta,
): CorrectionEntry[] {
  const out: CorrectionEntry[] = [];
  let splits = 0;
  for (const entry of entries) {
    if (entry.kind !== 'range' || entry.endFrame < start || entry.startFrame > end) {
      out.push(entry);
      continue;
    }
    const before = entry.startFrame < start;
    const after = entry.endFrame > end;
    if (before && after) {
      splits++;
      out.push({ ...entry, endFrame: start - 1 });
      out.push({ ...entry, id: `${meta.id}-split-${splits}`, timestamp: meta.timestamp, startFrame: end + 1 });
    } else if (before) {
      out.push({ ...entry, endFrame: start - 1 });
    } else if (after) {
      out.push({ ...entry, startFrame: end + 1 });
    }
    // wholly inside: gone
  }
  return out;
}

/** Joins ranges of one type that touch or overlap into one entry each; the earliest id survives. */
function mergeTouching(entries: readonly CorrectionEntry[]): CorrectionEntry[] {
  const ranges = entries.filter((e): e is RangeCorrection => e.kind === 'range');
  const others = entries.filter((e) => e.kind !== 'range');
  const merged: RangeCorrection[] = [];
  for (const range of [...ranges].sort((a, b) => a.startFrame - b.startFrame)) {
    const last = merged[merged.length - 1];
    if (last && last.rangeType === range.rangeType && range.startFrame <= last.endFrame + 1) {
      merged[merged.length - 1] = {
        ...last,
        endFrame: Math.max(last.endFrame, range.endFrame),
        timestamp: last.timestamp > range.timestamp ? last.timestamp : range.timestamp,
      };
    } else {
      merged.push(range);
    }
  }
  return [...others, ...merged];
}

/**
 * Marks [start, end] (either order) as "not visible" or "in the escape box".
 * Frames already covered by a range of either type are re-marked; touching
 * ranges of the same type become one entry.
 */
export function markRange(
  layer: CorrectionsLayer,
  rangeType: RangeCorrectionType,
  startFrame: number,
  endFrame: number,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const [start, end] = ordered(startFrame, endFrame);
  const entry: RangeCorrection = {
    kind: 'range',
    id: meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    rangeType,
    startFrame: start,
    endFrame: end,
  };
  return layerOf(mergeTouching([...eraseFrames(layer.entries, start, end, meta), entry]));
}

/** Removes every range mark from [start, end] (either order): the eraser. */
export function clearRange(
  layer: CorrectionsLayer,
  startFrame: number,
  endFrame: number,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const [start, end] = ordered(startFrame, endFrame);
  return layerOf(eraseFrames(layer.entries, start, end, meta));
}

export function rangesCovering(layer: CorrectionsLayer, frameIndex: number): RangeCorrection[] {
  return layer.entries.filter(
    (e): e is RangeCorrection =>
      e.kind === 'range' && e.startFrame <= frameIndex && frameIndex <= e.endFrame,
  );
}

// ---------------------------------------------------------------------------
// Events: add, relabel / retime, delete
// ---------------------------------------------------------------------------

export function isUserEventId(eventId: string): boolean {
  return eventId.startsWith(USER_EVENT_PREFIX);
}

/** The `add` entry behind a user-added event, or null. */
function addEntryFor(layer: CorrectionsLayer, eventId: string): EventCorrection | null {
  if (!isUserEventId(eventId)) return null;
  const id = eventId.slice(USER_EVENT_PREFIX.length);
  for (const entry of layer.entries) {
    if (entry.kind === 'event' && entry.action === 'add' && entry.id === id) return entry;
  }
  return null;
}

function editEntryFor(layer: CorrectionsLayer, eventId: string): EventCorrection | null {
  for (const entry of layer.entries) {
    if (entry.kind === 'event' && entry.action === 'edit' && entry.eventId === eventId) return entry;
  }
  return null;
}

/** Every event correction that addresses this event: its add entry, edits and deletes. */
export function eventCorrectionsFor(layer: CorrectionsLayer, eventId: string): EventCorrection[] {
  const add = addEntryFor(layer, eventId);
  return layer.entries.filter(
    (e): e is EventCorrection => e.kind === 'event' && (e === add || e.eventId === eventId),
  );
}

/** Adds an investigation at a hole over [start, end] (either order). Its event id will be `user-<meta.id>`. */
export function addEvent(
  layer: CorrectionsLayer,
  holeIndex: number,
  startFrame: number,
  endFrame: number,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const [start, end] = ordered(startFrame, endFrame);
  const entry: EventCorrection = {
    kind: 'event',
    id: meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    action: 'add',
    holeIndex,
    startFrame: start,
    endFrame: end,
  };
  return layerOf([...layer.entries, entry]);
}

export interface EventPatch {
  holeIndex?: number;
  startFrame?: number;
  endFrame?: number;
}

/**
 * Relabels or retimes an event. A user-added event's own `add` entry is
 * patched in place; an automatic event gets one `edit` entry, and a later edit
 * of the same event merges into it (keeping its id, taking the new timestamp),
 * so an event never accumulates a chain of corrections.
 */
export function editEvent(
  layer: CorrectionsLayer,
  eventId: string,
  patch: EventPatch,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const fields: EventPatch = {};
  if (patch.holeIndex !== undefined) fields.holeIndex = patch.holeIndex;
  if (patch.startFrame !== undefined || patch.endFrame !== undefined) {
    const start = patch.startFrame;
    const end = patch.endFrame;
    if (start !== undefined && end !== undefined) {
      const [s, e] = ordered(start, end);
      fields.startFrame = s;
      fields.endFrame = e;
    } else {
      if (start !== undefined) fields.startFrame = start;
      if (end !== undefined) fields.endFrame = end;
    }
  }
  const add = addEntryFor(layer, eventId);
  if (add) {
    const patched: EventCorrection = { ...add, ...fields, timestamp: meta.timestamp };
    return layerOf(layer.entries.map((e) => (e === add ? patched : e)));
  }
  const existing = editEntryFor(layer, eventId);
  const entry: EventCorrection = {
    kind: 'event',
    id: existing?.id ?? meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    action: 'edit',
    eventId,
    ...(existing
      ? {
          ...(existing.holeIndex === undefined ? {} : { holeIndex: existing.holeIndex }),
          ...(existing.startFrame === undefined ? {} : { startFrame: existing.startFrame }),
          ...(existing.endFrame === undefined ? {} : { endFrame: existing.endFrame }),
        }
      : {}),
    ...fields,
  };
  return layerOf([...drop(layer, (e) => e === existing), entry]);
}

/**
 * Keeps an event exactly as the tool found it: an edit whose values are the
 * automatic ones. The event becomes the user's — `source: 'corrected'`, with
 * the automatic values kept as its `autoShadow` — so it leaves the list of
 * events to check, and "revert to automatic" puts it back.
 *
 * There is no `confirmed` flag in the D9 contract, so a confirmation *is* the
 * equal-values edit: everything downstream already recomputes from it, and
 * `src/analysis/events.ts` already writes "no change to hole or frames" into
 * the event's evidence. A reader tells a confirmation from a real edit by
 * comparing the event with its own `autoShadow`, not by a stored field.
 */
export function confirmEvent(
  layer: CorrectionsLayer,
  eventId: string,
  values: { holeIndex: number | null; startFrame: number; endFrame: number },
  meta: CorrectionMeta,
): CorrectionsLayer {
  return editEvent(
    layer,
    eventId,
    {
      ...(values.holeIndex === null ? {} : { holeIndex: values.holeIndex }),
      startFrame: values.startFrame,
      endFrame: values.endFrame,
    },
    meta,
  );
}

/**
 * Deletes an event. A user-added event simply loses its `add` entry (and any
 * edit of it); an automatic event gets one `delete` entry, replacing any edit.
 */
export function deleteEvent(
  layer: CorrectionsLayer,
  eventId: string,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const add = addEntryFor(layer, eventId);
  if (add) return layerOf(drop(layer, (e) => e === add || (e.kind === 'event' && e.eventId === eventId)));
  const entry: EventCorrection = {
    kind: 'event',
    id: meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    action: 'delete',
    eventId,
  };
  return layerOf([...drop(layer, (e) => e.kind === 'event' && e.eventId === eventId), entry]);
}

// ---------------------------------------------------------------------------
// Trial start and strategy override: one entry each
// ---------------------------------------------------------------------------

export function trialStartCorrection(layer: CorrectionsLayer): TrialStartCorrection | null {
  let latest: TrialStartCorrection | null = null;
  for (const entry of layer.entries) {
    if (entry.kind === 'trial_start' && (latest === null || entry.timestamp >= latest.timestamp)) {
      latest = entry;
    }
  }
  return latest;
}

export function setTrialStart(
  layer: CorrectionsLayer,
  frameIndex: number,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const existing = trialStartCorrection(layer);
  const entry: TrialStartCorrection = {
    kind: 'trial_start',
    id: existing?.id ?? meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    frameIndex,
  };
  return layerOf([...drop(layer, (e) => e.kind === 'trial_start'), entry]);
}

export function strategyOverride(layer: CorrectionsLayer): StrategyOverrideCorrection | null {
  let latest: StrategyOverrideCorrection | null = null;
  for (const entry of layer.entries) {
    if (
      entry.kind === 'strategy_override' &&
      (latest === null || entry.timestamp >= latest.timestamp)
    ) {
      latest = entry;
    }
  }
  return latest;
}

export function setStrategyOverride(
  layer: CorrectionsLayer,
  strategy: SearchStrategy,
  reason: string,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const existing = strategyOverride(layer);
  const entry: StrategyOverrideCorrection = {
    kind: 'strategy_override',
    id: existing?.id ?? meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    strategy,
    reason,
  };
  return layerOf([...drop(layer, (e) => e.kind === 'strategy_override'), entry]);
}

// ---------------------------------------------------------------------------
// Confirmed non-escape (D63): one entry per video, like the strategy override
// ---------------------------------------------------------------------------

export function noEscapeCorrection(layer: CorrectionsLayer): NoEscapeCorrection | null {
  let latest: NoEscapeCorrection | null = null;
  for (const entry of layer.entries) {
    if (entry.kind === 'no_escape' && (latest === null || entry.timestamp >= latest.timestamp)) {
      latest = entry;
    }
  }
  return latest;
}

/** Records "the animal never entered the escape box", with the reason. A second call replaces the first. */
export function setNoEscape(
  layer: CorrectionsLayer,
  reason: string,
  meta: CorrectionMeta,
): CorrectionsLayer {
  const existing = noEscapeCorrection(layer);
  const entry: NoEscapeCorrection = {
    kind: 'no_escape',
    id: existing?.id ?? meta.id,
    timestamp: meta.timestamp,
    source: 'user',
    reason,
  };
  return layerOf([...drop(layer, (e) => e.kind === 'no_escape'), entry]);
}

// ---------------------------------------------------------------------------
// Revert to automatic (D25): one item at a time
// ---------------------------------------------------------------------------

export function revertCorrection(layer: CorrectionsLayer, correctionId: string): CorrectionsLayer {
  const entries = drop(layer, (e) => e.id === correctionId);
  return entries.length === layer.entries.length ? layer : layerOf(entries);
}

/** Removes every correction that addresses one event: it goes back to what the automatic layer says. */
export function revertEvent(layer: CorrectionsLayer, eventId: string): CorrectionsLayer {
  const gone = new Set(eventCorrectionsFor(layer, eventId));
  return gone.size === 0 ? layer : layerOf(drop(layer, (e) => gone.has(e as EventCorrection)));
}

export function revertTrialStart(layer: CorrectionsLayer): CorrectionsLayer {
  const entries = drop(layer, (e) => e.kind === 'trial_start');
  return entries.length === layer.entries.length ? layer : layerOf(entries);
}

export function revertStrategyOverride(layer: CorrectionsLayer): CorrectionsLayer {
  const entries = drop(layer, (e) => e.kind === 'strategy_override');
  return entries.length === layer.entries.length ? layer : layerOf(entries);
}

export function revertNoEscape(layer: CorrectionsLayer): CorrectionsLayer {
  const entries = drop(layer, (e) => e.kind === 'no_escape');
  return entries.length === layer.entries.length ? layer : layerOf(entries);
}

// ---------------------------------------------------------------------------
// Reading the layer
// ---------------------------------------------------------------------------

/** Corrections that touch one frame: a point placed on it, a range covering it, a trial start on it. */
export function correctionsAtFrame(layer: CorrectionsLayer, frameIndex: number): CorrectionEntry[] {
  return layer.entries.filter((e) => {
    if (e.kind === 'point' || e.kind === 'trial_start') return e.frameIndex === frameIndex;
    if (e.kind === 'range') return e.startFrame <= frameIndex && frameIndex <= e.endFrame;
    return false;
  });
}

export interface OrphanedCorrection {
  entry: CorrectionEntry;
  flag: ReviewFlag;
}

/**
 * Corrections that no longer apply — an event correction whose automatic event
 * vanished under the current parameters, a frame outside the track — paired
 * with the review flag that says so. Listed, never dropped (D25).
 */
export function orphanedCorrections(
  layer: CorrectionsLayer,
  flags: readonly ReviewFlag[],
): OrphanedCorrection[] {
  const out: OrphanedCorrection[] = [];
  for (const flag of flags) {
    if (flag.code !== 'orphaned_correction' && flag.code !== 'correction_out_of_range') continue;
    if (flag.correctionId === undefined) continue;
    const entry = layer.entries.find((e) => e.id === flag.correctionId);
    if (entry) out.push({ entry, flag });
  }
  return out;
}

const STRATEGY_WORDS: Record<SearchStrategy, string> = {
  spatial: 'spatial',
  serial: 'serial',
  random: 'random',
};

/** One plain sentence per correction, for the corrections list and the live region. */
export function describeCorrection(entry: CorrectionEntry): string {
  switch (entry.kind) {
    case 'point': {
      const which = entry.point === 'nose' ? 'Nose' : 'Centroid';
      return entry.value.valid
        ? `${which} placed by hand on frame ${entry.frameIndex} at (${entry.value.x.toFixed(1)}, ${entry.value.y.toFixed(1)}) px`
        : `${which} marked invalid on frame ${entry.frameIndex}`;
    }
    case 'range':
      return entry.rangeType === 'not_visible'
        ? `Animal not visible, frames ${entry.startFrame}–${entry.endFrame}`
        : `Animal in the escape box, frames ${entry.startFrame}–${entry.endFrame}`;
    case 'event': {
      if (entry.action === 'add') {
        return `Investigation added at hole ${entry.holeIndex}, frames ${entry.startFrame}–${entry.endFrame}`;
      }
      if (entry.action === 'delete') return `Event ${entry.eventId} deleted`;
      const changes: string[] = [];
      if (entry.holeIndex !== undefined) changes.push(`hole → ${entry.holeIndex}`);
      if (entry.startFrame !== undefined || entry.endFrame !== undefined) {
        changes.push(`frames → ${entry.startFrame ?? '…'}–${entry.endFrame ?? '…'}`);
      }
      return `Event ${entry.eventId} edited: ${changes.length > 0 ? changes.join(', ') : 'no change'}`;
    }
    case 'trial_start':
      return `Trial start moved to frame ${entry.frameIndex}`;
    case 'strategy_override':
      return `Strategy set to ${STRATEGY_WORDS[entry.strategy]} by hand${entry.reason ? `: ${entry.reason}` : ''}`;
    case 'no_escape':
      return `Confirmed: the animal never entered the escape box${entry.reason ? `: ${entry.reason}` : ''}`;
  }
}
