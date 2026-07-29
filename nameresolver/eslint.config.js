import globals from 'globals'

// See app/eslint.config.js for why this exists (issue #303). This service is
// small and well covered, but it is the one piece that runs unattended on the
// server, where an undefined identifier surfaces as a dead subscriber rather
// than a visible error.
export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'data/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/__tests__/**/*.js', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
