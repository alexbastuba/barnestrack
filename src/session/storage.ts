/**
 * Where the autosave record lives. D27.
 *
 * One record, one key: a session is "the current session", replaced in place
 * on every change. The in-memory implementation is what the unit tests use;
 * the IndexedDB one is what the page uses.
 */
import type { StoredSession } from './stored.js';

export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export class MemorySessionStorage implements SessionStorage {
  private record: StoredSession | null = null;
  /** How many times `save` has been called; lets a test assert the debounce. */
  saveCount = 0;

  load(): Promise<StoredSession | null> {
    return Promise.resolve(this.record === null ? null : structuredClone(this.record));
  }

  save(session: StoredSession): Promise<void> {
    this.saveCount++;
    this.record = structuredClone(session);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.record = null;
    return Promise.resolve();
  }
}

const DB_NAME = 'barnestrack';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const CURRENT_KEY = 'current';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbSessionStorage implements SessionStorage {
  private db: Promise<IDBDatabase> | null = null;

  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab'));
    });
    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, mode);
    const result = promisify(body(tx.objectStore(STORE_NAME)));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => {
        result.then(resolve, reject);
      };
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  }

  async load(): Promise<StoredSession | null> {
    const record = await this.run<StoredSession | undefined>('readonly', (store) =>
      store.get(CURRENT_KEY) as IDBRequest<StoredSession | undefined>,
    );
    return record ?? null;
  }

  async save(session: StoredSession): Promise<void> {
    await this.run('readwrite', (store) => store.put(session, CURRENT_KEY));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.delete(CURRENT_KEY));
  }
}
