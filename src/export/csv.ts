/**
 * RFC 4180 CSV writer: `\r\n` line endings, UTF-8 with no BOM, a field quoted
 * only when it has to be, and no comment rows (D11). Values arrive already
 * rounded from `rows.ts` — this module never reformats a number.
 */
import type { ColumnSpec } from './columns.js';

/** Fields containing a quote, a comma or a line break must be quoted (RFC 4180 §2.6). */
const NEEDS_QUOTING = /["\r\n,]/;

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvHeaderRow<Row>(columns: readonly ColumnSpec<Row>[]): string {
  return columns.map((column) => csvField(column.header)).join(',');
}

export function toCsv<Row>(columns: readonly ColumnSpec<Row>[], rows: readonly Row[]): string {
  const lines = [csvHeaderRow(columns)];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column.key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
