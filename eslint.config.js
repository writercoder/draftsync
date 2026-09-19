import js from '@eslint/js';
import globals from 'globals';
import nodePlugin from 'eslint-plugin-n';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', 'content/', 'fixtures/']
  },
  js.configs.recommended,
  nodePlugin.configs['flat/recommended-module'],
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      // Error-level so nothing accumulates silently; intentional unused
      // parameters/vars (e.g. in stubs) are prefixed with _
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  {
    // Tests run on the same Node matrix but may use globals (fetch) that
    // are present-but-experimental on Node 18
    files: ['test/**'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off'
    }
  }
];
