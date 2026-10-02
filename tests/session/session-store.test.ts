import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { findByFingerprint } from '../../src/session/attach.js';
import { setPoint } from '../../src/session/corrections.js';
import { isSessionId } from '../../src/session/session-file.js';
import { DEFAULT_SESSION_NAME, SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import {
  fingerprint,
  fullSession,
  legacySessionDocument,
  TOOL_VERSION,
  videoDescriptor,
} from './fixtures.js';

function newStore(): { store: SessionStore; storage: MemorySessionStorage } {
  const storage = new MemorySessionStorage();
  return { store: new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 }), storage };
}

const test50 = { filename: 'test50.mp4', fingerprint: fingerprint(), referenceResolution: { width: 640, height: 480 } };
const test51 = {
  filename: 'test51.mp4',
  fingerprint: fingerprint({ byteLength: 455_680, frameCount: 741, sha256: 'b'.repeat(64) }),
  referenceResolution: { width: 720, height: 480 },
};

describe('SessionStore', () => {
  it('starts as a valid, empty schema-2 session with a fresh id and no reviewer', () => {
    const { store } = newStore();
    expect(store.current.schemaVersion).toBe(2);
    expect(isSessionId(store.current.sessionId)).toBe(true);
    expect(store.current.reviewer).toBeNull();
    expect(store.current.toolVersion).toBe(TOOL_VERSION);
    expect(store.current.name).toBe(DEFAULT_SESSION_NAME);
    expect(store.current.videos).toEqual([]);
    expect(store.current.mazeMap).toBeNull();
    expect(store.current.parameters).toBeNull();
  });

  it('adds a video as an acquisition trial measured against the map’s target (D68)', () => {
    const { store } = newStore();
    const { descriptor } = store.addVideo(test50);
    expect(descriptor.trialType).toBe('acquisition');
    expect(descriptor.targetHole).toBeNull();
  });

  it('stamps the session reviewer onto the corrections a write adds or re-makes, and leaves the rest alone (D68)', () => {
    const { store } = newStore();
    store.replaceSession(fullSession());
    const videoId = 'vid_01';
    const before = store.analysisFor(videoId)!.corrections.entries;
    expect(before[0]!.reviewer).toBe('A. Reviewer');

    store.setReviewer('  B. Reviewer ');
    expect(store.current.reviewer).toBe('B. Reviewer');
    const added = setPoint(
      store.analysisFor(videoId)!.corrections,
      5,
      'centroid',
      { x: 1, y: 2, confidence: 1, valid: true },
      { id: 'corr_02', timestamp: '2026-10-01T10:00:00.000Z' },
    );
    store.setCorrections(videoId, added);
    const after = store.analysisFor(videoId)!.corrections.entries;
    expect(after.find((e) => e.id === 'corr_01')!.reviewer).toBe('A. Reviewer');
    expect(after.find((e) => e.id === 'corr_02')!.reviewer).toBe('B. Reviewer');

    // re-placing the first point re-makes its entry: the new write is the new reviewer's
    store.setCorrections(
      videoId,
      setPoint(
        store.analysisFor(videoId)!.corrections,
        1,
        'nose',
        { x: 3, y: 4, confidence: 1, valid: true },
        { id: 'ignored', timestamp: '2026-10-01T10:01:00.000Z' },
      ),
    );
    expect(store.analysisFor(videoId)!.corrections.entries.find((e) => e.id === 'corr_01')!.reviewer).toBe('B. Reviewer');

    // with no reviewer named, a new entry says so explicitly
    store.setReviewer('');
    expect(store.current.reviewer).toBeNull();
    store.setCorrections(
      videoId,
      setPoint(
        store.analysisFor(videoId)!.corrections,
        9,
        'nose',
        { x: 3, y: 4, confidence: 1, valid: true },
        { id: 'corr_03', timestamp: '2026-10-01T10:02:00.000Z' },
      ),
    );
    expect(store.analysisFor(videoId)!.corrections.entries.find((e) => e.id === 'corr_03')!.reviewer).toBeNull();
  });

  it('drops the derived cache when a video’s trial type or target hole changes (D68)', () => {
    const { store } = newStore();
    store.replaceSession(fullSession());
    const layer = fullSession().analyses['vid_01']!.derived;
    store.setDerivedLayer('vid_01', layer);
    expect(store.analysisFor('vid_01')!.derived).not.toBeNull();
    store.setTrialType('vid_01', 'probe');
    expect(store.videoById('vid_01')!.trialType).toBe('probe');
    expect(store.analysisFor('vid_01')!.derived).toBeNull();

    store.setDerivedLayer('vid_01', layer);
    store.setTargetHole('vid_01', 4);
    expect(store.videoById('vid_01')!.targetHole).toBe(4);
    expect(store.analysisFor('vid_01')!.derived).toBeNull();
  });

  it('restores a version-1 autosave record as a version-2 session (D68)', async () => {
    const { store, storage } = newStore();
    await storage.save({
      file: legacySessionDocument() as unknown as SessionFile,
      draftMazeMap: null,
      mazeClicks: {},
      parameters: null,
      savedAt: '2026-09-30T10:00:00.000Z',
    });
    expect(await store.restore()).toBe(true);
    expect(store.current.schemaVersion).toBe(2);
    expect(isSessionId(store.current.sessionId)).toBe(true);
    expect(store.current.reviewer).toBeNull();
    expect(store.current.videos.every((v) => v.trialType === 'acquisition' && v.targetHole === null)).toBe(true);
    expect(store.current.name).toBe('cohort3 day1');
    // the next autosave writes version 2 with the same id
    const id = store.current.sessionId;
    store.setName('renamed');
    await store.flush();
    const saved = await storage.load();
    expect(saved!.file.schemaVersion).toBe(2);
    expect(saved!.file.sessionId).toBe(id);
  });

  it('names the session after the first video, and never overwrites a user name', () => {
    const { store } = newStore();
    store.addVideo(test50);
    expect(store.current.name).toBe('test50');
    store.addVideo(test51);
    expect(store.current.name).toBe('test50');

    const { store: other } = newStore();
    other.setName('cohort 3');
    other.addVideo(test50);
    expect(other.current.name).toBe('cohort 3');
  });

  it('keeps load order and gives each video a distinct id', () => {
    const { store } = newStore();
    store.addVideo(test50);
    store.addVideo(test51);
    expect(store.videos.map((v) => v.filename)).toEqual(['test50.mp4', 'test51.mp4']);
    expect(store.videos.map((v) => v.id)).toEqual(['vid_01', 'vid_02']);
  });

  it('reports duplicate content instead of adding it twice', () => {
    const { store } = newStore();
    const first = store.addVideo(test50);
    const again = store.addVideo({ ...test50, filename: 'a-copy-of-test50.mp4' });
    expect(again.duplicateOf?.id).toBe(first.descriptor.id);
    expect(store.videos).toHaveLength(1);
    expect(store.videos[0]?.filename).toBe('test50.mp4');
  });

  it('autosaves and restores through storage, click counts included', async () => {
    const { store, storage } = newStore();
    const { descriptor } = store.addVideo(test50);
    store.setMetadata(descriptor.id, { animal: '07', day: '1' });
    store.setMazeMap(fullSession().mazeMap);
    store.countMazeClick(descriptor.id, 3);
    await store.flush();

    const restored = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    expect(await restored.restore()).toBe(true);
    expect(restored.current.videos[0]?.metadata).toEqual({ animal: '07', day: '1' });
    expect(restored.current.mazeMap?.target.holeIndex).toBe(7);
    expect(restored.mazeClickCount(descriptor.id)).toBe(3);
    expect(restored.isAttached(descriptor.id)).toBe(false);
  });

  it('restores nothing when storage is empty', async () => {
    const { store } = newStore();
    expect(await store.restore()).toBe(false);
  });

  it('debounces: many edits in one burst write once', async () => {
    const storage = new MemorySessionStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 50 });
    const { descriptor } = store.addVideo(test50);
    for (let i = 0; i < 10; i++) store.countMazeClick(descriptor.id);
    await store.flush();
    expect(storage.saveCount).toBe(1);
    expect(store.mazeClickCount(descriptor.id)).toBe(10);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const { store } = newStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.addVideo(test50);
    store.setName('cohort 3');
    expect(calls).toBe(2);
    off();
    store.setName('cohort 4');
    expect(calls).toBe(2);
  });

  it('reset clears memory and the stored record', async () => {
    const { store, storage } = newStore();
    store.addVideo(test50);
    await store.flush();
    expect(await storage.load()).not.toBeNull();

    await store.reset();
    expect(store.videos).toEqual([]);
    expect(store.current.name).toBe(DEFAULT_SESSION_NAME);
    expect(await storage.load()).toBeNull();
  });

  it('removing a video drops its analysis and its click count', () => {
    const { store } = newStore();
    const { descriptor } = store.addVideo(test50);
    store.countMazeClick(descriptor.id, 4);
    store.removeVideo(descriptor.id);
    expect(store.videos).toEqual([]);
    expect(store.mazeClickCount(descriptor.id)).toBe(0);
  });

  it('replaceSession adopts a loaded file and drops click counts, which the file does not carry', () => {
    const { store } = newStore();
    const { descriptor } = store.addVideo(test50);
    store.countMazeClick(descriptor.id, 5);
    store.replaceSession(fullSession());
    expect(store.current.name).toBe('cohort3 day1');
    expect(store.videos).toHaveLength(3);
    expect(store.mazeClickCount('vid_01')).toBe(0);
  });
});

describe('parameters (D51, D55)', () => {
  it('are the defaults until edited, and the working set is remembered across a reload but not stamped', async () => {
    const { store, storage } = newStore();
    store.addVideo(test50);
    expect(store.parameters).toEqual(DEFAULT_PARAMETERS);
    expect(store.current.parameters).toBeNull();

    store.setParameters({ ...DEFAULT_PARAMETERS, trialCutoff_s: 120 });
    expect(store.parameters.trialCutoff_s).toBe(120);
    expect(store.current.parameters).toBeNull();
    await store.flush();

    const restored = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    await restored.restore();
    expect(restored.parameters.trialCutoff_s).toBe(120);
    expect(restored.current.parameters).toBeNull();
  });

  it('ensureParameters stamps the working set once; later edits go into the session file', () => {
    const { store } = newStore();
    store.addVideo(test50);
    store.setTrackingParameters({ ...DEFAULT_PARAMETERS.tracking, minBlobArea_cm2: 6.5 });
    const stamped = store.ensureParameters();
    expect(store.current.parameters).toBe(stamped);
    expect(stamped.tracking.minBlobArea_cm2).toBe(6.5);
    expect(store.ensureParameters()).toBe(stamped);

    store.setParameters({ ...stamped, noseConfidenceCutoff: 0.6 });
    expect(store.current.parameters?.noseConfidenceCutoff).toBe(0.6);
    expect(store.current.parameters?.tracking.minBlobArea_cm2).toBe(6.5);
    expect(store.trackingParameters.minBlobArea_cm2).toBe(6.5);
  });

  it('refuses an invalid set, so nothing invalid is ever hashed', () => {
    const { store } = newStore();
    expect(() =>
      store.setParameters({ ...DEFAULT_PARAMETERS, noseConfidenceCutoff: 2 }),
    ).toThrow('noseConfidenceCutoff');
    expect(store.parameters.noseConfidenceCutoff).toBe(0.5);
  });

  it('folds a record written with only a tracking block into the working set', async () => {
    const storage = new MemorySessionStorage();
    const { store } = newStore();
    store.addVideo(test50);
    await store.flush();
    const legacy = { ...store.toStoredSession(), parameters: null };
    legacy.trackingParameters = { ...DEFAULT_PARAMETERS.tracking, minBlobArea_cm2: 7 };
    await storage.save(legacy);

    const restored = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    expect(await restored.restore()).toBe(true);
    expect(restored.trackingParameters.minBlobArea_cm2).toBe(7);
    expect(restored.parameters.trialCutoff_s).toBe(DEFAULT_PARAMETERS.trialCutoff_s);
  });

  it('sets corrections and the derived cache per video without touching the automatic layer', () => {
    const { store } = newStore();
    store.replaceSession(fullSession());
    const before = store.analysisFor('vid_01')!;
    store.setCorrections('vid_01', { entries: [] });
    expect(store.analysisFor('vid_01')!.auto).toBe(before.auto);
    expect(store.analysisFor('vid_01')!.corrections.entries).toEqual([]);
    store.setDerivedLayer('vid_01', null);
    expect(store.analysisFor('vid_01')!.derived).toBeNull();
    expect(store.analysisFor('vid_01')!.auto).toBe(before.auto);
    store.setCorrections('vid_99', { entries: [] });
    expect(store.analysisFor('vid_99')).toBeUndefined();
  });
});

describe('an unfinished maze map (D14, D47)', () => {
  it('is remembered in this browser but kept out of the session file', async () => {
    const { store, storage } = newStore();
    store.addVideo(test50);
    const draft = { ...fullSession().mazeMap!, calibration: { platformDiameter_cm: 0 } };
    store.setMazeMap(draft);

    expect(store.current.mazeMap).toBeNull();
    expect(store.workingMazeMap?.platform.r).toBe(draft.platform.r);
    await store.flush();

    const restored = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    await restored.restore();
    expect(restored.current.mazeMap).toBeNull();
    expect(restored.workingMazeMap?.platform.r).toBe(draft.platform.r);
  });

  it('is published the moment the platform diameter arrives, and withdrawn if it is removed', () => {
    const { store } = newStore();
    store.addVideo(test50);
    const map = fullSession().mazeMap!;
    store.setMazeMap({ ...map, calibration: { platformDiameter_cm: 0 } });
    expect(store.current.mazeMap).toBeNull();

    store.setMazeMap(map);
    expect(store.current.mazeMap?.calibration.platformDiameter_cm).toBe(92);
    expect(store.workingMazeMap).toBe(store.current.mazeMap);

    store.setMazeMap({ ...map, calibration: { platformDiameter_cm: 0 } });
    expect(store.current.mazeMap).toBeNull();
  });
});

describe('epoch and restore', () => {
  it('changes on every whole-session replacement so views can drop cached state', async () => {
    const { store, storage } = newStore();
    const start = store.epoch;
    store.addVideo(test50);
    expect(store.epoch).toBe(start);

    store.replaceSession(fullSession());
    expect(store.epoch).toBe(start + 1);
    await store.reset();
    expect(store.epoch).toBe(start + 2);

    store.addVideo(test51);
    await store.flush();
    const other = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    expect(await other.restore()).toBe(true);
    expect(other.epoch).toBe(1);
  });

  it('refuses to restore over work already in memory', async () => {
    const { store, storage } = newStore();
    store.addVideo(test50);
    await store.flush();

    const racing = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    racing.addVideo(test51);
    expect(await racing.restore()).toBe(false);
    expect(racing.videos.map((v) => v.filename)).toEqual(['test51.mp4']);
  });
});

describe('autosave state', () => {
  it('reports pending the moment something changes, and saved once it lands', async () => {
    const storage = new MemorySessionStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 5 });
    expect(store.autosaveState).toBe('saved');

    let sawPending = false;
    store.subscribe(() => {
      if (store.autosaveState === 'pending') sawPending = true;
    });
    store.addVideo(test50);
    expect(sawPending).toBe(true);
    expect(store.autosaveState).toBe('pending');

    await store.flush();
    expect(store.autosaveState).toBe('saved');
  });
});

describe('re-attach by fingerprint (D27)', () => {
  it('matches the same content under a different filename', () => {
    const { store } = newStore();
    store.addVideo(test51);
    const renamed = { ...fingerprint({ byteLength: 455_680, frameCount: 741, sha256: 'b'.repeat(64) }) };
    expect(store.matchFingerprint(renamed)?.filename).toBe('test51.mp4');
  });

  it('refuses a different file that carries a session filename', () => {
    const { store } = newStore();
    store.addVideo(test51);
    const impostor = fingerprint({ byteLength: 455_680, frameCount: 741, sha256: 'c'.repeat(64) });
    expect(store.matchFingerprint(impostor)).toBeUndefined();
  });

  it('rejects on byte length before the hash is even equal', () => {
    const videos = [videoDescriptor()];
    expect(findByFingerprint(videos, fingerprint({ byteLength: 1 }))).toBeUndefined();
    expect(findByFingerprint(videos, fingerprint())?.id).toBe('vid_01');
  });
});
