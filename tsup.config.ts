import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  format: ['cjs', 'esm'],
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  target: 'node18',
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
  noExternal: [], // Bundle any ESM-only deps to avoid require() errors
  splitting: false,
  outExtension({ format }) {
    if (format === 'esm') return { js: '.mjs' };
    return { js: '.cjs' };
  }
});