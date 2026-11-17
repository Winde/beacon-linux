import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * `typescript` is aliased to the TypeScript 6 compatibility package because
 * typescript-eslint needs its API; `@typescript/native` provides the TS 7
 * `tsc` used by `npm run typecheck`. See package.json.
 */
export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'dist/**',
      'node_modules/**',
      'build/linux-unpacked/**',
      'reference/**',
      'packaging/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    rules: {
      // Used deliberately where the CMS document is untyped.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      // The classic hook rules only. The plugin's newer React Compiler rules
      // flag long-standing patterns this app uses deliberately (refs in event
      // handlers, imperative media state), so they would be noise here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...jsxA11y.flatConfigs.recommended.rules
    }
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      // Tests build deliberately loose CMS and fake-bridge shapes.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  prettier
)
