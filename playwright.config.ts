import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke + screenshot harness.
 * Chromium is launched with a fake camera so the tracking pipeline initialises
 * without a physical webcam. Gesture states are driven through `window.__celly`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The device preset carries its own 1280x720 viewport; the docs and the specs both
        // assume a roomy 1440x900 desktop, so it has to be set after the spread.
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--enable-unsafe-swiftshader'
          ]
        }
      }
    }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
