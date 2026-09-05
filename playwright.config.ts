/**
 * Browser checks for what Vitest cannot run (WebCodecs). Not part of CI in
 * this chunk; run locally with `npx playwright test`. Uses the installed
 * Google Chrome (`channel: 'chrome'`), never a downloaded browser.
 */
import { defineConfig } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/playwright',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel: 'chrome',
    headless: process.env['BARNESTRACK_HEADED'] !== '1',
    trace: 'off',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/prototypes/frame-server/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
