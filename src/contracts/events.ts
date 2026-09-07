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
  source: 'auto' | 'corrected';
  /** The automatic values, kept alongside a correction so nothing is overwritten silently. D11. */
  autoShadow?: Pick<EventRecord, 'holeIndex' | 'startFrame' | 'endFrame'>;
}
