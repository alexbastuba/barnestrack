import { describe, expect, it } from 'vitest';
import { SESSION_SCHEMA_VERSION, type EventCorrection } from '../../src/contracts/session.js';
import { confirmedEventIds } from '../../src/session/corrections.js';
import {
  createSessionFile,
  isSessionId,
  parseSessionDocument,
  serializeSessionFile,
  sessionFileName,
} from '../../src/session/session-file.js';
import { fullSession, legacySessionDocument, SESSION_ID, TOOL_VERSION } from './fixtures.js';

describe('serialize → parse round trip', () => {
  it('preserves every part of the contract', () => {
    const session = fullSession();
    const result = parseSessionDocument(serializeSessionFile(session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toEqual(session);
  });

  it('round-trips a confirmed event correction, save → load → save', () => {
    const session = fullSession();
    const confirmation: EventCorrection = {
      kind: 'event',
      id: 'corr_confirm_01',
      timestamp: '2026-09-08T09:15:00.000Z',
      source: 'user',
      action: 'edit',
      eventId: 'auto-investigation-h7-f120',
      holeIndex: 7,
      startFrame: 120,
      endFrame: 168,
      confirmed: true,
    };
    const withConfirmation = {
      ...session,
      analyses: {
        ...session.analyses,
        vid_01: {
          ...session.analyses['vid_01']!,
          corrections: { entries: [...session.analyses['vid_01']!.corrections.entries, confirmation] },
        },
      },
    };

    const once = parseSessionDocument(serializeSessionFile(withConfirmation));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const loaded = once.session.analyses['vid_01']!.corrections.entries.at(-1) as EventCorrection;
    expect(loaded.confirmed).toBe(true);
    expect(confirmedEventIds(once.session.analyses['vid_01']!.corrections)).toEqual(
      new Set(['auto-investigation-h7-f120']),
    );
    // And again: the second write is byte-identical to the first, so the flag
    // survives a session opened and saved without being touched.
    expect(serializeSessionFile(once.session)).toBe(serializeSessionFile(withConfirmation));
  });

  it('reads an event correction written without the flag as an edit, not a confirmation', () => {
    // The field is additive within schema version 1 (D63's precedent): a file
    // written before it existed still loads, and reads as what it is.
    const session = fullSession();
    const edit: EventCorrection = {
      kind: 'event',
      id: 'corr_edit_01',
      timestamp: '2026-09-08T09:16:00.000Z',
      source: 'user',
      action: 'edit',
      eventId: 'auto-investigation-h7-f120',
      holeIndex: 8,
    };
    const withEdit = {
      ...session,
      analyses: {
        ...session.analyses,
        vid_01: {
          ...session.analyses['vid_01']!,
          corrections: { entries: [...session.analyses['vid_01']!.corrections.entries, edit] },
        },
      },
    };
    const result = parseSessionDocument(serializeSessionFile(withEdit));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = result.session.analyses['vid_01']!.corrections.entries;
    expect((entries.at(-1) as EventCorrection).confirmed).toBeUndefined();
    expect(confirmedEventIds(result.session.analyses['vid_01']!.corrections).size).toBe(0);
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

describe('schema version 2 (D68)', () => {
  it('writes and reads the session id, the reviewer, each video’s trial type and target hole', () => {
    const session = fullSession();
    expect(session.sessionId).toBe(SESSION_ID);
    const result = parseSessionDocument(serializeSessionFile(session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.sessionId).toBe(SESSION_ID);
    expect(result.session.reviewer).toBe('A. Reviewer');
    expect(result.session.videos[0]!.trialType).toBe('acquisition');
    expect(result.session.videos[0]!.targetHole).toBeNull();
    const probe = {
      ...session,
      videos: session.videos.map((video, i) =>
        i === 1 ? { ...video, trialType: 'probe' as const, targetHole: 12 } : video,
      ),
    };
    const again = parseSessionDocument(serializeSessionFile(probe));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.session.videos[1]).toMatchObject({ trialType: 'probe', targetHole: 12 });
  });

  it('gives a new session a fresh id and no reviewer', () => {
    const a = createSessionFile('one', TOOL_VERSION);
    const b = createSessionFile('two', TOOL_VERSION);
    expect(isSessionId(a.sessionId)).toBe(true);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.reviewer).toBeNull();
    expect(a.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
  });

  it('migrates a version-1 document in memory and writes it back as version 2', () => {
    const result = parseSessionDocument(JSON.stringify(legacySessionDocument()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.session;
    expect(session.schemaVersion).toBe(2);
    expect(isSessionId(session.sessionId)).toBe(true);
    expect(session.reviewer).toBeNull();
    expect(session.videos.map((v) => [v.trialType, v.targetHole])).toEqual([
      ['acquisition', null],
      ['acquisition', null],
      ['acquisition', null],
    ]);
    // the automatic layer and the corrections survive; the version-1 derived cache does not
    expect(session.analyses['vid_01']!.auto).toEqual(fullSession().analyses['vid_01']!.auto);
    expect(session.analyses['vid_01']!.corrections.entries[0]).toMatchObject({ id: 'corr_01', reviewer: null });
    expect(session.analyses['vid_01']!.derived).toBeNull();
    expect(serializeSessionFile(session)).toContain('"schemaVersion": 2');
  });

  it('rejects a version-2 document that lacks a version-2 field, naming it', () => {
    const noId = { ...fullSession(), sessionId: 'not-a-uuid' };
    const a = parseSessionDocument(JSON.stringify(noId));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.message).toContain('session id');

    const session = fullSession();
    const noType = {
      ...session,
      videos: session.videos.map((video, i) => {
        if (i !== 1) return video;
        const { trialType: _dropped, ...rest } = video;
        void _dropped;
        return rest;
      }),
    };
    const b = parseSessionDocument(JSON.stringify(noType));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.message).toContain('video 2');

    const badType = {
      ...session,
      videos: session.videos.map((video, i) => (i === 0 ? { ...video, trialType: 'foo' } : video)),
    };
    const c = parseSessionDocument(JSON.stringify(badType));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.message).toContain('trial type');

    const badHole = {
      ...session,
      videos: session.videos.map((video, i) => (i === 0 ? { ...video, targetHole: 2.5 } : video)),
    };
    const d = parseSessionDocument(JSON.stringify(badHole));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toContain('target hole');
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
