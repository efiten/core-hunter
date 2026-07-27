import { defineConfig, devices } from '@playwright/test'

const PORT = 5179

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Pin the zone, matching vitest.config.js. CI runs UTC while the project is
    // developed in CEST, so anything local-vs-UTC either passes for the wrong
    // reason in CI or fails only on a developer machine.
    timezoneId: 'Europe/Brussels',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node test-server.mjs',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
})
