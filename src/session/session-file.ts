/**
 * Reading and writing the portable session file. D9, D27, D47.
 *
 * The in-memory session *is* a `SessionFile`; saving is `JSON.stringify` and
 * loading is a parse plus a schema check. The schema version is checked
 * before anything else and reported in plain language, because the person
 * reading the message is a neuroscientist with a file from another machine,
 * not a developer with a stack trace.
 */
import { SESSION_SCHEMA_VERSION, type SessionFile } from '../contracts/session.js';

export const SESSION_FILE_SUFFIX = '.barnestrack.json';

export function createSessionFile(name: string, toolVersion: string): SessionFile {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    toolVersion,
    name,
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
  if (version !== SESSION_SCHEMA_VERSION) {
    return {
      ok: false,
      message:
        version > SESSION_SCHEMA_VERSION
          ? `That session file uses schema version ${version}; this build of BarnesTrack reads version ${SESSION_SCHEMA_VERSION}. Open it with a newer version of BarnesTrack.`
          : `That session file uses schema version ${version}; this build of BarnesTrack reads version ${SESSION_SCHEMA_VERSION}. It was written by an older version and cannot be read here.`,
    };
  }

  const missing = requiredFieldProblem(value);
  if (missing) return { ok: false, message: missing };

  return { ok: true, session: value as unknown as SessionFile };
}

/** Names the first field that is missing or the wrong shape, in the user's words. */
function requiredFieldProblem(value: Record<string, unknown>): string | null {
  const complaint = (what: string) =>
    `That session file says it is schema version ${SESSION_SCHEMA_VERSION}, but ${what}. It may have been edited by hand or truncated.`;

  if (typeof value['toolVersion'] !== 'string') return complaint('it records no tool version');
  if (typeof value['name'] !== 'string') return complaint('it has no session name');
  if (!Array.isArray(value['videos'])) return complaint('its video list is missing');
  for (const [i, video] of (value['videos'] as unknown[]).entries()) {
    if (!isRecord(video) || typeof video['id'] !== 'string' || typeof video['filename'] !== 'string') {
      return complaint(`video ${i + 1} in its list has no id or filename`);
    }
    if (!isRecord(video['fingerprint']) || typeof video['fingerprint']['sha256'] !== 'string') {
      return complaint(`video ${i + 1} in its list has no content fingerprint`);
    }
  }
  const mazeMap = value['mazeMap'];
  if (mazeMap !== null && !isRecord(mazeMap)) return complaint('its maze map is not a maze map');
  const parameters = value['parameters'];
  if (parameters !== null && !isRecord(parameters)) return complaint('its parameters are not a parameter set');
  if (!isRecord(value['analyses'])) return complaint('its analyses section is missing');
  return null;
}
