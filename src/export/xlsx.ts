/**
 * The workbook: the same three tables as the CSVs, plus a `parameters` sheet
 * and a `readme` sheet that says what everything is (D11). Header rows are bold
 * and frozen, column widths follow the content, and numbers stay numbers so a
 * spreadsheet can sort and average them without a conversion step.
 *
 * `exceljs` is loaded with a dynamic import so it becomes its own chunk rather
 * than ~900 kB in the main bundle, and so Node and the browser take the same
 * path. Its module shape differs between the two (a CommonJS default in Node, a
 * namespace under a bundler), which `loadExcelJs` normalises.
 */
import type ExcelJS from 'exceljs';
import { EXPORT_SCHEMA_VERSION } from '../contracts/exportRows.js';
import type { SessionFile } from '../contracts/session.js';
import type { ColumnSpec } from './columns.js';
import { EVENT_COLUMNS, QUALITY_COLUMNS, TRIAL_COLUMNS } from './columns.js';
import type { ParameterDefinitionLookup } from './parameter-sheet.js';
import { parameterRows } from './parameter-sheet.js';
import { eventRows, qualityRows, trialRows } from './rows.js';

export interface WorkbookOptions {
  /** Chunk 5's definitions module, when it exists; it wins over the built-ins. */
  definitions?: ParameterDefinitionLookup;
  /** Fixed clock, so a test can compare two workbooks. */
  now?: Date;
}

type ExcelJsModule = typeof ExcelJS;

async function loadExcelJs(): Promise<ExcelJsModule> {
  const imported = (await import('exceljs')) as unknown as {
    default?: ExcelJsModule;
  } & ExcelJsModule;
  return imported.default ?? imported;
}

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 46;

function addTable<Row>(
  sheet: ExcelJS.Worksheet,
  columns: readonly ColumnSpec<Row>[],
  rows: readonly Row[],
): void {
  sheet.addRow(columns.map((column) => column.header));
  for (const row of rows) {
    sheet.addRow(columns.map((column) => row[column.key] ?? null));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  columns.forEach((column, index) => {
    let widest = column.header.length;
    for (const row of rows) {
      const value = row[column.key];
      const length = value === null || value === undefined ? 0 : String(value).length;
      if (length > widest) widest = length;
    }
    sheet.getColumn(index + 1).width = Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, widest + 2),
    );
  });
}

function addReadme(
  sheet: ExcelJS.Worksheet,
  session: SessionFile,
  toolVersion: string,
  now: Date,
): void {
  // Only analysed videos have a parameters hash (D52); an unanalysed one
  // contributes no hash rather than an empty entry in the readme's list.
  const hashes = [
    ...new Set(
      Object.values(session.analyses)
        .map((a) => a.derived?.quality.parametersHash)
        .filter((hash): hash is string => hash !== undefined),
    ),
  ];
  const lines: [string, string][] = [
    ['BarnesTrack export', session.name],
    ['Tool version', toolVersion],
    ['Export schema version', String(EXPORT_SCHEMA_VERSION)],
    ['Parameters hash', hashes.join(', ')],
    ['Written', now.toISOString()],
    ['', ''],
    ['Sheet', 'What it holds'],
    [
      'trials',
      'One row per trial: latencies (s), errors (count), path length (cm), mean speed (cm/s), time in the target quadrant (s), search strategy, and every threshold that defined those numbers.',
    ],
    [
      'events',
      'One row per hole investigation or escape-box entry, with the frame range, the times (s), the closest nose and centroid approach (cm) and the plain-language evidence. A loss of tracking is not an event: it is reported on the quality sheet.',
    ],
    [
      'quality',
      'One row per video: what fraction of frames were tracked, how many gaps and how long the longest was (s), timebase anomalies, the platform calibration (cm and px/cm) and a GOOD / REVIEW / POOR tier.',
    ],
    [
      'parameters',
      'Every threshold in force for this export, with its value, unit and definition. parameters.json in the same bundle holds the identical set as machine-readable JSON.',
    ],
    ['', ''],
    ['Note', 'Detail'],
    [
      'Units',
      'Units are in the column names: _s seconds, _cm centimetres, _cm_per_s centimetres per second, _fraction a proportion from 0 to 1.',
    ],
    [
      'status',
      'From the trial metrics: ok when the animal escaped and nothing needed a human look; review when the trial ran past the cutoff, tracking failed, or a value could not be resolved automatically; unresolved when it still cannot be resolved after review.',
    ],
    [
      'Corrections',
      'A corrected event carries the automatic values alongside it in the auto_hole_index, auto_start_frame and auto_end_frame columns; nothing automatic is overwritten. correction_count on the trials sheet says how many edits a trial carries.',
    ],
    [
      'Thresholds that are not columns',
      'The path-smoothing window (kinematicsSmoothingWindowFrames), the trial-censoring switch (trialCensoring.censorToCutoff), the search-strategy rule numbers (strategy.*) and the quality-tier thresholds (quality.*) are parameters, not columns: they are on the parameters sheet and in parameters.json, and parameters_hash covers them. trials reports both path_length_cm and path_length_smoothed_cm.',
    ],
    [
      'Reproducing a number',
      'Every row carries tool_version, schema_version and parameters_hash. The same tool version and the same parameters hash reproduce the same numbers from the session file in this bundle.',
    ],
  ];
  const headings = new Set(['BarnesTrack export', 'Sheet', 'Note']);
  lines.forEach((line, index) => {
    sheet.addRow(line);
    if (headings.has(line[0])) sheet.getRow(index + 1).font = { bold: true };
  });
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 110;
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
}

export async function buildWorkbook(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
  options: WorkbookOptions = {},
): Promise<ExcelJS.Workbook> {
  const excel = await loadExcelJs();
  const workbook = new excel.Workbook();
  workbook.creator = toolVersion;
  workbook.created = options.now ?? new Date();

  addTable(workbook.addWorksheet('trials'), TRIAL_COLUMNS, trialRows(session, toolVersion));
  addTable(workbook.addWorksheet('events'), EVENT_COLUMNS, eventRows(session, toolVersion));
  addTable(workbook.addWorksheet('quality'), QUALITY_COLUMNS, qualityRows(session, toolVersion));

  const parameters = workbook.addWorksheet('parameters');
  addTable(
    parameters,
    [
      { key: 'name', header: 'parameter', unit: '' },
      { key: 'value', header: 'value', unit: '' },
      { key: 'unit', header: 'unit', unit: '' },
      { key: 'definition', header: 'definition', unit: '' },
    ],
    session.parameters ? parameterRows(session.parameters, options.definitions) : [],
  );
  parameters.getColumn(4).alignment = { wrapText: true, vertical: 'top' };

  addReadme(workbook.addWorksheet('readme'), session, toolVersion, options.now ?? new Date());
  return workbook;
}

/** The workbook as bytes; the caller wraps them in a Blob or writes them out. */
export async function xlsxBytes(
  session: SessionFile,
  toolVersion: string = session.toolVersion,
  options: WorkbookOptions = {},
): Promise<Uint8Array> {
  const workbook = await buildWorkbook(session, toolVersion, options);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
