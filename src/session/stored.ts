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
import type { TrackingParameters } from '../contracts/parameters.js';
import type { SessionFile } from '../contracts/session.js';

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
   * The tracking parameters in force for the next run, or null while they are
   * still the defaults. D51 stamps `SessionFile.parameters` at the first
   * *analysis* run, not the first tracking run, so until the analysis engine
   * lands there is nowhere in the contract for an edited tracking parameter to
   * live. Remembered here so a reload does not silently revert a threshold the
   * user changed; the auto layer's `parametersHash` still records which
   * parameters produced it.
   */
  trackingParameters: TrackingParameters | null;
  /** ISO 8601, when this record was written. */
  savedAt: string;
}
