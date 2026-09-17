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
    /* Подставная база - та же, что в .github/workflows/ci.yml. Без адреса и
       ключа клиент Supabase не создаётся: витрина работает, а `/admin`
       показывает «База не подключена», и весь admin-* валится на входе.
       В рабочей копии агента нет .env.local, поэтому значения нужны здесь,
       а не только в CI. Такого проекта не существует (в адресе проекта
       Supabase не бывает дефиса), ответы подменяют tests/fixtures.ts и
       tests/adminMocks.ts, домен *.supabase.co проходит
       Content-Security-Policy из index.html. Переменная окружения, если
       задана, сильнее: process.env у Vite важнее .env-файлов. */
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://e2e-offline.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_e2e',
    },
  },
})
