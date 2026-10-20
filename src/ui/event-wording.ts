/**
 * What an event is called, in every place the Review step names one (D67).
 *
 * The detector's escape entry is an inference — the tracker lost the animal at
 * the target hole — and the interface says so wherever it names one: the event
 * card, the events table, the timeline, the selection line. A person's own
 * entry, a person's confirmation and a person's reclassification are named as
 * theirs. One function, so the four places cannot drift apart.
 *
 * Pure, tested in Node.
 */
import type { EventKind, EventRecord } from '../contracts/events.js';

const KIND_WORDS: Record<EventKind, string> = {
  investigation: 'Investigation',
  escape_entry: 'Escape entry',
  tracking_failure: 'Tracking failure',
};

export const INFERRED_ENTRY = 'Inferred escape entry';
export const MARKED_ENTRY = 'Escape entry — marked by you';
export const CONFIRMED_ENTRY = 'Escape entry — confirmed';
export const RECLASSIFIED_LOSS = 'Tracking loss — reclassified by you';

type Wordable = Pick<EventRecord, 'kind' | 'source' | 'confirmed'>;

/** The event's name, capitalised: `Inferred escape entry`, `Investigation`, … */
export function eventWording(event: Wordable, reclassified = false): string {
  if (event.kind === 'escape_entry') {
    if (event.confirmed) return CONFIRMED_ENTRY;
    if (event.source === 'corrected') return MARKED_ENTRY;
    return INFERRED_ENTRY;
  }
  if (event.kind === 'tracking_failure' && reclassified) return RECLASSIFIED_LOSS;
  return KIND_WORDS[event.kind];
}

/** The same name in running text: `inferred escape entry`, `investigation`, … */
export function eventWordingLower(event: Wordable, reclassified = false): string {
  const words = eventWording(event, reclassified);
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/** True for an escape entry the detector produced and nobody has confirmed: an inference. */
export function isInferredEntry(event: Wordable): boolean {
  return event.kind === 'escape_entry' && event.source === 'auto' && !event.confirmed;
}

/**
 * The evidence sentence as the interface prints it. The detector writes an
 * inferred entry's evidence as a statement ("Escape-box entry at the target
 * hole 7: …"); the interface prefixes it so it reads as the inference it is.
 * The engine's sentence itself is left alone — the export carries it verbatim.
 */
export function evidenceWording(event: Pick<EventRecord, 'kind' | 'source' | 'confirmed' | 'evidence'>): string {
  if (!event.evidence) return event.evidence;
  return isInferredEntry(event) ? `Inferred — ${event.evidence}` : event.evidence;
}

/**
 * Whether reclassifying this event as tracking loss is allowed, and why not
 * when it is not (D67). Only the detector's escape entry can be reclassified:
 * `reclassifyEvent` writes the edit whatever the kind, so the interface gates it.
 */
export function reclassifyRefusal(event: Wordable | null): string | null {
  if (event === null) return 'Select an escape entry first (click its card or its bar on the timeline).';
  if (event.kind !== 'escape_entry') {
    return `Only an escape entry the tracker inferred can be reclassified as tracking loss; this is ${eventWordingLower(event)}.`;
  }
  if (event.source !== 'auto') {
    return 'This escape entry was marked by you: revert the range that made it instead of reclassifying it.';
  }
  return null;
}
