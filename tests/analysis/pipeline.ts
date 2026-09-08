/**
 * The analysis steps chained by hand for the metrics and strategy tests
 * (the `derive` entry point has its own tests). No cleaning: these tests
 * script clean tracks.
 */
import { applyTrackCorrections } from '../../src/analysis/corrections.js';
import {
  applyEventCorrections,
  detectAutoEvents,
  eventPoints,
  type EventContext,
} from '../../src/analysis/events.js';
import type { MazeGeometry } from '../../src/analysis/geometry.js';
import { computeKinematics } from '../../src/analysis/kinematics.js';
import { computeMetrics } from '../../src/analysis/metrics.js';
import { DEFAULT_PARAMETERS } from '../../src/analysis/parameters.js';
import { classifyStrategy } from '../../src/analysis/strategy.js';
import { buildTrackArrays } from '../../src/analysis/track-arrays.js';
import { proposeTrialStart, trialBounds } from '../../src/analysis/trial.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionsLayer } from '../../src/contracts/session.js';
import type { ReviewFlag } from '../../src/analysis/types.js';
import { testGeometry } from './maze-fixture.js';
import { scriptTrack, type Segment } from './synthetic-track.js';

export interface PipelineOptions {
  g?: MazeGeometry;
  p?: Parameters;
  corrections?: CorrectionsLayer;
  fps?: number;
}

export function pipeline(segments: Segment[], opts: PipelineOptions = {}) {
  const g = opts.g ?? testGeometry();
  const p = opts.p ?? DEFAULT_PARAMETERS;
  const corrections = opts.corrections ?? { entries: [] };
  const scripted = scriptTrack(segments, { g, fps: opts.fps });
  const frames = applyTrackCorrections(scripted.frames, corrections).frames;
  const a = buildTrackArrays(frames, g);
  const pts = eventPoints(a, g, p, frames);
  const ctx: EventContext = { frames, a, g, p, pts };
  const proposal = proposeTrialStart(frames, a, corrections);
  const auto = detectAutoEvents(ctx, proposal.startFrame);
  const corrected = applyEventCorrections(ctx, auto.events, corrections, auto.endFrame);
  const bounds = trialBounds(a, proposal, auto.cutoffFrame, {
    endFrame: auto.endFrame,
    endReason: auto.endReason,
  });
  const window =
    bounds.startFrame === null || bounds.endFrame === null
      ? null
      : { startFrame: bounds.startFrame, endFrame: bounds.endFrame };
  const kinematics = computeKinematics(a, g, p, window);
  const strategy = classifyStrategy({
    frames,
    events: corrected.events,
    kinematics,
    a,
    g,
    bounds,
    corrections,
    parameters: p,
  });
  const flags: ReviewFlag[] = [...proposal.flags, ...auto.flags, ...corrected.flags];
  const metrics = computeMetrics({
    bounds,
    events: corrected.events,
    flags,
    kinematics,
    a,
    strategy,
    noEscapeConfirmed: corrections.entries.some((entry) => entry.kind === 'no_escape'),
    correctionCount: corrections.entries.length,
    parameters: p,
  });
  return {
    g,
    frames,
    a,
    bounds,
    events: corrected.events,
    flags,
    kinematics,
    strategy,
    metrics,
    segmentStarts: scripted.segmentStarts,
  };
}
