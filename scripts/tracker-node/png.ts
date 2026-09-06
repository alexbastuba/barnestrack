/**
 * Minimal PNG encoder in plain JavaScript: 8-bit grayscale, RGB or indexed
 * colour, zlib from Node's built-in module, adaptive scanline filtering for
 * the continuous-tone types. No native image dependency (dev-only harness).
 */
import { deflateSync, inflateSync } from 'node:zlib';

export type PngColor =
  | { type: 'gray' }
  | { type: 'rgb' }
  | { type: 'indexed'; palette: Uint8Array /* r,g,b × entries */ };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function channelsOf(color: PngColor): number {
  return color.type === 'rgb' ? 3 : 1;
}

function colorTypeOf(color: PngColor): number {
  return color.type === 'gray' ? 0 : color.type === 'rgb' ? 2 : 3;
}

/** Picks, per scanline, the filter whose output has the smallest sum of absolute values. */
function filterScanlines(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  adaptive: boolean,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  const candidates = adaptive ? [0, 1, 2, 3, 4] : [0];
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestScore = Infinity;
    let best: Uint8Array | null = null;
    for (const type of candidates) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels]! : 0;
        const b = prev ? prev[i]! : 0;
        const c = prev && i >= channels ? prev[i - channels]! : 0;
        let pred = 0;
        if (type === 1) pred = a;
        else if (type === 2) pred = b;
        else if (type === 3) pred = (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i]! - pred) & 0xff;
        trial[i] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = Uint8Array.from(trial);
      }
    }
    out[y * (stride + 1)] = bestType;
    out.set(best!, y * (stride + 1) + 1);
  }
  return out;
}

export function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  color: PngColor,
): Uint8Array {
  const channels = channelsOf(color);
  if (pixels.length !== width * height * channels) {
    throw new RangeError(
      `expected ${width * height * channels} bytes of pixels, got ${pixels.length}`,
    );
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorTypeOf(color);
  const parts: Uint8Array[] = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
  ];
  if (color.type === 'indexed') {
    if (color.palette.length % 3 !== 0 || color.palette.length > 768) {
      throw new RangeError('palette must hold up to 256 r,g,b triples');
    }
    parts.push(chunk('PLTE', color.palette));
  }
  const filtered = filterScanlines(pixels, width, height, channels, color.type !== 'indexed');
  parts.push(chunk('IDAT', new Uint8Array(deflateSync(filtered, { level: 9 }))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export interface DecodedPng {
  width: number;
  height: number;
  colorType: number;
  /** Unfiltered pixel bytes (indices for indexed images). */
  pixels: Uint8Array;
  palette: Uint8Array | null;
}

/** Decoder for the tests: 8-bit, non-interlaced, the same three colour types. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    if (crc !== crc32(bytes.subarray(offset + 4, offset + 8 + length)))
      throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (data[8] !== 8) throw new Error('only 8-bit PNGs are decoded');
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error('interlaced PNGs are not decoded');
    } else if (type === 'PLTE') palette = Uint8Array.from(data);
    else if (type === 'IDAT') idat.push(Uint8Array.from(data));
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  const raw = new Uint8Array(inflateSync(joined));
  const channels = colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= channels ? prev[i - channels]! : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (src[i]! + pred) & 0xff;
    }
  }
  return { width, height, colorType, pixels, palette };
}
