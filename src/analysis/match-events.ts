/**
 * Event provenance as the difference between two detections (D65, D71).
 *
 * `derive()` runs event detection twice under the same parameters and over
 * the same trial window: once over the automatic frames alone, and once over
 * `auto ⊕ corrections` (point and range corrections applied to the frames).
 * This module matches the two lists and labels every corrected-detection
 * event with where it came from:
 *
 * - present only in the corrected detection → a human claim:
 *   `source: 'corrected'`, `correctionIds` = the point and range corrections
 *   inside its span, no `autoShadow`;
 * - present in both with the same values → `source: 'auto'`,
 *   `evidenceCorrected: false`, `correctionIds: []`;
 * - present in both with different values → `source: 'auto'`,
 *   `evidenceCorrected: true`, `correctionIds` = the corrections inside the
 *   union of its span and its shadow's span, `autoShadow` = the auto-only
 *   hole and frames;
 * - present in both but of a different kind (a range that turned an
 *   investigation into an escape entry, a point that turned a loss into an
 *   investigation) → a human claim: `source: 'corrected'`, `correctionIds`
 *   over the union of the two spans, `autoShadow` = the automatic hole, frames
 *   and kind, and the evidence sentence names the automatic kind (D71);
 * - present only in the automatic detection → removed by a correction: it is
 *   returned in `removedAutoEvents` so `derive()` can flag it and count it as
 *   an event delete is counted; it gets no row (D71).
 *
 * Matching runs in two passes, each largest overlap first and each event
 * matched at most once: by kind and hole, then — over what is left — by hole
 * alone. A pair left to the second pass always differs in kind, because a
 * same-kind pair with both sides free would have been taken in the first.
 * Ids are not stable across corrections (they carry the start frame), which
 * is why spans are matched and not ids. Pure: no DOM, no video, no clock.
 */
import type { EventKind, EventRecord } from '../contracts/events.js';
import type { CorrectionEntry } from '../contracts/session.js';
import { sortedCorrections } from './corrections.js';

/** The frames one point or range correction touches, inclusive. */
export interface FrameCorrectionSpan {
  id: string;
  startFrame: number;
  endFrame: number;
}

/** The point and range corrections of a layer as frame spans, in application order. */
export function frameCorrectionSpans(entries: readonly CorrectionEntry[]): FrameCorrectionSpan[] {
  const out: FrameCorrectionSpan[] = [];
  for (const c of sortedCorrections(entries)) {
    if (c.kind === 'point') {
      out.push({ id: c.id, startFrame: c.frameIndex, endFrame: c.frameIndex });
    } else if (c.kind === 'range') {
      out.push({
        id: c.id,
        startFrame: Math.min(c.startFrame, c.endFrame),
        endFrame: Math.max(c.startFrame, c.endFrame),
      });
    }
  }
  return out;
}

/** Ids of the corrections whose frames overlap the inclusive span. */
export function correctionIdsInSpan(
  spans: readonly FrameCorrectionSpan[],
  startFrame: number,
  endFrame: number,
): string[] {
  return spans
    .filter((s) => s.startFrame <= endFrame && startFrame <= s.endFrame)
    .map((s) => s.id);
}

/** Fields that describe where an event came from rather than what it is. */
const PROVENANCE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'source',
  'evidenceCorrected',
  'correctionIds',
  'confirmed',
  'autoShadow',
]);

/** True when the two records agree on every measured field (NaN equals NaN). */
export function sameEventValues(a: EventRecord, b: EventRecord): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (PROVENANCE_KEYS.has(key)) continue;
    const x = (a as unknown as Record<string, unknown>)[key];
    const y = (b as unknown as Record<string, unknown>)[key];
    if (!Object.is(x, y)) return false;
  }
  return true;
}

function overlapFrames(a: EventRecord, b: EventRecord): number {
  return Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame) + 1;
}

/** How the evidence sentence names an automatic kind. */
const KIND_LABEL: Record<EventKind, string> = {
  investigation: 'investigation',
  escape_entry: 'escape entry',
  tracking_failure: 'tracking failure',
};

/**
 * Pairs the free corrected events with the free automatic ones that `eligible`
 * admits, largest overlap first, each event at most once. Ties go to the
 * earlier corrected event, then the earlier automatic one. Returns corrected
 * index → automatic index.
 */
function pairByOverlap(
  autoOnly: readonly EventRecord[],
  corrected: readonly EventRecord[],
  freeCorrected: (ci: number) => boolean,
  freeAuto: (ai: number) => boolean,
  eligible: (ev: EventRecord, shadow: EventRecord) => boolean,
): Map<number, number> {
  const pairs: { ci: number; ai: number; overlap: number }[] = [];
  corrected.forEach((ev, ci) => {
    if (!freeCorrected(ci)) return;
    autoOnly.forEach((shadow, ai) => {
      if (!freeAuto(ai) || !eligible(ev, shadow)) return;
      const overlap = overlapFrames(ev, shadow);
      if (overlap > 0) pairs.push({ ci, ai, overlap });
    });
  });
  pairs.sort(
    (x, y) =>
      y.overlap - x.overlap ||
      corrected[x.ci]!.startFrame - corrected[y.ci]!.startFrame ||
      autoOnly[x.ai]!.startFrame - autoOnly[y.ai]!.startFrame,
  );
  const matched = new Map<number, number>();
  const used = new Set<number>();
  for (const pair of pairs) {
    if (matched.has(pair.ci) || used.has(pair.ai)) continue;
    matched.set(pair.ci, pair.ai);
    used.add(pair.ai);
  }
  return matched;
}

export interface MatchedEvents {
  /** The corrected-detection events with their provenance filled in, in the order of `corrected`. */
  events: EventRecord[];
  /**
   * Automatic events with no counterpart in the corrected detection, by start
   * frame: a correction removed their evidence (D71). Each carries the ids of
   * the point and range corrections inside its span as `correctionIds`, so a
   * reader can see what erased it; `source` stays `auto`.
   */
  removedAutoEvents: EventRecord[];
}

/**
 * The corrected-detection events with their provenance filled in from the
 * auto-only detection, and the automatic events that no longer have a
 * counterpart. The order of `corrected` is kept.
 */
export function matchEvents(
  autoOnly: readonly EventRecord[],
  corrected: readonly EventRecord[],
  spans: readonly FrameCorrectionSpan[],
): MatchedEvents {
  // pass 1 (D65): by kind and hole
  const sameKind = pairByOverlap(
    autoOnly,
    corrected,
    () => true,
    () => true,
    (ev, shadow) => shadow.kind === ev.kind && shadow.holeIndex === ev.holeIndex,
  );
  const usedAuto = new Set(sameKind.values());
  // pass 2 (D71): over the leftovers, by hole alone — every pair here differs in kind
  const kindChange = pairByOverlap(
    autoOnly,
    corrected,
    (ci) => !sameKind.has(ci),
    (ai) => !usedAuto.has(ai),
    (ev, shadow) => shadow.holeIndex === ev.holeIndex,
  );
  for (const ai of kindChange.values()) usedAuto.add(ai);

  const events = corrected.map((ev, ci): EventRecord => {
    const same = sameKind.get(ci);
    if (same !== undefined) {
      const shadow = autoOnly[same]!;
      if (sameEventValues(ev, shadow)) {
        const { autoShadow: _dropped, ...rest } = ev;
        void _dropped;
        return {
          ...rest,
          source: 'auto',
          evidenceCorrected: false,
          correctionIds: [],
          confirmed: false,
        };
      }
      return {
        ...ev,
        source: 'auto',
        evidenceCorrected: true,
        correctionIds: correctionIdsInSpan(
          spans,
          Math.min(ev.startFrame, shadow.startFrame),
          Math.max(ev.endFrame, shadow.endFrame),
        ),
        confirmed: false,
        autoShadow: {
          holeIndex: shadow.holeIndex,
          startFrame: shadow.startFrame,
          endFrame: shadow.endFrame,
        },
      };
    }
    const changed = kindChange.get(ci);
    if (changed !== undefined) {
      // A kind change is the strongest form of "the human said otherwise": the event is a claim,
      // and the automatic event stands beside it with its kind — the CSV shadow columns carry
      // hole and frames only, so the sentence is where the kind travels (D71).
      const shadow = autoOnly[changed]!;
      const where =
        shadow.holeIndex === null ? 'away from any hole' : `at hole ${shadow.holeIndex}`;
      return {
        ...ev,
        evidence: `${ev.evidence} Was an automatic ${KIND_LABEL[shadow.kind]} ${where}, frames ${shadow.startFrame}–${shadow.endFrame}, before the corrections changed its kind.`,
        source: 'corrected',
        evidenceCorrected: false,
        correctionIds: correctionIdsInSpan(
          spans,
          Math.min(ev.startFrame, shadow.startFrame),
          Math.max(ev.endFrame, shadow.endFrame),
        ),
        confirmed: false,
        autoShadow: {
          holeIndex: shadow.holeIndex,
          startFrame: shadow.startFrame,
          endFrame: shadow.endFrame,
          kind: shadow.kind,
        },
      };
    }
    // only the corrected detection found it: a human claim
    const { autoShadow: _dropped, ...rest } = ev;
    void _dropped;
    return {
      ...rest,
      source: 'corrected',
      evidenceCorrected: false,
      correctionIds: correctionIdsInSpan(spans, ev.startFrame, ev.endFrame),
      confirmed: false,
    };
  });

  const removedAutoEvents = autoOnly
    .map((ev, ai) => ({ ev, ai }))
    .filter(({ ai }) => !usedAuto.has(ai))
    .map(
      ({ ev }): EventRecord => ({
        ...ev,
        correctionIds: correctionIdsInSpan(spans, ev.startFrame, ev.endFrame),
      }),
    )
    .sort((x, y) => x.startFrame - y.startFrame);

  return { events, removedAutoEvents };
}
