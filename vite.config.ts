import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

function gitSha7(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? 'nogit';
  }
}

const version = `barnestrack v${pkg.version} (${gitSha7()})`;

export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  define: {
    __BARNESTRACK_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'node',
    // Playwright specs live in tests/browser/*.spec.ts and are not Vitest tests.
    include: ['tests/**/*.test.ts'],
  },
});
