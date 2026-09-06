/**
 * Reading a figure's inputs out of the session, in one place so no figure
 * re-derives geometry for itself. Hole centres always come from the shared maze
 * map put through the video's own transform (D10, D49) — never recomputed.
 */
import type { MazeMapFile } from '../contracts/mazeMap.js';
import type { SessionFile, VideoAnalysis, VideoDescriptor } from '../contracts/session.js';
import type { TrackFrame } from '../contracts/track.js';
import type { HolePosition } from '../maze/ring.js';
import { holeCentres, pxPerCm } from '../maze/ring.js';
import { transformMap } from '../maze/similarity.js';
import type { Point } from '../maze/types.js';
import type { FigureData } from './types.js';

export interface TrialSource {
  descriptor: VideoDescriptor;
  analysis: VideoAnalysis;
  /** The shared maze map expressed in this video's pixels. */
  map: MazeMapFile;
  holes: HolePosition[];
  targetIndex: number;
  pixelsPerCm: number;
}

export function trialSource(data: FigureData): TrialSource | null {
  const { session, videoId } = data;
  if (!session.mazeMap) return null;
  const descriptor = session.videos.find((video) => video.id === videoId);
  const analysis = session.analyses[videoId];
  if (!descriptor || !analysis) return null;
  const map = transformMap(
    session.mazeMap,
    descriptor.mazeTransform,
    descriptor.referenceResolution,
  );
  return {
    descriptor,
    analysis,
    map,
    holes: holeCentres(map),
    targetIndex: map.target.holeIndex,
    pixelsPerCm:
      pxPerCm(map.platform, map.calibration.platformDiameter_cm) ??
      analysis.derived.quality.pxPerCm,
  };
}

/** Every trial in the session that has been analysed, in session order. */
export function analysedTrials(session: SessionFile): TrialSource[] {
  const out: TrialSource[] = [];
  for (const video of session.videos) {
    const source = trialSource({ session, videoId: video.id });
    if (source) out.push(source);
  }
  return out;
}

/** A short human label for a trial: the metadata if there is any, else the file. */
export function trialLabel(descriptor: VideoDescriptor): string {
  const { animal, day, trial } = descriptor.metadata;
  const parts = [animal, day ? `day ${day}` : undefined, trial ? `trial ${trial}` : undefined];
  const label = parts.filter(Boolean).join(' · ');
  return label || descriptor.filename;
}

export interface PathPoint extends Point {
  frame: TrackFrame;
  /** Seconds from the start of the clip. */
  t_s: number;
  /** Filled by the cleaning step rather than detected (O10). */
  filled: boolean;
}

/** Valid centroid positions of the cleaned track, in this video's pixels. */
export function centroidPath(analysis: VideoAnalysis): PathPoint[] {
  const out: PathPoint[] = [];
  for (const frame of analysis.derived.cleanedTrack) {
    if (!frame.centroid.valid) continue;
    out.push({
      x: frame.centroid.x,
      y: frame.centroid.y,
      frame,
      t_s: frame.t_s,
      filled: frame.centroid.source === 'filled',
    });
  }
  return out;
}

/**
 * Speed at each path point, cm/s, over a centred window of `windowFrames` on
 * either side using the frames' own timestamps (O11). Steps whose elapsed time
 * is zero — a duplicate presentation timestamp — contribute nothing rather than
 * an infinite speed.
 */
export function speedsCmPerS(
  path: readonly PathPoint[],
  pixelsPerCm: number,
  windowFrames: number,
): number[] {
  return path.map((_, index) => {
    const first = Math.max(0, index - windowFrames);
    const last = Math.min(path.length - 1, index + windowFrames);
    const elapsed = path[last]!.t_s - path[first]!.t_s;
    if (elapsed <= 0) return 0;
    let distance = 0;
    for (let i = first + 1; i <= last; i++) {
      distance += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    }
    return distance / pixelsPerCm / elapsed;
  });
}

/** The highest speed below the given percentile, so one jump cannot flatten a scale. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index]!;
}
