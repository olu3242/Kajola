import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:     './tests/e2e',
  timeout:     30_000,
  retries:     1,
  fullyParallel: false,
  workers:       1,
  reporter:    [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL:    'http://localhost:3000',
    // Chromium pre-installed at this path in the remote execution environment
    channel:    undefined,
    headless:   true,
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  webServer: {
    command:              'npm run build && npm run start',
    url:                  'http://localhost:3000',
    reuseExistingServer:  false,
    timeout:              120_000,
    cwd:                  '.',
    env: {
      KAJOLA_RUNTIME_MODE: 'local',
      APP_ENV: 'test',
    },
  },
});
