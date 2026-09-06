/**
 * A session that exercises every part of the contract, so the round-trip test
 * proves more than "an empty object survives JSON".
 */
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../../src/contracts/mazeMap.js';
import {
  SESSION_SCHEMA_VERSION,
  type SessionFile,
  type VideoAnalysis,
  type VideoDescriptor,
  type VideoFingerprint,
} from '../../src/contracts/session.js';
import type { TrackFrame } from '../../src/contracts/track.js';

export const TOOL_VERSION = 'barnestrack v0.1.0 (abc1234)';

export function fingerprint(overrides: Partial<VideoFingerprint> = {}): VideoFingerprint {
  return {
    byteLength: 2_282_496,
    durationSeconds: 184.633,
    frameCount: 5539,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

export function videoDescriptor(overrides: Partial<VideoDescriptor> = {}): VideoDescriptor {
  return {
    id: 'vid_01',
    filename: 'test50.mp4',
    fingerprint: fingerprint(),
    referenceResolution: { width: 640, height: 480 },
    mazeTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 1 },
    metadata: { animal: '07', day: '1', trial: '3', group: 'control' },
    ...overrides,
  };
}

export function mazeMap(overrides: Partial<MazeMapFile> = {}): MazeMapFile {
  return {
    schemaVersion: MAZE_MAP_SCHEMA_VERSION,
    referenceResolution: { width: 640, height: 480 },
    platform: { cx: 320.5, cy: 240.25, r: 200.75 },
    holes: {
      n: 20,
      ringRatio: 0.89,
      holeRadius_px: 10.9,
      phase_deg: 9,
      offsets: [{ holeIndex: 3, dx_px: 2, dy_px: -1 }],
    },
    target: { holeIndex: 7 },
    calibration: { platformDiameter_cm: 92 },
    createdFrom: 'vid_01',
    ...overrides,
  };
}

function trackFrame(frameIndex: number): TrackFrame {
  return {
    frameIndex,
    t_s: frameIndex / 30,
    centroid: { x: 100, y: 120, confidence: 0.9, valid: true, source: 'auto' },
    nose: { x: 106, y: 114, confidence: 0.7, valid: true, source: 'auto' },
    detectionState: 'tracked',
    reason: 'single_blob',
    blobArea_px2: 842,
    boundingBox: { x: 90, y: 108, width: 30, height: 26 },
    noseHeadingConfidence: 0.7,
  };
}

/**
 * A video that has been tracked but not yet analysed: `derived` is null (D52).
 * This is what chunk 4's tracking pass writes, so both branches of
 * `VideoAnalysis.derived` are typed and round-tripped by the tests.
 */
export function trackedOnlyAnalysis(): VideoAnalysis {
  return {
    auto: { parametersHash: 'p_9f2a', frames: [trackFrame(0), trackFrame(1)] },
    corrections: { entries: [] },
    derived: null,
  };
}

export function videoAnalysis(): VideoAnalysis {
  return {
    auto: { parametersHash: 'p_9f2a', frames: [trackFrame(0), trackFrame(1)] },
    corrections: {
      entries: [
        {
          kind: 'point',
          id: 'corr_01',
          timestamp: '2026-09-05T12:00:00.000Z',
          source: 'user',
          frameIndex: 1,
          point: 'nose',
          value: { x: 110, y: 118, confidence: 1, valid: true },
        },
      ],
    },
    derived: {
      cleanedTrack: [trackFrame(0), trackFrame(1)],
      events: [
        {
          id: 'ev_01',
          kind: 'investigation',
          holeIndex: 7,
          isTarget: true,
          startFrame: 0,
          endFrame: 1,
          startTime_s: 0,
          endTime_s: 1 / 30,
          durationSeconds: 1 / 30,
          pointUsed: 'nose',
          minNoseDistance_cm: 1.2,
          minCentroidDistance_cm: 3.4,
          evidence: 'nose within 1.5 hole radii for 0.21 s',
          source: 'auto',
        },
      ],
      metrics: {
        trialStart_s: 0,
        primaryLatency_s: 12.5,
        totalLatency_s: null,
        primaryErrors: 2,
        totalErrors: 5,
        pathLength_cm: 812.4,
        pathLengthSmoothed_cm: 790.1,
        meanSpeed_cmPerS: 9.3,
        targetQuadrantTime_s: 22.5,
        strategy: 'spatial',
        strategySource: 'auto',
        escaped: false,
        status: 'review',
        trackedFraction: 0.97,
        correctionCount: 1,
      },
      quality: {
        videoId: 'vid_01',
        detectionStateFractions: {
          tracked: 0.97,
          not_detected: 0.02,
          ambiguous: 0.005,
          low_confidence: 0.005,
        },
        gaps: [{ startFrame: 10, endFrame: 12, durationSeconds: 0.067, locationClass: 'hole', holeIndex: 7 }],
        longestGapSeconds: 0.067,
        noseConfidenceHistogram: [{ min: 0, max: 0.5, count: 12 }],
        timebaseAnomalies: { duplicateTimestampCount: 162, droppedFrameGapCount: 214, driftSeconds: 0.433 },
        platformDiameter_cm: 92,
        pxPerCm: 4.364,
        parametersHash: 'p_9f2a',
        tier: 'REVIEW',
      },
    },
  };
}

/** A session with every optional part populated. */
export function fullSession(): SessionFile {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    name: 'cohort3 day1',
    videos: [
      videoDescriptor(),
      videoDescriptor({
        id: 'vid_02',
        filename: 'test51.mp4',
        fingerprint: fingerprint({ byteLength: 455_680, frameCount: 741, sha256: 'b'.repeat(64) }),
        mazeTransform: { translateX: -12.5, translateY: 4, rotationDeg: 0, scale: 1.08 },
        metadata: {},
      }),
      // Tracked but not yet analysed, so `derived: null` round-trips too (D52).
      videoDescriptor({
        id: 'vid_03',
        filename: 'test53.mp4',
        fingerprint: fingerprint({ byteLength: 556_032, frameCount: 905, sha256: 'c'.repeat(64) }),
        metadata: {},
      }),
    ],
    mazeMap: mazeMap(),
    parameters: null,
    analyses: { vid_01: videoAnalysis(), vid_03: trackedOnlyAnalysis() },
  };
}
