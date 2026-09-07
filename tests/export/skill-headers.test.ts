/**
 * The cohort skill quotes the three CSV header lines so a reader can diff them
 * against a real export, and until now nothing bound the two: chunk 9a
 * generated them through `src/export/` and pasted the result, D54 then added
 * three columns to `quality.csv`, and the skill went on claiming seventeen for
 * two chunks without a single test going red (D42 S1).
 *
 * These assertions close that. The next change to `src/export/columns.ts` fails
 * here, naming the file to regenerate, rather than shipping a skill that
 * teaches an agent a schema the tool does not write.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_COLUMNS, QUALITY_COLUMNS, TRIAL_COLUMNS } from '../../src/export/columns.js';
import { csvHeaderRow } from '../../src/export/csv.js';

const SKILL_PATH = fileURLToPath(
  new URL('../../skills/barnestrack-cohort/SKILL.md', import.meta.url),
);
const skill = readFileSync(SKILL_PATH, 'utf-8');

// The header is taken here, one call per column table, rather than in the loop:
// the three tables have different row types, so a union of them widens
// `csvHeaderRow`'s generic to something it cannot accept.
const FILES = [
  { name: 'trials.csv', header: csvHeaderRow(TRIAL_COLUMNS), count: TRIAL_COLUMNS.length },
  { name: 'events.csv', header: csvHeaderRow(EVENT_COLUMNS), count: EVENT_COLUMNS.length },
  { name: 'quality.csv', header: csvHeaderRow(QUALITY_COLUMNS), count: QUALITY_COLUMNS.length },
] as const;

describe('the cohort skill quotes the headers the export actually writes', () => {
  for (const { name, header, count } of FILES) {
    it(`quotes the ${name} header row verbatim`, () => {
      expect(
        skill.includes(header),
        `skills/barnestrack-cohort/SKILL.md does not contain the ${name} header row.\n` +
          `Expected, verbatim:\n${header}\n` +
          `Regenerate the fenced block from src/export/ and update the column count beside it.`,
      ).toBe(true);
    });

    it(`states the right column count for ${name}`, () => {
      // The "What an export contains" table reads "| `quality.csv` | video | 20 columns; …".
      const row = skill
        .split('\n')
        .find((line) => line.includes(`\`${name}\``) && line.includes('columns;'));
      expect(row, `no "${name} … columns;" row in the skill's export table`).toBeDefined();
      expect(row).toContain(`${count} columns;`);
    });
  }

  it('quotes no header row the export no longer writes', () => {
    // A stale block left behind next to a fresh one would still pass the
    // includes() checks above, so the fenced blocks are counted too: exactly
    // three of them are a full CSV header, one per file.
    const fenced = skill.match(/^session_id,[^\n]*$/gm) ?? [];
    const written = new Set(FILES.map((file) => file.header));
    const stale = fenced.filter((line) => !line.includes('…') && !written.has(line));
    expect(stale, `header rows in SKILL.md that src/export/ does not write:\n${stale.join('\n')}`)
      .toEqual([]);
  });
});
