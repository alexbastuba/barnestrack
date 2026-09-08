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
import type { SearchStrategy } from './session.js';
import type { NamedPointId } from './track.js';
import type { ToolVersion } from './version.js';

export const EXPORT_SCHEMA_VERSION = 1;

interface ExportProvenance {
  toolVersion: ToolVersion;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  parametersHash: string;
}

export interface TrialRow extends ExportProvenance {
  sessionId: string;
  videoId: string;
  animal: string | null;
  day: string | null;
  trialLabel: string | null;
  group: string | null;
  /**
   * D62: the target hole under the maze map's numbering (D49), null when the
   * session has no map. Gawel's protocol rotates the platform between trials,
   * so a row without its target is not interpretable on its own.
   */
  targetHole: number | null;

  trialStart_s: number | null;
  primaryLatency_s: number | null;
  totalLatency_s: number | null;
  primaryErrors: number;
  totalErrors: number;
  pathLength_cm: number;
  pathLengthSmoothed_cm: number;
  meanSpeed_cmPerS: number | null;
  targetQuadrantTime_s: number;
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  escaped: boolean;
  /** D63: a person has confirmed the animal never entered the escape box. */
  noEscapeConfirmed: boolean;
  status: TrialStatus;
  trackedFraction: number;
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
  /** Populated only when source is 'corrected' (D11 shadow columns). */
  autoHoleIndex: number | null;
  autoStartFrame: number | null;
  autoEndFrame: number | null;
}

export interface QualityRow extends ExportProvenance {
  sessionId: string;
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
