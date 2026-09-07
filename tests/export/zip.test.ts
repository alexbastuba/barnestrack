/**
 * The ZIP is parsed back with an independent reader written here, so a bug that
 * is symmetric in the writer cannot hide: local headers are walked by hand, the
 * CRC of every entry is recomputed, and the central directory is checked against
 * what the local headers said.
 */
import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '../../src/export/zip.js';

interface ReadEntry {
  name: string;
  bytes: Uint8Array;
  crc: number;
  localOffset: number;
}

function readZip(archive: Uint8Array): { entries: ReadEntry[]; centralNames: string[] } {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const entries: ReadEntry[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const localOffset = offset;
    expect(view.getUint16(offset + 8, true)).toBe(0); // stored, never deflated
    const crc = view.getUint32(offset + 14, true);
    const compressed = view.getUint32(offset + 18, true);
    const uncompressed = view.getUint32(offset + 22, true);
    expect(compressed).toBe(uncompressed);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(archive.subarray(nameStart, nameStart + nameLength)),
      bytes: archive.subarray(dataStart, dataStart + uncompressed),
      crc,
      localOffset,
    });
    offset = dataStart + uncompressed;
  }

  const centralStart = offset;
  const centralNames: string[] = [];
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    centralNames.push(name);
    const match = entries.find((entry) => entry.name === name);
    expect(match?.localOffset).toBe(localHeaderOffset);
    offset += 46 + nameLength;
  }

  expect(view.getUint32(offset, true)).toBe(0x06054b50);
  expect(view.getUint16(offset + 10, true)).toBe(entries.length);
  expect(view.getUint32(offset + 12, true)).toBe(offset - centralStart);
  expect(view.getUint32(offset + 16, true)).toBe(centralStart);
  expect(offset + 22).toBe(archive.length);
  return { entries, centralNames };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('crc32', () => {
  it('matches the published check values', () => {
    expect(crc32(encoder.encode(''))).toBe(0);
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipStore', () => {
  const files = [
    { name: 'trials.csv', bytes: encoder.encode('a,b\r\n1,2\r\n') },
    { name: 'notes.txt', bytes: encoder.encode('hole 7 — ünïcode, "quoted"') },
    { name: 'empty.bin', bytes: new Uint8Array(0) },
  ];

  it('round-trips every entry byte for byte, with a correct CRC', () => {
    const { entries, centralNames } = readZip(zipStore(files, new Date('2026-09-06T11:30:00Z')));
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));
    expect(centralNames).toEqual(files.map((file) => file.name));
    entries.forEach((entry, index) => {
      const original = files[index]!;
      expect([...entry.bytes]).toEqual([...original.bytes]);
      expect(entry.crc).toBe(crc32(original.bytes));
    });
    expect(decoder.decode(entries[1]?.bytes)).toBe('hole 7 — ünïcode, "quoted"');
  });

  it('writes an archive with no entries at all', () => {
    const { entries } = readZip(zipStore([], new Date('2026-09-06T11:30:00Z')));
    expect(entries).toHaveLength(0);
  });

  it('is byte-identical for the same input and timestamp', () => {
    const when = new Date('2026-09-06T11:30:00Z');
    expect([...zipStore(files, when)]).toEqual([...zipStore(files, when)]);
  });
});
