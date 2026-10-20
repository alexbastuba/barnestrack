import { describe, expect, it } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import { TRIAL_COLUMNS } from '../../src/export/columns.js';
import { toCsv } from '../../src/export/csv.js';
import {
  buildExportBundle,
  exportZipName,
  PARAMETERS_FILE_NAME,
  XLSX_FILE_NAME,
} from '../../src/export/index.js';
import { trialRows } from '../../src/export/rows.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import { FIXTURE_PARAMETERS, syntheticSession } from '../fixtures/synthetic-analysis.js';
import { entriesOf } from './zip-entries.js';

const session = syntheticSession();
const NOW = new Date('2026-09-06T11:30:00Z');

describe('buildExportBundle', () => {
  it('offers the six documented files, individually and in the zip (D11)', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    // the file name is pinned through the constant, which is what the UI's manifest should use
    expect(PARAMETERS_FILE_NAME).toBe('parameters.json');
    const expected = [
      'trials.csv',
      'events.csv',
      'quality.csv',
      PARAMETERS_FILE_NAME,
      'Barnes cohort A.barnestrack.json',
      XLSX_FILE_NAME,
    ];
    expect(bundle.files.map((file) => file.name)).toEqual(expected);
    expect([...(await entriesOf(bundle.zip)).keys()]).toEqual(expected);
  });

  it('puts the same trials.csv bytes in the zip as csv.ts writes', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    const inZip = (await entriesOf(bundle.zip)).get('trials.csv');
    expect(inZip).toBeDefined();
    expect(new TextDecoder().decode(inZip)).toBe(toCsv(TRIAL_COLUMNS, trialRows(session)));
  });

  it('round-trips parameters.json and the session file from inside the zip', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    const entries = await entriesOf(bundle.zip);
    const decoder = new TextDecoder();
    // D71: the set, with the build and the hash beside it
    expect(JSON.parse(decoder.decode(entries.get(PARAMETERS_FILE_NAME)))).toEqual({
      toolVersion: session.toolVersion,
      parametersHash: hashParameters(FIXTURE_PARAMETERS),
      ...FIXTURE_PARAMETERS,
    });
    const parsed = parseSessionDocument(
      decoder.decode(entries.get('Barnes cohort A.barnestrack.json')),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.videos.map((video) => video.id)).toEqual(
      session.videos.map((video) => video.id),
    );
  });

  it('stamps parameters.json with the tool version and the hash it hashes to (D71)', async () => {
    const bundle = await buildExportBundle(session, 'barnestrack v9.9.9 (deadbee)', { now: NOW });
    const text = new TextDecoder().decode((await entriesOf(bundle.zip)).get(PARAMETERS_FILE_NAME));
    const parsed = JSON.parse(text) as { toolVersion: string; parametersHash: string };
    // the exporting build's version, as on every row; the provenance first, so a reader sees it
    expect(parsed.toolVersion).toBe('barnestrack v9.9.9 (deadbee)');
    expect(Object.keys(parsed).slice(0, 2)).toEqual(['toolVersion', 'parametersHash']);
    expect(parsed.parametersHash).toBe(hashParameters(session.parameters!));
    // the reconciliation the two keys exist for: the file hashes to the hash it names
    expect(hashParameters(parsed as never)).toBe(parsed.parametersHash);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('stamps the exporting build version on the rows, not the one in the session', async () => {
    const bundle = await buildExportBundle(session, 'barnestrack v9.9.9 (deadbee)', { now: NOW });
    const csv = new TextDecoder().decode((await entriesOf(bundle.zip)).get('trials.csv'));
    expect(csv).toContain('barnestrack v9.9.9 (deadbee)');
    expect(csv).not.toContain(session.toolVersion);
  });

  it('names the download after the tool, the cohort and the day', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    expect(bundle.zipName).toBe(
      `barnestrack_export_barnes-cohort-a_${NOW.getFullYear()}${String(NOW.getMonth() + 1).padStart(2, '0')}${String(NOW.getDate()).padStart(2, '0')}.zip`,
    );
    expect(exportZipName({ ...session, name: '  ///  ' }, NOW)).toContain('_session_');
  });

  it('hashes parameters.json to the parameters_hash every trials.csv row names (D11, D12)', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    const entries = await entriesOf(bundle.zip);
    const decoder = new TextDecoder();

    // The reconciliation the two files exist to allow: the hash in every row is
    // the hash of the parameter set shipped beside it, in the same ZIP — read
    // back whole, provenance keys and all, as the browser smoke test reads it.
    const written = hashParameters(JSON.parse(decoder.decode(entries.get(PARAMETERS_FILE_NAME))));
    const rows = decoder.decode(entries.get('trials.csv')).split('\r\n').filter(Boolean).slice(1);
    const column = TRIAL_COLUMNS.findIndex((spec) => spec.header === 'parameters_hash');
    expect(column).toBeGreaterThanOrEqual(0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split(',')[column]).toBe(written);
  });

  it('still produces a bundle for a session that has never been analysed (D47)', async () => {
    const bare = { ...session, parameters: null, analyses: {} };
    const bundle = await buildExportBundle(bare, bare.toolVersion, { now: NOW });
    const entries = await entriesOf(bundle.zip);
    const decoder = new TextDecoder();
    expect(decoder.decode(entries.get('trials.csv')).split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(decoder.decode(entries.get(PARAMETERS_FILE_NAME))).toBe('{}\n');
  });
});
