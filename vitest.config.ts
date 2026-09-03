import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['tests/**/*.test.ts', 'apps/web/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include:  ['apps/web/lib/**', 'apps/web/app/api/**'],
    },
  },
});
