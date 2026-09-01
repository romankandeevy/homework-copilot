/* Проверка ведёт браузер шаг за шагом: каждое действие зависит от состояния после предыдущего. */
/* eslint-disable no-await-in-loop */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const port = 4197
const origin = `http://127.0.0.1:${port}`
const outputDirectory = resolve('.impeccable', 'review')
await mkdir(outputDirectory, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk })
server.stderr.on('data', (chunk) => { serverOutput += chunk })

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Vite did not start.\n${serverOutput}`)
}

const failures = []
const browser = await chromium.launch({ headless: true })

function trackRuntimeErrors(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label}: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => failures.push(`${label}: page error: ${error.message}`))
  page.on('requestfailed', (request) => failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`))
}

try {
  await waitForServer()

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  trackRuntimeErrors(desktop, 'desktop')
  await desktop.goto(`${origin}/admin?admin-preview=1`, { waitUntil: 'domcontentloaded' })
  await desktop.getByRole('heading', { name: 'Управление сервисом' }).waitFor()
  await desktop.getByRole('heading', { name: 'База решений' }).waitFor()
  await desktop.getByRole('heading', { name: 'Поддержка' }).waitFor()

  if (await desktop.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
    failures.push('desktop: horizontal overflow')
  }

  await desktop.locator('.admin-user-cell').first().click()
  await desktop.getByRole('dialog', { name: /Алина Смирнова/ }).waitFor()
  await desktop.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Закрыть карточку пользователя')
  await desktop.getByRole('heading', { name: 'Профиль' }).waitFor()
  await desktop.getByLabel('Имя').fill('Алина Воронова')
  await desktop.getByLabel('Класс').selectOption('9')
  await desktop.getByRole('button', { name: 'Сохранить профиль' }).click()
  await desktop.getByRole('heading', { name: 'Алина Воронова' }).waitFor()
  await desktop.getByRole('button', { name: 'Закрыть карточку пользователя' }).click()
  await desktop.waitForFunction(() => document.activeElement?.classList.contains('admin-user-cell'))

  await desktop.getByRole('link', { name: 'База решений' }).click()
  await desktop.waitForURL(/#solution-library$/)
  await desktop.locator('a[href="#solution-library"][aria-current="page"]').waitFor()

  const solutionSection = desktop.locator('#solution-library')
  await solutionSection.scrollIntoViewIfNeeded()
  await solutionSection.getByLabel('Поиск решения').fill('123')
  await solutionSection.getByText('Геометрия · № 123').waitFor()
  await solutionSection.getByRole('button', { name: 'Удалить решение задачи № 123' }).click()
  await solutionSection.getByText('Баланс автоматически не возвращается.').waitFor()
  await solutionSection.getByLabel('Причина удаления').fill('Неверное решение')
  await solutionSection.getByRole('button', { name: 'Удалить из базы' }).click()
  await solutionSection.getByText('Предпросмотр: решение № 123 удалено из списка.').waitFor()

  await desktop.reload({ waitUntil: 'domcontentloaded' })
  await desktop.getByRole('heading', { name: 'Управление сервисом' }).waitFor()
  await desktop.locator('.admin-user-cell').first().waitFor()
  await desktop.locator('#solution-library .admin-solution-row').first().waitFor()
  await desktop.evaluate(() => window.scrollTo(0, 0))
  await desktop.screenshot({ path: resolve(outputDirectory, 'admin-desktop.png'), fullPage: true })
  await desktop.close()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  trackRuntimeErrors(mobile, 'mobile')
  await mobile.goto(`${origin}/admin?admin-preview=1`, { waitUntil: 'domcontentloaded' })
  await mobile.getByRole('heading', { name: 'Управление сервисом' }).waitFor()
  await mobile.locator('#solution-library').scrollIntoViewIfNeeded()
  await mobile.getByRole('heading', { name: 'База решений' }).waitFor()
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
    failures.push('mobile: horizontal overflow')
  }
  await mobile.evaluate(() => window.scrollTo(0, 0))
  await mobile.screenshot({ path: resolve(outputDirectory, 'admin-mobile.png'), fullPage: true })
  await mobile.close()
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Admin browser verification passed at 390px and 1440px')
}
