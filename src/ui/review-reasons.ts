/**
 * Why an event is in the review queue, and what it costs if it is wrong
 * (D19, D20, D76; chunk 17).
 *
 * The queue (`review-queue.ts`) says *which* events want a human. This module
 * says, for each of them, *why* — the review flag that names it, or the
 * uncertain frames it was decided over — and *what changes if it is wrong*,
 * found the only honest way: by re-running the pure engine on
 * `auto ⊕ corrections` with that one event deleted and comparing the trial's
 * numbers (D20, D22). The consequence orders the queue (trial-ending first)
 * and is printed on the card with every changed number beside what it is
 * compared to (D76).
 *
 * Pure over the analysis and its input — no DOM, no video, no clock beyond
 * the timer it is handed — so the sentences are unit tested. The cost is one
 * derive per queued event, cached per analysis object.
 */
import { derive, type DeriveInput, type DerivedAnalysis } from '../analysis/derive.js';
import type { TrialEndReason } from '../analysis/trial.js';
import type { ReviewFlag, ReviewFlagCode } from '../analysis/types.js';
import type { EventRecord } from '../contracts/events.js';
import type { TrialMetrics } from '../contracts/metrics.js';
import type { TrackFrame } from '../contracts/track.js';
import { deleteEvent } from '../session/corrections.js';
import { formatCount, formatSeconds } from './components/format.js';
import type { QueueRank } from './review-queue.js';

/**
 * What each review flag is called on a card and in the queue's reason. Four
 * of the codes can name an event, and they mean different things: only
 * `physically_unlikely_entry` is the O4 "there is no escape box there"
 * finding, so only it may be labelled "physically unlikely". Calling a
 * lost-tracking flag or an orphaned correction by that name would tell the
 * user the animal did something impossible when the tracker merely lost it.
 *
 * The label is a short noun phrase because the sentence is already in
 * `flag.message`, which the card keeps one click away.
 */
export const FLAG_LABELS: Record<ReviewFlagCode, string> = {
  physically_unlikely_entry: 'physically unlikely',
  tracking_failure_at_hole: 'lost at a hole',
  oversized_in_trial: 'oversized foreground',
  orphaned_correction: 'orphaned correction',
  correction_out_of_range: 'correction out of range',
  stale_auto_layer: 'stale automatic track',
  no_escape_contradicted: 'contradicted non-escape',
  confirmation_contradicted: 'contradicted confirmation',
  non_persistent_entry_noted: 'short entry noted',
  auto_event_removed_by_correction: 'automatic event removed',
};

/** What a review flag is called, by its code. */
export function flagLabel(code: ReviewFlagCode): string {
  return FLAG_LABELS[code];
}

const STATE_WORDS: Record<TrackFrame['detectionState'], string> = {
  tracked: 'tracked',
  low_confidence: 'low confidence',
  ambiguous: 'ambiguous',
  not_detected: 'not detected',
};

/** The uncertain states in the order the sentence names them: a position the tracker doubted before no position at all. */
const UNCERTAIN_ORDER: readonly TrackFrame['detectionState'][] = ['low_confidence', 'ambiguous', 'not_detected'];

/**
 * One sentence saying why the event is in the queue: the flag(s) naming it,
 * or — with none — the uncertain frames it was decided over, counted by
 * state and reason from the cleaned track (`eventsToCheck` admits an event on
 * a single uncertain frame; this says how many, and of what kind). Frames are
 * taken by `frameIndex`, the identity an event's span is written in, never by
 * array position. Null when neither applies — the event is not queued.
 */
export function reasonFor(
  event: Pick<EventRecord, 'id' | 'startFrame' | 'endFrame'>,
  flags: readonly ReviewFlag[],
  frames: readonly TrackFrame[],
): string | null {
  const labels = [...new Set(flags.filter((flag) => flag.eventId === event.id).map((flag) => FLAG_LABELS[flag.code]))];
  if (labels.length > 0) return `Flagged: ${labels.join(' · ')}.`;
  let total = 0;
  let uncertain = 0;
  const counts = new Map<TrackFrame['detectionState'], Map<string, number>>();
  for (const frame of frames) {
    if (frame.frameIndex < event.startFrame || frame.frameIndex > event.endFrame) continue;
    total++;
    if (frame.detectionState === 'tracked') continue;
    uncertain++;
    const reasons = counts.get(frame.detectionState) ?? new Map<string, number>();
    reasons.set(frame.reason, (reasons.get(frame.reason) ?? 0) + 1);
    counts.set(frame.detectionState, reasons);
  }
  if (uncertain === 0) return null;
  const parts = UNCERTAIN_ORDER.flatMap((state) => {
    const reasons = counts.get(state);
    if (!reasons) return [];
    const n = [...reasons.values()].reduce((a, b) => a + b, 0);
    const detail = [...reasons]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([reason, count]) => `${count} ${reason.replace(/_/g, ' ')}`)
      .join(', ');
    return [`${n} ${STATE_WORDS[state]} (${detail})`];
  });
  return `Decided over ${uncertain} uncertain frame${uncertain === 1 ? '' : 's'} of ${total}: ${parts.join(', ')}.`;
}

export interface Consequence {
  /** What the event decides, for the queue's order: the trial's end, the strategy, an error count, or nothing. */
  rank: QueueRank;
  /** `If rejected: total latency 44.0 s → cutoff; status ok → review.` */
  sentence: string;
  /** Wall-clock time of the re-derive, ms. */
  ms: number;
}

/** The one correction a rejection adds: pure, so the same event always gets the same layer. */
const REJECTION_META = { id: 'consequence', timestamp: '1970-01-01T00:00:00.000Z' } as const;

const END_WORDS: Record<TrialEndReason, string> = {
  escape: 'escape',
  cutoff: 'cutoff',
  end_of_video: 'end of video',
  no_start: 'no trial window',
};

function latencyWord(metrics: TrialMetrics, end: TrialEndReason): string {
  return metrics.totalLatency_s === null ? END_WORDS[end] : formatSeconds(metrics.totalLatency_s, 1);
}

function escapedWord(value: boolean | null): string {
  return value === null ? 'not applicable' : value ? 'yes' : 'no';
}

/** `name before → after`, or null when nothing moved (D76: a changed number names what it is compared to). */
function clause(name: string, before: string, after: string): string | null {
  return before === after ? null : `${name} ${before} → ${after}`;
}

/**
 * What changes if the event is wrong: the trial re-derived from the same
 * input with this event deleted, compared with the analysis as it stands.
 * An escape entry's rejection re-resolves the trial end; an investigation's
 * moves the error counts and may flip the strategy; a tracking failure's
 * moves nothing, and the sentence says so.
 */
export function consequenceOf(
  event: EventRecord,
  input: DeriveInput,
  baseline: DerivedAnalysis,
  now: () => number = () => performance.now(),
): Consequence {
  const started = now();
  const rejected = derive({ ...input, corrections: deleteEvent(input.corrections, event.id, REJECTION_META) });
  const ms = now() - started;
  const b = baseline.metrics;
  const a = rejected.metrics;
  const latency = clause('total latency', latencyWord(b, baseline.trial.endReason), latencyWord(a, rejected.trial.endReason));
  const escaped = clause('escaped', escapedWord(b.escaped), escapedWord(a.escaped));
  const status = clause('status', b.status, a.status);
  const primaryLatency = clause('primary latency', formatSeconds(b.primaryLatency_s, 1), formatSeconds(a.primaryLatency_s, 1));
  const totalErrors = clause('total errors', formatCount(b.totalErrors), formatCount(a.totalErrors));
  const primaryErrors = clause('primary errors', formatCount(b.primaryErrors), formatCount(a.primaryErrors));
  const strategy = clause('strategy', b.strategy, a.strategy);
  const rank: QueueRank =
    latency !== null || escaped !== null || baseline.trial.endReason !== rejected.trial.endReason
      ? 'trial_end'
      : strategy !== null
        ? 'strategy'
        : totalErrors !== null || primaryErrors !== null
          ? 'errors'
          : 'none';
  const clauses: string[] = [];
  if (event.kind === 'investigation') {
    // the two numbers an investigation decides are always named, moved or not
    clauses.push(totalErrors ?? 'total errors unchanged');
    for (const c of [primaryErrors, primaryLatency, latency, escaped, status]) if (c !== null) clauses.push(c);
    clauses.push(strategy ?? 'strategy unchanged');
  } else {
    for (const c of [latency, escaped, status, primaryLatency, totalErrors, primaryErrors, strategy]) if (c !== null) clauses.push(c);
    if (clauses.length === 0) clauses.push('no number changes');
  }
  return { rank, sentence: `If rejected: ${clauses.join('; ')}.`, ms };
}

const CACHE = new WeakMap<DerivedAnalysis, Map<string, Consequence>>();

/**
 * The consequences of the given events, computed once per analysis object
 * (a new derive is a new object, so a correction or a threshold change
 * recomputes; a re-render does not). `input` must be the input that produced
 * `analysis`. Ids the analysis has no event for are skipped.
 */
export function consequencesFor(
  input: DeriveInput,
  analysis: DerivedAnalysis,
  ids: readonly string[],
  now?: () => number,
): ReadonlyMap<string, Consequence> {
  let map = CACHE.get(analysis);
  if (!map) {
    map = new Map();
    CACHE.set(analysis, map);
  }
  for (const id of ids) {
    if (map.has(id)) continue;
    const event = analysis.events.find((candidate) => candidate.id === id);
    if (!event) continue;
    map.set(id, consequenceOf(event, input, analysis, now));
  }
  return map;
}

export interface ConsequenceTiming {
  count: number;
  mean: number;
  max: number;
  total: number;
}

/** The cost of the consequences named, for the timing line and the report. */
export function consequenceTiming(consequences: ReadonlyMap<string, Consequence>, ids: readonly string[]): ConsequenceTiming {
  let total = 0;
  let max = 0;
  let count = 0;
  for (const id of ids) {
    const c = consequences.get(id);
    if (!c) continue;
    count++;
    total += c.ms;
    if (c.ms > max) max = c.ms;
  }
  return { count, mean: count === 0 ? 0 : total / count, max, total };
}
