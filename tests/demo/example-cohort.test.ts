/**
 * The "Load example cohort" loader (D33). Runs against the real committed
 * bundle through an injected fetch, so the gzip path, the parser and the store
 * adoption are all the production ones — only the network is faked.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import {
  EXAMPLE_SESSION_NAME,
  decodeBundleBytes,
  exampleStillUrl,
  fetchExampleSession,
  isSameExampleCohort,
  loadExampleCohort,
  type FetchLike,
} from '../../src/demo/example-cohort.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = readFileSync(join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz'));
const BASE = 'http://localhost/';
const TOOL_VERSION = 'barnestrack v0.1.0 (test)';

/** Serves the real bundle bytes; `body` overrides them for the failure cases. */
function fakeFetch(body: Uint8Array | null = null, status = 200): FetchLike {
  return () =>
    Promise.resolve(
      new Response(status === 200 ? ((body ?? new Uint8Array(BUNDLE)) as BodyInit) : null, {
        status,
      }),
    );
}

function newStore(): SessionStore {
  return new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
}

function options(fetchImpl: FetchLike = fakeFetch()) {
  return { fetchImpl, baseUrl: BASE };
}

describe('decodeBundleBytes', () => {
  it('gunzips gzip bytes', async () => {
    const text = await decodeBundleBytes(new Uint8Array(gzipSync(Buffer.from('{"a":1}'))));
    expect(text).toBe('{"a":1}');
  });

  it('passes plain bytes through, for a host that already decoded the response', async () => {
    const text = await decodeBundleBytes(new TextEncoder().encode('{"a":1}'));
    expect(text).toBe('{"a":1}');
  });

  it('round-trips the committed bundle', async () => {
    const text = await decodeBundleBytes(new Uint8Array(BUNDLE));
    expect(JSON.parse(text)).toMatchObject({ name: EXAMPLE_SESSION_NAME });
  });
});

describe('fetchExampleSession', () => {
  it('returns a validated session', async () => {
    const session = await fetchExampleSession(options());
    expect(session.name).toBe(EXAMPLE_SESSION_NAME);
    expect(session.videos).toHaveLength(3);
  });

  it('reports an unreachable bundle in a sentence, not a stack', async () => {
    const boom: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(fetchExampleSession(options(boom))).rejects.toThrow(
      'Could not read the bundled example cohort from this page.',
    );
  });

  it('reports a non-200 with its status', async () => {
    await expect(fetchExampleSession(options(fakeFetch(null, 404)))).rejects.toThrow('HTTP 404');
  });

  it('reports a corrupt bundle through the session parser', async () => {
    const rubbish = new Uint8Array(gzipSync(Buffer.from('{"schemaVersion":99}')));
    await expect(fetchExampleSession(options(fakeFetch(rubbish)))).rejects.toThrow(
      /example cohort could not be read/,
    );
  });
});

describe('loadExampleCohort', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = newStore();
  });

  it('loads three videos, none of them attached', async () => {
    const result = await loadExampleCohort(store, options());

    expect(result.kind).toBe('loaded');
    expect(store.current.name).toBe(EXAMPLE_SESSION_NAME);
    expect(store.videos).toHaveLength(3);
    for (const video of store.videos) {
      expect(store.isAttached(video.id), `${video.filename} should not be attached`).toBe(false);
    }
  });

  it('brings the maze, parameters and an analysis per video, so results can render', async () => {
    await loadExampleCohort(store, options());

    expect(store.current.mazeMap).not.toBeNull();
    expect(store.current.parameters).not.toBeNull();
    for (const video of store.videos) {
      expect(store.analysisFor(video.id)).toBeDefined();
    }
  });

  it('is idempotent: a second load changes nothing and does not bump the epoch', async () => {
    await loadExampleCohort(store, options());
    const epoch = store.epoch;

    const again = await loadExampleCohort(store, options());

    expect(again.kind).toBe('already-loaded');
    expect(store.epoch).toBe(epoch);
    expect(store.videos).toHaveLength(3);
  });

  it('asks before replacing a session that already holds videos', async () => {
    store.addVideo({
      filename: 'mine.mp4',
      fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'a'.repeat(64) },
      referenceResolution: { width: 640, height: 480 },
    });
    const confirmReplace = vi.fn(() => false);

    const result = await loadExampleCohort(store, { ...options(), confirmReplace });

    expect(confirmReplace).toHaveBeenCalledOnce();
    expect(result.kind).toBe('cancelled');
    expect(store.videos.map((video) => video.filename)).toEqual(['mine.mp4']);
  });

  it('replaces when the confirmation is accepted', async () => {
    store.addVideo({
      filename: 'mine.mp4',
      fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'a'.repeat(64) },
      referenceResolution: { width: 640, height: 480 },
    });

    const result = await loadExampleCohort(store, { ...options(), confirmReplace: () => true });

    expect(result.kind).toBe('loaded');
    expect(store.videos).toHaveLength(3);
  });

  it('refuses rather than overwriting when the caller offers no way to ask', async () => {
    store.addVideo({
      filename: 'mine.mp4',
      fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'a'.repeat(64) },
      referenceResolution: { width: 640, height: 480 },
    });

    // No confirmReplace: a caller with no way to ask cannot consent for the user.
    const result = await loadExampleCohort(store, options());

    expect(result.kind).toBe('cancelled');
    expect(store.videos.map((video) => video.filename)).toEqual(['mine.mp4']);
  });

  it('does not ask when the session is empty — there is nothing to lose', async () => {
    const confirmReplace = vi.fn(() => true);

    await loadExampleCohort(store, { ...options(), confirmReplace });

    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it('returns a readable failure rather than throwing at the caller', async () => {
    const boom: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));

    const result = await loadExampleCohort(store, options(boom));

    expect(result).toEqual({
      kind: 'failed',
      message: 'Could not read the bundled example cohort from this page.',
    });
    expect(store.videos).toHaveLength(0);
  });
});

describe('isSameExampleCohort', () => {
  it('treats a rebuilt bundle as new, so the real take reaches a returning user', async () => {
    const bundle = await fetchExampleSession(options());
    // Monday's take: same three videos, same name, new outputs and tool version.
    const rebuilt = { ...bundle, toolVersion: 'barnestrack v0.2.0 (deadbee)' };

    expect(isSameExampleCohort(bundle, rebuilt)).toBe(false);
    expect(isSameExampleCohort(bundle, bundle)).toBe(true);
  });

  it('is false when the content differs even though the name matches', async () => {
    const bundle = await fetchExampleSession(options());
    const renamed = {
      ...bundle,
      videos: bundle.videos.map((video) => ({
        ...video,
        fingerprint: { ...video.fingerprint, sha256: 'b'.repeat(64) },
      })),
    };
    expect(isSameExampleCohort(renamed, bundle)).toBe(false);
  });
});

describe('exampleStillUrl', () => {
  it('maps a video filename to its derived still', () => {
    expect(exampleStillUrl('test53.mp4', { baseUrl: BASE })).toBe(
      'http://localhost/examples/test53.jpg',
    );
  });
});
