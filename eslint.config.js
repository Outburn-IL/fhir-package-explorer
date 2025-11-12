import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'test/.test-cache/**', 'test/manual/**']
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: { 
      globals: globals.node 
    },
    rules: {
      indent: ['error', 2],
      semi: ['error', 'always'],
      quotes: ['error', 'single'],
      'no-unused-vars': ['warn'],
      'no-console': 'off'
    }
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.{js,mjs,cjs,ts}']
  }))
];