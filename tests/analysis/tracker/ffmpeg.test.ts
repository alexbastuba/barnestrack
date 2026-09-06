/**
 * The harness's ffmpeg streaming, on a synthetic clip encoded in a temp
 * directory (D35): frame count, frame reassembly across stdout chunks, the
 * `select` pass, and the reused-buffer contract. Skipped when ffmpeg with
 * libx264 is missing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegArgs, streamGrayFrames } from '../../../scripts/tracker-node/ffmpeg.js';
import {
  SKIP_REASON,
  encodeSyntheticClip,
  ffmpegHasLibx264,
  type SyntheticClip,
} from '../../video/synthetic-clip.js';

const hasFfmpeg = ffmpegHasLibx264();
if (!hasFfmpeg) console.warn(SKIP_REASON);

describe('ffmpegArgs', () => {
  it('always uses passthrough vsync and gray rawvideo, with an escaped select expression', () => {
    const plain = ffmpegArgs('v.mp4');
    expect(plain).toEqual([
      '-v',
      'error',
      '-nostdin',
      '-i',
      'v.mp4',
      '-fps_mode',
      'passthrough',
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      '-',
    ]);
    const selected = ffmpegArgs('v.mp4', { select: [0, 7, 59] });
    expect(selected).toContain("select='eq(n\\,0)+eq(n\\,7)+eq(n\\,59)'");
    expect(selected.indexOf('-vf')).toBeLessThan(selected.indexOf('-fps_mode'));
    expect(() => ffmpegArgs('v.mp4', { select: [] })).toThrow(/at least one/);
  });
});

describe.skipIf(!hasFfmpeg)('streamGrayFrames on a synthetic 64×64 clip', () => {
  let clip: SyntheticClip;
  const frames: Uint8Array[] = [];

  beforeAll(async () => {
    clip = encodeSyntheticClip();
    const count = await streamGrayFrames(clip.path, 64, 64, (gray, i) => {
      expect(i).toBe(frames.length);
      frames.push(Uint8Array.from(gray));
    });
    expect(count).toBe(60);
  });
  afterAll(() => clip?.cleanup());

  it('emits every frame once, in order, as 64 × 64 bytes', () => {
    expect(frames.length).toBe(60);
    for (const f of frames) expect(f.length).toBe(4096);
    // testsrc changes every frame: consecutive frames differ
    expect(frames[1]).not.toEqual(frames[0]);
  });

  it('reuses one buffer: a reference kept across callbacks sees the next frame', async () => {
    const kept: Uint8Array[] = [];
    await streamGrayFrames(clip.path, 64, 64, (gray) => kept.push(gray));
    expect(kept.length).toBe(60);
    expect(kept[0]).toBe(kept[59]); // same object every time
    expect(kept[0]).toEqual(frames[59]); // holding the last frame's bytes
  });

  it('selects frames by presentation index and matches the full pass pixel for pixel', async () => {
    const picked: Uint8Array[] = [];
    const count = await streamGrayFrames(
      clip.path,
      64,
      64,
      (gray) => picked.push(Uint8Array.from(gray)),
      { select: [0, 7, 59] },
    );
    expect(count).toBe(3);
    expect(picked[0]).toEqual(frames[0]);
    expect(picked[1]).toEqual(frames[7]);
    expect(picked[2]).toEqual(frames[59]);
  });

  it('rejects when ffmpeg cannot read the input', async () => {
    await expect(streamGrayFrames('/nonexistent/clip.mp4', 64, 64, () => {})).rejects.toThrow(
      /ffmpeg exited/,
    );
  });
});
