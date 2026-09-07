/**
 * Applying the sparse human corrections of the corrections layer to a copy
 * of the automatic track (D9, D25): point corrections replace one named
 * point (a centroid correction also sets the frame's detection state, so the
 * quality report follows it), range corrections mark frames "not visible" or
 * "in the escape box".
 * The automatic layer is never touched; untouched frames are shared, changed
 * frames are new objects. Corrections apply in timestamp order, then id, so
 * a re-saved file gives the same answer regardless of array order.
 */
import type { CorrectionEntry, CorrectionsLayer } from '../contracts/session.js';
import type { NamedPoint, TrackFrame } from '../contracts/track.js';
import type { ReviewFlag } from './types.js';

/** Derived-layer reason strings written by corrections (D8: every frame carries a reason). */
export const NOT_VISIBLE_REASON = 'not_visible';
export const IN_ESCAPE_BOX_REASON = 'in_escape_box';
/** A frame whose centroid was placed (or declared invalid) by hand: `tracked` when valid, `not_detected` when not. */
export const CORRECTED_REASON = 'corrected';

export type CorrectionOfKind<K extends CorrectionEntry['kind']> = Extract<
  CorrectionEntry,
  { kind: K }
>;

function compareCorrections(a: CorrectionEntry, b: CorrectionEntry): number {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** A copy of the entries in application order: ISO timestamp, then id. */
export function sortedCorrections(entries: readonly CorrectionEntry[]): CorrectionEntry[] {
  return [...entries].sort(compareCorrections);
}

export function correctionsOfKind<K extends CorrectionEntry['kind']>(
  entries: readonly CorrectionEntry[],
  kind: K,
): CorrectionOfKind<K>[] {
  return sortedCorrections(entries).filter((c): c is CorrectionOfKind<K> => c.kind === kind);
}

/** The last correction of a kind in application order, or null. */
export function latestCorrection<K extends CorrectionEntry['kind']>(
  entries: readonly CorrectionEntry[],
  kind: K,
): CorrectionOfKind<K> | null {
  const all = correctionsOfKind(entries, kind);
  return all.length === 0 ? null : all[all.length - 1]!;
}

function invalidCorrectedPoint(): NamedPoint {
  return { x: 0, y: 0, confidence: 0, valid: false, source: 'corrected' };
}

export interface CorrectedTrack {
  frames: TrackFrame[];
  /** Corrections that named a frame outside the track. */
  flags: ReviewFlag[];
  pointCorrections: number;
  rangeCorrections: number;
}

/**
 * The automatic frames with point and range corrections applied. Event,
 * trial-start and strategy corrections are applied by their own modules.
 */
export function applyTrackCorrections(
  frames: readonly TrackFrame[],
  corrections: CorrectionsLayer,
): CorrectedTrack {
  const n = frames.length;
  const flags: ReviewFlag[] = [];
  let pointCorrections = 0;
  let rangeCorrections = 0;
  // frameIndex is the presentation position (D7); fall back to a lookup if a track disagrees.
  let positionOf: (frameIndex: number) => number = (frameIndex) => frameIndex;
  for (let i = 0; i < n; i++) {
    if (frames[i]!.frameIndex !== i) {
      const map = new Map<number, number>();
      for (let j = 0; j < n; j++) map.set(frames[j]!.frameIndex, j);
      positionOf = (frameIndex) => map.get(frameIndex) ?? -1;
      break;
    }
  }
  const edited = new Map<number, TrackFrame>();
  const frameAt = (position: number): TrackFrame => edited.get(position) ?? frames[position]!;

  for (const c of sortedCorrections(corrections.entries)) {
    if (c.kind === 'point') {
      const position = positionOf(c.frameIndex);
      if (position < 0 || position >= n) {
        flags.push({
          code: 'correction_out_of_range',
          correctionId: c.id,
          frameIndex: c.frameIndex,
          message: `Point correction ${c.id} names frame ${c.frameIndex}, outside this track of ${n} frames; ignored.`,
        });
        continue;
      }
      pointCorrections++;
      const point: NamedPoint = {
        x: c.value.x,
        y: c.value.y,
        confidence: c.value.confidence,
        valid: c.value.valid,
        source: 'corrected',
      };
      const base = frameAt(position);
      if (c.point === 'centroid') {
        // a hand-placed centroid positions the frame (or declares it unpositioned): the detection
        // state follows, so the quality report and the tier move with the correction (D26, D30)
        edited.set(position, {
          ...base,
          centroid: point,
          detectionState: point.valid ? 'tracked' : 'not_detected',
          reason: CORRECTED_REASON,
        });
      } else {
        // a nose-only correction leaves the frame's state and reason as the tracker set them
        edited.set(position, { ...base, nose: point });
      }
    } else if (c.kind === 'range') {
      const first = Math.max(0, positionOf(c.startFrame));
      const last = Math.min(n - 1, positionOf(c.endFrame));
      if (
        c.startFrame > c.endFrame ||
        positionOf(c.endFrame) < 0 ||
        positionOf(c.startFrame) >= n
      ) {
        flags.push({
          code: 'correction_out_of_range',
          correctionId: c.id,
          frameIndex: c.startFrame,
          message: `Range correction ${c.id} covers frames ${c.startFrame}–${c.endFrame}, outside this track of ${n} frames; ignored.`,
        });
        continue;
      }
      rangeCorrections++;
      const reason = c.rangeType === 'not_visible' ? NOT_VISIBLE_REASON : IN_ESCAPE_BOX_REASON;
      for (let position = first; position <= last; position++) {
        edited.set(position, {
          ...frameAt(position),
          centroid: invalidCorrectedPoint(),
          nose: invalidCorrectedPoint(),
          detectionState: 'not_detected',
          reason,
        });
      }
    }
  }

  const out: TrackFrame[] = new Array<TrackFrame>(n);
  for (let i = 0; i < n; i++) out[i] = edited.get(i) ?? frames[i]!;
  return { frames: out, flags, pointCorrections, rangeCorrections };
}
