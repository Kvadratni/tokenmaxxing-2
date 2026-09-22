/**
 * Playwright configuration for the Tokenmaxxing e2e suite.
 *
 * Everything runs against the **production preview** on port 4185, never the
 * dev server on 5185: other agents edit `src/` while these tests run and Vite
 * HMR would reload the page mid-assertion and destroy the execution context.
 * A production build only exposes `window.__TOKENMAXXING__` when the page is
 * loaded with `?testhooks=1`, which every spec does via `bootPage()`.
 *
 * The game is stateful (one sim instance, localStorage-backed meta), so the
 * suite is deliberately serial: `fullyParallel: false` + a single worker.
 */
import { defineConfig } from '@playwright/test';

/** Preview server. 5185 is dev; 5173/4173 belong to an unrelated project. */
export const PREVIEW_URL = 'http://localhost:4185';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/',

  // The sim is a singleton behind one localStorage key — never run two at once.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: PREVIEW_URL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      // Everything that is not explicitly tagged for another form factor.
      name: 'desktop',
      grepInvert: /@mobile|@reduced/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      // Stacked layout. Specs tagged `@mobile`.
      name: 'mobile',
      grep: /@mobile/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        // A real phone context: mobile UA, meta-viewport handling, and touch
        // instead of mouse. Without this the project was really a narrow
        // desktop, which hid a dead touch surface and 125px of overflow.
        isMobile: true,
      },
    },
    {
      // `--force-prefers-reduced-motion` equivalent. Specs tagged `@reduced`.
      // `reducedMotion` is a browser-context option, not a top-level fixture,
      // in @playwright/test 1.62 — it has to travel via `contextOptions`.
      name: 'reduced-motion',
      grep: /@reduced/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview',
    url: PREVIEW_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
