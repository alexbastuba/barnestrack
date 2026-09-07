import { describe, expect, it } from 'vitest';
import type { ColumnSpec } from '../../src/export/columns.js';
import { csvField, toCsv } from '../../src/export/csv.js';

interface Sample {
  label: string;
  count: number | null;
  flag: boolean;
}

const COLUMNS: readonly ColumnSpec<Sample>[] = [
  { key: 'label', header: 'label', unit: '' },
  { key: 'count', header: 'count', unit: 'count' },
  { key: 'flag', header: 'flag', unit: 'bool' },
];

describe('csvField', () => {
  it('leaves an ordinary field unquoted', () => {
    expect(csvField('hole 7')).toBe('hole 7');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvField(true)).toBe('true');
  });

  it('quotes a field containing a comma', () => {
    expect(csvField('lost, then reappeared')).toBe('"lost, then reappeared"');
  });

  it('doubles inner quotes and quotes the field', () => {
    expect(csvField('the "nose" cue')).toBe('"the ""nose"" cue"');
  });

  it('quotes a field containing a line break', () => {
    expect(csvField('first\r\nsecond')).toBe('"first\r\nsecond"');
    expect(csvField('first\nsecond')).toBe('"first\nsecond"');
  });

  it('writes null, undefined and a non-finite number as an empty field', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a header row followed by one CRLF-terminated row per record', () => {
    const csv = toCsv(COLUMNS, [
      { label: 'plain', count: 3, flag: false },
      { label: 'has "quotes", a comma\nand a break', count: null, flag: true },
    ]);
    expect(csv).toBe(
      'label,count,flag\r\n' +
        'plain,3,false\r\n' +
        '"has ""quotes"", a comma\nand a break",,true\r\n',
    );
  });

  it('writes a header row and nothing else when there are no records', () => {
    expect(toCsv(COLUMNS, [])).toBe('label,count,flag\r\n');
  });
});
