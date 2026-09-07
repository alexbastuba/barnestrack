/**
 * Smoke run of the analysis engine on the tracker's real output for the
 * three sample videos (`prototypes/tracker/out/<video>.track.json`, produced
 * by `scripts/track-node.ts`; gitignored). Skipped, with a printed reason,
 * when those files are absent. There is no ground truth: this is a sanity
 * check against the contact sheets, recorded in prototypes/analysis/RESULTS.md,
 * not an acceptance test.
 *
 * The recorded map (chunk-3 handoff, target hole 7) is the record. The
 * "signature check" cases derive test51 and test53 a second time with the
 * target at the hole the animal ends at, purely to show whether the revised
 * O4 entry rule fires on a real head-in-hole run; they change nothing that is
 * recorded.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { derive, type DeriveInput, type DerivedAnalysis } from '../../src/analysis/derive.js';
import { distanceToHole_px, nearestHoleIndex } from '../../src/analysis/geometry.js';
import { ANALYSIS_MODEL, DEFAULT_PARAMETERS, isRecorded } from '../../src/analysis/parameters.js';
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../../src/contracts/mazeMap.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { IDENTITY_TRANSFORM, transformFromCircles } from '../../src/maze/similarity.js';
import { parseMp4Index, type TimebaseAnomalies } from '../../src/video/mp4-index.js';

const OUT_DIR = new URL('../../prototypes/tracker/out/', import.meta.url).pathname;
const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
const VIDEOS = ['test50', 'test51', 'test53'] as const;
type Video = (typeof VIDEOS)[number];
const present = VIDEOS.every((v) => existsSync(join(OUT_DIR, `${v}.track.json`)));
if (!present) {
  console.warn(
    'prototypes/tracker/out/<video>.track.json not found; sample-video derive smoke run skipped (see prototypes/tracker/RESULTS.md to regenerate)',
  );
}

/** Chunk-3 handoff: the maze as fitted in Chrome; test50 and test53 share the rig, test51 needs the fit. */
const MAP: MazeMapFile = {
  schemaVersion: MAZE_MAP_SCHEMA_VERSION,
  referenceResolution: { width: 640, height: 480 },
  platform: { cx: 327.8, cy: 239.7, r: 208.5 },
  holes: { n: 20, ringRatio: 0.89, holeRadius_px: 11.3, phase_deg: 356.82 },
  target: { holeIndex: 7 },
  calibration: { platformDiameter_cm: 92 },
  createdFrom: 'test53',
};
const TEST51_PLATFORM = { cx: 280.0, cy: 239.9, r: 222.5 };

/** The hole each clip's animal ends at with its head in (from the contact sheets and the chunk-5 run). */
const ENDS_AT: Partial<Record<Video, number>> = { test51: 19, test53: 2 };

interface TrackJson {
  frames: TrackFrame[];
  index: { width: number; height: number; nominalFps: number; durationSeconds: number };
}

async function timebaseFor(video: string): Promise<TimebaseAnomalies | undefined> {
  if (!SAMPLE_DIR) return undefined;
  const path = join(SAMPLE_DIR, `${video}.mp4`);
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const index = await parseMp4Index(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    {
      dropGapFactor: DEFAULT_PARAMETERS.kinematics.dropGapFactor,
    },
  );
  return index.timebaseAnomalies;
}

async function inputFor(video: Video, map: MazeMapFile): Promise<DeriveInput> {
  const json = JSON.parse(readFileSync(join(OUT_DIR, `${video}.track.json`), 'utf-8')) as TrackJson;
  const transform =
    video === 'test51' ? transformFromCircles(map.platform, TEST51_PLATFORM)! : IDENTITY_TRANSFORM;
  const timebase = await timebaseFor(video);
  return {
    videoId: video,
    auto: { parametersHash: 'tracker-run', frames: json.frames },
    corrections: { entries: [] },
    mazeMap: map,
    mazeTransform: transform,
    index: {
      width: json.index.width,
      height: json.index.height,
      ...(timebase ? { timebaseAnomalies: timebase } : {}),
    },
    parameters: DEFAULT_PARAMETERS,
  };
}

const f2 = (x: number | null): string => (x === null || !isRecorded(x) ? '—' : x.toFixed(2));

/**
 * Stretches of partial detections (`ANALYSIS_MODEL.entryPartialReasons`) of at
 * least half a second, with the nearest hole and the centroid's distance to it
 * at the middle frame — what the revised O4 rule looks at.
 */
function partialRuns(d: DerivedAnalysis): string[] {
  const g = d.geometry;
  const reasons: readonly string[] = ANALYSIS_MODEL.entryPartialReasons;
  const track = d.cleanedTrack;
  const isPartial = (f: TrackFrame): boolean =>
    f.detectionState === 'low_confidence' && reasons.includes(f.reason);
  const lines: string[] = [];
  let i = 0;
  while (i < track.length) {
    if (!isPartial(track[i]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < track.length && isPartial(track[i]!)) i++;
    const end = i - 1;
    const duration = track[end]!.t_s - track[start]!.t_s;
    if (duration < 0.5) continue;
    const mid = track[(start + end) >> 1]!;
    const k = nearestHoleIndex(g, mid.centroid.x, mid.centroid.y);
    const dist = distanceToHole_px(g, mid.centroid.x, mid.centroid.y, k) / g.pxPerCm;
    lines.push(
      `- partial run frames ${track[start]!.frameIndex}–${track[end]!.frameIndex} (${end - start + 1} frames, ${duration.toFixed(2)} s first-to-last), nearest hole ${k}${k === g.targetIndex ? ' (target)' : ''}, centroid ${dist.toFixed(1)} cm from its centre (entry radius ${(g.escapeRadius_px / g.pxPerCm).toFixed(1)} cm, minimum ${DEFAULT_PARAMETERS.escapeEntry.minDuration_s} s)`,
    );
  }
  return lines;
}

describe.skipIf(!present)(
  'derive on the sample videos (tracker output in prototypes/tracker/out)',
  () => {
    for (const video of VIDEOS) {
      it(`${video}: derives and prints its summary`, async () => {
        const input = await inputFor(video, MAP);
        const timebase = input.index.timebaseAnomalies;
        derive(input);
        const times: number[] = [];
        let d = derive(input);
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          d = derive(input);
          times.push(performance.now() - t0);
        }
        times.sort((x, y) => x - y);
        const m = d.metrics;
        const q = d.quality;
        const byKind = { investigation: 0, escape_entry: 0, tracking_failure: 0 };
        for (const ev of d.events) byKind[ev.kind]++;
        const lines = [
          `### ${video}`,
          '',
          `| field | value |`,
          `| --- | --- |`,
          `| frames · px/cm | ${input.auto.frames.length} · ${q.pxPerCm.toFixed(3)} |`,
          `| trial start | frame ${d.trial.startFrame} (${f2(d.trial.startTime_s)} s, ${d.trial.startSource}; last oversized frame ${d.trial.lastOversizedFrame}) |`,
          `| trial end | frame ${d.trial.endFrame} (${f2(d.trial.endTime_s)} s), ${d.trial.endReason} |`,
          `| primary latency · total latency | ${f2(m.primaryLatency_s)} s · ${f2(m.totalLatency_s)} s |`,
          `| primary errors · total errors | ${m.primaryErrors} · ${m.totalErrors} |`,
          `| escaped · status | ${m.escaped} · ${m.status} |`,
          `| strategy (source) · runner-up | ${m.strategy} (${m.strategySource}) · ${d.strategy.runnerUp} |`,
          `| path raw · smoothed · mean speed | ${f2(m.pathLength_cm)} cm · ${f2(m.pathLengthSmoothed_cm)} cm · ${f2(m.meanSpeed_cmPerS)} cm/s |`,
          `| target-quadrant time (fraction) | ${f2(m.targetQuadrantTime_s)} s (${f2(d.kinematics.targetQuadrantFraction)}) |`,
          `| tracked fraction (trial) · positioned (trial · whole clip) · tier | ${f2(m.trackedFraction)} · ${f2(q.positionedFraction)} · ${f2(q.wholeClipPositionedFraction)} · ${q.tier} |`,
          `| events judged on the nose | ${f2(q.noseJudgedEventFraction)} |`,
          `| events: investigations · escape entries · tracking failures | ${byKind.investigation} · ${byKind.escape_entry} · ${byKind.tracking_failure} |`,
          `| holes visited (time order) | ${d.strategy.features.sequence.join('→') || 'none'} |`,
          `| filled frames · outliers · unfilled gaps | ${d.cleaning.filledFrames} · ${d.cleaning.outlierFrames} · ${d.cleaning.unfilledGaps.length} |`,
          `| quality gaps · longest | ${q.gaps.length} · ${q.longestGapSeconds.toFixed(2)} s |`,
          `| timebase: duplicates · drops · drift | ${q.timebaseAnomalies.duplicateTimestampCount} · ${q.timebaseAnomalies.droppedFrameGapCount} · ${q.timebaseAnomalies.driftSeconds.toFixed(3)} s${timebase ? ' (drift from the MP4 index)' : ' (from the timestamps)'} |`,
          `| review flags | ${d.reviewFlags.length === 0 ? 'none' : d.reviewFlags.map((r) => `${r.code} @ frame ${r.frameIndex}`).join('; ')} |`,
          `| derive time (median of 5) | ${times[2]!.toFixed(1)} ms (${times.map((t) => t.toFixed(1)).join(' / ')}) |`,
          '',
          ...partialRuns(d),
          ...d.events
            .filter((ev) => ev.kind !== 'investigation' || ev.evidence.startsWith('Physically'))
            .map(
              (ev) =>
                `- ${ev.kind} at hole ${ev.holeIndex}, frames ${ev.startFrame}–${ev.endFrame}: ${ev.evidence}`,
            ),
          ...d.strategy.reasoning.map((r) => `- strategy: ${r}`),
          '',
        ];
        console.info(lines.join('\n'));

        // sanity, not acceptance
        expect(d.cleanedTrack).toHaveLength(input.auto.frames.length);
        expect(d.trial.startFrame).not.toBeNull();
        if (video === 'test53' || video === 'test50')
          expect(d.trial.startFrame!).toBeGreaterThanOrEqual(150);
        if (video === 'test51') expect(d.trial.startFrame!).toBeGreaterThanOrEqual(75);
        const fractions = Object.values(q.detectionStateFractions).reduce((s, x) => s + x, 0);
        expect(fractions).toBeCloseTo(1, 9);
        for (let i = 1; i < d.events.length; i++)
          expect(d.events[i]!.startFrame).toBeGreaterThanOrEqual(d.events[i - 1]!.startFrame);
        expect(times[2]!).toBeLessThan(250);
      });
    }

    for (const video of VIDEOS) {
      const hole = ENDS_AT[video];
      if (hole === undefined) continue;
      it(`${video}: signature check with the target moved to hole ${hole} (test-only; the recorded map keeps target 7)`, async () => {
        const input = await inputFor(video, { ...MAP, target: { holeIndex: hole } });
        const d = derive(input);
        const entries = d.events.filter((ev) => ev.kind === 'escape_entry');
        const lines = [
          `### ${video}, target moved to hole ${hole} (signature check only)`,
          '',
          `- trial end: frame ${d.trial.endFrame} (${f2(d.trial.endTime_s)} s), ${d.trial.endReason}; escaped ${d.metrics.escaped}; total latency ${f2(d.metrics.totalLatency_s)} s`,
          `- escape entries: ${entries.length === 0 ? 'none' : entries.map((ev) => `frames ${ev.startFrame}–${ev.endFrame} (${ev.durationSeconds.toFixed(2)} s)`).join('; ')}`,
          `- review flags: ${d.reviewFlags.length === 0 ? 'none' : d.reviewFlags.map((r) => `${r.code} @ frame ${r.frameIndex}`).join('; ')}`,
          ...partialRuns(d),
          ...entries.map((ev) => `- ${ev.evidence}`),
          '',
        ];
        console.info(lines.join('\n'));
        expect(d.cleanedTrack).toHaveLength(input.auto.frames.length);
      });
    }
  },
);
