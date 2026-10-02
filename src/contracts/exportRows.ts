/**
 * Row types for the tidy CSV/XLSX exports. `snake_case` field names with
 * unit suffixes at the file-format boundary (see docs/data-contracts.md);
 * these types use the project's camelCase convention and are mapped to
 * `snake_case` headers by the CSV/XLSX writer. D11.
 *
 * Every row carries the tool version, schema version and parameters hash
 * so a row is self-describing months later, and every threshold that
 * defines an event or cleaning step is its own column.
 */
import type { EventKind } from './events.js';
import type { TrialStatus } from './metrics.js';
import type { SearchStrategy, TrialType } from './session.js';
import type { NamedPointId } from './track.js';
import type { ToolVersion } from './version.js';

/**
 * Version 2 (D65, D66, D68): `session_id` is the session's UUID and
 * `session_name` the editable name; trials gain `trial_type`, `review_flags`
 * and `no_escape_confirmed_by`, their window measures are blank when no trial
 * window exists, and `strategy` admits `unclassified`; events gain
 * `evidence_corrected`, `correction_ids`, `confirmed` and `reviewer`, and
 * `kind` admits `tracking_failure`.
 */
export const EXPORT_SCHEMA_VERSION = 2;

interface ExportProvenance {
  toolVersion: ToolVersion;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  parametersHash: string;
}

export interface TrialRow extends ExportProvenance {
  /** D68: the session's UUID. */
  sessionId: string;
  /** D68: the editable cohort name, beside the id that never changes. */
  sessionName: string;
  videoId: string;
  animal: string | null;
  day: string | null;
  trialLabel: string | null;
  group: string | null;
  /** D68: acquisition or probe. */
  trialType: TrialType;
  /**
   * D62, D68: the effective target hole under the maze map's numbering (D49) —
   * this video's override when it has one, else the map's — null when the
   * session has no map. Gawel's protocol rotates the platform between trials,
   * so a row without its target is not interpretable on its own.
   */
  targetHole: number | null;

  trialStart_s: number | null;
  primaryLatency_s: number | null;
  totalLatency_s: number | null;
  /** D66: every measure over the trial window is null (an empty cell) on an `unresolved` row, never 0. */
  primaryErrors: number | null;
  totalErrors: number | null;
  pathLength_cm: number | null;
  pathLengthSmoothed_cm: number | null;
  meanSpeed_cmPerS: number | null;
  targetQuadrantTime_s: number | null;
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  /** Blank (null) on a probe trial, which has no escape box (D66, D68). */
  escaped: boolean | null;
  /** D63: a person has confirmed the animal never entered the escape box; blank on a probe trial. */
  noEscapeConfirmed: boolean | null;
  /** D68: who recorded that confirmation, when the session named a reviewer. */
  noEscapeConfirmedBy: string | null;
  status: TrialStatus;
  /** D66: the review flag codes `derive()` raised, `;`-joined, unique, alphabetical; empty when none. */
  reviewFlags: string;
  trackedFraction: number | null;
  correctionCount: number;

  /** O1 */
  holeInvestigationRadiusFactor: number;
  holeInvestigationMinDuration_s: number;
  holeInvestigationMergeGap_s: number;
  /** O4 */
  escapeEntryRadiusFactor: number;
  escapeEntryMinDuration_s: number;
  escapeEntryPersistCutoff_s: number;
  /** O5 */
  trialCutoff_s: number;
  /** O6 */
  targetQuadrantHoleSpan: number;
  /** O10 */
  gapFillMaxDuration_s: number;
  /** O16 */
  noseConfidenceCutoff: number;
  /** O17 */
  outlierVelocityThreshold_cmPerS: number;
}

export interface EventRow extends ExportProvenance {
  sessionId: string;
  sessionName: string;
  videoId: string;
  trialLabel: string | null;
  eventId: string;
  kind: EventKind;
  holeIndex: number | null;
  isTarget: boolean;
  startFrame: number;
  endFrame: number;
  startTime_s: number;
  endTime_s: number;
  durationSeconds: number;
  pointUsed: NamedPointId;
  minNoseDistance_cm: number | null;
  minCentroidDistance_cm: number;
  evidenceSummary: string;
  source: 'auto' | 'corrected';
  /** D65: the automatic detection found this event too, but over corrected frames. */
  evidenceCorrected: boolean;
  /** D65: `;`-joined ids of the point and range corrections inside the event's span; empty when none. */
  correctionIds: string;
  /** D64, D67: a person kept the event as it stands. */
  confirmed: boolean;
  /** D68: the reviewers behind the corrections that touched this event, `;`-joined; blank when none or unnamed. */
  reviewer: string | null;
  /** Populated when the record carries its auto-only values: a corrected or evidence-corrected event (D11, D65 shadow columns). */
  autoHoleIndex: number | null;
  autoStartFrame: number | null;
  autoEndFrame: number | null;
}

export interface QualityRow extends ExportProvenance {
  sessionId: string;
  sessionName: string;
  videoId: string;
  trackedFraction: number;
  notDetectedFraction: number;
  ambiguousFraction: number;
  lowConfidenceFraction: number;
  /** D54: the headline the tier is judged on (trial window), its whole-clip twin, and the O16 share. */
  positionedFraction: number;
  wholeClipPositionedFraction: number;
  /** NaN (an empty cell) when the trial has no investigation or entry. */
  noseJudgedEventFraction: number;
  gapCount: number;
  longestGap_s: number;
  duplicateTimestampCount: number;
  droppedFrameGapCount: number;
  driftSeconds: number;
  platformDiameter_cm: number;
  /** Derived from the maze map's platform radius after this video's transform. D44. */
  pxPerCm: number;
  tier: 'GOOD' | 'REVIEW' | 'POOR';
}
