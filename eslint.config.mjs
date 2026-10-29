// ESLint 10 flat config
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'companion/pkg/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'ExampleApp/**',
      'templates/**',
      'public/**',
      'scripts/**',
      'DATAROOT/**',
      'LOG/**'
    ]
  },
  js.configs.recommended,
  { files: ['companion/**/*.{js,mjs}'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      // Main-process code loads optional native modules (NDI) with require()
      '@typescript-eslint/no-require-imports': 'off',
      // Rules new in ESLint 10 / react-hooks 7 (React Compiler checks). Existing code predates them;
      // kept as warnings until the affected components are refactored.
      'preserve-caught-error': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn'
    }
  }
);
