import { describe, expect, it } from 'vitest';
import { TRIAL_COLUMNS } from '../../src/export/columns.js';
import { toCsv } from '../../src/export/csv.js';
import { buildExportBundle, exportZipName, XLSX_FILE_NAME } from '../../src/export/index.js';
import { trialRows } from '../../src/export/rows.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import { FIXTURE_PARAMETERS, syntheticSession } from '../fixtures/synthetic-analysis.js';

const session = syntheticSession();
const NOW = new Date('2026-09-06T11:30:00Z');

async function entriesOf(zip: Blob): Promise<Map<string, Uint8Array>> {
  const archive = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(archive.buffer);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    out.set(
      decoder.decode(archive.subarray(offset + 30, offset + 30 + nameLength)),
      archive.subarray(dataStart, dataStart + size),
    );
    offset = dataStart + size;
  }
  return out;
}

describe('buildExportBundle', () => {
  it('offers the six documented files, individually and in the zip (D11)', async () => {
    const bundle = await buildExportBundle(session, session.toolVersion, { now: NOW });
    const expected = [
      'trials.csv',
      'events.csv',
      'quality.csv',
      'parameters.json',
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
    expect(JSON.parse(decoder.decode(entries.get('parameters.json')))).toEqual(FIXTURE_PARAMETERS);
    const parsed = parseSessionDocument(
      decoder.decode(entries.get('Barnes cohort A.barnestrack.json')),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.videos.map((video) => video.id)).toEqual(
      session.videos.map((video) => video.id),
    );
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

  it('still produces a bundle for a session that has never been analysed (D47)', async () => {
    const bare = { ...session, parameters: null, analyses: {} };
    const bundle = await buildExportBundle(bare, bare.toolVersion, { now: NOW });
    const entries = await entriesOf(bundle.zip);
    const decoder = new TextDecoder();
    expect(decoder.decode(entries.get('trials.csv')).split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(decoder.decode(entries.get('parameters.json'))).toBe('{}\n');
  });
});
