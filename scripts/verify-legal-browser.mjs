import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const port = 4187
const configuredOrigin = (process.argv[2] || process.env.LEGAL_BASE_URL)?.replace(/\/+$/, '')
const origin = configuredOrigin || `http://127.0.0.1:${port}`
const navigationWaitUntil = configuredOrigin ? 'commit' : 'domcontentloaded'
const outputDirectory = resolve('test-results', 'legal-browser')
await mkdir(outputDirectory, { recursive: true })

const server = configuredOrigin
  ? null
  : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

let serverOutput = ''
server?.stdout.on('data', (chunk) => { serverOutput += chunk })
server?.stderr.on('data', (chunk) => { serverOutput += chunk })

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Preview did not start.\n${serverOutput}`)
}

const failures = []
const browser = await chromium.launch({ headless: true })
try {
  if (!configuredOrigin) await waitForServer()
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 960 }]) {
    const page = await browser.newPage({ viewport })
    const runtimeErrors = []
    page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`) })
    page.on('pageerror', (error) => runtimeErrors.push(`page: ${error.message}`))
    page.on('requestfailed', (request) => runtimeErrors.push(`network: ${request.url()} ${request.failure()?.errorText ?? ''}`))

    await page.goto(`${origin}/privacy`, { waitUntil: navigationWaitUntil })
    await page.locator('h1').filter({ hasText: 'Политика обработки персональных данных' }).waitFor()
    await page.evaluate(() => document.fonts.ready)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (canonical !== 'https://www.homeworkcopilot.ru/privacy') failures.push(`${viewport.width}px: wrong canonical ${canonical}`)
    if (robots !== 'index, follow') failures.push(`${viewport.width}px: wrong robots ${robots}`)
    if (overflow > 0) failures.push(`${viewport.width}px: horizontal overflow ${overflow}px`)

    const noticeButton = page.getByRole('button', { name: /Понятно/ })
    await page.screenshot({ path: resolve(outputDirectory, `notice-${viewport.width}.png`) })
    await noticeButton.focus()
    if (!await noticeButton.evaluate((element) => element === document.activeElement)) failures.push(`${viewport.width}px: notice button is not focusable`)
    await page.keyboard.press('Enter')
    if (await page.locator('.privacy-notice').count()) failures.push(`${viewport.width}px: notice did not close from keyboard`)

    await page.screenshot({ path: resolve(outputDirectory, `privacy-${viewport.width}.png`) })
    await page.locator('.site-footer').scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(outputDirectory, `footer-${viewport.width}.png`) })

    for (const route of ['cookies', 'offer', 'terms', 'consent']) {
      await page.goto(`${origin}/${route}`, { waitUntil: navigationWaitUntil })
      await page.locator('h1').waitFor()
      const routeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (routeOverflow > 0) failures.push(`${viewport.width}px /${route}: horizontal overflow ${routeOverflow}px`)
    }

    failures.push(...runtimeErrors.map((error) => `${viewport.width}px: ${error}`))
    await page.close()
  }
} finally {
  await browser.close()
  server?.kill()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Legal browser verification passed at 375px, 768px, and 1440px against ${origin}`)
}
