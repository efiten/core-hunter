import globals from 'globals'

// Lint exists for one rule: no-undef. Three times during the #230 cycle a
// reference to an identifier that does not exist shipped with all four CI jobs
// green — `queue.takeAll()` after the method was removed, then `RECENT_CAP` and
// `RETENTION_MS`. Each throws on the first tick and lands in one of app.js's
// broad `catch (_)` blocks, so the app renders nothing and publishes nothing,
// silently. Nothing else in the pipeline can catch that class: app.js is
// excluded from unit testing (AGENTS.md §5.1), the queue contract test checks
// that a method exists but never evaluates its arguments, and Rollup treats an
// undeclared bare identifier as an external global rather than an error.
// See issue #303.
export default [
  {
    files: ['**/*.js'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Loaded from a CDN script tag, not imported (see index.html).
        maplibregl: 'readonly',
        // Legacy WebKit prefix, feature-detected in sound.js. Not in the
        // browser globals set, but a real global where it exists.
        webkitAudioContext: 'readonly',
        // Injected by vite.config.js's define block at build time.
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // Catches the other half of the same class: an identifier that survives a
      // rename on one side only. Args are noisy and not the point here.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/__tests__/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
