/**
 * Search-strategy classification (O7, D23): a transparent rule engine over
 * named features of the search phase (trial start to the first target
 * visit), showing the feature values, the rule that fired, the runner-up and
 * the reasoning in sentences a student can read aloud. The placeholder rules
 * and their numbers come from `Parameters.strategy` (D55, hashed like every
 * other threshold); a user override wins and is stored as a correction.
 */
import type { EventRecord } from '../contracts/events.js';
import type { Parameters } from '../contracts/parameters.js';
import type { TrackFrame } from '../contracts/track.js';
import type { CorrectionsLayer, SearchStrategy } from '../contracts/session.js';
import { latestCorrection } from './corrections.js';
import { holeIndexDistance, inCentreZone, type MazeGeometry } from './geometry.js';
import type { KinematicsSummary } from './kinematics.js';
import { ANALYSIS_MODEL } from './parameters.js';
import { firstTargetEvent } from './metrics.js';
import { framePosition, type TrackArrays } from './track-arrays.js';
import type { TrialBounds } from './trial.js';

export interface StrategyFeatures {
  /** Non-target investigations before the first target visit (O2 primary errors). */
  errors: number;
  /** Largest ring distance, in holes, of an error hole from the target. */
  maxHoleDistanceFromTarget: number;
  /** Longest run of investigations of adjacent holes with no centre crossing during it; the target visit may end it. */
  longestAdjacentRun: number;
  longestAdjacentRunHoles: number[];
  /** Entries into the centre zone during the search phase. */
  centreCrossings: number;
  /** Straight line from the start to where the target was reached ÷ smoothed path there; > 1 only when gaps hide path. */
  pathEfficiency: number;
  /** Cumulative absolute heading change over smoothed steps of at least `tortuosityMinStep_cm`, radians. */
  tortuosity_rad: number;
  targetReached: boolean;
  /** Investigations in the search phase, in time order, the target visit last when reached. */
  sequence: number[];
}

export interface RuleCondition {
  text: string;
  satisfied: boolean;
  /** How close the condition came to holding, 0–1 (1 when it held): limit ÷ value for an upper limit, value ÷ limit for a lower one. */
  degree: number;
}

export interface RuleOutcome {
  strategy: SearchStrategy;
  /** Each condition of the rule with whether it held. */
  conditions: RuleCondition[];
  fired: boolean;
}

export interface StrategyResult {
  strategy: SearchStrategy;
  strategySource: 'auto' | 'corrected';
  autoStrategy: SearchStrategy;
  runnerUp: SearchStrategy;
  features: StrategyFeatures;
  rules: RuleOutcome[];
  reasoning: string[];
}

export interface StrategyInput {
  events: readonly EventRecord[];
  kinematics: KinematicsSummary;
  a: TrackArrays;
  /** The cleaned frames, to map event frame numbers to positions (D7). */
  frames: readonly TrackFrame[];
  g: MazeGeometry;
  bounds: TrialBounds;
  corrections: CorrectionsLayer;
  parameters: Parameters;
}

const ORDER: SearchStrategy[] = ['spatial', 'serial', 'random'];

function emptyFeatures(): StrategyFeatures {
  return {
    errors: 0,
    maxHoleDistanceFromTarget: 0,
    longestAdjacentRun: 0,
    longestAdjacentRunHoles: [],
    centreCrossings: 0,
    pathEfficiency: Number.NaN,
    tortuosity_rad: Number.NaN,
    targetReached: false,
    sequence: [],
  };
}

/** Frames (positions) at which the centroid enters the centre zone inside [from, to]. */
function centreEntries(a: TrackArrays, g: MazeGeometry, from: number, to: number): number[] {
  const entries: number[] = [];
  let inside: boolean | null = null;
  for (let i = from; i <= to; i++) {
    if (a.cValid[i] === 0) continue;
    const now = inCentreZone(g, a.cx[i]!, a.cy[i]!);
    if (now && inside === false) entries.push(i);
    inside = now;
  }
  return entries;
}

function pathOver(k: KinematicsSummary, a: TrackArrays, from: number, to: number): number {
  let path = 0;
  for (let i = from; i < to; i++) {
    if (a.cValid[i] === 1 && a.cValid[i + 1] === 1) {
      path += Math.hypot(
        k.smoothedX[i + 1]! - k.smoothedX[i]!,
        k.smoothedY[i + 1]! - k.smoothedY[i]!,
      );
    }
  }
  return path;
}

function tortuosity(
  k: KinematicsSummary,
  a: TrackArrays,
  g: MazeGeometry,
  from: number,
  to: number,
): number {
  const minStep = ANALYSIS_MODEL.tortuosityMinStep_cm * g.pxPerCm;
  let total = 0;
  let anchorX = Number.NaN;
  let anchorY = Number.NaN;
  let heading = Number.NaN;
  for (let i = from; i <= to; i++) {
    if (a.cValid[i] === 0) {
      anchorX = Number.NaN;
      continue;
    }
    const x = k.smoothedX[i]!;
    const y = k.smoothedY[i]!;
    if (!Number.isFinite(anchorX)) {
      anchorX = x;
      anchorY = y;
      continue;
    }
    const dx = x - anchorX;
    const dy = y - anchorY;
    if (Math.hypot(dx, dy) < minStep) continue;
    const h = Math.atan2(dy, dx);
    if (Number.isFinite(heading)) {
      let d = h - heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += Math.abs(d);
    }
    heading = h;
    anchorX = x;
    anchorY = y;
  }
  return total;
}

export function computeStrategyFeatures(
  input: Omit<StrategyInput, 'corrections' | 'parameters'>,
): StrategyFeatures {
  const { events, kinematics, a, g, bounds, frames } = input;
  if (bounds.startFrame === null || bounds.endFrame === null) return emptyFeatures();
  const start = bounds.startFrame;
  const target = firstTargetEvent(events);
  const targetPosition = target === null ? -1 : framePosition(frames, target.startFrame);
  const phaseEnd =
    target === null || targetPosition < 0
      ? bounds.endFrame
      : Math.min(bounds.endFrame, Math.max(start, targetPosition));

  const investigations = events
    .filter(
      (e) =>
        e.kind === 'investigation' &&
        framePosition(frames, e.startFrame) <= phaseEnd &&
        (target === null || e.startFrame <= target.startFrame),
    )
    .sort((x, y) => x.startFrame - y.startFrame);
  // the target visit that ends the phase is the last element of the sequence
  const sequenceEvents =
    target !== null && target.kind === 'investigation' && !investigations.includes(target)
      ? [...investigations, target]
      : investigations;

  const crossings = centreEntries(a, g, start, phaseEnd);
  const errors = sequenceEvents.filter((e) => !e.isTarget);
  let maxDist = 0;
  for (const e of errors)
    maxDist = Math.max(maxDist, holeIndexDistance(g, e.holeIndex!, g.targetIndex));

  let bestRun: number[] = [];
  let run: number[] = [];
  let runLastEnd = -1;
  for (const e of sequenceEvents) {
    const hole = e.holeIndex!;
    const last = run[run.length - 1];
    if (last === undefined) {
      run = [hole];
    } else if (hole === last) {
      // a repeat of the same hole neither extends nor breaks the run
    } else {
      const startPosition = framePosition(frames, e.startFrame);
      const crossed = crossings.some((f) => f > runLastEnd && f < startPosition);
      if (!crossed && holeIndexDistance(g, hole, last) === 1) run.push(hole);
      else run = [hole];
    }
    runLastEnd = Math.max(runLastEnd, framePosition(frames, e.endFrame));
    if (run.length > bestRun.length) bestRun = [...run];
  }

  let startX = Number.NaN;
  let startY = Number.NaN;
  for (let i = start; i <= phaseEnd; i++) {
    if (a.cValid[i] === 1) {
      startX = a.cx[i]!;
      startY = a.cy[i]!;
      break;
    }
  }
  const path = pathOver(kinematics, a, start, phaseEnd);
  let straight = Number.NaN;
  if (Number.isFinite(startX)) {
    if (target !== null && a.cValid[phaseEnd] === 1) {
      straight = Math.hypot(a.cx[phaseEnd]! - startX, a.cy[phaseEnd]! - startY);
    } else {
      straight = Math.hypot(g.holeX[g.targetIndex]! - startX, g.holeY[g.targetIndex]! - startY);
    }
  }

  return {
    errors: errors.length,
    maxHoleDistanceFromTarget: maxDist,
    longestAdjacentRun: bestRun.length,
    longestAdjacentRunHoles: bestRun,
    centreCrossings: crossings.length,
    pathEfficiency: path > 0 && Number.isFinite(straight) ? straight / path : Number.NaN,
    tortuosity_rad: tortuosity(kinematics, a, g, start, phaseEnd),
    targetReached: target !== null,
    sequence: sequenceEvents.map((e) => e.holeIndex!),
  };
}

function atMost(text: string, value: number, limit: number): RuleCondition {
  const satisfied = value <= limit;
  return { text, satisfied, degree: satisfied ? 1 : value > 0 ? limit / value : 1 };
}

function atLeast(text: string, value: number, limit: number): RuleCondition {
  const satisfied = value >= limit;
  return { text, satisfied, degree: satisfied ? 1 : limit > 0 ? value / limit : 1 };
}

function evaluateRules(f: StrategyFeatures, o: Parameters['strategy']): RuleOutcome[] {
  const spatial: RuleOutcome = {
    strategy: 'spatial',
    conditions: [
      atMost(
        `${f.errors} error${f.errors === 1 ? '' : 's'} (at most ${o.spatialMaxErrors})`,
        f.errors,
        o.spatialMaxErrors,
      ),
      atMost(
        f.errors === 0
          ? `no error hole to be farther than ${o.spatialMaxHoleDistance} holes from the target`
          : `every error hole within ${f.maxHoleDistanceFromTarget} hole${f.maxHoleDistanceFromTarget === 1 ? '' : 's'} of the target (at most ${o.spatialMaxHoleDistance})`,
        f.maxHoleDistanceFromTarget,
        o.spatialMaxHoleDistance,
      ),
      atMost(
        `${f.centreCrossings} centre crossing${f.centreCrossings === 1 ? '' : 's'} (at most ${o.spatialMaxCentreCrossings})`,
        f.centreCrossings,
        o.spatialMaxCentreCrossings,
      ),
    ],
    fired: false,
  };
  spatial.fired = spatial.conditions.every((c) => c.satisfied);
  const runText =
    f.longestAdjacentRunHoles.length > 0 ? ` (${f.longestAdjacentRunHoles.join('→')})` : '';
  const serial: RuleOutcome = {
    strategy: 'serial',
    conditions: [
      atLeast(
        `longest run of adjacent holes with no centre crossing during it ${f.longestAdjacentRun}${runText} (at least ${o.serialMinRun})`,
        f.longestAdjacentRun,
        o.serialMinRun,
      ),
    ],
    fired: false,
  };
  serial.fired = serial.conditions.every((c) => c.satisfied);
  const neither = !spatial.fired && !serial.fired;
  const random: RuleOutcome = {
    strategy: 'random',
    conditions: [
      {
        text: 'neither the spatial nor the serial rule fired',
        satisfied: neither,
        degree: neither ? 1 : 0,
      },
    ],
    fired: neither,
  };
  return [spatial, serial, random];
}

/** Mean degree of satisfaction of a rule's conditions: how close it came to firing. */
function closeness(r: RuleOutcome): number {
  return r.conditions.reduce((sum, c) => sum + c.degree, 0) / r.conditions.length;
}

export function classifyStrategy(input: StrategyInput): StrategyResult {
  const { bounds, corrections, parameters } = input;
  const override = latestCorrection(corrections.entries, 'strategy_override');
  const features = computeStrategyFeatures(input);
  const reasoning: string[] = [];

  let autoStrategy: SearchStrategy;
  let runnerUp: SearchStrategy;
  let rules: RuleOutcome[];
  if (bounds.startFrame === null || bounds.endFrame === null) {
    autoStrategy = 'random';
    runnerUp = 'random';
    rules = [];
    reasoning.push(
      'Not classified: no trial start could be proposed, so the placeholder rules were not applied; recorded as random.',
    );
  } else {
    rules = evaluateRules(features, parameters.strategy);
    const winner = ORDER.find((s) => rules.find((r) => r.strategy === s)!.fired) ?? 'random';
    autoStrategy = winner;
    const others = rules.filter((r) => r.strategy !== winner);
    // the runner-up is the rule that would fire next: another rule that fired, else (when the
    // fallback won) the rule that came closest to firing, ties in the order spatial, serial
    const next =
      others.find((r) => r.fired) ??
      others
        .filter((r) => r.strategy !== 'random')
        .sort(
          (x, y) =>
            closeness(y) - closeness(x) || ORDER.indexOf(x.strategy) - ORDER.indexOf(y.strategy),
        )[0];
    runnerUp =
      winner === 'random'
        ? (next?.strategy ?? 'spatial')
        : (others.find((r) => r.fired)?.strategy ?? 'random');
    reasoning.push(
      `Features over the search phase (trial start to ${features.targetReached ? 'the first target visit' : 'the trial end; the target was never reached'}): ${features.errors} error${features.errors === 1 ? '' : 's'}, holes visited ${features.sequence.length > 0 ? features.sequence.join('→') : 'none'}, max hole distance from the target ${features.maxHoleDistanceFromTarget}, longest adjacent run ${features.longestAdjacentRun}, centre crossings ${features.centreCrossings}, path efficiency ${Number.isFinite(features.pathEfficiency) ? features.pathEfficiency.toFixed(2) : 'n/a'}, tortuosity ${Number.isFinite(features.tortuosity_rad) ? `${features.tortuosity_rad.toFixed(2)} rad` : 'n/a'}.`,
    );
    for (const r of rules) {
      // a rule that fired but lost to an earlier one in the order says so, never "did not fire"
      const verdict =
        r.strategy === winner
          ? 'fired'
          : r.fired
            ? `fired, outranked by ${winner} (rule order ${ORDER.join(' → ')})`
            : r.strategy === 'random'
              ? 'is the fallback'
              : 'did not fire';
      reasoning.push(
        `${r.strategy} ${verdict}: ${r.conditions.map((c) => `${c.text} — ${c.satisfied ? 'yes' : 'no'}`).join('; ')}.`,
      );
    }
    reasoning.push(
      `Classified as ${winner} (the first rule to fire in the order ${ORDER.join(' → ')}); runner-up ${runnerUp}.`,
    );
    if (!features.targetReached && features.sequence.length === 0) {
      reasoning.push(
        'No investigation and no target visit in the trial: the classification rests on an empty search and should be read with the trial status.',
      );
    }
  }

  if (override !== null) {
    reasoning.push(
      `Overridden by the user (correction ${override.id}): ${override.strategy}${override.reason ? ` — ${override.reason}` : ''}. Automatic classification: ${autoStrategy}.`,
    );
    return {
      strategy: override.strategy,
      strategySource: 'corrected',
      autoStrategy,
      runnerUp,
      features,
      rules,
      reasoning,
    };
  }
  return {
    strategy: autoStrategy,
    strategySource: 'auto',
    autoStrategy,
    runnerUp,
    features,
    rules,
    reasoning,
  };
}
