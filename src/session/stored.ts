/**
 * The browser's autosave record (D27).
 *
 * It is a *superset* of the session file, never a wider `SessionFile`: the
 * contract stays exactly what `docs/data-contracts.md` §3 says, and anything
 * this build wants to remember that the contract does not carry lives beside
 * it here. Today that is the maze-step click count (D29 evidence), which is
 * therefore restored across a reload but is not written into a downloaded
 * session file.
 */
import type { MazeMapFile } from '../contracts/mazeMap.js';
import type { Parameters, TrackingParameters } from '../contracts/parameters.js';
import { SESSION_SCHEMA_VERSION, type SessionFile } from '../contracts/session.js';
import {
  isLegacySessionDocument,
  migrateSessionDocument,
  type SessionDocumentV1,
} from './migrate.js';
import { newSessionId } from './session-file.js';

/** `VideoDescriptor.id`, and the key of `SessionFile.analyses`. */
export type VideoId = string;

export interface StoredSession {
  file: SessionFile;
  /**
   * A maze map that has been started but not yet calibrated. D47 says
   * `SessionFile.mazeMap` is null until the maze step is finished, and a map
   * with `platformDiameter_cm: 0` is not a calibration (D14) — so the
   * in-progress map is remembered here, where a reload finds it, instead of
   * being published into the session file for another tool to divide by.
   */
  draftMazeMap: MazeMapFile | null;
  /** Maze-step clicks spent per video. Not part of the session file contract. */
  mazeClicks: Record<VideoId, number>;
  /**
   * The parameters in force before the first analysis run stamps them into
   * `SessionFile.parameters` (D51), or null while they are still the defaults.
   * Remembered here so a reload does not silently revert a threshold the user
   * changed before analysing anything; once stamped, the session file carries
   * them and this is null.
   */
  parameters: Parameters | null;
  /**
   * Records written by earlier builds carried only the tracking block here.
   * Read on restore and folded into `parameters`; never written again.
   */
  trackingParameters?: TrackingParameters | null;
  /** ISO 8601, when this record was written. */
  savedAt: string;
}

/**
 * A record written by an earlier build may carry a version-1 session file
 * (D68). It is migrated the same way a loaded file is — the id drawn once here
 * and kept by the next autosave — so a reload never loses work to a schema
 * change. A current record is returned as it is.
 */
export function migrateStoredSession(record: StoredSession): StoredSession {
  const file = record.file as SessionFile | SessionDocumentV1;
  if (file.schemaVersion === SESSION_SCHEMA_VERSION) return record;
  if (isLegacySessionDocument(file)) {
    return { ...record, file: migrateSessionDocument(file, newSessionId()) };
  }
  return record;
}
