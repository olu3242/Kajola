import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@kajola/contracts':   path.resolve(__dirname, 'packages/contracts/src'),
      '@kajola/runtime-os':  path.resolve(__dirname, 'packages/runtime-os/src'),
      '@kajola/workflow-os': path.resolve(__dirname, 'packages/workflow-os/src'),
      '@kajola/agent-os':    path.resolve(__dirname, 'packages/agent-os/src'),
    },
  },
  test: {
    globals:     true,
    environment: 'node',
    include:     ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/web/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include:  ['apps/web/lib/**', 'apps/web/app/api/**'],
    },
  },
});
