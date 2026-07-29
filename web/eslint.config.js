import globals from 'globals'

// See app/eslint.config.js for why this exists (issue #303). The web side has
// the same exposure: map.js is a single large module with no exports, so an
// identifier that survives a rename on one side only cannot be caught by the
// unit tests, and a page that dies at parse time surfaces as nothing more than
// "Unexpected end of input" in the console.
export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Leaflet, loaded from a CDN script tag rather than imported.
        L: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['*.test.js', 'e2e/**/*.js', '*.config.js', 'test-server.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
