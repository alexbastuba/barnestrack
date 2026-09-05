/**
 * Content fingerprint of a video file (D27): lets a session re-attach to
 * "the same file dropped again" after a reload, independent of filename.
 * SHA-256 is streamed over the file in slices; see `sha256.ts`.
 */
import type { VideoFingerprint } from '../contracts/session.js';
import { toByteSource, type ByteSourceInput } from './byte-source.js';
import type { Mp4Index } from './mp4-index.js';
import { Sha256 } from './sha256.js';

const HASH_SLICE_BYTES = 4 * 1024 * 1024;

export async function sha256OfSource(input: ByteSourceInput): Promise<string> {
  const source = toByteSource(input);
  const hasher = new Sha256();
  for (let offset = 0; offset < source.byteLength; offset += HASH_SLICE_BYTES) {
    const end = Math.min(offset + HASH_SLICE_BYTES, source.byteLength);
    hasher.update(new Uint8Array(await source.read(offset, end)));
  }
  return hasher.digestHex();
}

export async function fingerprintVideo(
  input: ByteSourceInput,
  index: Pick<Mp4Index, 'durationSeconds' | 'frameCount'>,
): Promise<VideoFingerprint> {
  const source = toByteSource(input);
  return {
    byteLength: source.byteLength,
    durationSeconds: index.durationSeconds,
    frameCount: index.frameCount,
    sha256: await sha256OfSource(source),
  };
}
