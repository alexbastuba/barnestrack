import { describe, expect, it } from 'vitest';
import { EXPORT_SCHEMA_VERSION } from '../../src/contracts/exportRows.js';
import { EVENT_COLUMNS, QUALITY_COLUMNS, TRIAL_COLUMNS } from '../../src/export/columns.js';
import { parameterRows, parametersJson } from '../../src/export/parameter-sheet.js';
import { eventRows, trialRows } from '../../src/export/rows.js';
import { buildWorkbook, xlsxBytes } from '../../src/export/xlsx.js';
import { FIXTURE_PARAMETERS, syntheticSession } from '../fixtures/synthetic-analysis.js';

const session = syntheticSession();
const NOW = new Date('2026-09-06T09:00:00.000Z');

async function readBack(bytes: Uint8Array) {
  const imported = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
  } & typeof import('exceljs');
  const excel = imported.default ?? imported;
  const workbook = new excel.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(0) as ArrayBuffer);
  return workbook;
}

describe('buildWorkbook', () => {
  it('has the five documented sheets in order (D11)', async () => {
    const workbook = await buildWorkbook(session, session.toolVersion, { now: NOW });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'trials',
      'events',
      'quality',
      'parameters',
      'readme',
    ]);
  });

  it('freezes and bolds the header row of every table sheet', async () => {
    const workbook = await buildWorkbook(session, session.toolVersion, { now: NOW });
    for (const name of ['trials', 'events', 'quality', 'parameters']) {
      const sheet = workbook.getWorksheet(name);
      expect(sheet).toBeDefined();
      if (!sheet) continue;
      expect(sheet.getRow(1).font?.bold).toBe(true);
      expect(sheet.views[0]?.state).toBe('frozen');
      expect(sheet.views[0]).toMatchObject({ ySplit: 1 });
    }
  });

  it('says on the readme sheet that the smoothing window is a parameter, not a column (O9)', async () => {
    const workbook = await buildWorkbook(session, session.toolVersion, { now: NOW });
    const readme = workbook.getWorksheet('readme');
    const text: string[] = [];
    readme?.eachRow((row) => text.push(row.values?.toString() ?? ''));
    const joined = text.join('\n');
    expect(joined).toContain('kinematicsSmoothingWindowFrames');
    expect(joined).toContain('path_length_smoothed_cm');
    expect(joined).toContain('parameters_hash');
  });
});

describe('xlsxBytes', () => {
  it('reads back with the same headers and row counts as the CSVs', async () => {
    const workbook = await readBack(await xlsxBytes(session, session.toolVersion, { now: NOW }));

    const trials = workbook.getWorksheet('trials');
    expect(trials?.getRow(1).values).toEqual([
      undefined,
      ...TRIAL_COLUMNS.map((column) => column.header),
    ]);
    expect((trials?.actualRowCount ?? 0) - 1).toBe(trialRows(session).length);

    const events = workbook.getWorksheet('events');
    expect(events?.getRow(1).values).toEqual([
      undefined,
      ...EVENT_COLUMNS.map((column) => column.header),
    ]);
    expect((events?.actualRowCount ?? 0) - 1).toBe(eventRows(session).length);

    const quality = workbook.getWorksheet('quality');
    expect(quality?.getRow(1).values).toEqual([
      undefined,
      ...QUALITY_COLUMNS.map((column) => column.header),
    ]);
    expect((quality?.actualRowCount ?? 0) - 1).toBe(session.videos.length);
  });

  it('keeps measurements as numbers, not text', async () => {
    const workbook = await readBack(await xlsxBytes(session, session.toolVersion, { now: NOW }));
    const trials = workbook.getWorksheet('trials');
    const pathLength = TRIAL_COLUMNS.findIndex((column) => column.header === 'path_length_cm') + 1;
    const errors = TRIAL_COLUMNS.findIndex((column) => column.header === 'total_errors') + 1;
    const schema = TRIAL_COLUMNS.findIndex((column) => column.header === 'schema_version') + 1;
    expect(typeof trials?.getRow(2).getCell(pathLength).value).toBe('number');
    expect(typeof trials?.getRow(2).getCell(errors).value).toBe('number');
    expect(trials?.getRow(2).getCell(schema).value).toBe(EXPORT_SCHEMA_VERSION);
  });

  it('writes one parameters row per threshold, with its definition', async () => {
    const workbook = await readBack(await xlsxBytes(session, session.toolVersion, { now: NOW }));
    const sheet = workbook.getWorksheet('parameters');
    expect((sheet?.actualRowCount ?? 0) - 1).toBe(parameterRows(FIXTURE_PARAMETERS).length);
    const names: string[] = [];
    sheet?.eachRow((row, index) => {
      if (index > 1) names.push(String(row.getCell(1).value));
    });
    expect(names).toContain('holeInvestigation.radiusFactor');
    expect(names).toContain('tracking.minBlobArea_cm2');
    expect(names).toContain('kinematicsSmoothingWindowFrames');
  });
});

describe('parameterRows', () => {
  it('gives the tracking subtree the definitions it already ships with', () => {
    const rows = parameterRows(FIXTURE_PARAMETERS);
    const minBlob = rows.find((row) => row.name === 'tracking.minBlobArea_cm2');
    expect(minBlob?.unit).toBe('cm²');
    expect(minBlob?.definition).toContain('smaller than this are ignored');
  });

  it('lets an inherited definition cover a nested leaf', () => {
    const rows = parameterRows(FIXTURE_PARAMETERS);
    const mode = rows.find((row) => row.name === 'tracking.threshold.mode');
    expect(mode?.definition).toContain('Otsu');
  });

  it('gives a supplied definitions module precedence over the built-in text', () => {
    const rows = parameterRows(FIXTURE_PARAMETERS, (path) =>
      path === 'trialCutoff_s' ? 'from chunk 5' : undefined,
    );
    expect(rows.find((row) => row.name === 'trialCutoff_s')?.definition).toBe('from chunk 5');
    expect(rows.find((row) => row.name === 'noseConfidenceCutoff')?.definition).toContain('nose');
  });

  it('round-trips parameters.json', () => {
    expect(JSON.parse(parametersJson(FIXTURE_PARAMETERS))).toEqual(FIXTURE_PARAMETERS);
    expect(parametersJson(FIXTURE_PARAMETERS).endsWith('\n')).toBe(true);
  });
});
