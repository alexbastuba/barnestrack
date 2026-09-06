/**
 * Candidate selection per frame → detection state and reason (D8, D16).
 * The reasons are fixed strings: the quality report clusters on them (D30).
 */
import type { DetectionState } from '../../contracts/track.js';
import type { TrackingParametersPx } from './calibration.js';

export type DetectionReason =
  | 'single_blob'
  | 'proximity_to_previous'
  | 'no_foreground'
  | 'multiple_blobs'
  | 'oversized_blob'
  | 'partial_at_rim'
  | 'small_blob';

export const DETECTION_REASONS: readonly DetectionReason[] = [
  'single_blob',
  'proximity_to_previous',
  'no_foreground',
  'multiple_blobs',
  'oversized_blob',
  'partial_at_rim',
  'small_blob',
];

export const REASON_STATE: Record<DetectionReason, DetectionState> = {
  single_blob: 'tracked',
  proximity_to_previous: 'tracked',
  no_foreground: 'not_detected',
  multiple_blobs: 'ambiguous',
  oversized_blob: 'ambiguous',
  partial_at_rim: 'low_confidence',
  small_blob: 'low_confidence',
};

export interface CandidateBlob {
  /** Body area after the opening, px². */
  area: number;
  cx: number;
  cy: number;
  rimContact: boolean;
}

export interface Selection {
  state: DetectionState;
  reason: DetectionReason;
  /** Index into `candidates` of the selected blob, or −1. */
  index: number;
  /** The blob was picked among several by proximity to the previous position. */
  byProximity: boolean;
}

function rejected(reason: DetectionReason): Selection {
  return { state: REASON_STATE[reason], reason, index: -1, byProximity: false };
}

/**
 * Precedence: any component above `maxBlobArea` or above
 * `oversizedBlobFactor × expected` → ambiguous / oversized_blob; nothing at or
 * above `minBlobArea` → not_detected / no_foreground; two or more plausible →
 * ambiguous / multiple_blobs unless exactly one lies within the proximity
 * radius of the previous position; the chosen blob → low_confidence /
 * partial_at_rim when it touches the rim zone, low_confidence / small_blob
 * when below `smallBlobFactor × expected`, otherwise tracked.
 */
export function selectCandidate(
  candidates: readonly CandidateBlob[],
  px: TrackingParametersPx,
  expected_px2: number | null,
  previous: { x: number; y: number } | null,
): Selection {
  const oversizedAbove =
    expected_px2 === null
      ? px.maxBlobArea_px2
      : Math.min(px.maxBlobArea_px2, px.oversizedBlobFactor * expected_px2);
  for (const c of candidates) if (c.area > oversizedAbove) return rejected('oversized_blob');

  const plausible: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.area >= px.minBlobArea_px2) plausible.push(i);
  }
  if (plausible.length === 0) return rejected('no_foreground');

  let index = plausible[0]!;
  let byProximity = false;
  if (plausible.length >= 2) {
    if (previous === null) return rejected('multiple_blobs');
    const r2 = px.proximityRadius_px * px.proximityRadius_px;
    let near = -1;
    let nearCount = 0;
    for (const i of plausible) {
      const c = candidates[i]!;
      const dx = c.cx - previous.x;
      const dy = c.cy - previous.y;
      if (dx * dx + dy * dy <= r2) {
        nearCount++;
        near = i;
      }
    }
    if (nearCount !== 1) return rejected('multiple_blobs');
    index = near;
    byProximity = true;
  }

  const chosen = candidates[index]!;
  if (chosen.rimContact)
    return { state: 'low_confidence', reason: 'partial_at_rim', index, byProximity };
  if (expected_px2 !== null && chosen.area < px.smallBlobFactor * expected_px2) {
    return { state: 'low_confidence', reason: 'small_blob', index, byProximity };
  }
  return {
    state: 'tracked',
    reason: byProximity ? 'proximity_to_previous' : 'single_blob',
    index,
    byProximity,
  };
}
