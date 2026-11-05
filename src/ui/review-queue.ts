/**
 * Which events still want a human (D19, D23, D24).
 *
 * The correction workflow is the centre of this tool, and until now nothing on
 * screen said *which* of forty investigations to look at — the user read them
 * all or trusted them all. The queue is that list: events carrying a review
 * flag, and events decided over frames the tracker was not sure about.
 *
 * Correcting an event takes it out of the queue. That is the whole point of the
 * count: it goes down as the work is done, and a user can stop when it is zero
 * rather than when they are tired.
 *
 * Pure over the derived analysis — no DOM, no video — so the rule is unit
 * tested rather than inferred from the screen.
 */
import type { DetectionState } from '../contracts/track.js';
import type { EventRecord } from '../contracts/events.js';
import type { ReviewFlag } from '../analysis/types.js';
import type { StateRun } from '../viz/quality-strip.js';

/**
 * States that make an event worth a second look. `tracked` is the only one
 * that does not: the other three each mean the tracker reported a position it
 * was not confident in, or none at all, over frames this event was judged on.
 */
const UNCERTAIN: ReadonlySet<DetectionState> = new Set<DetectionState>([
  'low_confidence',
  'ambiguous',
  'not_detected',
]);

/** True when any frame of the inclusive span falls in an uncertain run. */
export function spanIsUncertain(
  runs: readonly StateRun[],
  startFrame: number,
  endFrame: number,
): boolean {
  for (const run of runs) {
    if (!UNCERTAIN.has(run.state)) continue;
    if (run.endFrame >= startFrame && run.startFrame <= endFrame) return true;
  }
  return false;
}

/**
 * The ids of the events to check, in the order the events are given. An event
 * qualifies when it is not already the user's and either a review flag names
 * it or it was decided over uncertain frames.
 */
export function eventsToCheck(
  events: readonly EventRecord[],
  flags: readonly ReviewFlag[],
  stateRuns: readonly StateRun[],
): string[] {
  const flagged = new Set(flags.map((flag) => flag.eventId).filter((id) => id !== undefined));
  const queue: string[] = [];
  for (const event of events) {
    // A person has looked at it: corrected (`source: corrected`) or kept as it stands
    // (`confirmed`, which leaves `source: auto`, D65). Either makes the count fall.
    if (event.source === 'corrected' || event.confirmed) continue;
    if (flagged.has(event.id) || spanIsUncertain(stateRuns, event.startFrame, event.endFrame)) {
      queue.push(event.id);
    }
  }
  return queue;
}

/** `4 events to check`, or `1 event to check`, or `nothing to check`. */
export function describeQueue(count: number): string {
  if (count === 0) return 'nothing to check';
  return `${count} event${count === 1 ? '' : 's'} to check`;
}

/** The events a person has already looked at: kept as they stand, or corrected. */
export function checkedCount(events: readonly Pick<EventRecord, 'source' | 'confirmed'>[]): number {
  return events.filter((event) => event.confirmed || event.source === 'corrected').length;
}

/** `3 to check · 9 checked`: how much is left beside how much is done (chunk 17). */
export function describeQueueCounts(toCheck: number, checked: number): string {
  return `${toCheck} to check · ${checked} checked`;
}

/**
 * What a queued event decides if it is wrong (`review-reasons.ts`), and the
 * order the queue walks: the trial's end first, then the strategy, then an
 * error count, then the rest.
 */
export type QueueRank = 'trial_end' | 'strategy' | 'errors' | 'none';

const RANK_ORDER: Record<QueueRank, number> = { trial_end: 0, strategy: 1, errors: 2, none: 3 };

/** The queue by rank, stable within a rank (the events' own order, by start frame). */
export function orderQueue(queue: readonly string[], rankOf: (id: string) => QueueRank): string[] {
  return queue
    .map((id, position) => ({ id, position, rank: RANK_ORDER[rankOf(id)] }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((item) => item.id);
}

/**
 * The next id after `currentId` in the queue, wrapping; `direction` is 1 for
 * the next and −1 for the previous. Null when the queue is empty. When the
 * selection is not in the queue — the user clicked some other event — the walk
 * starts from the beginning or the end rather than nowhere.
 */
export function stepQueue(
  queue: readonly string[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (queue.length === 0) return null;
  const at = currentId === null ? -1 : queue.indexOf(currentId);
  if (at === -1) return direction === 1 ? queue[0]! : queue[queue.length - 1]!;
  const next = (at + direction + queue.length) % queue.length;
  return queue[next]!;
}
