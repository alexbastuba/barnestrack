/**
 * Streams a video's frames through ffmpeg as raw 8-bit gray planes, in
 * presentation order, without ever holding the whole video in memory. The
 * one buffer is reused for every frame, exactly as the browser decoder does,
 * so a consumer that keeps a reference sees its frame overwritten.
 *
 * `-fps_mode passthrough` is mandatory: ffmpeg's default vsync drops or
 * duplicates frames to a constant rate, and the sample videos carry tied
 * timestamps and dropped-frame gaps (D7). ffmpeg's rawvideo muxer then
 * complains about non-monotonic dts on every tied pair; those lines are
 * filtered out of the reported stderr.
 */
import { spawn } from 'node:child_process';

export interface StreamOptions {
  /** Presentation-order frame numbers to emit (all frames when absent). Passed to ffmpeg's `select` filter. */
  select?: readonly number[];
  ffmpegPath?: string;
}

const HARMLESS_STDERR = /non monotonically increasing dts/;

export function ffmpegArgs(video: string, options: StreamOptions = {}): string[] {
  const args = ['-v', 'error', '-nostdin', '-i', video];
  if (options.select) {
    if (options.select.length === 0) throw new RangeError('select needs at least one frame');
    const expr = options.select.map((n) => `eq(n\\,${n})`).join('+');
    args.push('-vf', `select='${expr}'`);
  }
  args.push('-fps_mode', 'passthrough', '-pix_fmt', 'gray', '-f', 'rawvideo', '-');
  return args;
}

/**
 * Calls `onFrame(gray, outputIndex)` for every frame ffmpeg emits (output
 * index 0, 1, 2 … in emission order; with `select`, the k-th selected frame).
 * Resolves with the number of frames emitted.
 */
export function streamGrayFrames(
  video: string,
  width: number,
  height: number,
  onFrame: (gray: Uint8Array, outputIndex: number) => void,
  options: StreamOptions = {},
): Promise<number> {
  const frameBytes = width * height;
  const frame = new Uint8Array(frameBytes);
  let filled = 0;
  let count = 0;
  const stderr: string[] = [];
  return new Promise((resolve, reject) => {
    const child = spawn(options.ffmpegPath ?? 'ffmpeg', ffmpegArgs(video, options), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let failed: Error | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed) return;
      let offset = 0;
      try {
        while (offset < chunk.length) {
          const take = Math.min(frameBytes - filled, chunk.length - offset);
          frame.set(chunk.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          if (filled === frameBytes) {
            onFrame(frame, count);
            count++;
            filled = 0;
          }
        }
      } catch (e) {
        failed = e instanceof Error ? e : new Error(String(e));
        child.kill('SIGKILL');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => {
      for (const line of text.split('\n')) {
        if (line.trim().length > 0 && !HARMLESS_STDERR.test(line)) stderr.push(line);
      }
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (failed) {
        reject(failed);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited with code ${code}${stderr.length ? `: ${stderr.join(' | ')}` : ''}`,
          ),
        );
        return;
      }
      if (filled !== 0) {
        reject(new Error(`ffmpeg output ended mid-frame (${filled} of ${frameBytes} bytes)`));
        return;
      }
      if (stderr.length > 0) process.stderr.write(`ffmpeg: ${stderr.join('\n')}\n`);
      resolve(count);
    });
  });
}
