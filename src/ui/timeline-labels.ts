/**
 * Where an event bar's label goes (D24: "events with hole numbers as text").
 *
 * The timeline used to draw a bar's label only when the whole string fitted
 * inside the bar, so at any zoom that showed a useful stretch of the clip most
 * investigations were unlabelled rectangles and the hole number — the one thing
 * a user is reading the row for — was not on screen at all.
 *
 * Three placements, tried in order: the full label inside the bar, the bare
 * hole number inside the bar, and the bare hole number *above* the bar with a
 * leader tick down to it. Above-labels are laid out left to right and one that
 * would touch the previous one is dropped rather than overprinted, so a dense
 * run thins out instead of turning into a smear.
 *
 * Pure and measurement-injected: the caller passes the canvas's own
 * `measureText`, so this is testable in Node with no 2D context.
 */

export interface LabelCandidate {
  id: string;
  /** Left edge of the bar, in CSS pixels from the timeline's left edge. */
  x: number;
  /** Bar width in CSS pixels. */
  width: number;
  /** Everything the label can say: flag marker, hole number, "user" tag. */
  full: string;
  /** The hole number alone — what must survive when nothing else fits. */
  bare: string;
}

export type LabelPlacement =
  | { id: string; text: string; kind: 'inside'; x: number }
  /** Drawn above the bar; `barX` is where the leader tick meets it. */
  | { id: string; text: string; kind: 'above'; x: number; barX: number };

/** Measures a label the way it will be drawn; `strong` is the bold weight. */
export type MeasureText = (text: string, strong: boolean) => number;

export interface LabelLayoutOptions {
  /** Breathing room inside the bar, both sides. */
  padding: number;
  /** Least horizontal gap between two above-labels before one is dropped. */
  gap: number;
  /** Left inset of a label drawn inside its bar. */
  inset: number;
  /** The timeline's width; an above-label is kept inside it. */
  width: number;
}

export const LABEL_DEFAULTS: LabelLayoutOptions = {
  padding: 6,
  gap: 4,
  inset: 3,
  width: 0,
};

/**
 * One placement per candidate that can be labelled, in the order given. A
 * candidate is absent only when its above-label would collide with the one
 * before it.
 */
export function planEventLabels(
  candidates: readonly LabelCandidate[],
  measure: MeasureText,
  options: Partial<LabelLayoutOptions> & Pick<LabelLayoutOptions, 'width'>,
): LabelPlacement[] {
  const opts = { ...LABEL_DEFAULTS, ...options };
  const placements: LabelPlacement[] = [];
  // The right edge of the last above-label placed; above-labels are the only
  // pair that can collide, since an inside label is on the bars' own line.
  let lastAboveRight = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.bare === '') continue;
    const room = candidate.width - opts.padding;
    if (measure(candidate.full, true) <= room) {
      placements.push({
        id: candidate.id,
        text: candidate.full,
        kind: 'inside',
        x: candidate.x + opts.inset,
      });
      continue;
    }
    if (measure(candidate.bare, true) <= room) {
      placements.push({
        id: candidate.id,
        text: candidate.bare,
        kind: 'inside',
        x: candidate.x + opts.inset,
      });
      continue;
    }
    const textWidth = measure(candidate.bare, true);
    const barX = candidate.x + candidate.width / 2;
    // Centred on the bar, then pushed inside the timeline's own edges so a
    // label at frame 0 or at the last frame is not half off-screen.
    const x = clamp(barX - textWidth / 2, 0, Math.max(0, opts.width - textWidth));
    if (x < lastAboveRight + opts.gap) continue;
    lastAboveRight = x + textWidth;
    placements.push({ id: candidate.id, text: candidate.bare, kind: 'above', x, barX });
  }
  return placements;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
