import { defineConfig, devices } from '@playwright/test'

// Порт можно сменить: рабочие копии агентов гоняют проверки параллельно, и
// на общем 4173 одна копия подхватила бы чужой dev-сервер.
const port = Number(process.env.PLAYWRIGHT_PORT || 4173)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests',
  // Разовые снимки для разбора дизайна (`*.local.spec.ts`) в общий прогон не
  // входят. Playwright не запускает исключённый файл даже по имени, поэтому
  // с ADMIN_SHOTS_DIR исключение снято: так их и запускают вручную.
  testIgnore: process.env.ADMIN_SHOTS_DIR ? [] : '**/*.local.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  // В CI отчёт нужен файлами: при падении он уходит артефактом
  // `playwright-report` со снимками и трассой.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
