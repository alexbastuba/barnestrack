/**
 * Review flags: what a human should look at before trusting a trial (D19,
 * D20, D56, D63, D66). Raised by `derive()`, persisted on the derived layer so
 * the reason travels with the row (`review_flags` in `trials.csv`), and
 * recomputed on load like everything else in that layer.
 */
export type ReviewFlagCode =
  | 'physically_unlikely_entry'
  | 'tracking_failure_at_hole'
  | 'oversized_in_trial'
  | 'orphaned_correction'
  | 'correction_out_of_range'
  /** The automatic layer was produced by other tracking parameters than the ones in force (D51). */
  | 'stale_auto_layer'
  /** A confirmed non-escape now has an escape entry that ended the trial, or a persistent one, beside it; the entry wins (D63, D67). */
  | 'no_escape_contradicted'
  /** A confirmed event no longer exists under the current parameters — removed, or its start frame moved (D67). */
  | 'confirmation_contradicted'
  /** Soft: a confirmed non-escape stands beside an entry too short to end the trial; noted, not contradicted (D67). */
  | 'non_persistent_entry_noted';

/**
 * Flags that note something without sending the trial to review (D67): the
 * trial's status ignores them, the export still carries them.
 */
export const SOFT_REVIEW_FLAG_CODES: ReadonlySet<ReviewFlagCode> = new Set<ReviewFlagCode>([
  'non_persistent_entry_noted',
]);

export function isSoftReviewFlag(flag: Pick<ReviewFlag, 'code'>): boolean {
  return SOFT_REVIEW_FLAG_CODES.has(flag.code);
}

/** Something a human should look at before trusting the trial; every one but a soft flag sets the status to review. */
export interface ReviewFlag {
  code: ReviewFlagCode;
  /** Plain-language reason, shown in the UI. */
  message: string;
  frameIndex?: number;
  eventId?: string;
  correctionId?: string;
}

/** The distinct codes raised, alphabetical: the stable order `review_flags` is written in. */
export function reviewFlagCodes(flags: readonly ReviewFlag[]): ReviewFlagCode[] {
  return [...new Set(flags.map((flag) => flag.code))].sort();
}
