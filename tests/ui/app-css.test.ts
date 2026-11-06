/**
 * The stylesheet's layout tokens, read as text (chunk 17, §4): the line
 * heights that make the header whole pixels at the default root size, and the
 * Review bar's column-footer geometry — one width token shared by the side
 * column and the bar, one reserve the column's height is computed from. The
 * rendered sizes are measured in Chrome by `scripts/screenshots.ts` and the
 * browser specs; this pins what they measure to the tokens that produce it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/app.css'), 'utf-8');
const ROOT_PX = 16;

function token(name: string): string {
  const match = new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(css);
  expect(match, `no token ${name}`).not.toBeNull();
  return match![1]!.trim();
}

function remToPx(value: string): number {
  expect(value).toMatch(/^\d+(\.\d+)?rem$/);
  return Number.parseFloat(value) * ROOT_PX;
}

describe('line-height tokens (chunk 17 §4.2)', () => {
  it('are whole pixels at the default root size', () => {
    for (const name of ['--lh-sm', '--lh-md', '--lh-lg']) {
      const px = remToPx(token(name));
      expect(Number.isInteger(px), `${name} = ${px} px`).toBe(true);
    }
  });

  it('are what the hint, the step heading, the step state and the step tab use', () => {
    expect(css).toMatch(/\.hint \{[^}]*line-height: var\(--lh-sm\);/);
    expect(css).toMatch(/\nh2 \{[^}]*line-height: var\(--lh-lg\);/);
    expect(css).toMatch(/\.step-tab \.step-state \{[^}]*line-height: var\(--lh-sm\);/);
    expect(css).toMatch(/\.step-tab \{[^}]*line-height: var\(--lh-md\);/);
    expect(css).toMatch(/\.step-tab \{[^}]*align-items: center;/);
  });

  it('give the status banner a fixed minimum of two lines', () => {
    expect(token('--status-lines')).toBe('2');
    expect(css).toMatch(/\.status \{[^}]*min-height: calc\(var\(--status-lines\) \* 1\.5 \* var\(--t-md\) \+ 2 \* var\(--s2\) \+ 2px\);/);
  });
});

describe('the Review bar as the side column’s footer (chunk 17 §4.1, D75)', () => {
  const review = css.slice(css.indexOf('.review-step {'), css.indexOf('.review-step > .next-step {') + 200);

  it('declares the column, the bar and the reserve as tokens inside the 1200 px query', () => {
    const query = css.lastIndexOf('@media (min-width: 1200px)', css.indexOf('.review-step {'));
    expect(query).toBeGreaterThan(-1);
    expect(review).toMatch(/--review-column: 24rem;/);
    expect(remToPx(token('--review-bar'))).toBeCloseTo(97.5, 5);
    expect(review).toMatch(/--review-reserve: calc\(var\(--review-bar\) \+ var\(--s4\)\);/);
  });

  it('gives the side column and the bar the same width token, and the column the reserve', () => {
    expect(review).toMatch(/\.review-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--review-column\);/);
    expect(review).toMatch(/\.review-stage-side \{[^}]*height: calc\(100vh - var\(--review-reserve\)\);/);
    expect(review).toMatch(/\.review-step > \.next-step \{\s*width: var\(--review-column\);\s*margin-left: auto;/);
  });

  it('matches the Maze bar’s reserve, the measured pattern it follows', () => {
    expect(token('--maze-bar')).toBe(token('--review-bar'));
  });
});
