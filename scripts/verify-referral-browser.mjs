import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const port = 4193
const origin = `http://127.0.0.1:${port}`
const outputDirectory = resolve('test-results', 'referral-browser')
const testUserId = 'c0de0000-2026-4828-9000-000000000001'
const referralCode = 'UIREF2026A'
const claimToken = '0f65dd61-a5df-4b65-980c-74f1ef7cdf13'
await mkdir(outputDirectory, { recursive: true })

const localEnvironment = [
  await readFile(resolve('.env.local'), 'utf8').catch(() => ''),
  await readFile(resolve('.vercel', '.env.production.local'), 'utf8').catch(() => ''),
].join('\n')
const environmentValue = (name) => localEnvironment
  .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, '')
const configuredUrl = process.env.VITE_SUPABASE_URL
  || environmentValue('VITE_SUPABASE_URL')
const configuredPublishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || environmentValue('VITE_SUPABASE_PUBLISHABLE_KEY')
if (!configuredUrl || !configuredPublishableKey) throw new Error('Supabase browser variables are required for referral browser verification')
const projectRef = new URL(configuredUrl).hostname.split('.')[0]

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_SUPABASE_URL: configuredUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: configuredPublishableKey,
  },
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

const profile = {
  id: testUserId,
  full_name: 'Referral UI Check',
  grade: 8,
  avatar_path: null,
  created_at: '2026-08-28T10:00:00.000Z',
  last_seen_at: null,
  updated_at: '2026-08-28T10:00:00.000Z',
}

const user = {
  id: testUserId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'referral-ui@example.invalid',
  email_confirmed_at: '2026-08-28T10:00:00.000Z',
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: profile.full_name, grade: '8' },
  identities: [],
  created_at: '2026-08-28T10:00:00.000Z',
  updated_at: '2026-08-28T10:00:00.000Z',
  is_anonymous: false,
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60
const accessToken = `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ aud: 'authenticated', exp: expiresAt, role: 'authenticated', sub: testUserId, email: user.email })}.browser-check`
const session = {
  access_token: accessToken,
  refresh_token: 'referral-browser-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: expiresAt,
  user,
}

async function routeSupabase(page) {
  await page.route('**/*.supabase.co/**', async (route) => {
    const requestUrl = new URL(route.request().url())
    const path = requestUrl.pathname
    const json = (value, status = 200) => route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(value),
    })

    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })
    if (path.endsWith('/auth/v1/user')) return json(user)
    if (path.endsWith('/auth/v1/token')) return json(session)
    if (path.endsWith('/rest/v1/rpc/begin_referral_registration')) return json({ claimToken, expiresAt: '2026-09-04T10:00:00.000Z' })
    if (path.endsWith('/rest/v1/rpc/get_my_referral')) return json({
      code: referralCode,
      invitedCount: 3,
      pendingCount: 2,
      rewardedCount: 1,
      earnedAmount: 10,
      joinedViaReferral: true,
      joinedRewardStatus: 'pending',
      referrerRewardAmount: 10,
      inviteeRewardAmount: 5,
    })
    if (path.includes('/rest/v1/rpc/')) return json(null)
    if (path.endsWith('/rest/v1/profiles')) return json(profile)
    if (path.endsWith('/rest/v1/wallet_accounts')) return json({ balance: 20 })
    if (path.endsWith('/rest/v1/wallet_entries')) return json([{
      id: 'entry-1',
      user_id: testUserId,
      amount: 20,
      kind: 'credit',
      description: 'Стартовые 20 ₽',
      idempotency_key: 'welcome-credit',
      created_at: '2026-08-28T10:00:00.000Z',
    }])
    if (path.endsWith('/rest/v1/account_controls')) return json({ user_id: testUserId, is_banned: false, ban_reason: null, banned_at: null, banned_by: null, updated_at: '2026-08-28T10:00:00.000Z' })
    if (path.endsWith('/rest/v1/homework_solution_catalog') || path.endsWith('/rest/v1/homework_solutions')) return json([])
    return json([])
  })
}

function trackRuntimeErrors(page, failures, label) {
  page.on('pageerror', (error) => failures.push(`${label}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (/websocket|realtime/i.test(message.text())) return
    failures.push(`${label}: ${message.text()}`)
  })
}

const failures = []
const browser = await chromium.launch({ headless: true })
try {
  await waitForServer()

  const guestPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  trackRuntimeErrors(guestPage, failures, 'guest')
  await routeSupabase(guestPage)
  await guestPage.goto(`${origin}/?ref=${referralCode}`, { waitUntil: 'domcontentloaded' })
  await guestPage.waitForFunction((expectedToken) => {
    const pending = JSON.parse(localStorage.getItem('homework-copilot:pending-referral') || 'null')
    return pending?.claimToken === expectedToken
  }, claimToken)
  if (new URL(guestPage.url()).searchParams.has('ref')) failures.push('guest: referral code remained in the visible URL')
  await guestPage.getByRole('button', { name: 'Войти или зарегистрироваться' }).first().click()
  await guestPage.getByRole('tab', { name: 'Регистрация' }).click()
  await guestPage.getByRole('heading', { name: 'Создай аккаунт' }).waitFor()
  await guestPage.screenshot({ path: resolve(outputDirectory, 'registration-390.png') })
  await guestPage.close()

  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    const context = await browser.newContext({ viewport })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    await context.addInitScript(({ storageKey, storedSession }) => {
      localStorage.setItem(storageKey, JSON.stringify(storedSession))
    }, { storageKey: `sb-${projectRef}-auth-token`, storedSession: session })
    const page = await context.newPage()
    trackRuntimeErrors(page, failures, `wallet-${viewport.width}`)
    await routeSupabase(page)
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    const profileButton = page.getByRole('button', { name: 'Открыть профиль' })
    try {
      await profileButton.waitFor({ timeout: 8000 })
    } catch {
      const availableButtons = await page.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') || button.textContent?.trim()).filter(Boolean))
      failures.push(`wallet-${viewport.width}: authenticated profile control is missing (${availableButtons.join(' | ')})`)
      await page.screenshot({ path: resolve(outputDirectory, `wallet-auth-failure-${viewport.width}.png`) })
      await context.close()
      continue
    }
    await profileButton.click()
    await page.getByRole('navigation', { name: 'Раздел аккаунта' }).waitFor()
    await page.getByRole('button', { name: /Баланс 20 ₽/ }).click()
    await page.getByRole('heading', { name: 'Пригласи друга' }).waitFor()
    await page.getByText('После его первого подтверждённого пополнения').waitFor()

    const linkInput = page.getByRole('textbox', { name: 'Личная реферальная ссылка' })
    if (await linkInput.inputValue() !== `${origin}/?ref=${referralCode}`) failures.push(`wallet-${viewport.width}: wrong personal link`)
    if (!await page.getByText('3 приглашено').isVisible()) failures.push(`wallet-${viewport.width}: invitation count is missing`)
    if (!await page.getByText('10 ₽ начислено').isVisible()) failures.push(`wallet-${viewport.width}: earned amount is missing`)

    const copyButton = page.getByRole('button', { name: 'Копировать' })
    await copyButton.focus()
    if (!await copyButton.evaluate((element) => element === document.activeElement)) failures.push(`wallet-${viewport.width}: copy button is not keyboard focusable`)
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Скопировано' }).waitFor()

    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector('.account-dialog')
      return {
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0,
      }
    })
    if (overflow.document > 0 || overflow.dialog > 0) failures.push(`wallet-${viewport.width}: horizontal overflow ${JSON.stringify(overflow)}`)
    await page.screenshot({ path: resolve(outputDirectory, `wallet-${viewport.width}.png`) })

    await page.goto(`${origin}/support`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Чем помочь?' }).waitFor()
    const ideaButton = page.getByRole('button', { name: /Идея для сервиса/ })
    await ideaButton.click()
    await page.getByText('За полезную идею начислим 10 ₽.').waitFor()
    await page.waitForTimeout(300)
    const supportState = await page.evaluate(() => {
      const note = document.querySelector('.support-context-note.is-feature')
      const regularCard = document.querySelector('.support-category-card:not(.is-selected)')
      const compose = document.querySelector('.support-compose')
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        referenceBorder: compose ? getComputedStyle(compose).borderColor : '',
        noteBorder: note ? getComputedStyle(note).borderColor : '',
        regularCardBorder: regularCard ? getComputedStyle(regularCard).borderColor : '',
      }
    })
    if (supportState.overflow) failures.push(`support-${viewport.width}: horizontal overflow`)
    if (supportState.noteBorder !== supportState.referenceBorder) failures.push(`support-${viewport.width}: reward note uses a tinted border`)
    if (supportState.regularCardBorder !== supportState.referenceBorder) failures.push(`support-${viewport.width}: category card uses a tinted border`)
    await page.screenshot({ path: resolve(outputDirectory, `support-${viewport.width}.png`), fullPage: true })

    await page.goto(`${origin}/solutions`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Решения', exact: true }).waitFor()
    const footerBeforeScroll = await page.locator('.site-footer').evaluate((footer) => ({
      top: footer.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    }))
    if (footerBeforeScroll.top < footerBeforeScroll.viewportHeight) failures.push(`solutions-${viewport.width}: footer is visible before scrolling`)
    await page.screenshot({ path: resolve(outputDirectory, `solutions-${viewport.width}.png`) })
    await page.locator('.site-footer').scrollIntoViewIfNeeded()
    if (!await page.locator('.site-footer').isVisible()) failures.push(`solutions-${viewport.width}: footer is not reachable by scrolling`)
    await context.close()
  }

  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  trackRuntimeErrors(adminPage, failures, 'admin')
  await adminPage.goto(`${origin}/admin?admin-preview=1`, { waitUntil: 'domcontentloaded' })
  await adminPage.getByRole('heading', { name: 'Управление сервисом' }).waitFor()
  await adminPage.locator('.admin-user-cell').first().click()
  await adminPage.getByRole('heading', { name: 'Подтвердить пополнение' }).waitFor()
  await adminPage.getByText('Первое подтверждённое пополнение запускает реферальные +10 ₽ и +5 ₽.').waitFor()
  await adminPage.waitForTimeout(400)
  if (await adminPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) failures.push('admin: horizontal overflow')
  await adminPage.screenshot({ path: resolve(outputDirectory, 'admin-top-up-1440.png') })
  await adminPage.close()
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Referral browser verification passed at 390px and 1440px')
}
