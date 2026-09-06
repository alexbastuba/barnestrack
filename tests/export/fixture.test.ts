/**
 * The synthetic session is the input to every other test in this chunk and to
 * the gallery page, so its own invariants are checked here.
 */
import { describe, expect, it } from 'vitest';
import { holeCentres } from '../../src/maze/ring.js';
import { syntheticSession, videoMazeMap } from '../fixtures/synthetic-analysis.js';

describe('syntheticSession', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(syntheticSession())).toBe(JSON.stringify(syntheticSession()));
  });

  it('has three tracked videos matching the sample clips', () => {
    const session = syntheticSession();
    expect(session.videos.map((video) => video.filename)).toEqual([
      'test50.mp4',
      'test51.mp4',
      'test53.mp4',
    ]);
    expect(session.videos.map((video) => video.fingerprint.frameCount)).toEqual([5539, 741, 905]);
    expect(Object.keys(session.analyses)).toHaveLength(3);
  });

  it('gives every video one escape entry or a documented reason it has none', () => {
    const session = syntheticSession();
    for (const video of session.videos) {
      const analysis = session.analyses[video.id];
      expect(analysis).toBeDefined();
      if (!analysis) continue;
      const escapes = analysis.derived.events.filter((event) => event.kind === 'escape_entry');
      expect(escapes.length).toBe(analysis.derived.metrics.escaped ? 1 : 0);
    }
  });

  it('carries a tracking failure and a corrected event with its automatic shadow', () => {
    const session = syntheticSession();
    const events = Object.values(session.analyses).flatMap((analysis) => analysis.derived.events);
    expect(events.filter((event) => event.kind === 'tracking_failure').length).toBeGreaterThan(0);
    const corrected = events.filter((event) => event.source === 'corrected');
    expect(corrected).toHaveLength(3);
    for (const event of corrected) {
      expect(event.autoShadow).toBeDefined();
      expect(event.autoShadow?.endFrame).not.toBe(event.endFrame);
    }
  });

  it('never puts a filled point in the automatic layer, only in the derived one (D8, O10)', () => {
    const session = syntheticSession();
    for (const analysis of Object.values(session.analyses)) {
      expect(
        analysis.auto.frames.some(
          (frame) => frame.centroid.source === 'filled' || frame.nose.source === 'filled',
        ),
      ).toBe(false);
    }
    const filled = Object.values(session.analyses).flatMap((analysis) =>
      analysis.derived.cleanedTrack.filter((frame) => frame.centroid.source === 'filled'),
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it('keeps every tracked position inside the platform of its own video', () => {
    const session = syntheticSession();
    for (const video of session.videos) {
      const analysis = session.analyses[video.id];
      const map = videoMazeMap(video);
      expect(holeCentres(map)).toHaveLength(20);
      if (!analysis) continue;
      for (const frame of analysis.derived.cleanedTrack) {
        if (!frame.centroid.valid) continue;
        const distance = Math.hypot(
          frame.centroid.x - map.platform.cx,
          frame.centroid.y - map.platform.cy,
        );
        expect(distance).toBeLessThanOrEqual(map.platform.r);
      }
    }
  });
});
