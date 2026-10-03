/**
 * Loading a session written under an earlier schema (D68).
 *
 * A version-1 file is migrated in memory and the next save writes version 2:
 * `sessionId` is generated once by the caller and kept from then on,
 * `reviewer` is null, every video is an acquisition trial with the map's
 * target, every correction carries `reviewer: null`, and the derived caches
 * are dropped — they have the version-1 shape and are recomputed from
 * `auto ⊕ corrections` on load like any derived layer (D9, D52). Nothing
 * automatic and nothing human-made is lost or changed.
 */
import {
  SESSION_SCHEMA_VERSION,
  type SessionFile,
  type VideoAnalysis,
  type VideoDescriptor,
} from '../contracts/session.js';

/** The schema versions this build can read and migrate forward. */
export const LEGACY_SESSION_SCHEMA_VERSIONS: readonly number[] = [1];

/** A version-1 document as parsed: the version-2 fields are absent, and the derived caches are of the version-1 shape. */
export interface SessionDocumentV1 {
  schemaVersion: 1;
  toolVersion: string;
  name: string;
  videos: Omit<VideoDescriptor, 'trialType' | 'targetHole'>[];
  mazeMap: SessionFile['mazeMap'];
  parameters: SessionFile['parameters'];
  analyses: Record<string, Pick<VideoAnalysis, 'auto' | 'corrections'> & { derived?: unknown }>;
}

export function isLegacySessionDocument(value: { schemaVersion: number }): value is SessionDocumentV1 {
  return LEGACY_SESSION_SCHEMA_VERSIONS.includes(value.schemaVersion);
}

/** The version-1 document as a version-2 session. Pure: the id is supplied, not drawn here. */
export function migrateSessionDocument(doc: SessionDocumentV1, sessionId: string): SessionFile {
  const analyses: SessionFile['analyses'] = {};
  for (const [videoId, analysis] of Object.entries(doc.analyses)) {
    analyses[videoId] = {
      auto: analysis.auto,
      corrections: {
        entries: analysis.corrections.entries.map((entry) => ({
          ...entry,
          reviewer: entry.reviewer ?? null,
        })),
      },
      // a version-1 cache has the version-1 shape; the app recomputes every derived layer on load
      derived: null,
    };
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    toolVersion: doc.toolVersion,
    sessionId,
    name: doc.name,
    reviewer: null,
    videos: doc.videos.map((video) => ({ ...video, trialType: 'acquisition', targetHole: null })),
    mazeMap: doc.mazeMap,
    parameters: doc.parameters,
    analyses,
  };
}
