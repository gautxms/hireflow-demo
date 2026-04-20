import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-undef': 'warn',
      'no-useless-escape': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['src/pages/**/*.jsx', 'src/components/**/*.jsx', 'src/admin/**/*.jsx'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Inline styles are restricted. Keep runtime-only width/height/position values data-driven, otherwise move styles to className/CSS tokens.',
        },
      ],
    },
  },
])
