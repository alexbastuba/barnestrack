/**
 * Event provenance as the difference between two detections (D65).
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
 *   hole and frames.
 *
 * Matching is by kind and hole on overlapping spans, largest overlap first,
 * each event matched at most once. Ids are not stable across corrections
 * (they carry the start frame), which is why spans are matched and not ids.
 * Pure: no DOM, no video, no clock.
 */
import type { EventRecord } from '../contracts/events.js';
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

/**
 * The corrected-detection events with their provenance filled in from the
 * auto-only detection. The order of `corrected` is kept.
 */
export function matchEvents(
  autoOnly: readonly EventRecord[],
  corrected: readonly EventRecord[],
  spans: readonly FrameCorrectionSpan[],
): EventRecord[] {
  const pairs: { ci: number; ai: number; overlap: number }[] = [];
  corrected.forEach((ev, ci) => {
    autoOnly.forEach((shadow, ai) => {
      if (shadow.kind !== ev.kind || shadow.holeIndex !== ev.holeIndex) return;
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
  const shadowOf = new Map<number, number>();
  const used = new Set<number>();
  for (const pair of pairs) {
    if (shadowOf.has(pair.ci) || used.has(pair.ai)) continue;
    shadowOf.set(pair.ci, pair.ai);
    used.add(pair.ai);
  }

  return corrected.map((ev, ci) => {
    const ai = shadowOf.get(ci);
    if (ai === undefined) {
      const { autoShadow: _dropped, ...rest } = ev;
      void _dropped;
      return {
        ...rest,
        source: 'corrected',
        evidenceCorrected: false,
        correctionIds: correctionIdsInSpan(spans, ev.startFrame, ev.endFrame),
        confirmed: false,
      };
    }
    const shadow = autoOnly[ai]!;
    if (sameEventValues(ev, shadow)) {
      const { autoShadow: _dropped, ...rest } = ev;
      void _dropped;
      return { ...rest, source: 'auto', evidenceCorrected: false, correctionIds: [], confirmed: false };
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
  });
}
