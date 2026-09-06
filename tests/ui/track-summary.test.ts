/**
 * The Track step's plain-language summary (D17).
 *
 * `src/ui/` is DOM- and canvas-bound and has no test environment, but the
 * sentence a user reads after a pass is pure string formatting over the
 * tracker's summary — so it is tested like the analysis code, and only that
 * part of the step lives here.
 */
import { describe, expect, it } from 'vitest';
import type { TrackerSummary } from '../../src/analysis/tracker/tracker.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import {
  countGaps,
  formatClock,
  formatPercent,
  formatRemaining,
  gapDurationSeconds,
  learnedBlobArea_cm2,
  progressLine,
  stateBreakdown,
  summaryLine,
  trackedFraction,
} from '../../src/ui/track-summary.js';

function frame(frameIndex: number, detectionState: TrackFrame['detectionState']): TrackFrame {
  return {
    frameIndex,
    t_s: frameIndex / 30,
    centroid: { x: 0, y: 0, confidence: 0, valid: detectionState === 'tracked', source: 'auto' },
    nose: { x: 0, y: 0, confidence: 0, valid: false, source: 'auto' },
    detectionState,
    reason: detectionState === 'tracked' ? 'single_blob' : 'no_foreground',
    blobArea_px2: 0,
    boundingBox: null,
    noseHeadingConfidence: 0,
  };
}

function summary(overrides: Partial<TrackerSummary> = {}): TrackerSummary {
  return {
    frameCount: 1000,
    stateCounts: { tracked: 941, not_detected: 30, ambiguous: 9, low_confidence: 20 },
    reasonCounts: {
      single_blob: 941,
      proximity_to_previous: 0,
      no_foreground: 30,
      multiple_blobs: 9,
      oversized_blob: 0,
      partial_at_rim: 20,
      small_blob: 0,
      fragmented: 0,
    },
    threshold: { value: 48, mode: 'otsu' },
    pxPerCm: 4.5,
    platform: { cx: 320, cy: 240, r: 205 },
    expectedBlobArea_px2: 800,
    expectedBlobAreaSource: 'learned',
    medianTrackedBlobArea_px2: 812,
    medianTrackedBlobArea_cm2: 40.1,
    longestNotDetectedRun: null,
    noseHeadingConfidenceCounts: { c0: 0, c05: 0, c1: 0 },
    movingNoseHeadingConfidenceCounts: { c0: 0, c05: 0, c1: 0 },
    movingFrames: 0,
    warnings: [],
    ...overrides,
  };
}

describe('formatClock', () => {
  it('writes a position the way a video player does', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(92)).toBe('1:32');
    expect(formatClock(185)).toBe('3:05');
  });

  it('says so rather than guessing when there is no time', () => {
    expect(formatClock(Number.NaN)).toBe('—');
    expect(formatClock(-1)).toBe('—');
  });
});

describe('formatPercent and trackedFraction', () => {
  it('keeps one decimal, and does not round a bad number up to a good one', () => {
    expect(formatPercent(0.941)).toBe('94.1 %');
    expect(formatPercent(0.9999)).toBe('100.0 %');
    expect(formatPercent(0.5)).toBe('50.0 %');
  });

  it('is zero, not a division by zero, for an empty pass', () => {
    expect(trackedFraction(summary({ frameCount: 0 }))).toBe(0);
  });
});

describe('countGaps', () => {
  it('counts runs of missing frames, not missing frames', () => {
    const frames = [
      frame(0, 'tracked'),
      frame(1, 'not_detected'),
      frame(2, 'not_detected'),
      frame(3, 'tracked'),
      frame(4, 'not_detected'),
    ];
    expect(countGaps(frames)).toBe(2);
  });

  it('does not count ambiguous or low-confidence frames as gaps', () => {
    expect(countGaps([frame(0, 'ambiguous'), frame(1, 'low_confidence')])).toBe(0);
  });

  it('counts a gap that runs to the end of the video', () => {
    expect(countGaps([frame(0, 'tracked'), frame(1, 'not_detected')])).toBe(1);
  });

  it('is zero for no frames', () => {
    expect(countGaps([])).toBe(0);
  });
});

describe('summaryLine', () => {
  it('reads as a sentence, with the longest gap named by where it starts', () => {
    const frames = [
      ...Array.from({ length: 2760 }, (_, i) => frame(i, 'tracked')),
      ...Array.from({ length: 372 }, (_, i) => frame(2760 + i, 'not_detected')),
      ...Array.from({ length: 100 }, (_, i) => frame(3132 + i, 'tracked')),
    ];
    const line = summaryLine(
      summary({
        longestNotDetectedRun: {
          startFrame: 2760,
          endFrame: 3131,
          frames: 372,
          lastTrackedPoint: null,
        },
      }),
      frames,
    );
    expect(line).toContain('Tracked 94.1 % of frames');
    expect(line).toContain('1 gap');
    expect(line).toContain('starting at 1:32');
    expect(line).toContain('background warning: none');
  });

  it('says how many background warnings there are when there are any', () => {
    const line = summaryLine(summary({ warnings: ['a dark blob is baked into the background'] }), []);
    expect(line).toContain('background warning: 1');
  });

  // A gap is measured to the moment tracking resumed. Measuring to the last
  // missing frame reports every gap one frame short, and a one-frame gap as
  // "0.0 s" — a gap the same sentence has just claimed exists.
  it('measures a gap to the frame where tracking resumed', () => {
    const frames = [
      frame(0, 'tracked'),
      frame(1, 'not_detected'),
      frame(2, 'tracked'),
      frame(3, 'tracked'),
    ];
    const line = summaryLine(
      summary({
        longestNotDetectedRun: { startFrame: 1, endFrame: 1, frames: 1, lastTrackedPoint: null },
      }),
      frames,
    );
    // One frame at 30 fps is 0.03 s, and is shown as such rather than rounded
    // away to a gap of no length.
    expect(line).toContain('longest 0.03 s');
    expect(gapDurationSeconds({ startFrame: 1, endFrame: 1, frames: 1, lastTrackedPoint: null }, frames)).toBeCloseTo(
      1 / 30,
      6,
    );
  });

  it('counts the whole span of a multi-frame gap', () => {
    const frames = [
      frame(0, 'tracked'),
      ...Array.from({ length: 9 }, (_, i) => frame(1 + i, 'not_detected')),
      frame(10, 'tracked'),
    ];
    const run = { startFrame: 1, endFrame: 9, frames: 9, lastTrackedPoint: null };
    // Nine missing frames at 30 fps is 0.3 s, not 8/30.
    expect(gapDurationSeconds(run, frames)).toBeCloseTo(9 / 30, 6);
  });

  it('still measures a gap that runs to the end of the video', () => {
    const frames = [frame(0, 'tracked'), frame(1, 'tracked'), frame(2, 'not_detected')];
    const run = { startFrame: 2, endFrame: 2, frames: 1, lastTrackedPoint: null };
    expect(gapDurationSeconds(run, frames)).toBeCloseTo(1 / 30, 6);
  });

  it('leaves the gap clause out when there was no gap', () => {
    const line = summaryLine(summary(), [frame(0, 'tracked')]);
    expect(line).toContain('0 gaps');
    expect(line).not.toContain('longest');
  });
});

describe('stateBreakdown', () => {
  it('leads with the states that need review and omits those that did not occur', () => {
    expect(stateBreakdown(summary())).toBe(
      '30 not detected, 9 ambiguous, 20 low confidence, 941 tracked',
    );
    expect(
      stateBreakdown(
        summary({ stateCounts: { tracked: 10, not_detected: 0, ambiguous: 0, low_confidence: 0 } }),
      ),
    ).toBe('10 tracked');
  });
});

describe('progressLine and formatRemaining', () => {
  it('names the frame, the rate and the time left', () => {
    expect(progressLine(2341, 5539, 214.4, 14.9)).toBe(
      'Frame 2,341 of 5,539 · 214 frames/s · about 15 s left',
    );
  });

  it('claims no rate before there is one', () => {
    expect(progressLine(0, 5539, 0, 0)).toBe('Frame 0 of 5,539');
  });

  it('writes long waits in minutes', () => {
    expect(formatRemaining(95)).toBe('1 min 35 s');
    expect(formatRemaining(0.2)).toBe('1 s');
    expect(formatRemaining(Number.NaN)).toBe('—');
  });
});

describe('learnedBlobArea_cm2', () => {
  it('offers the area only when the pass actually learned one (D29)', () => {
    expect(learnedBlobArea_cm2(summary())).toBe(40.1);
    expect(learnedBlobArea_cm2(summary({ expectedBlobAreaSource: 'parameter' }))).toBeNull();
    expect(learnedBlobArea_cm2(summary({ expectedBlobAreaSource: 'unavailable' }))).toBeNull();
  });
});
