/**
 * Re-attaching a video after a reload. D27.
 *
 * The match is on content, never on the filename: a renamed copy of the same
 * file re-attaches, and a different file that happens to carry a session's
 * filename does not. `byteLength` is compared first because it rejects almost
 * every non-match without reading the hash.
 */
import type { VideoDescriptor, VideoFingerprint } from '../contracts/session.js';

export function fingerprintsMatch(a: VideoFingerprint, b: VideoFingerprint): boolean {
  return a.byteLength === b.byteLength && a.sha256 === b.sha256;
}

export function findByFingerprint(
  videos: readonly VideoDescriptor[],
  fingerprint: VideoFingerprint,
): VideoDescriptor | undefined {
  return videos.find((video) => fingerprintsMatch(video.fingerprint, fingerprint));
}
