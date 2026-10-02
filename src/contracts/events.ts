/**
 * Event records: investigations, escape-box entries and tracking failures.
 * D8, D19, O1, O4.
 */
import type { FrameIndex, NamedPointId, TimeSeconds } from './track.js';

export type EventKind = 'investigation' | 'escape_entry' | 'tracking_failure';

export interface EventRecord {
  id: string;
  kind: EventKind;
  /** null for a tracking failure away from any hole. */
  holeIndex: number | null;
  isTarget: boolean;
  startFrame: FrameIndex;
  endFrame: FrameIndex;
  startTime_s: TimeSeconds;
  endTime_s: TimeSeconds;
  durationSeconds: number;
  /** Which named point this event's distance/dwell was judged on. O16. */
  pointUsed: NamedPointId;
  /** null when the nose was never usable during the event (O16, D55); recorded whichever point was used otherwise (O1). */
  minNoseDistance_cm: number | null;
  minCentroidDistance_cm: number;
  /** Plain-language evidence: last-seen location, loss duration, reappearance, blob-area trend. D19. */
  evidence: string;
  /**
   * `corrected` when the event is a human claim: it exists only in the
   * detection over `auto ⊕ corrections` (a user's escape-box range, a nudged
   * point that produced it), or an event correction edited or added it.
   * `auto` otherwise, including a confirmed event (D65).
   */
  source: 'auto' | 'corrected';
  /**
   * True when the automatic detection also found this event but a point or
   * range correction inside its span changed what it measured; the auto-only
   * values are then kept in `autoShadow` (D65).
   */
  evidenceCorrected: boolean;
  /**
   * The ids of the point and range corrections inside the event's span (the
   * span and, for an evidence-corrected event, its shadow span). Empty for an
   * untouched automatic event (D65).
   */
  correctionIds: string[];
  /** A human looked at this event and kept it as it stands (D64, D67). The values are the automatic ones. */
  confirmed: boolean;
  /** The automatic values, kept alongside a correction so nothing is overwritten silently. D11, D65. */
  autoShadow?: Pick<EventRecord, 'holeIndex' | 'startFrame' | 'endFrame'>;
}
