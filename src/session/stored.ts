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
import type { SessionFile } from '../contracts/session.js';

/** `VideoDescriptor.id`, and the key of `SessionFile.analyses`. */
export type VideoId = string;

export interface StoredSession {
  file: SessionFile;
  /** Maze-step clicks spent per video. Not part of the session file contract. */
  mazeClicks: Record<VideoId, number>;
  /** ISO 8601, when this record was written. */
  savedAt: string;
}
