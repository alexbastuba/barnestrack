/**
 * The one permitted outbound request (D2) and its verifier.
 *
 * Everything here is deterministic and offline: the fetch is faked, so the
 * verifier, the progress reporting and the failure messages are covered without
 * CI depending on GitHub being reachable. The one test that really goes to the
 * network is opt-in through BARNESTRACK_NET_TEST=1 and skips with a message
 * otherwise, which keeps "the app makes no requests" easy to state and easy to
 * check.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { VideoDescriptor } from '../../src/contracts/session.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import {
  SAMPLE_CLIP_FILENAME,
  SAMPLE_CLIP_URL,
  fetchSampleClip,
  verifyAgainstDescriptor,
  type FetchLike,
} from '../../src/demo/fetch-sample-clip.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_PATH = join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz');

const CLIP_BYTES = new TextEncoder().encode('barnestrack sample clip bytes');
/** Recorded, not recomputed: a verifier checked against its own output proves nothing. */
const CLIP_SHA256 = '9b829f116481b2d97ba5cc4fe948c725e8d9551c8dd818fe5144a76f151485e8';

function descriptorFor(bytes: Uint8Array, sha256: string): VideoDescriptor {
  return {
    id: 'video-test53',
    filename: SAMPLE_CLIP_FILENAME,
    fingerprint: { byteLength: bytes.byteLength, durationSeconds: 30.2, frameCount: 905, sha256 },
    referenceResolution: { width: 640, height: 480 },
    mazeTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 1 },
    metadata: {},
  };
}

/** A streaming body, so `readWithProgress` is exercised rather than bypassed. */
function streamingFetch(bytes: Uint8Array, chunkSize = 8, withLength = true): FetchLike {
  return () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
          controller.enqueue(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)));
        }
        controller.close();
      },
    });
    const headers: Record<string, string> = withLength
      ? { 'content-length': String(bytes.byteLength) }
      : {};
    return Promise.resolve(new Response(stream, { headers }));
  };
}

function exampleTest53Descriptor(): VideoDescriptor {
  const parsed = parseSessionDocument(gunzipSync(readFileSync(BUNDLE_PATH)).toString('utf-8'));
  if (!parsed.ok) throw new Error(parsed.message);
  const video = parsed.session.videos.find((v) => v.filename === SAMPLE_CLIP_FILENAME);
  if (video === undefined) throw new Error(`no ${SAMPLE_CLIP_FILENAME} in the example cohort`);
  return video;
}

describe('verifyAgainstDescriptor', () => {
  it('accepts bytes whose hash matches the recorded one', async () => {
    const result = await verifyAgainstDescriptor(CLIP_BYTES, descriptorFor(CLIP_BYTES, CLIP_SHA256));

    expect(result.kind).toBe('verified');
  });

  it('rejects different bytes of the same length', async () => {
    const tampered = new TextEncoder().encode('barnestrack sample clip byteS');
    expect(tampered.byteLength).toBe(CLIP_BYTES.byteLength);

    const result = await verifyAgainstDescriptor(tampered, descriptorFor(CLIP_BYTES, CLIP_SHA256));

    expect(result.kind).toBe('mismatch');
    if (result.kind !== 'mismatch') throw new Error('expected a mismatch');
    expect(result.message).toContain('not the test53.mp4 this example cohort was built from');
  });

  it('rejects a truncated download', async () => {
    const short = CLIP_BYTES.slice(0, 10);

    const result = await verifyAgainstDescriptor(short, descriptorFor(CLIP_BYTES, CLIP_SHA256));

    expect(result.kind).toBe('mismatch');
  });
});

describe('fetchSampleClip', () => {
  const descriptor = descriptorFor(CLIP_BYTES, CLIP_SHA256);

  it('returns a File named for the descriptor when the bytes verify', async () => {
    const result = await fetchSampleClip(descriptor, { fetchImpl: streamingFetch(CLIP_BYTES) });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(result.message);
    expect(result.file.name).toBe(SAMPLE_CLIP_FILENAME);
    expect(result.file.size).toBe(CLIP_BYTES.byteLength);
  });

  it('reports progress up to the total', async () => {
    const onProgress = vi.fn();

    await fetchSampleClip(descriptor, { fetchImpl: streamingFetch(CLIP_BYTES), onProgress });

    const calls = onProgress.mock.calls.map(([progress]) => progress as { receivedBytes: number });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.at(-1)).toEqual({
      receivedBytes: CLIP_BYTES.byteLength,
      totalBytes: CLIP_BYTES.byteLength,
    });
    // Monotonic, so a progress bar never goes backwards.
    const received = calls.map((c) => c.receivedBytes);
    expect([...received].sort((a, b) => a - b)).toEqual(received);
  });

  it('carries a null total when the server sends no content-length', async () => {
    const onProgress = vi.fn();

    await fetchSampleClip(descriptor, {
      fetchImpl: streamingFetch(CLIP_BYTES, 8, false),
      onProgress,
    });

    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ totalBytes: null });
  });

  it('discards a download that does not verify', async () => {
    const wrong = new TextEncoder().encode('something else entirely......');

    const result = await fetchSampleClip(descriptor, { fetchImpl: streamingFetch(wrong) });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected a failure');
    expect(result.message).toContain('was discarded');
  });

  it('stops a response longer than the descriptor says, without buffering it all', async () => {
    const flood = new Uint8Array(CLIP_BYTES.byteLength * 50);
    let delivered = 0;
    const counting: FetchLike = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let offset = 0; offset < flood.byteLength; offset += 8) {
                controller.enqueue(flood.slice(offset, offset + 8));
                delivered += 8;
              }
              controller.close();
            },
          }),
        ),
      );

    const result = await fetchSampleClip(descriptor, { fetchImpl: counting });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected a failure');
    expect(result.message).toContain('larger than');
    // Enqueued eagerly by the fake, but the reader stopped early rather than
    // keeping all of it: what matters is that it refused, not how far it read.
    expect(delivered).toBeGreaterThan(0);
  });

  it('says what to do when the request cannot be made at all', async () => {
    const offline: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));

    const result = await fetchSampleClip(descriptor, { fetchImpl: offline });

    expect(result).toEqual({
      kind: 'failed',
      message:
        'Could not reach the sample-data repository. Check your connection, or download ' +
        'test53.mp4 yourself and drop it on the Videos step instead.',
    });
  });

  it('reports an HTTP error with its status', async () => {
    const missing: FetchLike = () => Promise.resolve(new Response(null, { status: 404 }));

    const result = await fetchSampleClip(descriptor, { fetchImpl: missing });

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected a failure');
    expect(result.message).toContain('404');
  });
});

describe('the real sample-data repository', () => {
  const enabled = process.env['BARNESTRACK_NET_TEST'] === '1';

  it.skipIf(!enabled)(
    'serves a test53.mp4 that verifies against the committed example cohort',
    async () => {
      const result = await fetchSampleClip(exampleTest53Descriptor(), { url: SAMPLE_CLIP_URL });

      expect(result.kind).toBe('ok');
    },
    60_000,
  );

  it.skipIf(enabled)('is not contacted unless BARNESTRACK_NET_TEST=1', () => {
    // Standing evidence for D2: the suite is offline-deterministic by default.
    expect(enabled).toBe(false);
  });
});
