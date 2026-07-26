import { defineConfig } from 'vitest/config'

// Scope vitest to the unit tests only. The e2e/ Playwright specs (*.spec.js) are
// run by `playwright test`, not vitest — without this, vitest globs them and
// fails on Playwright's test.beforeEach.
// Pin the timezone (#289). Every local-time assertion here is otherwise
// TZ-relative and passes identically on a UTC runner and a CEST laptop, which
// makes a whole class of local-vs-UTC bug invisible in CI — including the DST
// round-trip below. Europe/Brussels is the project's own zone and, unlike UTC,
// actually has DST transitions to test against.
process.env.TZ = 'Europe/Brussels'

export default defineConfig({
  test: {
    include: ['**/*.test.js'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
