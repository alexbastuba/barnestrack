/**
 * The synthetic session is the input to every other test in this chunk and to
 * the gallery page, so its own invariants are checked here.
 */
import { describe, expect, it } from 'vitest';
import type { VideoDescriptor } from '../../src/contracts/session.js';
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

  it('never fills a gap wider than the parameter that authorises it (O10)', () => {
    const session = syntheticSession();
    const holeRadius_px = (video: VideoDescriptor): number =>
      videoMazeMap(video).holes.holeRadius_px;
    const nearestHoleDistance_px = (video: VideoDescriptor, at: { x: number; y: number }): number =>
      Math.min(
        ...holeCentres(videoMazeMap(video)).map((hole) => Math.hypot(hole.x - at.x, hole.y - at.y)),
      );
    const ceiling = session.parameters?.gapFilling.maxDuration_s ?? 0;
    expect(ceiling).toBeGreaterThan(0);
    let filledRuns = 0;
    for (const video of session.videos) {
      const analysis = session.analyses[video.id];
      if (!analysis) continue;
      const track = analysis.derived.cleanedTrack;
      for (let i = 0; i < track.length; i++) {
        if (track[i]!.centroid.source !== 'filled') continue;
        if (i > 0 && track[i - 1]!.centroid.source === 'filled') continue;
        let end = i;
        while (end + 1 < track.length && track[end + 1]!.centroid.source === 'filled') end++;
        // The gap is measured between the frames that bound it, which is what
        // O10's ceiling is about — not the filled frames alone.
        const before = track[i - 1];
        const after = track[end + 1];
        expect(before).toBeDefined();
        expect(after).toBeDefined();
        if (!before || !after) continue;
        expect(after.t_s - before.t_s).toBeLessThanOrEqual(ceiling + 1e-9);
        // O10 also forbids filling within one hole radius of a hole — a gap at
        // a hole is evidence, not noise — so the reason's "away from any hole"
        // has to be true of both bounding frames, not just plausible.
        for (const bound of [before, after]) {
          expect(nearestHoleDistance_px(video, bound.centroid)).toBeGreaterThan(
            holeRadius_px(video),
          );
        }
        // The reason quotes the gap it actually measured, not a fixed number.
        expect(track[i]!.reason).toContain(
          `${Math.round((after.t_s - before.t_s) * 1000) / 1000} s`,
        );
        filledRuns++;
        i = end;
      }
    }
    expect(filledRuns).toBeGreaterThan(0);
  });

  it('shows O10 declining to fill as well as filling it (D31)', () => {
    const session = syntheticSession();
    const ceiling = session.parameters?.gapFilling.maxDuration_s ?? 0;
    const shortUnfilled: number[] = [];
    for (const analysis of Object.values(session.analyses)) {
      const track = analysis.derived.cleanedTrack;
      for (let i = 0; i < track.length; i++) {
        if (track[i]!.detectionState !== 'not_detected') continue;
        let end = i;
        while (end + 1 < track.length && track[end + 1]!.detectionState === 'not_detected') end++;
        const before = track[i - 1];
        const after = track[end + 1];
        // A short loss that was left alone: at 14.985 fps even a one-frame gap
        // spans more than the 0.1 s ceiling, so the cohort carries both cases.
        if (before && after && end - i < 4) shortUnfilled.push(after.t_s - before.t_s);
        i = end;
      }
    }
    expect(shortUnfilled.length).toBeGreaterThan(0);
    expect(Math.max(...shortUnfilled)).toBeGreaterThan(ceiling);
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
