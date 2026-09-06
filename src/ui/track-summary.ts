/**
 * What a finished pass says, in a sentence a person can read (D17).
 *
 * Pure string formatting over the tracker's summary — no DOM, so it is unit
 * tested like the analysis code. The numbers are never rounded to look better
 * than they are: a gap is a gap and the longest one is named with the time it
 * starts, because that is where the user will go and look.
 */
import type { NotDetectedRun, TrackerSummary } from '../analysis/tracker/tracker.js';
import type { TrackFrame } from '../contracts/track.js';

/** `1:32`, the way a video player writes a position. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(1)} %`;
}

/** Frames the tracker resolved to a position, over all frames. */
export function trackedFraction(summary: TrackerSummary): number {
  if (summary.frameCount === 0) return 0;
  return summary.stateCounts.tracked / summary.frameCount;
}

/** Runs of consecutive frames with no detection at all. */
export function countGaps(frames: readonly TrackFrame[]): number {
  let gaps = 0;
  let inGap = false;
  for (const frame of frames) {
    const missing = frame.detectionState === 'not_detected';
    if (missing && !inGap) gaps += 1;
    inGap = missing;
  }
  return gaps;
}

function gapPhrase(longest: NotDetectedRun | null, frames: readonly TrackFrame[]): string {
  if (!longest) return '';
  const start = frames[longest.startFrame]?.t_s;
  const end = frames[longest.endFrame]?.t_s;
  const seconds = start !== undefined && end !== undefined ? end - start : 0;
  const at = start === undefined ? '' : ` starting at ${formatClock(start)}`;
  return ` · longest ${seconds.toFixed(1)} s${at}`;
}

/**
 * The one-line result, e.g.
 * `Tracked 94.1 % of frames · 3 gaps · longest 12.4 s starting at 1:32 · background warning: none`.
 */
export function summaryLine(summary: TrackerSummary, frames: readonly TrackFrame[]): string {
  const gaps = countGaps(frames);
  const warnings =
    summary.warnings.length === 0
      ? 'background warning: none'
      : `background warning: ${summary.warnings.length}`;
  return (
    `Tracked ${formatPercent(trackedFraction(summary))} of frames` +
    ` · ${gaps} gap${gaps === 1 ? '' : 's'}` +
    gapPhrase(summary.longestNotDetectedRun, frames) +
    ` · ${warnings}`
  );
}

/**
 * The detail behind the summary line, one clause per state that occurred, so
 * "94.1 % tracked" is never the only thing the user is told. Ordered worst
 * first: the states that need review lead.
 */
export function stateBreakdown(summary: TrackerSummary): string {
  const order = ['not_detected', 'ambiguous', 'low_confidence', 'tracked'] as const;
  const label: Record<(typeof order)[number], string> = {
    not_detected: 'not detected',
    ambiguous: 'ambiguous',
    low_confidence: 'low confidence',
    tracked: 'tracked',
  };
  const parts: string[] = [];
  for (const state of order) {
    const count = summary.stateCounts[state];
    if (count > 0) parts.push(`${count.toLocaleString()} ${label[state]}`);
  }
  return parts.join(', ');
}

/** Progress while a pass runs: `Frame 2,341 of 5,539 · 214 frames/s · about 15 s left`. */
export function progressLine(done: number, total: number, fps: number, etaSeconds: number): string {
  const head = `Frame ${done.toLocaleString()} of ${total.toLocaleString()}`;
  if (fps <= 0) return head;
  return `${head} · ${Math.round(fps).toLocaleString()} frames/s · about ${formatRemaining(etaSeconds)} left`;
}

export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

/**
 * The learned body area offered to the other videos (D29), or null when the
 * pass could not learn one.
 */
export function learnedBlobArea_cm2(summary: TrackerSummary): number | null {
  if (summary.expectedBlobAreaSource !== 'learned') return null;
  return summary.medianTrackedBlobArea_cm2;
}
