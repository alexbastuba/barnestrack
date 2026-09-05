/**
 * Test helper: encodes small H.264 clips with ffmpeg into a temp directory.
 * Nothing is committed (D35). Tests skip themselves when ffmpeg or libx264
 * is missing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SyntheticClip {
  path: string;
  buffer: ArrayBuffer;
  cleanup(): void;
}

export function ffmpegHasLibx264(): boolean {
  try {
    const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return encoders.includes('libx264');
  } catch {
    return false;
  }
}

export const SKIP_REASON = 'ffmpeg with libx264 is not on PATH; synthetic-clip tests skipped';

/** 64×64, 30 fps, 2 s: 60 frames, keyframe every 15, B-pyramid, faststart. */
export function encodeSyntheticClip(extraVideoFilter?: string): SyntheticClip {
  const dir = mkdtempSync(join(tmpdir(), 'barnestrack-clip-'));
  const path = join(dir, 'synthetic.mp4');
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30', '-t', '2'];
  if (extraVideoFilter) args.push('-vf', extraVideoFilter, '-fps_mode', 'passthrough');
  args.push(
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-bf', '2',
    '-x264-params', 'b-pyramid=normal:keyint=15:min-keyint=15',
    '-movflags', '+faststart',
    path,
  );
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    path,
    buffer,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Same clip with the timestamps of every third frame collapsed onto the frame
 * before it, which reproduces the duplicate-timestamp pairs and +1-tick
 * offsets seen in the sample videos.
 */
export function encodeSyntheticTieClip(): SyntheticClip {
  return encodeSyntheticClip('setpts=floor(N/3)*3*(1/30)/TB');
}

/** ffprobe's per-frame presentation timestamps in seconds, decoder output order. */
export function ffprobePtsSeconds(path: string): number[] {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', path],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  ).toString();
  return out
    .split('\n')
    .map((line) => line.replace(/,.*$/, '').trim())
    .filter((line) => line.length > 0)
    .map(Number);
}
