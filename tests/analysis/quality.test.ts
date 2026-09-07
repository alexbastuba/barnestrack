import { describe, expect, it } from 'vitest';
import { cleanTrack } from '../../src/analysis/clean.js';
import { applyTrackCorrections } from '../../src/analysis/corrections.js';
import { DEFAULT_PARAMETERS, hashParameters } from '../../src/analysis/parameters.js';
import {
  findGaps,
  noseConfidenceHistogram,
  qualityReport,
  qualityTier,
  timebaseAnomalies,
} from '../../src/analysis/quality.js';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import { proposeTrialStart, trialBounds, type TrialBounds } from '../../src/analysis/trial.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import { TEST_PLATFORM, testGeometry } from './maze-fixture.js';
import { holePoint, scriptTrack, type Segment } from './synthetic-track.js';
import { buildTrack, timebase } from './track-builder.js';

const g = testGeometry();
const none = { entries: [] };

function report(
  segments: Segment[],
  opts: {
    p?: Parameters;
    withTrial?: boolean;
    anomalies?: { duplicatesAt?: number[]; dropsAt?: number[] };
  } = {},
) {
  const p = opts.p ?? DEFAULT_PARAMETERS;
  const scripted = scriptTrack(segments, { g, ...opts.anomalies });
  const frames = applyTrackCorrections(scripted.frames, none).frames;
  const corrected = buildTrackArrays(frames, g);
  const cleanedFrames = cleanTrack(frames, corrected, g, p).track;
  const cleaned = buildTrackArrays(cleanedFrames, g);
  const proposal = proposeTrialStart(frames, corrected, none);
  const start = opts.withTrial === false ? null : proposal.startFrame;
  const bounds: TrialBounds = trialBounds(
    corrected,
    { ...proposal, startFrame: start },
    start === null ? null : frames.length - 1,
    start === null
      ? { endFrame: null, endReason: 'no_start' }
      : { endFrame: frames.length - 1, endReason: 'end_of_video' },
  );
  const q = qualityReport({
    videoId: 'v',
    corrected,
    cleaned,
    frames: cleanedFrames,
    g,
    p,
    parametersHash: hashParameters(p),
    bounds,
  });
  return { q, corrected, cleaned, frames, segmentStarts: scripted.segmentStarts };
}

describe('qualityReport (D30)', () => {
  it('gives state fractions over the trial window in a fixed key order, so an empty start does not count', () => {
    const { q } = report([
      { kind: 'empty', seconds: 1 },
      { kind: 'dwell', seconds: 1 },
      { kind: 'dwell', seconds: 1, state: 'low_confidence', reason: 'small_blob' },
    ]);
    expect(Object.keys(q.detectionStateFractions)).toEqual([
      'tracked',
      'not_detected',
      'ambiguous',
      'low_confidence',
    ]);
    expect(q.detectionStateFractions).toEqual({
      tracked: 0.5,
      not_detected: 0,
      ambiguous: 0,
      low_confidence: 0.5,
    });
    expect(q.gaps).toEqual([]);
    expect(q.tier).toBe('GOOD');
    const whole = report(
      [
        { kind: 'empty', seconds: 1 },
        { kind: 'dwell', seconds: 1 },
        { kind: 'dwell', seconds: 1, state: 'low_confidence', reason: 'small_blob' },
      ],
      { withTrial: false },
    );
    expect(whole.q.detectionStateFractions.not_detected).toBeCloseTo(1 / 3, 12);
    expect(whole.q.gaps).toHaveLength(1);
    expect(whole.q.gaps[0]).toMatchObject({
      startFrame: 0,
      endFrame: 29,
      locationClass: 'open_platform',
    });
  });

  it('clusters gaps by run with a location class from where the animal was last seen, and the longest gap', () => {
    const rim = {
      x: TEST_PLATFORM.cx + 0.95 * TEST_PLATFORM.r * Math.cos(Math.PI / 20),
      y: TEST_PLATFORM.cy + 0.95 * TEST_PLATFORM.r * Math.sin(Math.PI / 20),
    }; // between holes 0 and 1, outside the ring
    const { q, segmentStarts } = report([
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 0.5 },
      { kind: 'moveToHole', hole: 4, seconds: 0.5 },
      { kind: 'dwell', hole: 4, seconds: 0.3 },
      { kind: 'lost', seconds: 1.5 },
      { kind: 'dwell', hole: 4, seconds: 0.3 },
      { kind: 'moveTo', x: rim.x, y: rim.y, seconds: 0.5 },
      { kind: 'dwell', seconds: 0.2 },
      { kind: 'lost', seconds: 0.1 },
      { kind: 'dwell', seconds: 0.2 },
    ]);
    expect(q.gaps.map((gap) => [gap.locationClass, gap.holeIndex ?? null])).toEqual([
      ['open_platform', null],
      ['hole', 4],
      ['rim', null],
    ]);
    expect(q.gaps[1]).toMatchObject({
      startFrame: segmentStarts[4],
      endFrame: segmentStarts[5]! - 1,
    });
    expect(q.gaps[1]!.durationSeconds).toBeCloseTo(46 / 30, 9); // 45 lost frames plus the two positioned frames either side
    expect(q.longestGapSeconds).toBe(q.gaps[1]!.durationSeconds);
    expect(q.gaps[2]!.durationSeconds).toBeCloseTo(4 / 30, 9);
  });

  it('classes a leading gap by the first frame after it', () => {
    const p = holePoint(g, 9);
    const frames = buildTrack([null, null, [p.x, p.y], [p.x, p.y]]);
    const a = buildTrackArrays(frames, g);
    expect(findGaps(a, frames, g, 0, 3)).toEqual([
      {
        startFrame: 0,
        endFrame: 1,
        durationSeconds: expect.closeTo(2 / 30, 12),
        locationClass: 'hole',
        holeIndex: 9,
      },
    ]);
    const nothingFrames = buildTrack([null, null]);
    const nothing = buildTrackArrays(nothingFrames, g);
    expect(findGaps(nothing, nothingFrames, g, 0, 1)[0]!.locationClass).toBe('open_platform');
    // gaps are named by frameIndex (D7), not by array position
    const offset = frames.map((f) => ({ ...f, frameIndex: f.frameIndex + 1000 }));
    expect(findGaps(buildTrackArrays(offset, g), offset, g, 0, 3)[0]).toMatchObject({
      startFrame: 1000,
      endFrame: 1001,
    });
  });

  it('histograms the nose-heading confidence of positioned frames into five bins', () => {
    const { q, cleaned } = report([
      { kind: 'dwell', seconds: 0.5, noseConf: 0 },
      { kind: 'dwell', seconds: 0.5, noseConf: 0.5 },
      { kind: 'dwell', seconds: 0.5, noseConf: 1 },
      { kind: 'lost', seconds: 0.5 },
    ]);
    expect(q.noseConfidenceHistogram).toHaveLength(5);
    expect(q.noseConfidenceHistogram.map((b) => b.count)).toEqual([15, 0, 15, 0, 15]);
    expect(q.noseConfidenceHistogram[0]).toEqual({ min: 0, max: 0.2, count: 15 });
    expect(q.noseConfidenceHistogram[4]).toEqual({ min: 0.8, max: 1, count: 15 });
    expect(noseConfidenceHistogram(cleaned, 0, -1).every((b) => b.count === 0)).toBe(true);
  });

  it('counts timebase anomalies from the timestamps with the session factors, and takes drift from the index when given', () => {
    const { q, cleaned } = report([{ kind: 'dwell', seconds: 2 }], {
      anomalies: { duplicatesAt: [5, 20], dropsAt: [30] },
    });
    expect(q.timebaseAnomalies).toEqual({
      duplicateTimestampCount: 2,
      droppedFrameGapCount: 1,
      driftSeconds: expect.closeTo(-1 / 30, 9),
    });
    // 60 frames: 57 nominal steps, 2 duplicates (−2/30) and 1 double gap (+1/30) net −1/30 against nominal-rate arithmetic
    expect(cleaned.length).toBe(60);
    expect(timebaseAnomalies(cleaned, DEFAULT_PARAMETERS).driftSeconds).toBeCloseTo(-1 / 30, 9);
    const fromIndex = timebaseAnomalies(cleaned, DEFAULT_PARAMETERS, {
      duplicateTimestampPairs: 99,
      droppedFrameGaps: 99,
      dropGapFactor: 1.5,
      driftSeconds: 0.433,
      nominalTick: 512,
    });
    expect(fromIndex).toEqual({
      duplicateTimestampCount: 2,
      droppedFrameGapCount: 1,
      driftSeconds: 0.433,
    });
    // a near-duplicate (one tick) counts under O11 even though it is not an exact tie
    const t = timebase(4, 30);
    t[2] = t[1]! + 1e-5;
    const near = buildTrackArrays(
      buildTrack(
        [
          [322, 240],
          [322, 240],
          [322, 240],
          [322, 240],
        ],
        t,
      ),
      g,
    );
    expect(timebaseAnomalies(near, DEFAULT_PARAMETERS).duplicateTimestampCount).toBe(1);
  });

  it('tiers the video on the positioned fraction of the trial window with the two thresholds', () => {
    const thresholds = DEFAULT_PARAMETERS.quality;
    expect(qualityTier(0.95, thresholds)).toBe('GOOD');
    expect(qualityTier(0.9, thresholds)).toBe('GOOD');
    expect(qualityTier(0.8, thresholds)).toBe('REVIEW');
    expect(qualityTier(0.7, thresholds)).toBe('REVIEW');
    expect(qualityTier(0.69, thresholds)).toBe('POOR');
    expect(qualityTier(Number.NaN, thresholds)).toBe('POOR');
    // the thresholds are parameters (D55): a stricter GOOD line moves the tier
    expect(qualityTier(0.95, { goodMinPositionedFraction: 0.97, poorMaxPositionedFraction: 0.7 })).toBe(
      'REVIEW',
    );
    const poor = report([
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 2 },
      { kind: 'dwell', seconds: 0.5 },
    ]);
    expect(poor.q.tier).toBe('POOR');
    const review = report([
      { kind: 'dwell', seconds: 2 },
      { kind: 'lost', seconds: 0.5 },
      { kind: 'dwell', seconds: 0.5 },
    ]);
    expect(review.q.tier).toBe('REVIEW');
    // filled frames never count toward the tier: gap filling on or off gives the same answer (D16)
    const script: Segment[] = [
      { kind: 'dwell', seconds: 0.5 },
      { kind: 'lost', seconds: 0.05 },
      { kind: 'dwell', seconds: 0.2 },
      { kind: 'lost', seconds: 0.05 },
      { kind: 'dwell', seconds: 0.2 },
    ];
    const on = report(script);
    const off = report(script, {
      p: { ...DEFAULT_PARAMETERS, gapFilling: { enabled: false, maxDuration_s: 0.1 } },
    });
    expect(on.q.tier).toBe('REVIEW');
    expect(off.q.tier).toBe(on.q.tier);
    expect(on.q.gaps).toHaveLength(2); // the gaps are still reported
  });

  it('carries the calibration and the parameters hash', () => {
    const { q } = report([{ kind: 'dwell', seconds: 1 }]);
    expect(q.videoId).toBe('v');
    expect(q.platformDiameter_cm).toBe(92);
    expect(q.pxPerCm).toBeCloseTo(g.pxPerCm, 12);
    expect(q.parametersHash).toBe(hashParameters(DEFAULT_PARAMETERS));
  });
});
