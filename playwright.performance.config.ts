import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './performance-tests',
  timeout: 10_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --config vite.performance.config.ts --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
  },
})
