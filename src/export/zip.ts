/**
 * A store-only ZIP writer, so one click hands over the whole export as a single
 * file without adding a dependency (D3 pins exceljs and mp4box as the only
 * runtime libraries).
 *
 * Store-only means no compression: local file header, the bytes, then a central
 * directory and end-of-central-directory record. The workbook inside is already
 * deflated, so a second compressor would buy nothing there — but the session
 * file is not, and it dominates the bundle (11.1 MiB for a three-video cohort;
 * see docs/known-limitations.md). Deflating the JSON and the CSVs is the
 * obvious next step and fits behind this same signature. No data descriptors
 * and no ZIP64 — every entry's size is known before it is written and the
 * archive is far below 4 GB.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** 2.0: the minimum that speaks the modern central directory. */
const VERSION_NEEDED = 20;
/** Bit 11 tells the reader the file name is UTF-8. */
const UTF8_NAME_FLAG = 0x0800;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, the only timestamp a basic ZIP entry carries. */
function dosTimestamp(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

export function zipStore(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosTimestamp(modified);
  const prepared = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    bytes: entry.bytes,
    crc: crc32(entry.bytes),
  }));

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.bytes.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;

  const u16 = (value: number): void => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number): void => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };

  const localOffsets: number[] = [];
  for (const entry of prepared) {
    localOffsets.push(offset);
    u32(LOCAL_HEADER_SIGNATURE);
    u16(VERSION_NEEDED);
    u16(UTF8_NAME_FLAG);
    u16(0); // stored, not deflated
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(entry.name.length);
    u16(0); // no extra field
    out.set(entry.name, offset);
    offset += entry.name.length;
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }

  const centralStart = offset;
  prepared.forEach((entry, index) => {
    u32(CENTRAL_HEADER_SIGNATURE);
    u16(VERSION_NEEDED); // version made by
    u16(VERSION_NEEDED);
    u16(UTF8_NAME_FLAG);
    u16(0);
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(entry.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(localOffsets[index]!);
    out.set(entry.name, offset);
    offset += entry.name.length;
  });

  // Captured before the record is written: `offset` moves as it is.
  const centralEnd = offset;
  u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  u16(0); // this disk
  u16(0); // disk holding the central directory
  u16(prepared.length);
  u16(prepared.length);
  u32(centralEnd - centralStart);
  u32(centralStart);
  u16(0); // no archive comment
  return out;
}
