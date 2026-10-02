/**
 * D68: a video's own target hole, when it has one, is the target every figure
 * draws and names — the map's otherwise.
 */
import { describe, expect, it } from 'vitest';
import { trialSource } from '../../src/viz/data.js';
import { holeRasterFigure } from '../../src/viz/hole-raster.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

describe('the effective target hole in the figures', () => {
  it('follows the video’s override and falls back to the map’s target', () => {
    const session = syntheticSession();
    const videoId = session.videos[1]!.id;
    expect(trialSource({ session, videoId })!.targetIndex).toBe(7);

    const overridden = {
      ...session,
      videos: session.videos.map((video) => (video.id === videoId ? { ...video, targetHole: 4 } : video)),
    };
    expect(trialSource({ session: overridden, videoId })!.targetIndex).toBe(4);
    // the other videos keep the map's target
    expect(trialSource({ session: overridden, videoId: session.videos[0]!.id })!.targetIndex).toBe(7);
    expect(holeRasterFigure.describe({ session: overridden, videoId }).summary).toContain('hole 4 is the target');
  });
});
