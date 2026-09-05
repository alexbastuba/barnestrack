import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { byteSourceFromArrayBuffer } from '../../src/video/byte-source.js';
import { fingerprintVideo, sha256OfSource } from '../../src/video/fingerprint.js';
import { parseMp4Index } from '../../src/video/mp4-index.js';
import { Sha256, sha256Hex } from '../../src/video/sha256.js';
import { SKIP_REASON, encodeSyntheticClip, ffmpegHasLibx264, type SyntheticClip } from './synthetic-clip.js';

const hasFfmpeg = ffmpegHasLibx264();
if (!hasFfmpeg) console.warn(SKIP_REASON);

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('agrees with node:crypto across block-boundary lengths and chunkings', () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65_537]) {
      const bytes = randomBytes(length);
      expect(sha256Hex(bytes), `length ${length}`).toBe(nodeSha256(bytes));
      const chunked = new Sha256();
      for (let offset = 0; offset < length; offset += 7) chunked.update(bytes.subarray(offset, offset + 7));
      expect(chunked.digestHex(), `chunked length ${length}`).toBe(nodeSha256(bytes));
    }
  });

  it('refuses to be reused after the digest', () => {
    const h = new Sha256().update(new Uint8Array([1]));
    h.digestHex();
    expect(() => h.update(new Uint8Array([2]))).toThrow();
  });
});

describe('sha256OfSource', () => {
  it('streams a source larger than one slice', async () => {
    const bytes = randomBytes(9 * 1024 * 1024 + 13);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await expect(sha256OfSource(byteSourceFromArrayBuffer(buffer))).resolves.toBe(nodeSha256(bytes));
  });
});

describe.skipIf(!hasFfmpeg)('fingerprintVideo', () => {
  let clip: SyntheticClip;
  beforeAll(() => {
    clip = encodeSyntheticClip();
  });
  afterAll(() => clip?.cleanup());

  it('populates every VideoFingerprint field from the clip and its index', async () => {
    const index = await parseMp4Index(clip.buffer);
    const fingerprint = await fingerprintVideo(clip.buffer, index);
    expect(fingerprint).toEqual({
      byteLength: clip.buffer.byteLength,
      durationSeconds: index.durationSeconds,
      frameCount: 60,
      sha256: nodeSha256(new Uint8Array(clip.buffer)),
    });
  });
});
