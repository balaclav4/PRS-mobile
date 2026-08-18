/**
 * A narrow lint gate, not a style guide.
 *
 * scripts/check-syntax.mjs proves every file parses, which is a weaker claim
 * than it sounds: a JSX component used without being imported is perfectly
 * valid syntax and throws ReferenceError the moment the screen renders. That
 * exact bug reached a device. `no-undef` is the rule that sees it.
 *
 * The full Expo preset was tried and produced 1043 findings, 916 of them
 * `no-use-before-define` firing on the `const s = StyleSheet.create({...})` at
 * the foot of every file - idiomatic, safe, and referenced from JSX above. A
 * gate nobody can act on is a gate nobody runs, so the preset is not used and
 * the rules here are limited to ones whose failures crash something.
 */
const globals = {
  // React Native / Hermes
  __DEV__: 'readonly', global: 'readonly', globalThis: 'readonly',
  console: 'readonly', fetch: 'readonly', navigator: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  Blob: 'readonly', URL: 'readonly', FormData: 'readonly',
  // CommonJS, used by config files and the Cloud Function
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', __dirname: 'readonly', Buffer: 'readonly',
  // Web, reached through Platform.OS checks
  window: 'readonly', document: 'readonly', alert: 'readonly',
  localStorage: 'readonly', indexedDB: 'readonly', HTMLInputElement: 'readonly',
  // Reached only behind Platform.OS === 'web' checks.
  confirm: 'readonly', atob: 'readonly', btoa: 'readonly', Image: 'readonly',
};

// JSX identifiers are invisible to the base no-undef rule: `<Plus />` is not a
// plain reference until it is compiled. react/jsx-no-undef is the rule that
// sees an undefined component, which is precisely the bug that reached a
// device. Verified by deleting the import and watching this fail.
const react = require('eslint-plugin-react');

module.exports = [
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', 'functions/node_modules/**', 'design_handoff_prs_mobile/**'] },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals,
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // The one that matters: an identifier with no binding anywhere.
      'no-undef': 'error',
      // Unused imports are usually a rename left half-done. A warning, since
      // they do not break anything.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^[_A-Z]',
        ignoreRestSiblings: true,
      }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'valid-typeof': 'error',
    },
  },
];
