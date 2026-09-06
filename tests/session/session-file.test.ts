import { describe, expect, it } from 'vitest';
import { SESSION_SCHEMA_VERSION } from '../../src/contracts/session.js';
import {
  createSessionFile,
  parseSessionDocument,
  serializeSessionFile,
  sessionFileName,
} from '../../src/session/session-file.js';
import { fullSession, TOOL_VERSION } from './fixtures.js';

describe('serialize → parse round trip', () => {
  it('preserves every part of the contract', () => {
    const session = fullSession();
    const result = parseSessionDocument(serializeSessionFile(session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toEqual(session);
  });

  it('preserves a session that has no maze map and no parameters yet (D47)', () => {
    const session = createSessionFile('test53', TOOL_VERSION);
    const result = parseSessionDocument(serializeSessionFile(session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.mazeMap).toBeNull();
    expect(result.session.parameters).toBeNull();
    expect(result.session.analyses).toEqual({});
    expect(result.session).toEqual(session);
  });

  it('never writes an analyses entry for an untracked video', () => {
    const session = fullSession();
    expect(Object.keys(session.analyses)).toEqual(['vid_01', 'vid_03']);
    expect(session.videos.map((v) => v.id)).toContain('vid_02');
  });

  // D52: a video can be tracked long before it is analysed, and the honest
  // value for its derived layer is a null, not a fabricated one (D16).
  it('round-trips a tracked video whose derived layer is null', () => {
    const session = fullSession();
    const parsed = parseSessionDocument(serializeSessionFile(session));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.analyses['vid_03']?.derived).toBeNull();
    expect(parsed.session.analyses['vid_03']?.auto.frames).toHaveLength(2);
    expect(parsed.session.analyses['vid_01']?.derived).not.toBeNull();
  });
});

describe('schema version', () => {
  it('rejects a newer schema with a message naming both versions', () => {
    const doc = { ...fullSession(), schemaVersion: SESSION_SCHEMA_VERSION + 1 };
    const result = parseSessionDocument(JSON.stringify(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(`schema version ${SESSION_SCHEMA_VERSION + 1}`);
    expect(result.message).toContain(`version ${SESSION_SCHEMA_VERSION}`);
    expect(result.message).toContain('newer version of BarnesTrack');
  });

  it('rejects an older schema with a message', () => {
    const result = parseSessionDocument(JSON.stringify({ ...fullSession(), schemaVersion: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('older version');
  });

  it('rejects a file that is not a session at all', () => {
    expect(parseSessionDocument('not json').ok).toBe(false);
    expect(parseSessionDocument('[1, 2, 3]').ok).toBe(false);
    const noVersion = parseSessionDocument('{"hello": "world"}');
    expect(noVersion.ok).toBe(false);
    if (noVersion.ok) return;
    expect(noVersion.message).toContain('.barnestrack.json');
  });

  it('rejects a truncated schema-1 file, naming what is missing', () => {
    const session = fullSession();
    const broken = { ...session, videos: [{ id: 'vid_01' }] };
    const result = parseSessionDocument(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('video 1');
  });
});

describe('sessionFileName', () => {
  it('appends the suffix once and keeps the name readable', () => {
    expect(sessionFileName('cohort3 day1')).toBe('cohort3 day1.barnestrack.json');
    expect(sessionFileName('cohort3.barnestrack.json')).toBe('cohort3.barnestrack.json');
  });

  it('replaces path separators and falls back for an empty name', () => {
    expect(sessionFileName('a/b:c')).toBe('a-b-c.barnestrack.json');
    expect(sessionFileName('   ')).toBe('session.barnestrack.json');
  });
});
