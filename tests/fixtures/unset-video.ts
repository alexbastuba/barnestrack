/**
 * A video the shared maze map is not yet set on (chunk 17, §4.4): one of
 * another size than the example cohort's 640 × 480, carrying the identity
 * transform, so `mazeSetOnVideo` (src/ui/next-step.ts) reads it as unset and
 * the Maze step's action bar shows its two-line reason — "The maze is set on
 * 3 of 4 videos. Choose each remaining video above and place the ring in its
 * frame." — the state chunk 14b sized `--maze-reserve` for and measured by
 * hand. `tests/browser/app-smoke.spec.ts` adds it through the store and
 * asserts that state; no file is needed, the descriptor is enough.
 */
import type { NewVideo } from '../../src/session/session-store.js';

export const UNSET_VIDEO: NewVideo = {
  filename: 'other-rig.mp4',
  fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'c'.repeat(64) },
  referenceResolution: { width: 1280, height: 720 },
};
