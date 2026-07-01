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
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-duplicate-imports': 'error',
    },
  },

  {
    files: ['backend/**/*.js', 'scripts/**/*.mjs', 'start-backend.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'backend/src/services/aiResumeAnalysisService.js',
      'backend/src/services/legacyDocSemanticExtractionService.js',
      'backend/src/services/resumeFormatDiagnosticFixtures.js',
    ],
    rules: {
      'no-control-regex': 'off',
      'no-constant-condition': 'off',
      'no-constant-binary-expression': 'off',
      'no-ex-assign': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        process: 'readonly',
      },
    },
  },

  {
    files: ['backend/src/routes/admin/ux.test.js', 'backend/src/routes/resultsExport.test.js'],
    rules: {
      'no-redeclare': 'off',
    },
  },
  {
    files: ['src/components/CandidateResults.jsx'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/admin/hooks/useAdminAuth.js', 'src/components/CandidateResults.jsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
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
