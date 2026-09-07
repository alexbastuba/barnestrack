/**
 * How the Review panels write a number.
 *
 * One rule, everywhere: a value that could not be computed is `—`, never `0`
 * and never `NaN`. The analysis layer's convention for "not computable" is a
 * non-finite number or null (`isRecorded`, D55), and every formatter here goes
 * through it, so a trial with no start cannot render a confident `0.00 s`.
 *
 * Pure string formatting, no DOM — tested like the analysis code, in the same
 * spirit as `src/ui/track-summary.ts`, whose clock and percentage formatters
 * this reuses rather than growing a second dialect of them.
 */
import { isRecorded } from '../../analysis/parameters.js';
import { formatClock, formatPercent } from '../track-summary.js';

export { formatClock, formatPercent };

/** What every formatter shows for a value that does not exist. */
export const NOT_RECORDED = '—';

/** A plain number to `digits` decimals, or `—`. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  return isRecorded(value) ? value.toFixed(digits) : NOT_RECORDED;
}

/** A whole number with thousands separators, or `—`. */
export function formatCount(value: number | null | undefined): string {
  return isRecorded(value) ? value.toLocaleString() : NOT_RECORDED;
}

/** `12.34 s`, or `—`. Latencies are seconds to 2 dp throughout the app. */
export function formatSeconds(value: number | null | undefined, digits = 2): string {
  return isRecorded(value) ? `${value.toFixed(digits)} s` : NOT_RECORDED;
}

/** `184.20 cm`, or `—`. */
export function formatCm(value: number | null | undefined, digits = 2): string {
  return isRecorded(value) ? `${value.toFixed(digits)} cm` : NOT_RECORDED;
}

/** `6.31 cm/s`, or `—`. */
export function formatSpeed(value: number | null | undefined, digits = 2): string {
  return isRecorded(value) ? `${value.toFixed(digits)} cm/s` : NOT_RECORDED;
}

/**
 * `1:23 (frame 2,481)` — the clock a person reads plus the frame identity the
 * app actually seeks on, because the two are not interchangeable (D7).
 */
export function formatTimeAndFrame(
  seconds: number | null | undefined,
  frame: number | null | undefined,
): string {
  const clock = isRecorded(seconds) ? formatClock(seconds) : NOT_RECORDED;
  if (!isRecorded(frame)) return clock;
  return `${clock} (frame ${frame.toLocaleString()})`;
}

/** `hole 7`, or `no hole` when the event is away from the ring. */
export function formatHole(holeIndex: number | null | undefined): string {
  return isRecorded(holeIndex) ? `hole ${holeIndex}` : 'no hole';
}

/** `yes` / `no` — words, so the value survives a screen reader and grayscale. */
export function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

/**
 * A parameter's value as text for the read-only rows: numbers keep their own
 * precision, `null` reads as the sentence that explains it, and a compound
 * value (the threshold, the exclude ranges) is written the way the tracker
 * would describe it rather than as JSON.
 */
export function formatParameterValue(value: unknown): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : NOT_RECORDED;
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return value
      .map((entry) => {
        const range = entry as { startFrame?: unknown; endFrame?: unknown };
        if (typeof range?.startFrame === 'number' && typeof range?.endFrame === 'number') {
          return `${range.startFrame}–${range.endFrame}`;
        }
        return String(entry);
      })
      .join(', ');
  }
  if (typeof value === 'object') {
    const threshold = value as { mode?: unknown; manualValue?: unknown };
    if (threshold.mode === 'otsu') return 'otsu (chosen from the video)';
    if (threshold.mode === 'manual') return `manual ${String(threshold.manualValue)}`;
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key} ${String(entry)}`)
      .join(', ');
  }
  return String(value);
}

/** `+2` / `−1` / `0`, with a real minus sign. Used by the diff badge. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

/** `4 → 3`, the way every changed value is written in the diff badge. */
export function formatChange(before: string, after: string): string {
  return `${before} → ${after}`;
}

/** `1 investigation` / `14 investigations`. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
