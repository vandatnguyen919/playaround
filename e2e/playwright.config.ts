import { defineConfig, devices } from '@playwright/test'

// Browser tests against the running dev stack (node verify-stack.mjs up):
// the SPA origin on :5174, Keycloak on :8080 with the themed login, Mailpit on :8025.
// Run through ./verify e2e (or npx playwright test from e2e/).
//
// No retries, anywhere: a failure is a failure (flaky-test policy, PRODUCT.md).
// One worker, so tests never compete for the same Keycloak or rate limits.
// Results land in this run's evidence folder, which ./verify clears first.
const evidence = '../.shipit/verify/evidence/latest'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${evidence}/e2e-results`,
  reporter: [['list'], ['html', { outputFolder: `${evidence}/e2e-report`, open: 'never' }]],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:5174',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
