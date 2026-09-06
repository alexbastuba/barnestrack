import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexedCanvas, contactPalette } from '../../../scripts/tracker-node/contact-sheet.js';
import { crc32, decodePng, encodePng } from '../../../scripts/tracker-node/png.js';
import { ffmpegHasLibx264 } from '../../video/synthetic-clip.js';

const hasFfmpeg = ffmpegHasLibx264();

describe('png encoder', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips gray, rgb and indexed images', () => {
    const w = 37;
    const h = 23;
    const gray = new Uint8Array(w * h).map((_, i) => (i * 7) & 0xff);
    const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 13) & 0xff);
    const idx = new Uint8Array(w * h).map((_, i) => i % 250);
    const g = decodePng(encodePng(w, h, gray, { type: 'gray' }));
    expect([g.width, g.height, g.colorType]).toEqual([w, h, 0]);
    expect(g.pixels).toEqual(gray);
    const c = decodePng(encodePng(w, h, rgb, { type: 'rgb' }));
    expect(c.colorType).toBe(2);
    expect(c.pixels).toEqual(rgb);
    const palette = contactPalette();
    const p = decodePng(encodePng(w, h, idx, { type: 'indexed', palette }));
    expect(p.colorType).toBe(3);
    expect(p.pixels).toEqual(idx);
    expect(p.palette).toEqual(palette);
    expect(() => encodePng(w, h, gray, { type: 'rgb' })).toThrow(/bytes/);
  });

  it.skipIf(!hasFfmpeg)('writes a file ffmpeg decodes back to the same gray pixels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'barnestrack-png-'));
    try {
      const w = 64;
      const h = 48;
      const gray = new Uint8Array(w * h).map((_, i) => (i * 3 + (i >> 6)) & 0xff);
      const path = join(dir, 'gray.png');
      writeFileSync(path, encodePng(w, h, gray, { type: 'gray' }));
      const decoded = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        {
          maxBuffer: 1 << 20,
        },
      );
      expect(new Uint8Array(decoded)).toEqual(gray);
      // indexed sheet: ffmpeg expands the palette
      const canvas = new IndexedCanvas(40, 20);
      canvas.text(2, 2, 'A1', 246, 2);
      const sheet = join(dir, 'sheet.png');
      writeFileSync(
        sheet,
        encodePng(40, 20, canvas.pixels, { type: 'indexed', palette: contactPalette() }),
      );
      const rgb = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', sheet, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 1 << 20 },
      );
      expect(rgb.length).toBe(40 * 20 * 3);
      expect(rgb[(2 * 40 + 4) * 3]).toBe(255); // the apex of the "A" glyph (row 0, column 1, scale 2) is white
      expect(rgb[(2 * 40 + 2) * 3]).toBe(24); // row 0, column 0 of "A" is unlit sheet background
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('IndexedCanvas', () => {
  it('draws text, lines and shapes inside its bounds', () => {
    const c = new IndexedCanvas(30, 12, 0);
    expect(c.text(0, 0, 'AB', 5, 1)).toBe(8);
    c.line(-5, 5, 40, 5, 7, { on: 2, off: 2 });
    c.fillCircle(15, 8, 2, 9);
    c.rect(0, 0, 29, 11, 3);
    expect(c.pixels[5 * 30 + 0]).toBe(3); // border wins after the line
    expect(c.pixels[5 * 30 + 3]).toBe(7);
    expect(c.pixels[8 * 30 + 15]).toBe(9);
    expect(c.pixels.length).toBe(360);
  });
});
