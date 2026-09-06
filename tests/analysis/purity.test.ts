/**
 * D22: everything under src/analysis/ is a pure function over the contracts —
 * no DOM, no video, no session, no clock, no randomness. Enforced by reading
 * the sources.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../src/analysis/', import.meta.url).pathname;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('src/analysis/ is pure', () => {
  const files = tsFiles(ROOT);

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf-8');

    it(`${rel}: imports nothing from src/ui, src/session or src/video (but sha256 and the Mp4Index type)`, () => {
      for (const m of source.matchAll(IMPORT)) {
        const isType = m[2] !== undefined;
        const spec = m[3]!;
        expect(spec, `${rel} imports ${spec}`).not.toMatch(/\/ui\//);
        expect(spec, `${rel} imports ${spec}`).not.toMatch(/\/session\//);
        if (/\/video\//.test(spec)) {
          const allowed =
            spec.endsWith('/video/sha256.js') || (isType && spec.endsWith('/video/mp4-index.js'));
          expect(allowed, `${rel} imports ${spec}${isType ? ' (type)' : ''}`).toBe(true);
        }
        expect(spec, `${rel} imports ${spec}`).not.toMatch(/^(node:|fs|path|crypto)/);
      }
    });

    it(`${rel}: touches no DOM, clock or randomness`, () => {
      const code = stripComments(source);
      // the globals themselves in use (`window.x`, `new OffscreenCanvas(...)`); the English word "window" in a definition is fine
      expect(code).not.toMatch(
        /\b(document|window|navigator|globalThis|self|localStorage|indexedDB)\s*[.[]/,
      );
      expect(code).not.toMatch(/\bnew\s+(OffscreenCanvas|Worker|Image|ImageData|VideoDecoder)\b/);
      expect(code).not.toMatch(
        /\b(requestAnimationFrame|postMessage|setTimeout|setInterval|fetch)\s*\(/,
      );
      expect(code).not.toMatch(/\bMath\.random\b/);
      expect(code).not.toMatch(/\bDate\b/);
      expect(code).not.toMatch(/\brandomUUID\b/);
      expect(code).not.toMatch(/\bcrypto\b/);
      if (!rel.startsWith('tracker/')) expect(code).not.toMatch(/\bperformance\b/);
    });
  }
});
