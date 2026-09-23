/**
 * Playwright configuration for the Tokenmaxxing 2 e2e suite.
 *
 * Everything runs against a **production preview** on port 4185, never the
 * dev server on 5185: other agents edit `src/` while these tests run and Vite
 * HMR would reload the page mid-assertion. A production build only exposes
 * `window.__TOKENMAXXING2__` when the page is loaded with `?testhooks=1`,
 * which `bootPage()` does unless a spec opts out on purpose.
 *
 * The web server builds with `vite build` directly, not `npm run build`: the
 * npm script runs a whole-project `tsc` first, which is red while other
 * modules are still landing, and e2e must not depend on it. It also builds
 * into its own directory, so a concurrent `npm run build` elsewhere cannot
 * swap the bundle out from under a running suite.
 *
 * Every test gets its own browser context, and so its own localStorage. The
 * suite still runs one test at a time: most specs freeze real time and
 * `advance()` the sim, but the UI updates on animation frames, and this
 * machine is shared with other work.
 *
 * Ports: 5173/4173 and 5183/4183 belong to other projects. Never use them.
 */
import { defineConfig } from '@playwright/test';

/** Preview server. 5185 is dev. */
export const PREVIEW_URL = 'http://localhost:4185';
/** Where the e2e bundle is built. Git-ignored (artifacts/). */
const E2E_DIST = 'artifacts/e2e-dist';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/',

  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  // One retry locally: this laptop shares its CPU with a VM and container farm,
  // and a starved renderer can stall a click for seconds. A test that needed
  // the retry is still reported, as "flaky", so it cannot hide.
  retries: process.env['CI'] ? 2 : 1,
  // Generous ceilings for the same reason. The specs never wait on them when
  // the machine is quiet: time in the game only moves when a spec advances it.
  timeout: 120_000,
  expect: { timeout: 20_000 },

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: PREVIEW_URL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },

  projects: [
    {
      // Everything that is not tagged for the phone.
      name: 'desktop',
      grepInvert: /@mobile/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      // A real phone context: mobile UA, meta-viewport handling, touch instead
      // of mouse, and `pointer: coarse`, which is what turns on the 44px
      // targets. Specs tagged `@mobile`.
      name: 'mobile',
      grep: /@mobile/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],

  webServer: {
    command: `npx vite build --outDir ${E2E_DIST} --emptyOutDir && npx vite preview --outDir ${E2E_DIST} --port 4185 --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
