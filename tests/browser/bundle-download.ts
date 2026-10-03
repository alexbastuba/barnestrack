/**
 * Opens an export bundle the browser actually downloaded, for the specs that
 * click "Export bundle (.zip)". Reads the ZIP with the same helper the Vitest
 * bundle tests use, so a spec asserts on the bytes a user would get.
 */
import { readFileSync } from 'node:fs';
import { expect, type Download, type Page } from '@playwright/test';
import { entriesOf } from '../export/zip-entries.js';

export interface DownloadedBundle {
  zipName: string;
  entries: Map<string, Uint8Array>;
  text(name: string): string;
}

/** Clicks the Review step's export button and opens what lands on disk. */
export async function downloadBundle(page: Page): Promise<DownloadedBundle> {
  const [download]: [Download, void] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export bundle (.zip)' }).click(),
  ]);
  const path = await download.path();
  expect(path, 'the download did not reach disk').toBeTruthy();
  const entries = await entriesOf(new Blob([readFileSync(path)]));
  const decoder = new TextDecoder();
  return {
    zipName: download.suggestedFilename(),
    entries,
    text(name: string): string {
      const bytes = entries.get(name);
      if (bytes === undefined) throw new Error(`${name} is not in the bundle`);
      return decoder.decode(bytes);
    },
  };
}

/** RFC 4180 rows as the export writes them (CRLF, double-quote escaping), header first. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** One column of a parsed CSV, by header name. */
export function column(rows: string[][], header: string): string[] {
  const index = rows[0]?.indexOf(header) ?? -1;
  if (index < 0) throw new Error(`no ${header} column in ${rows[0]?.join(',') ?? 'an empty file'}`);
  return rows.slice(1).map((row) => row[index] ?? '');
}
