/**
 * Every event keeps its hole number (D24). The case that made this module
 * exist is the one asserted first: twenty investigations across a whole clip,
 * where no bar is wide enough for its own label, and every one of them still
 * gets a number drawn.
 *
 * `measure` is injected, so this runs in Node with no 2D context: six pixels a
 * character, which is about what 11 px system-ui costs, and bold a shade wider.
 */
import { describe, expect, it } from 'vitest';
import { planEventLabels, type LabelCandidate } from '../../src/ui/timeline-labels.js';

const measure = (text: string, strong: boolean): number => text.length * (strong ? 6.6 : 6);

/** `count` bars spread evenly across `width`, each `barWidth` wide. */
function spread(count: number, width: number, barWidth: number): LabelCandidate[] {
  const step = width / count;
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    x: i * step,
    width: barWidth,
    full: `${i} user`,
    bare: String(i),
  }));
}

describe('planEventLabels', () => {
  it('labels all twenty events at whole-clip zoom, where no bar fits its own text', () => {
    const candidates = spread(20, 900, 4);
    const placements = planEventLabels(candidates, measure, { width: 900 });

    expect(placements).toHaveLength(20);
    expect(new Set(placements.map((p) => p.id)).size).toBe(20);
    // Not one of them fitted inside a 4 px bar, so they are all leader labels.
    expect(placements.every((p) => p.kind === 'above')).toBe(true);
    expect(placements.map((p) => p.text)).toEqual(candidates.map((c) => c.bare));
  });

  it("labels every investigation on test50's shape at whole-clip zoom", () => {
    // The example cohort's longest clip: 5,539 frames on a 1,150 px timeline,
    // which is what the Review step gives it at 1400 px wide. Twenty
    // investigations of about a second each, so every bar is
    // 30/5539 * 1150 ~ 6 px — under the width of even a two-digit number.
    const frames = 5539;
    const width = 1150;
    const perFrame = width / frames;
    const candidates: LabelCandidate[] = Array.from({ length: 20 }, (_, i) => {
      const start = 200 + i * 260;
      return {
        id: `ev${i}`,
        x: start * perFrame,
        width: Math.max(2, 30 * perFrame),
        full: `${i % 20} user`,
        bare: String(i % 20),
      };
    });

    const placements = planEventLabels(candidates, measure, { width });
    expect(placements).toHaveLength(20);
    expect(placements.filter((p) => p.kind === 'above')).toHaveLength(20);
  });

  it('puts the full label inside a bar wide enough for it', () => {
    const placements = planEventLabels(
      [{ id: 'a', x: 10, width: 200, full: '12 user', bare: '12' }],
      measure,
      { width: 900 },
    );
    expect(placements).toEqual([{ id: 'a', text: '12 user', kind: 'inside', x: 13 }]);
  });

  it('falls back to the bare hole number inside a bar too narrow for the full label', () => {
    // '12 user' is 46.2 px bold, '12' is 13.2; a 30 px bar takes only the number.
    const placements = planEventLabels(
      [{ id: 'a', x: 10, width: 30, full: '12 user', bare: '12' }],
      measure,
      { width: 900 },
    );
    expect(placements).toEqual([{ id: 'a', text: '12', kind: 'inside', x: 13 }]);
  });

  it('puts the number above the bar when even that does not fit, with the tick on the bar centre', () => {
    const placements = planEventLabels(
      [{ id: 'a', x: 100, width: 3, full: '12 user', bare: '12' }],
      measure,
      { width: 900 },
    );
    expect(placements).toHaveLength(1);
    const placement = placements[0]!;
    expect(placement.kind).toBe('above');
    if (placement.kind !== 'above') throw new Error('expected an above placement');
    expect(placement.barX).toBe(101.5);
    expect(placement.x).toBeCloseTo(101.5 - 13.2 / 2, 5);
  });

  it('drops an above-label that would collide instead of overprinting it', () => {
    // Three 2 px bars two pixels apart: the numbers cannot all fit side by side.
    const placements = planEventLabels(
      [
        { id: 'a', x: 100, width: 2, full: '10 user', bare: '10' },
        { id: 'b', x: 104, width: 2, full: '11 user', bare: '11' },
        { id: 'c', x: 140, width: 2, full: '12 user', bare: '12' },
      ],
      measure,
      { width: 900 },
    );
    expect(placements.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('never lets two above-labels overlap', () => {
    const placements = planEventLabels(spread(60, 400, 2), measure, { width: 400 });
    const above = placements.filter((p) => p.kind === 'above');
    for (let i = 1; i < above.length; i++) {
      const previous = above[i - 1]!;
      const current = above[i]!;
      expect(current.x).toBeGreaterThanOrEqual(previous.x + measure(previous.text, true));
    }
  });

  it('keeps a label at either end inside the timeline', () => {
    const placements = planEventLabels(
      [
        { id: 'first', x: 0, width: 2, full: '0 user', bare: '0' },
        { id: 'last', x: 898, width: 2, full: '19 user', bare: '19' },
      ],
      measure,
      { width: 900 },
    );
    for (const placement of placements) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x + measure(placement.text, true)).toBeLessThanOrEqual(900);
    }
  });

  it('skips an event with no hole number to show', () => {
    expect(
      planEventLabels([{ id: 'a', x: 0, width: 2, full: '', bare: '' }], measure, { width: 900 }),
    ).toEqual([]);
  });
});
