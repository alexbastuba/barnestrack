import { describe, expect, it } from 'vitest';
import { findByFingerprint } from '../../src/session/attach.js';
import { DEFAULT_SESSION_NAME, SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { fingerprint, fullSession, TOOL_VERSION, videoDescriptor } from './fixtures.js';

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
  it('starts as a valid, empty schema-1 session', () => {
    const { store } = newStore();
    expect(store.current.schemaVersion).toBe(1);
    expect(store.current.toolVersion).toBe(TOOL_VERSION);
    expect(store.current.name).toBe(DEFAULT_SESSION_NAME);
    expect(store.current.videos).toEqual([]);
    expect(store.current.mazeMap).toBeNull();
    expect(store.current.parameters).toBeNull();
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
