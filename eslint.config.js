import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
        ...globals.node,
        afterEach: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../lib/supabase', '../../lib/supabase', '../../../lib/supabase',
                  '../lib/supabase.js', '../../lib/supabase.js', '../../../lib/supabase.js',
                  './lib/supabase', './lib/supabase.js',
                  'lib/supabase', 'lib/supabase.js'],
          message: 'Jangan import supabase.js langsung. Gunakan service di src/services/ (storageService, authService, dll).'
        }]
      }],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
]
