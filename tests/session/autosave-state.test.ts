import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/session/session-store.js';
import type { SessionStorage } from '../../src/session/storage.js';
import type { StoredSession } from '../../src/session/stored.js';
import { TOOL_VERSION } from './fixtures.js';

/**
 * A storage whose writes finish only when the test says so, the way a large
 * IndexedDB write outlives the autosave debounce.
 */
class HeldStorage implements SessionStorage {
  readonly writes: { name: string; finish: () => void }[] = [];

  load(): Promise<StoredSession | null> {
    return Promise.resolve(null);
  }

  save(session: StoredSession): Promise<void> {
    return new Promise((resolve) => {
      this.writes.push({ name: session.file.name, finish: resolve });
    });
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }
}

/** Lets the debounce timer fire and the save chain run up to its next await. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('autosave state with overlapping writes (D27)', () => {
  it('stays pending while a later write is still queued behind a finished one', async () => {
    const storage = new HeldStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });

    store.setName('first edit');
    await settle();
    expect(storage.writes.map((write) => write.name)).toEqual(['first edit']);

    // A second edit while the first write is still running: its write queues behind it.
    store.setName('second edit');
    await settle();
    expect(storage.writes).toHaveLength(1);

    storage.writes[0]!.finish();
    await settle();
    // The first write is down, but it holds the first edit only. A reload now
    // would lose the second, so the header must not say everything is saved.
    expect(storage.writes.map((write) => write.name)).toEqual(['first edit', 'second edit']);
    expect(store.autosaveState).toBe('pending');

    storage.writes[1]!.finish();
    await settle();
    expect(store.autosaveState).toBe('saved');
  });

  it('reads saved after a single write, as before', async () => {
    const storage = new HeldStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });

    store.setName('only edit');
    await settle();
    expect(store.autosaveState).toBe('pending');
    storage.writes[0]!.finish();
    await settle();
    expect(store.autosaveState).toBe('saved');
  });
});
