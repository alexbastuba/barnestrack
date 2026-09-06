/**
 * Event detection (O1, O4, D19, D20): hole investigations from dwell at a
 * hole, and the three readings of a loss of detection — escape-box entry,
 * a physically unlikely "entry" at a non-target hole, or a tracking
 * failure — decided from evidence the user can inspect: where the animal was
 * last seen, how long it was lost, whether and where it reappeared, and how
 * the blob area was trending. Event corrections are applied afterwards and
 * stay pinned through parameter changes.
 *
 * Every number here comes from `Parameters`, the geometry or `ANALYSIS_MODEL`.
 */
import type { EventKind, EventRecord } from '../contracts/events.js';
import type { Parameters } from '../contracts/parameters.js';
import type { CorrectionsLayer, EventCorrection } from '../contracts/session.js';
import type { NamedPointId, TrackFrame } from '../contracts/track.js';
import { IN_ESCAPE_BOX_REASON, correctionsOfKind } from './corrections.js';
import {
  distanceFromCentre_cm,
  distanceToHole_px,
  nearestHoleIndex,
  type MazeGeometry,
} from './geometry.js';
import { ANALYSIS_MODEL } from './parameters.js';
import type { TrackArrays } from './track-arrays.js';
import { cutoffFrame, resolveTrialEnd, type TrialEndReason } from './trial.js';
import type { ReviewFlag } from './types.js';

// ---------------------------------------------------------------------------
// Per-frame event points
// ---------------------------------------------------------------------------

export interface EventPoints {
  /** 1 when the nose is the event point: valid and (hand-placed or heading confidence ≥ cutoff). O16, D18. */
  useNose: Uint8Array;
  /** The event point per positioned frame (NaN elsewhere). */
  ex: Float64Array;
  ey: Float64Array;
  /** Hole the event point is at (within the investigation radius), else -1. */
  holeAt: Int16Array;
  /** Nearest hole to the event point per positioned frame, else -1. */
  nearest: Int16Array;
  /** Distance from the event point to its nearest hole, px (NaN elsewhere). */
  nearestDistance_px: Float64Array;
}

export function eventPoints(a: TrackArrays, g: MazeGeometry, p: Parameters): EventPoints {
  const n = a.length;
  const useNose = new Uint8Array(n);
  const ex = new Float64Array(n).fill(Number.NaN);
  const ey = new Float64Array(n).fill(Number.NaN);
  const holeAt = new Int16Array(n).fill(-1);
  const nearest = new Int16Array(n).fill(-1);
  const nearestDistance_px = new Float64Array(n).fill(Number.NaN);
  const cutoff = p.noseConfidenceCutoff;
  for (let i = 0; i < n; i++) {
    if (a.cValid[i] === 0) continue;
    const nose = a.nValid[i] === 1 && (a.nCorrected[i] === 1 || a.noseConf[i]! >= cutoff);
    useNose[i] = nose ? 1 : 0;
    const x = nose ? a.nx[i]! : a.cx[i]!;
    const y = nose ? a.ny[i]! : a.cy[i]!;
    ex[i] = x;
    ey[i] = y;
    const k = nearestHoleIndex(g, x, y);
    const d = distanceToHole_px(g, x, y, k);
    nearest[i] = k;
    nearestDistance_px[i] = d;
    if (d <= g.investigationRadius_px) holeAt[i] = k;
  }
  return { useNose, ex, ey, holeAt, nearest, nearestDistance_px };
}

// ---------------------------------------------------------------------------
// Formatting helpers for the evidence sentences (deterministic: toFixed only)
// ---------------------------------------------------------------------------

const s2 = (t: number): string => `${t.toFixed(2)} s`;
const cm1 = (cm: number): string => (Number.isFinite(cm) ? `${cm.toFixed(1)} cm` : 'n/a');
const holeName = (g: MazeGeometry, k: number): string =>
  `hole ${k}${k === g.targetIndex ? ' (target)' : ' (non-target)'}`;

function frameSpan(
  a: TrackArrays,
  frames: readonly TrackFrame[],
  start: number,
  end: number,
): string {
  return `frames ${frames[start]!.frameIndex}–${frames[end]!.frameIndex} (${s2(a.t[start]!)}–${s2(a.t[end]!)})`;
}

function blobTrend(a: TrackArrays, before: number): string {
  const w = ANALYSIS_MODEL.blobTrendWindowFrames;
  let first = Number.NaN;
  let last = Number.NaN;
  let count = 0;
  for (let i = Math.max(0, before - w + 1); i <= before; i++) {
    if (a.cValid[i] === 0) continue;
    if (!Number.isFinite(first)) first = a.blobArea[i]!;
    last = a.blobArea[i]!;
    count++;
  }
  if (count < 2)
    return `no blob-area trend available (${count} positioned frame${count === 1 ? '' : 's'} in the ${w} before the loss)`;
  const ratio = first > 0 ? last / first : 1;
  const verb = ratio < 0.8 ? 'fell' : ratio > 1.25 ? 'rose' : 'was steady';
  return `blob area ${verb} from ${first.toFixed(0)} to ${last.toFixed(0)} px² over the ${count} positioned frames before the loss`;
}

// ---------------------------------------------------------------------------
// Distances over a span
// ---------------------------------------------------------------------------

interface SpanDistances {
  minNose_cm: number;
  minCentroid_cm: number;
  noseFrames: number;
  centroidFrames: number;
}

function spanDistances(
  a: TrackArrays,
  g: MazeGeometry,
  pts: EventPoints,
  hole: number,
  start: number,
  end: number,
): SpanDistances {
  let minNose = Number.POSITIVE_INFINITY;
  let minCentroid = Number.POSITIVE_INFINITY;
  let noseFrames = 0;
  let centroidFrames = 0;
  for (let i = start; i <= end; i++) {
    if (a.cValid[i] === 0) continue;
    const dc = distanceToHole_px(g, a.cx[i]!, a.cy[i]!, hole);
    if (dc < minCentroid) minCentroid = dc;
    if (pts.useNose[i] === 1) {
      noseFrames++;
      const dn = distanceToHole_px(g, a.nx[i]!, a.ny[i]!, hole);
      if (dn < minNose) minNose = dn;
    } else {
      centroidFrames++;
    }
  }
  return {
    minNose_cm: Number.isFinite(minNose) ? minNose / g.pxPerCm : Number.NaN,
    minCentroid_cm: Number.isFinite(minCentroid) ? minCentroid / g.pxPerCm : Number.NaN,
    noseFrames,
    centroidFrames,
  };
}

function pointUsedFor(d: SpanDistances): NamedPointId {
  return d.noseFrames > d.centroidFrames ? 'nose' : 'centroid';
}

function pointUsedSentence(d: SpanDistances): string {
  const total = d.noseFrames + d.centroidFrames;
  if (total === 0) return 'No positioned frame in the span.';
  return `Nose used on ${d.noseFrames} of ${total} positioned frames, centroid on the rest.`;
}

function noseSentence(d: SpanDistances): string {
  return Number.isFinite(d.minNose_cm)
    ? `Closest approach: nose ${cm1(d.minNose_cm)}, centroid ${cm1(d.minCentroid_cm)}.`
    : `Closest approach: centroid ${cm1(d.minCentroid_cm)}; nose not available on any frame, so the nose distance is not recorded.`;
}

// ---------------------------------------------------------------------------
// Losses of detection (O4)
// ---------------------------------------------------------------------------

interface Loss {
  start: number;
  end: number;
  toEnd: boolean;
  durationSeconds: number;
  /** Index of the last positioned frame before the loss, or -1. */
  lastSeen: number;
  /** Index of the first positioned frame after the loss, or -1. */
  reappear: number;
  /** First frame the user marked "in the escape box" inside the loss, or -1. */
  inEscapeBoxFrom: number;
}

function findLosses(a: TrackArrays, frames: readonly TrackFrame[], from: number): Loss[] {
  const losses: Loss[] = [];
  let i = from;
  const n = a.length;
  while (i < n) {
    if (a.cValid[i] === 1) {
      i++;
      continue;
    }
    const start = i;
    let inEscapeBoxFrom = -1;
    while (i < n && a.cValid[i] === 0) {
      if (inEscapeBoxFrom < 0 && frames[i]!.reason === IN_ESCAPE_BOX_REASON) inEscapeBoxFrom = i;
      i++;
    }
    const end = i - 1;
    losses.push({
      start,
      end,
      toEnd: end === n - 1,
      durationSeconds: a.t[end]! - a.t[start]!,
      lastSeen: start > from && a.cValid[start - 1] === 1 ? start - 1 : -1,
      reappear: end + 1 < n ? end + 1 : -1,
      inEscapeBoxFrom,
    });
  }
  return losses;
}

type LossOutcome =
  | { kind: 'escape_entry'; hole: number; persistent: boolean; startFrame: number; byUser: boolean }
  | { kind: 'investigation'; hole: number }
  | { kind: 'tracking_failure'; hole: number | null }
  | { kind: 'none' };

interface ClassifiedLoss {
  loss: Loss;
  outcome: LossOutcome;
  lastSeenHole: number;
  lastSeenDistance_px: number;
  reappearNearSameHole: boolean;
}

function classifyLoss(
  loss: Loss,
  a: TrackArrays,
  g: MazeGeometry,
  p: Parameters,
  pts: EventPoints,
): ClassifiedLoss {
  const lastSeenHole = loss.lastSeen >= 0 ? pts.nearest[loss.lastSeen]! : -1;
  const lastSeenDistance_px =
    loss.lastSeen >= 0 ? pts.nearestDistance_px[loss.lastSeen]! : Number.NaN;
  const reappearNearSameHole =
    loss.reappear >= 0 &&
    lastSeenHole >= 0 &&
    distanceToHole_px(g, pts.ex[loss.reappear]!, pts.ey[loss.reappear]!, lastSeenHole) <=
      g.investigationRadius_px;
  const base = { loss, lastSeenHole, lastSeenDistance_px, reappearNearSameHole };
  if (loss.inEscapeBoxFrom >= 0) {
    return {
      ...base,
      outcome: {
        kind: 'escape_entry',
        hole: g.targetIndex,
        persistent: true,
        startFrame: loss.inEscapeBoxFrom,
        byUser: true,
      },
    };
  }
  const longEnough = loss.durationSeconds >= p.escapeEntry.minDuration_s;
  const entryShaped =
    loss.lastSeen >= 0 &&
    lastSeenDistance_px <= g.escapeRadius_px &&
    longEnough &&
    (loss.reappear < 0 || reappearNearSameHole);
  if (entryShaped) {
    if (lastSeenHole === g.targetIndex) {
      const persistent = loss.toEnd || loss.durationSeconds >= p.escapeEntry.persistCutoff_s;
      return {
        ...base,
        outcome: {
          kind: 'escape_entry',
          hole: lastSeenHole,
          persistent,
          startFrame: loss.start,
          byUser: false,
        },
      };
    }
    return { ...base, outcome: { kind: 'investigation', hole: lastSeenHole } };
  }
  if (longEnough) {
    const atHole = loss.lastSeen >= 0 && lastSeenDistance_px <= g.investigationRadius_px;
    return { ...base, outcome: { kind: 'tracking_failure', hole: atHole ? lastSeenHole : null } };
  }
  return { ...base, outcome: { kind: 'none' } };
}

function lossEvidence(
  c: ClassifiedLoss,
  a: TrackArrays,
  frames: readonly TrackFrame[],
  g: MazeGeometry,
  p: Parameters,
  pts: EventPoints,
): string {
  const { loss } = c;
  const parts: string[] = [];
  const lostAt = `lost from view at frame ${frames[loss.start]!.frameIndex} (${s2(a.t[loss.start]!)})`;
  const lasted = loss.toEnd
    ? `the loss lasted ${s2(loss.durationSeconds)} to the end of the video with no reappearance`
    : `the loss lasted ${s2(loss.durationSeconds)}`;
  if (loss.lastSeen >= 0) {
    const where =
      c.lastSeenHole >= 0
        ? `last seen ${cm1(c.lastSeenDistance_px / g.pxPerCm)} from the centre of ${holeName(g, c.lastSeenHole)} (${(c.lastSeenDistance_px / g.holeRadius_px).toFixed(2)} × hole radius; entry radius ${p.escapeEntry.radiusFactor} ×, investigation radius ${p.holeInvestigation.radiusFactor} ×), ${cm1(distanceFromCentre_cm(g, pts.ex[loss.lastSeen]!, pts.ey[loss.lastSeen]!))} from the platform centre`
        : 'last seen away from every hole';
    parts.push(`${lostAt}, ${where}; ${lasted}.`);
  } else {
    parts.push(`${lostAt} with no positioned frame before it in the trial; ${lasted}.`);
  }
  if (loss.reappear >= 0) {
    const r = loss.reappear;
    const back =
      c.lastSeenHole >= 0
        ? `${cm1(distanceToHole_px(g, pts.ex[r]!, pts.ey[r]!, c.lastSeenHole) / g.pxPerCm)} from ${holeName(g, c.lastSeenHole)} (${c.reappearNearSameHole ? 'the same hole' : 'elsewhere'})`
        : `${cm1(pts.nearestDistance_px[r]! / g.pxPerCm)} from its nearest hole ${pts.nearest[r]}`;
    const moved =
      loss.lastSeen >= 0
        ? `, ${cm1(Math.hypot(pts.ex[r]! - pts.ex[loss.lastSeen]!, pts.ey[r]! - pts.ey[loss.lastSeen]!) / g.pxPerCm)} from where it was lost`
        : '';
    parts.push(`Reappeared at frame ${frames[r]!.frameIndex} (${s2(a.t[r]!)}) ${back}${moved}.`);
  }
  if (loss.lastSeen >= 0) parts.push(`Before the loss the ${blobTrend(a, loss.lastSeen)}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Bouts and investigations (O1)
// ---------------------------------------------------------------------------

interface Bout {
  hole: number;
  start: number;
  end: number;
  /** Set when the bout is an entry-shaped loss at a non-target hole (O4). */
  unlikelyLoss: ClassifiedLoss | null;
}

interface MergedBout extends Bout {
  boutCount: number;
  largestGap_s: number;
}

function findBouts(pts: EventPoints, from: number, to: number): Bout[] {
  const bouts: Bout[] = [];
  let i = from;
  while (i <= to) {
    const k = pts.holeAt[i]!;
    if (k < 0) {
      i++;
      continue;
    }
    const start = i;
    while (i <= to && pts.holeAt[i] === k) i++;
    bouts.push({ hole: k, start, end: i - 1, unlikelyLoss: null });
  }
  return bouts;
}

function mergeBouts(bouts: Bout[], a: TrackArrays, mergeGap_s: number): MergedBout[] {
  const byHole = new Map<number, Bout[]>();
  for (const b of bouts) {
    const list = byHole.get(b.hole);
    if (list) list.push(b);
    else byHole.set(b.hole, [b]);
  }
  const merged: MergedBout[] = [];
  for (const list of byHole.values()) {
    list.sort((x, y) => x.start - y.start);
    let current: MergedBout | null = null;
    for (const b of list) {
      if (current !== null && a.t[b.start]! - a.t[current.end]! < mergeGap_s) {
        current.largestGap_s = Math.max(current.largestGap_s, a.t[b.start]! - a.t[current.end]!);
        current.end = Math.max(current.end, b.end);
        current.boutCount++;
        current.unlikelyLoss = current.unlikelyLoss ?? b.unlikelyLoss;
      } else {
        current = { ...b, boutCount: 1, largestGap_s: 0 };
        merged.push(current);
      }
    }
  }
  merged.sort((x, y) => x.start - y.start || x.hole - y.hole);
  return merged;
}

// ---------------------------------------------------------------------------
// Building records
// ---------------------------------------------------------------------------

const KIND_ORDER: Record<EventKind, number> = {
  investigation: 0,
  escape_entry: 1,
  tracking_failure: 2,
};

export function autoEventId(kind: EventKind, holeIndex: number | null, startFrame: number): string {
  return `auto-${kind}-h${holeIndex === null ? 'x' : holeIndex}-f${startFrame}`;
}

function sortEvents(events: EventRecord[]): EventRecord[] {
  return events.sort(
    (x, y) =>
      x.startFrame - y.startFrame ||
      KIND_ORDER[x.kind] - KIND_ORDER[y.kind] ||
      (x.holeIndex ?? -1) - (y.holeIndex ?? -1) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}

export interface EventContext {
  frames: readonly TrackFrame[];
  a: TrackArrays;
  g: MazeGeometry;
  p: Parameters;
  pts: EventPoints;
}

function record(
  ctx: EventContext,
  kind: EventKind,
  holeIndex: number | null,
  start: number,
  end: number,
  distances: SpanDistances,
  pointUsed: NamedPointId,
  evidence: string,
  id = autoEventId(kind, holeIndex, ctx.frames[start]!.frameIndex),
): EventRecord {
  const { frames, a, g } = ctx;
  return {
    id,
    kind,
    holeIndex,
    isTarget: holeIndex === g.targetIndex,
    startFrame: frames[start]!.frameIndex,
    endFrame: frames[end]!.frameIndex,
    startTime_s: a.t[start]!,
    endTime_s: a.t[end]!,
    durationSeconds: a.t[end]! - a.t[start]!,
    pointUsed,
    minNoseDistance_cm: distances.minNose_cm,
    minCentroidDistance_cm: distances.minCentroid_cm,
    evidence,
    source: 'auto',
  };
}

/** The approach to a loss: the run of frames at the same hole ending at the last-seen frame. */
function approachStart(pts: EventPoints, lastSeen: number, hole: number, floor: number): number {
  let j = lastSeen;
  while (j - 1 >= floor && pts.holeAt[j - 1] === hole) j--;
  return j;
}

// ---------------------------------------------------------------------------
// Automatic detection over the trial
// ---------------------------------------------------------------------------

export interface AutoEvents {
  events: EventRecord[];
  flags: ReviewFlag[];
  /** Start frame (position) of the persistent escape entry that ends the trial, or null. */
  persistentEscapeStartFrame: number | null;
  cutoffFrame: number | null;
  endFrame: number | null;
  endReason: TrialEndReason;
}

/**
 * Losses are classified over [start, end of video] so the trial end can be
 * found; investigations are then detected over [start, end], so one still in
 * progress at a cutoff ends there and says so. A loss event keeps the span of
 * its loss. Only events that begin within the trial are emitted.
 */
export function detectAutoEvents(
  ctx: EventContext,
  startFrame: number | null,
  /** A trial end decided after event corrections (a deleted or edited escape entry), replacing the automatic one. */
  endOverride?: { endFrame: number; endReason: TrialEndReason },
): AutoEvents {
  const { frames, a, g, p, pts } = ctx;
  const flags: ReviewFlag[] = [];
  if (startFrame === null || a.length === 0) {
    return {
      events: [],
      flags,
      persistentEscapeStartFrame: null,
      cutoffFrame: null,
      endFrame: null,
      endReason: 'no_start',
    };
  }
  const cutoff = cutoffFrame(a, startFrame, p.trialCutoff_s);
  const classified = findLosses(a, frames, startFrame).map((loss) =>
    classifyLoss(loss, a, g, p, pts),
  );
  let persistentEscapeStartFrame: number | null = null;
  for (const c of classified) {
    if (c.outcome.kind === 'escape_entry' && c.outcome.persistent) {
      persistentEscapeStartFrame = c.outcome.startFrame;
      break;
    }
  }
  const end = endOverride ?? resolveTrialEnd(a, startFrame, cutoff, persistentEscapeStartFrame);
  const endFrame = end.endFrame!;
  const events: EventRecord[] = [];

  const bouts = findBouts(pts, startFrame, endFrame);
  for (const c of classified) {
    if (c.outcome.kind === 'investigation' && c.loss.start <= endFrame) {
      bouts.push({ hole: c.outcome.hole, start: c.loss.start, end: c.loss.end, unlikelyLoss: c });
    }
  }
  for (const b of mergeBouts(bouts, a, p.holeInvestigation.mergeGap_s)) {
    const duration = a.t[b.end]! - a.t[b.start]!;
    if (duration < p.holeInvestigation.minDuration_s) continue;
    const d = spanDistances(a, g, pts, b.hole, b.start, b.end);
    const parts: string[] = [];
    if (b.unlikelyLoss !== null) {
      parts.push(
        `Physically unlikely — review: an entry-shaped loss of detection at ${holeName(g, b.hole)}, where there is no escape box; counted as an investigation. ${lossEvidence(b.unlikelyLoss, a, frames, g, p, pts)}`,
      );
    }
    parts.push(
      `${b.unlikelyLoss === null ? `${holeName(g, b.hole)}.` : ''} Event point within ${p.holeInvestigation.radiusFactor} × hole radius (${cm1(g.investigationRadius_px / g.pxPerCm)}) for ${s2(duration)}, ${frameSpan(a, frames, b.start, b.end)}${b.end === endFrame && endFrame + 1 < a.length && pts.holeAt[endFrame + 1] === b.hole ? ` (still at the hole when the trial ended at ${s2(a.t[endFrame]!)})` : ''}.`.trim(),
    );
    parts.push(pointUsedSentence(d));
    parts.push(noseSentence(d));
    if (b.boutCount > 1)
      parts.push(
        `Merged from ${b.boutCount} bouts at the same hole, the largest gap ${s2(b.largestGap_s)} (merge gap ${p.holeInvestigation.mergeGap_s} s).`,
      );
    const ev = record(
      ctx,
      'investigation',
      b.hole,
      b.start,
      b.end,
      d,
      pointUsedFor(d),
      parts.join(' '),
    );
    events.push(ev);
    if (b.unlikelyLoss !== null) {
      flags.push({
        code: 'physically_unlikely_entry',
        eventId: ev.id,
        frameIndex: ev.startFrame,
        message: `An entry-shaped loss of detection at ${holeName(g, b.hole)} lasting ${s2(b.unlikelyLoss.loss.durationSeconds)}: there is no escape box there, so this needs a look.`,
      });
    }
  }

  for (const c of classified) {
    const o = c.outcome;
    if (o.kind === 'none' || o.kind === 'investigation') continue;
    const start = o.kind === 'escape_entry' ? o.startFrame : c.loss.start;
    if (start > endFrame) continue;
    const lastSeen = c.loss.lastSeen;
    const hole = o.hole;
    const spanStart =
      lastSeen >= 0 && hole !== null ? approachStart(pts, lastSeen, hole, startFrame) : -1;
    const d =
      spanStart >= 0 && hole !== null
        ? spanDistances(a, g, pts, hole, spanStart, lastSeen)
        : { minNose_cm: Number.NaN, minCentroid_cm: Number.NaN, noseFrames: 0, centroidFrames: 0 };
    const pointUsed: NamedPointId =
      lastSeen >= 0 && pts.useNose[lastSeen] === 1 ? 'nose' : 'centroid';
    const evidence = lossEvidence(c, a, frames, g, p, pts);
    if (o.kind === 'escape_entry') {
      const head = o.byUser
        ? `Escape-box entry marked by the user from frame ${frames[start]!.frameIndex} (${s2(a.t[start]!)}): the animal is in the escape box at the target hole ${g.targetIndex} by assertion; the trial ends here.`
        : `Escape-box entry at the target hole ${hole}: ${evidence} ${o.persistent ? `Persistent (${c.loss.toEnd ? 'to the end of the video' : `≥ ${p.escapeEntry.persistCutoff_s} s`}): the trial ends at the first lost frame.` : `Not persistent (< ${p.escapeEntry.persistCutoff_s} s and the animal reappeared at the same hole), so the trial continues.`}`;
      const tail = spanStart >= 0 ? ` ${noseSentence(d)}` : '';
      events.push(
        record(ctx, 'escape_entry', hole, start, c.loss.end, d, pointUsed, `${head}${tail}`),
      );
    } else {
      const where = hole === null ? 'away from every hole' : `at ${holeName(g, hole)}`;
      const ev = record(
        ctx,
        'tracking_failure',
        hole,
        start,
        c.loss.end,
        d,
        pointUsed,
        `Tracking failure ${where}: ${evidence} Not an investigation, an entry or an error; listed for review and in the quality report.${hole !== null ? ' Lost at a hole: review whether this was an entry.' : ''}`,
      );
      events.push(ev);
      if (hole !== null) {
        flags.push({
          code: 'tracking_failure_at_hole',
          eventId: ev.id,
          frameIndex: ev.startFrame,
          message: `Tracking was lost for ${s2(c.loss.durationSeconds)} at ${holeName(g, hole)} without the signature of an entry; check whether the animal went in.`,
        });
      }
    }
  }

  return {
    events: sortEvents(events),
    flags,
    persistentEscapeStartFrame,
    cutoffFrame: cutoff,
    endFrame,
    endReason: end.endReason,
  };
}

// ---------------------------------------------------------------------------
// Event corrections (D20, D25): applied after detection, pinned across
// parameter changes, matched deterministically.
// ---------------------------------------------------------------------------

const AUTO_ID = /^auto-(investigation|escape_entry|tracking_failure)-h(\d+|x)-f(\d+)$/;

function parseAutoId(
  id: string,
): { kind: EventKind; hole: number | null; startFrame: number } | null {
  const m = AUTO_ID.exec(id);
  if (!m) return null;
  return {
    kind: m[1] as EventKind,
    hole: m[2] === 'x' ? null : Number(m[2]),
    startFrame: Number(m[3]),
  };
}

/**
 * Exact id first; otherwise the automatic event of the same kind and hole
 * whose frame span contains the start frame named in the id (an edit also
 * matches an overlap with its own new span); the earliest such event wins.
 */
function matchEvent(events: readonly EventRecord[], c: EventCorrection): EventRecord | null {
  if (c.eventId === undefined) return null;
  const exact = events.find((e) => e.id === c.eventId);
  if (exact) return exact;
  const parsed = parseAutoId(c.eventId);
  if (!parsed) return null;
  const candidates = events
    .filter((e) => e.source === 'auto' && e.kind === parsed.kind && e.holeIndex === parsed.hole)
    .filter((e) => {
      if (e.startFrame <= parsed.startFrame && parsed.startFrame <= e.endFrame) return true;
      if (c.action === 'edit' && c.startFrame !== undefined && c.endFrame !== undefined) {
        return e.startFrame <= c.endFrame && c.startFrame <= e.endFrame;
      }
      return false;
    })
    .sort((x, y) => x.startFrame - y.startFrame);
  return candidates[0] ?? null;
}

export interface CorrectedEvents {
  events: EventRecord[];
  flags: ReviewFlag[];
  applied: number;
}

export function applyEventCorrections(
  ctx: EventContext,
  autoEvents: readonly EventRecord[],
  corrections: CorrectionsLayer,
  trialEndFrame: number | null,
): CorrectedEvents {
  const { frames, a, g, pts } = ctx;
  const flags: ReviewFlag[] = [];
  let events = [...autoEvents];
  let applied = 0;
  const positionOf = new Map<number, number>();
  for (let i = 0; i < frames.length; i++) positionOf.set(frames[i]!.frameIndex, i);

  const spanOf = (startFrame: number, endFrame: number): [number, number] | null => {
    const s = positionOf.get(startFrame);
    const e = positionOf.get(endFrame);
    if (s === undefined || e === undefined || s > e) return null;
    return [s, e];
  };

  for (const c of correctionsOfKind(corrections.entries, 'event')) {
    if (c.action === 'add') {
      const span =
        c.holeIndex !== undefined && c.startFrame !== undefined && c.endFrame !== undefined
          ? spanOf(c.startFrame, c.endFrame)
          : null;
      if (span === null || c.holeIndex! < 0 || c.holeIndex! >= g.holeCount) {
        flags.push({
          code: 'orphaned_correction',
          correctionId: c.id,
          message: `Event correction ${c.id} adds an event without a valid hole and frame span inside this track; ignored.`,
        });
        continue;
      }
      const [s, e] = span;
      const d = spanDistances(a, g, pts, c.holeIndex!, s, e);
      const ev = record(
        ctx,
        'investigation',
        c.holeIndex!,
        s,
        e,
        d,
        pointUsedFor(d),
        `Investigation added by the user at ${holeName(g, c.holeIndex!)}, ${frameSpan(a, frames, s, e)}${trialEndFrame !== null && s > trialEndFrame ? ' (after the trial end)' : ''}. ${pointUsedSentence(d)} ${noseSentence(d)}`,
        `user-${c.id}`,
      );
      events.push({ ...ev, source: 'corrected' });
      applied++;
      continue;
    }
    const target = matchEvent(events, c);
    if (c.action === 'delete') {
      if (target === null) {
        flags.push({
          code: 'orphaned_correction',
          correctionId: c.id,
          eventId: c.eventId,
          message: `Event correction ${c.id} deletes event ${c.eventId ?? '(none)'}, which no longer exists under the current parameters; nothing was removed.`,
        });
        continue;
      }
      events = events.filter((e) => e !== target);
      applied++;
      continue;
    }
    // edit
    const hole = c.holeIndex ?? target?.holeIndex ?? null;
    const startFrame = c.startFrame ?? target?.startFrame;
    const endFrame = c.endFrame ?? target?.endFrame;
    const span =
      startFrame !== undefined && endFrame !== undefined ? spanOf(startFrame, endFrame) : null;
    if (span === null || (hole !== null && (hole < 0 || hole >= g.holeCount))) {
      flags.push({
        code: 'orphaned_correction',
        correctionId: c.id,
        eventId: c.eventId,
        message: `Event correction ${c.id} edits event ${c.eventId ?? '(none)'} but names no valid hole and frame span inside this track; ignored.`,
      });
      continue;
    }
    const [s, e] = span;
    const kind: EventKind = target?.kind ?? 'investigation';
    const d =
      hole === null
        ? { minNose_cm: Number.NaN, minCentroid_cm: Number.NaN, noseFrames: 0, centroidFrames: 0 }
        : spanDistances(a, g, pts, hole, s, e);
    const changes: string[] = [];
    if (target !== null) {
      if (target.holeIndex !== hole)
        changes.push(`hole ${target.holeIndex ?? 'none'} → ${hole ?? 'none'}`);
      if (target.startFrame !== startFrame || target.endFrame !== endFrame)
        changes.push(`frames ${target.startFrame}–${target.endFrame} → ${startFrame}–${endFrame}`);
    }
    const head =
      target === null
        ? `Corrected by the user (correction ${c.id}); the automatic event it corrected no longer exists under the current parameters, so the corrected values are kept as pinned.`
        : `Corrected by the user (correction ${c.id}): ${changes.length > 0 ? changes.join(', ') : 'no change to hole or frames'}; automatic values kept as autoShadow.`;
    const ev: EventRecord = {
      ...record(
        ctx,
        kind,
        hole,
        s,
        e,
        d,
        pointUsedFor(d),
        `${head} ${hole === null ? '' : `${holeName(g, hole)}, `}${frameSpan(a, frames, s, e)}. ${pointUsedSentence(d)} ${noseSentence(d)}`,
        target?.id ?? c.eventId ?? `user-${c.id}`,
      ),
      source: 'corrected',
    };
    if (target !== null) {
      ev.autoShadow = target.autoShadow ?? {
        holeIndex: target.holeIndex,
        startFrame: target.startFrame,
        endFrame: target.endFrame,
      };
      events = events.map((x) => (x === target ? ev : x));
    } else {
      events.push(ev);
    }
    applied++;
  }
  return { events: sortEvents(events), flags, applied };
}
