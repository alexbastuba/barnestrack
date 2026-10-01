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

export interface SyntheticMazeClip extends SyntheticClip {
  /** The platform disc as drawn, in video pixels. */
  platform: { cx: number; cy: number; r: number };
  /** The real-world diameter the disc stands for; 92 cm, the sample rig's. */
  platformDiameter_cm: number;
  /** The hole the animal walks to and stays at, under phase 0 and the default ring. */
  targetHole: number;
  /** Where the animal's centroid stops, in video pixels. */
  parkedAt: { x: number; y: number };
  frameCount: number;
}

const MAZE_CLIP = {
  width: 320,
  height: 240,
  fps: 30,
  seconds: 4,
  /** The animal walks for this long, then stays put to the end. */
  walkSeconds: 2.5,
  platform: { cx: 160, cy: 120, r: 100 },
  platformDiameter_cm: 92,
  /** O8 defaults, as a freshly typed maze has them: 20 holes, ring at 0.89 r, hole 0 at 0°. */
  holeCount: 20,
  ringRatio: 0.89,
  targetHole: 5,
  /**
   * The centroid stops this far inside the ring, so that both the centroid and
   * the nose ahead of it sit within the 1.5 × hole-radius investigation radius
   * (≈ 8 px at 2.17 px/cm with 5 cm holes) whichever point the event is judged on.
   */
  parkInsideRing_px: 4,
  /** A mouse under a 92 cm platform, ≈ 8 × 3 cm, as an ellipse along its heading. */
  bodyLength_px: 17,
  bodyWidth_px: 6,
  surround: 20,
  disc: 200,
  animal: 30,
};

/**
 * A Barnes maze in miniature for the tracking pipeline (D35): a dark surround,
 * a light platform disc and a dark mouse-sized blob that walks from the centre
 * to the target hole over the first 2.5 s and stays there, visible, to the end
 * of the 4 s clip. Frames are drawn in Node as raw grayscale and encoded by
 * ffmpeg with libx264 (yuv420p, keyframe every 15) into a temp directory.
 *
 * The animal is still on screen at the end, so the trial has no escape entry:
 * it ends with the clip, and its status is `review`, never `unresolved`. It
 * parks for 1.5 s of 4 s, under half the clip, so the per-pixel median
 * background does not absorb it.
 */
export function encodeSyntheticMazeClip(): SyntheticMazeClip {
  const c = MAZE_CLIP;
  const { cx, cy, r } = c.platform;
  const angle = (c.targetHole * 2 * Math.PI) / c.holeCount;
  const parkRadius = r * c.ringRatio - c.parkInsideRing_px;
  const parkedAt = { x: cx + parkRadius * Math.cos(angle), y: cy + parkRadius * Math.sin(angle) };
  const heading = { x: Math.cos(angle), y: Math.sin(angle) };
  const frameCount = c.fps * c.seconds;
  const frameBytes = c.width * c.height;
  const halfLength = c.bodyLength_px / 2;
  const halfWidth = c.bodyWidth_px / 2;

  const raw = Buffer.alloc(frameBytes * frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const progress = Math.min(frame / c.fps / c.walkSeconds, 1);
    const ax = cx + progress * (parkedAt.x - cx);
    const ay = cy + progress * (parkedAt.y - cy);
    const base = frame * frameBytes;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let value = Math.hypot(px - cx, py - cy) <= r ? c.disc : c.surround;
        const along = (px - ax) * heading.x + (py - ay) * heading.y;
        const across = -(px - ax) * heading.y + (py - ay) * heading.x;
        if ((along / halfLength) ** 2 + (across / halfWidth) ** 2 <= 1) value = c.animal;
        raw[base + y * c.width + x] = value;
      }
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'barnestrack-maze-clip-'));
  const path = join(dir, 'synthetic-maze.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${c.width}x${c.height}`, '-framerate', String(c.fps),
      '-i', 'pipe:0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15',
      '-x264-params', 'keyint=15:min-keyint=15',
      '-movflags', '+faststart',
      path,
    ],
    { input: raw, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const bytes = readFileSync(path);
  return {
    path,
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    platform: { ...c.platform },
    platformDiameter_cm: c.platformDiameter_cm,
    targetHole: c.targetHole,
    parkedAt,
    frameCount,
  };
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
