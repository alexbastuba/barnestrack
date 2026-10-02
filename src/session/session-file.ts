/**
 * Reading and writing the portable session file. D9, D27, D47, D68.
 *
 * The in-memory session *is* a `SessionFile`; saving is `JSON.stringify` and
 * loading is a parse plus a schema check. The schema version is checked
 * before anything else and reported in plain language, because the person
 * reading the message is a neuroscientist with a file from another machine,
 * not a developer with a stack trace. A version-1 file is accepted and
 * migrated in memory (`./migrate.js`); the next save writes version 2.
 */
import { SESSION_SCHEMA_VERSION, type SessionFile } from '../contracts/session.js';
import { isLegacySessionDocument, migrateSessionDocument } from './migrate.js';

export const SESSION_FILE_SUFFIX = '.barnestrack.json';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A fresh session id (D68): a version-4 UUID from the platform's random
 * source. Generated once, when a session is created or a version-1 file is
 * migrated, and never again for that session.
 */
export function newSessionId(): string {
  const source = globalThis.crypto;
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function createSessionFile(
  name: string,
  toolVersion: string,
  sessionId: string = newSessionId(),
): SessionFile {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    toolVersion,
    sessionId,
    name,
    reviewer: null,
    videos: [],
    mazeMap: null,
    parameters: null,
    analyses: {},
  };
}

export type ParsedSession = { ok: true; session: SessionFile } | { ok: false; message: string };

export function serializeSessionFile(session: SessionFile): string {
  return `${JSON.stringify(session, null, 2)}\n`;
}

/** Turns a session name into a safe download filename: `<name>.barnestrack.json`. */
export function sessionFileName(name: string): string {
  const base = name
    .replace(/\.barnestrack\.json$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base.length > 0 ? base.slice(0, 120) : 'session'}${SESSION_FILE_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSessionDocument(text: string): ParsedSession {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: 'That file is not valid JSON, so it cannot be a BarnesTrack session file.',
    };
  }
  if (!isRecord(value)) {
    return { ok: false, message: 'That file does not contain a BarnesTrack session.' };
  }

  if (isRecord(value['platform']) && isRecord(value['holes'])) {
    return {
      ok: false,
      message:
        'That is a BarnesTrack maze map, not a session file. Load it with "Import map" on the Maze step.',
    };
  }

  const version = value['schemaVersion'];
  if (typeof version !== 'number') {
    return {
      ok: false,
      message:
        'That file has no session schema version, so it is not a BarnesTrack session file. ' +
        'Choose a file whose name ends in .barnestrack.json.',
    };
  }
  const legacy = isLegacySessionDocument({ schemaVersion: version });
  if (version !== SESSION_SCHEMA_VERSION && !legacy) {
    return {
      ok: false,
      message:
        version > SESSION_SCHEMA_VERSION
          ? `That session file uses schema version ${version}; this build of BarnesTrack reads version ${SESSION_SCHEMA_VERSION}. Open it with a newer version of BarnesTrack.`
          : `That session file uses schema version ${version}; this build of BarnesTrack reads version ${SESSION_SCHEMA_VERSION}. It was written by an older version and cannot be read here.`,
    };
  }

  const missing = requiredFieldProblem(value, version);
  if (missing) return { ok: false, message: missing };

  if (legacy) {
    // D68: migrated in memory; the id is drawn once here and written by the next save
    return {
      ok: true,
      session: migrateSessionDocument(
        value as unknown as Parameters<typeof migrateSessionDocument>[0],
        newSessionId(),
      ),
    };
  }
  return { ok: true, session: value as unknown as SessionFile };
}

/** The map's hole count when the document carries a map with one; null when there is nothing to check against. */
function holeCountOf(mazeMap: unknown): number | null {
  if (!isRecord(mazeMap) || !isRecord(mazeMap['holes'])) return null;
  const n = mazeMap['holes']['n'];
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/** Names the first field that is missing or the wrong shape, in the user's words. */
function requiredFieldProblem(value: Record<string, unknown>, version: number): string | null {
  const complaint = (what: string) =>
    `That session file says it is schema version ${version}, but ${what}. It may have been edited by hand or truncated.`;

  if (typeof value['toolVersion'] !== 'string') return complaint('it records no tool version');
  if (typeof value['name'] !== 'string') return complaint('it has no session name');
  if (version >= 2) {
    const sessionId = value['sessionId'];
    if (typeof sessionId !== 'string') return complaint('it has no session id');
    if (!isSessionId(sessionId)) return complaint(`its session id "${sessionId}" is not a UUID`);
    const reviewer = value['reviewer'];
    if (reviewer !== null && typeof reviewer !== 'string') {
      return complaint('its reviewer is neither a name nor empty');
    }
  }
  if (!Array.isArray(value['videos'])) return complaint('its video list is missing');
  // a per-video target must be one of the map's holes, when there is a map to check against
  const holeCount = holeCountOf(value['mazeMap']);
  for (const [i, video] of (value['videos'] as unknown[]).entries()) {
    if (!isRecord(video) || typeof video['id'] !== 'string' || typeof video['filename'] !== 'string') {
      return complaint(`video ${i + 1} in its list has no id or filename`);
    }
    if (!isRecord(video['fingerprint']) || typeof video['fingerprint']['sha256'] !== 'string') {
      return complaint(`video ${i + 1} in its list has no content fingerprint`);
    }
    if (version >= 2) {
      const trialType = video['trialType'];
      if (trialType !== 'acquisition' && trialType !== 'probe') {
        return complaint(
          typeof trialType === 'string'
            ? `video ${i + 1} in its list has trial type "${trialType}", not acquisition or probe`
            : `video ${i + 1} in its list has no trial type (acquisition or probe)`,
        );
      }
      const targetHole = video['targetHole'];
      if (targetHole !== null && !(Number.isInteger(targetHole) && (targetHole as number) >= 0)) {
        return complaint(`video ${i + 1} in its list names a target hole that is not a hole number`);
      }
      if (typeof targetHole === 'number' && holeCount !== null && targetHole >= holeCount) {
        return complaint(
          `video ${i + 1} in its list names target hole ${targetHole}, but its maze map has ${holeCount} holes (0 to ${holeCount - 1})`,
        );
      }
    }
  }
  const mazeMap = value['mazeMap'];
  if (mazeMap !== null && !isRecord(mazeMap)) return complaint('its maze map is not a maze map');
  const parameters = value['parameters'];
  if (parameters !== null && !isRecord(parameters)) return complaint('its parameters are not a parameter set');
  const analyses = value['analyses'];
  if (!isRecord(analyses)) return complaint('its analyses section is missing');
  for (const [videoId, analysis] of Object.entries(analyses)) {
    if (!isRecord(analysis)) return complaint(`the analysis for ${videoId} is not an analysis`);
    const auto = analysis['auto'];
    if (!isRecord(auto) || !Array.isArray(auto['frames'])) {
      return complaint(`the analysis for ${videoId} has no tracked frames`);
    }
    const corrections = analysis['corrections'];
    if (!isRecord(corrections) || !Array.isArray(corrections['entries'])) {
      return complaint(`the analysis for ${videoId} has no corrections list`);
    }
    // `derived` is null until an analysis run computes it (D52), so its
    // absence is correct; anything that is neither null nor an object is not.
    const derived = analysis['derived'];
    if (derived !== null && derived !== undefined && !isRecord(derived)) {
      return complaint(`the analysis for ${videoId} has a derived layer that is not one`);
    }
  }
  return null;
}
