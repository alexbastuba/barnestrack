/**
 * The export bundle (D11): the three tidy CSVs, the parameter set as JSON, the
 * session file itself and the workbook, offered both individually and as one
 * ZIP. Pure — it returns Blobs and never touches the DOM, so it runs in a test,
 * in a worker and in the page.
 */
import type { SessionFile } from '../contracts/session.js';
import { serializeSessionFile, sessionFileName } from '../session/session-file.js';
import { EVENT_COLUMNS, QUALITY_COLUMNS, TRIAL_COLUMNS } from './columns.js';
import { toCsv } from './csv.js';
import type { ParameterDefinitionLookup } from './parameter-sheet.js';
import { parametersJson } from './parameter-sheet.js';
import { eventRows, qualityRows, trialRows } from './rows.js';
import { xlsxBytes } from './xlsx.js';
import { zipStore } from './zip.js';

export { TRIAL_COLUMNS, EVENT_COLUMNS, QUALITY_COLUMNS } from './columns.js';
export type { ColumnSpec } from './columns.js';
export { csvField, csvHeaderRow, toCsv } from './csv.js';
export { parameterRows, parametersJson } from './parameter-sheet.js';
export type { ParameterDefinitionLookup, ParameterRow } from './parameter-sheet.js';
export { eventRows, qualityRows, trialRows } from './rows.js';
export { buildWorkbook, xlsxBytes } from './xlsx.js';
export { crc32, zipStore } from './zip.js';
export type { ZipEntry } from './zip.js';

export const XLSX_FILE_NAME = 'barnestrack_export.xlsx';
const CSV_MIME = 'text/csv;charset=utf-8';
const JSON_MIME = 'application/json;charset=utf-8';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ExportFile {
  name: string;
  blob: Blob;
}

export interface ExportBundle {
  files: ExportFile[];
  zip: Blob;
  zipName: string;
}

export interface ExportBundleOptions {
  /** Chunk 5's definitions module for the parameters sheet, when it exists. */
  definitions?: ParameterDefinitionLookup;
  /** Fixed clock, so a test can compare two bundles. */
  now?: Date;
}

/**
 * `barnestrack_export_<cohort>_<YYYYMMDD>.zip`. No decision covers export file
 * naming, so the rule is: the tool name first so the file is recognisable in a
 * downloads folder, then the cohort, then the day it was written.
 */
export function exportZipName(session: SessionFile, now: Date): string {
  const slug =
    session.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session';
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`;
  return `barnestrack_export_${slug}_${stamp}.zip`;
}

export async function buildExportBundle(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
  options: ExportBundleOptions = {},
): Promise<ExportBundle> {
  const now = options.now ?? new Date();
  const encoder = new TextEncoder();

  const texts: [string, string, string][] = [
    ['trials.csv', toCsv(TRIAL_COLUMNS, trialRows(session, toolVersion)), CSV_MIME],
    ['events.csv', toCsv(EVENT_COLUMNS, eventRows(session, toolVersion)), CSV_MIME],
    ['quality.csv', toCsv(QUALITY_COLUMNS, qualityRows(session, toolVersion)), CSV_MIME],
    [
      'parameters.json',
      session.parameters ? parametersJson(session.parameters) : '{}\n',
      JSON_MIME,
    ],
    [sessionFileName(session.name), serializeSessionFile(session), JSON_MIME],
  ];
  const workbook = await xlsxBytes(session, toolVersion, {
    definitions: options.definitions,
    now,
  });

  const files: ExportFile[] = texts.map(([name, text, mime]) => ({
    name,
    blob: new Blob([text], { type: mime }),
  }));
  files.push({
    name: XLSX_FILE_NAME,
    blob: new Blob([workbook as BlobPart], { type: XLSX_MIME }),
  });

  const zip = zipStore(
    [
      ...texts.map(([name, text]) => ({ name, bytes: encoder.encode(text) })),
      { name: XLSX_FILE_NAME, bytes: workbook },
    ],
    now,
  );

  return {
    files,
    zip: new Blob([zip as BlobPart], { type: 'application/zip' }),
    zipName: exportZipName(session, now),
  };
}
