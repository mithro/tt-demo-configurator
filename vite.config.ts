import suidPlugin from '@suid/vite-plugin';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();

export default defineConfig({
  base: './',
  plugins: [suidPlugin(), solidPlugin()],
  resolve: { alias: { '~': path.resolve(__dirname, './src') } },
  define: { __COMMIT_HASH__: JSON.stringify(commit) },
  // the simulator worker (src/sim) is an ES module: binaryen uses top-level await
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
