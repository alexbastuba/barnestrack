/**
 * The tracker on the real sample videos, through the Node harness (ffmpeg →
 * tracker module). Runs only when BARNESTRACK_SAMPLE_DIR points at the
 * upstream data/barnes-maze folder; skipped otherwise (D35). The platform
 * circles are the estimator's proposals recorded in
 * prototypes/tracker/RESULTS.md, checked by eye against the background.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackVideo } from '../../../scripts/tracker-node/run.js';

const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
if (!SAMPLE_DIR)
  console.warn('BARNESTRACK_SAMPLE_DIR is not set; sample-video tracker tests skipped');

const PLATFORMS = {
  test51: { cx: 280.7, cy: 242.7, r: 221.1 },
  test53: { cx: 324.6, cy: 240.5, r: 208.2 },
} as const;

/** The start cylinder sits on the platform in these frames of test51 (checked by eye: lifted between frames 74 and 76). */
const TEST51_CYLINDER_FRAMES: [number, number] = [0, 74];
/** test53 starts with an empty platform; the animal is placed at frame 150. */
const TEST53_EMPTY_FRAMES: [number, number] = [0, 59];

const TIMEOUT_MS = 120_000;

describe.skipIf(!SAMPLE_DIR)('tracker on the sample videos (BARNESTRACK_SAMPLE_DIR)', () => {
  it(
    "test53: the empty start is not_detected / no_foreground and the animal's first frames are tracked",
    async () => {
      const video = join(SAMPLE_DIR!, 'test53.mp4');
      expect(existsSync(video)).toBe(true);
      const run = await trackVideo({
        video,
        platformDiameter_cm: 92,
        platform: PLATFORMS.test53,
        contactFrames: 0,
        movingFrames: 0,
      });
      const frames = run.result!.frames;
      expect(frames.length).toBe(905);
      for (let i = TEST53_EMPTY_FRAMES[0]; i <= TEST53_EMPTY_FRAMES[1]; i++) {
        expect(frames[i]!.detectionState, `frame ${i}`).toBe('not_detected');
        expect(frames[i]!.reason).toBe('no_foreground');
        expect(frames[i]!.centroid.valid).toBe(false);
      }
      expect(run.result!.summary.stateCounts.tracked).toBeGreaterThan(500);
      expect(run.result!.summary.warnings).toEqual([]);
      console.info(
        `test53: ${run.timing.trackerFps.toFixed(0)} fps tracker, ${run.timing.wallFps.toFixed(0)} fps with ffmpeg`,
      );
    },
    TIMEOUT_MS,
  );

  it(
    'test51: no frame with the start cylinder on the platform is tracked',
    async () => {
      const video = join(SAMPLE_DIR!, 'test51.mp4');
      const run = await trackVideo({
        video,
        platformDiameter_cm: 92,
        platform: PLATFORMS.test51,
        contactFrames: 0,
        movingFrames: 0,
      });
      const frames = run.result!.frames;
      expect(frames.length).toBe(741);
      for (let i = TEST51_CYLINDER_FRAMES[0]; i <= TEST51_CYLINDER_FRAMES[1]; i++) {
        expect(frames[i]!.detectionState, `frame ${i}`).not.toBe('tracked');
        expect(frames[i]!.centroid.valid, `frame ${i}`).toBe(false);
      }
      // the animal is tracked once the cylinder is gone
      expect(
        frames.slice(76, 100).filter((f) => f.detectionState === 'tracked').length,
      ).toBeGreaterThan(20);
    },
    TIMEOUT_MS,
  );

  it(
    'is deterministic across two runs of the same file',
    async () => {
      const video = join(SAMPLE_DIR!, 'test53.mp4');
      const a = await trackVideo({
        video,
        platformDiameter_cm: 92,
        platform: PLATFORMS.test53,
        contactFrames: 0,
        movingFrames: 0,
      });
      const b = await trackVideo({
        video,
        platformDiameter_cm: 92,
        platform: PLATFORMS.test53,
        contactFrames: 0,
        movingFrames: 0,
      });
      expect(JSON.stringify(b.result!.frames)).toBe(JSON.stringify(a.result!.frames));
      expect(b.result!.summary).toEqual(a.result!.summary);
    },
    TIMEOUT_MS,
  );
});
