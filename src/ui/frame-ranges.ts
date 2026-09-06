/**
 * Frame ranges as a person types them: `0-74, 200-210`.
 *
 * `backgroundExcludeRanges` is the remedy the background contamination
 * warning names by hand — "a stationary animal or object may be baked into
 * the background; exclude its frames" — so it has to be typeable, and a typo
 * has to say what is wrong rather than silently excluding nothing.
 *
 * Pure string work, no DOM.
 */
import type { FrameRange } from '../contracts/parameters.js';

export type ParsedRanges =
  | { ok: true; ranges: FrameRange[] }
  | { ok: false; message: string };

/** `0-74, 200-210`, or the empty string for none. */
export function formatFrameRanges(ranges: readonly FrameRange[]): string {
  return ranges.map((r) => `${r.startFrame}-${r.endFrame}`).join(', ');
}

/**
 * Accepts `start-end` pairs separated by commas or semicolons, and a bare
 * number as a single frame. Ranges are normalised to ascending order, sorted,
 * and merged where they overlap or touch — so any two spellings of the same
 * excluded frames produce the same value and therefore the same parameters
 * hash (D51). `5-8, 0-10` and `0-10` exclude the same frames and must not be
 * recorded as two different parameter sets.
 */
export function parseFrameRanges(text: string): ParsedRanges {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, ranges: [] };

  const ranges: FrameRange[] = [];
  for (const piece of trimmed.split(/[,;]/)) {
    const part = piece.trim();
    if (part === '') continue;

    const match = /^(\d+)\s*(?:-|–|\.\.)\s*(\d+)$/.exec(part);
    if (match) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      ranges.push({ startFrame: Math.min(a, b), endFrame: Math.max(a, b) });
      continue;
    }
    if (/^\d+$/.test(part)) {
      const only = Number(part);
      ranges.push({ startFrame: only, endFrame: only });
      continue;
    }
    return {
      ok: false,
      message: `"${part}" is not a frame range. Write ranges as 0-74, separated by commas.`,
    };
  }

  ranges.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

  // Merge overlapping and adjacent ranges. Adjacent too: 0-10 and 11-20
  // exclude exactly the frames 0-20 does, so they must record as one range.
  const merged: FrameRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startFrame <= last.endFrame + 1) {
      last.endFrame = Math.max(last.endFrame, range.endFrame);
    } else {
      merged.push({ ...range });
    }
  }
  return { ok: true, ranges: merged };
}

/** Plain-language count for the status line, e.g. `2 ranges, 85 frames`. */
export function describeFrameRanges(ranges: readonly FrameRange[]): string {
  if (ranges.length === 0) return 'none — every frame may be sampled';
  const frames = ranges.reduce((sum, r) => sum + (r.endFrame - r.startFrame + 1), 0);
  return `${ranges.length} range${ranges.length === 1 ? '' : 's'}, ${frames.toLocaleString()} frame${frames === 1 ? '' : 's'} excluded`;
}
