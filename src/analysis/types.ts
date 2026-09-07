/** Result types shared across the analysis modules. */

export type ReviewFlagCode =
  | 'physically_unlikely_entry'
  | 'tracking_failure_at_hole'
  | 'oversized_in_trial'
  | 'orphaned_correction'
  | 'correction_out_of_range'
  /** The automatic layer was produced by other tracking parameters than the ones in force (D51). */
  | 'stale_auto_layer';

/** Something a human should look at before trusting the trial; every one sets the status to review. */
export interface ReviewFlag {
  code: ReviewFlagCode;
  /** Plain-language reason, shown in the UI. */
  message: string;
  frameIndex?: number;
  eventId?: string;
  correctionId?: string;
}
