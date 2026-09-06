/**
 * Video intake: what BarnesTrack will accept, and what it says about the rest.
 * D28, O13.
 *
 * Nothing is ever dropped silently. A file that is not an MP4, an MP4 that is
 * not H.264, or an H.264 profile this build cannot decode all come back as a
 * `rejected` result carrying the plain-language reason from chunk 1's index
 * plus the re-encode line from `docs/known-limitations.md`.
 */
import type { VideoFingerprint } from '../contracts/session.js';
import { fingerprintVideo } from '../video/fingerprint.js';
import { parseMp4Index, UnsupportedVideoError, type Mp4Index } from '../video/mp4-index.js';

/** The one command that turns an unsupported file into one BarnesTrack reads (O13). */
export const REENCODE_HINT = 'ffmpeg -i in.avi -c:v libx264 -pix_fmt yuv420p -g 15 -bf 0 out.mp4';

export type IntakeResult =
  | { kind: 'accepted'; file: File; index: Mp4Index; fingerprint: VideoFingerprint }
  | { kind: 'rejected'; file: File; reason: string; hint: string | null };

export function looksLikeMp4(file: File): boolean {
  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
}

const VIDEO_EXTENSIONS = /\.(avi|mov|mkv|webm|mpg|mpeg|m4v|wmv|flv|mts|m2ts|ogv|3gp)$/i;

function couldBeVideo(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name);
}

function describeFile(file: File): string {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1];
  if (file.type) return `a ${file.type} file`;
  if (extension) return `a .${extension.toLowerCase()} file`;
  return 'a file with no recognised type';
}

/**
 * Parses the sample table and fingerprints the content. Reading the whole file
 * once for SHA-256 is what lets a reload re-attach it by content (D27).
 */
export async function inspectFile(file: File): Promise<IntakeResult> {
  if (!looksLikeMp4(file)) {
    return {
      kind: 'rejected',
      file,
      reason: `This is ${describeFile(file)}. BarnesTrack reads MP4 files containing H.264 (AVC) video.`,
      // Only worth suggesting for something that is plausibly video: telling
      // someone to re-encode a spreadsheet is noise, not help.
      hint: couldBeVideo(file) ? REENCODE_HINT : null,
    };
  }
  try {
    const index = await parseMp4Index(file);
    const fingerprint = await fingerprintVideo(file, index);
    return { kind: 'accepted', file, index, fingerprint };
  } catch (error) {
    if (error instanceof UnsupportedVideoError) {
      return { kind: 'rejected', file, reason: error.reason, hint: REENCODE_HINT };
    }
    return {
      kind: 'rejected',
      file,
      reason: `This MP4 could not be read: ${error instanceof Error ? error.message : String(error)}`,
      hint: null,
    };
  }
}
