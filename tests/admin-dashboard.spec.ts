import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

/* Админку проверяем без настоящей базы: ответы Supabase подменяются на
   уровне сети. Так проходит весь путь входа - пароль, код второго фактора,
   повышение сессии до aal2 - и разделы получают те же JSON, что отдают
   admin-RPC на проде. */

const userId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'

function base64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function token(aal: 'aal1' | 'aal2') {
  const now = Math.floor(Date.now() / 1000)
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
    sub: userId,
    email: 'owner@example.test',
    role: 'authenticated',
    aal,
    amr: aal === 'aal2' ? [{ method: 'totp', timestamp: now }, { method: 'password', timestamp: now }] : [{ method: 'password', timestamp: now }],
    session_id: 'session-1',
    exp: now + 3600,
    iat: now,
  })}.${Buffer.from('test-signature').toString('base64url')}`
}

const authUser = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  factors: [{ id: 'factor-1', friendly_name: 'Админка', factor_type: 'totp', status: 'verified', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' }],
  created_at: '2026-08-23T10:00:00Z',
}

function session(aal: 'aal1' | 'aal2') {
  return {
    access_token: token(aal),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${aal}`,
    user: authUser,
  }
}

function days(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - (count - 1 - index))
    return date.toISOString().slice(0, 10)
  })
}

const summary = (factor: number) => ({
  revenue: 125000 * factor, topUps: 12 * factor, averageCheck: 10400, registrations: 18 * factor, solved: 140 * factor, failed: 9,
  consumption: 61000 * factor, llmCost: 9100 * factor, solutionCost: 7000 * factor, chatCost: 2100 * factor, margin: 115900 * factor,
  errors: 14, dau: 7.4, wau: 21, mau: 44, mrr: 125000 * factor, conversion: 16.7,
})

const dashboard = {
  from: days(30)[0],
  to: days(30)[29],
  previousFrom: days(60)[0],
  previousTo: days(60)[29],
  current: summary(1),
  previous: summary(0.8),
  errorsLastHour: 2,
  errorsHourlyNorm: 0.4,
  errorsAboveNorm: false,
  online: 3,
  series: days(30).map((date, index) => ({
    date,
    revenue: (index % 4) * 3000,
    llmCost: 200 + (index % 5) * 90,
    registrations: index % 3,
    activeUsers: 4 + (index % 6),
    solved: 3 + (index % 7),
    failed: index % 2,
    errors: index % 3,
    bySubject: { Физика: 2 + (index % 3), Алгебра: 1 + (index % 4), 'Русский язык': index % 2 },
  })),
  cohorts: days(21).filter((_, index) => index % 7 === 0).map((week) => ({ week, size: 6, retention: [100, 50, 33.3, null, null, null, null, null] })),
  funnel: [
    { step: 'registered', count: 18 },
    { step: 'first_task', count: 12 },
    { step: 'limit_exhausted', count: 5 },
    { step: 'paid', count: 3 },
  ],
  attention: {
    slaMinutes: 30,
    overdueTickets: [{ id: 'conversation-1', subject: 'Проблема с оплатой или балансом', email: 'alina@example.test', waitingMinutes: 45 }],
    fraudFlags: [{ id: 'flag-1', userId: studentId, email: 'alina@example.test', risk: 'medium', explanation: 'С адреса 10.0.0.1 за 24 ч зарегистрировано 3 аккаунтов' }],
    fraudOpen: 1,
    errorSpike: { lastHour: 2, norm: 0.4, spike: false },
    paymentRejections24h: 1,
    refunds24h: 0,
    stuckJobs: 0,
  },
}

const student = {
  id: studentId, email: 'alina@example.test', fullName: 'Алина Смирнова', grade: 8,
  createdAt: '2026-09-01T09:00:00Z', lastSeenAt: '2026-09-10T18:00:00Z', balance: 1850,
  isBanned: false, bannedUntil: null, planId: 'base', planTitle: 'Базовый', tasks: 7,
  paid: true, paidTotal: 10000, openFlags: 1, maxRisk: 'medium', status: 'fraud',
}

const rpcFixtures: Record<string, (aal: string) => unknown> = {
  get_admin_context: (aal) => ({
    isAdmin: true,
    role: 'owner',
    mfaEnrolled: true,
    aal,
    permissions: { users: true, support: true, moderate: true, money: true, settings: true, delete: true, payouts: true, admins: true },
  }),
  admin_signal_counts: () => ({ pendingTickets: 1, overdueTickets: 1, openFlags: 1, openErrors: 1, online: 3 }),
  admin_dashboard_v2: () => dashboard,
  admin_users_list: () => ({ total: 1, page: 1, pageSize: 50, items: [student], plans: [{ id: 'base', title: 'Базовый' }] }),
  admin_user_card: () => ({
    profile: { id: studentId, email: student.email, fullName: student.fullName, grade: 8, createdAt: student.createdAt, lastSeenAt: student.lastSeenAt, lastSignInAt: student.lastSeenAt, emailConfirmedAt: student.createdAt, providers: ['email'], isAdmin: false },
    controls: { isBanned: false, banReason: null, bannedAt: null, bannedUntil: null, dailySolveLimit: null, limitReason: null },
    wallet: { balance: 1850, credited: 12000, debited: 10150, entries: [{ id: 'entry-1', amount: -450, kind: 'debit', description: 'Решение задачи', key: 'solution-1', createdAt: '2026-09-10T18:00:00Z' }] },
    plan: { current: { id: 'base', title: 'Базовый', dailySolveLimit: 60, priceKopecks: 0 }, grant: null, history: [], available: [{ id: 'base', title: 'Базовый' }] },
    payments: [{ id: 'topup-1', amount: 10000, reference: 'bank-0001', source: 'admin', createdAt: '2026-09-05T10:00:00Z', refunded: 0 }],
    tasks: [{ key: 'solution-1', subject: 'Физика', grade: '8 класс', source: 'text', task: 'Задача', preview: 'Тело массой 2 кг', status: 'done', stage: 'done', error: null, createdAt: '2026-09-10T18:00:00Z', finishedAt: '2026-09-10T18:01:00Z', logId: null, costKopecks: 38 }],
    economics: { solutionCostKopecks: 380, chatCostKopecks: 0, chatChargedKopecks: 0, solutionChargedKopecks: 3150, paidKopecks: 10000, refundedKopecks: 0 },
    devices: [], activity: [], linked: [], tickets: [], flags: [], notes: [], audit: [], viewerRole: 'owner',
  }),
}

async function mockSupabase(page: Page) {
  await page.routeWebSocket(/\/realtime\/v1\//, () => {})
  await page.route(/\/auth\/v1\/token/, (route) => route.fulfill({ json: session('aal1') }))
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ json: authUser }))
  await page.route(/\/auth\/v1\/factors\/factor-1\/challenge/, (route) => route.fulfill({ json: { id: 'challenge-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 } }))
  await page.route(/\/auth\/v1\/factors\/factor-1\/verify/, (route) => route.fulfill({ json: session('aal2') }))
  await page.route(/\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204, body: '' }))
  await page.route(/\/rest\/v1\/rpc\/([a-z_0-9]+)/, (route: Route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const authorization = route.request().headers().authorization ?? ''
    const payload = authorization.split('.')[1]
    const aal = payload ? String(JSON.parse(Buffer.from(payload, 'base64url').toString()).aal ?? 'aal1') : 'aal1'
    const fixture = rpcFixtures[name]
    return route.fulfill({ json: fixture ? fixture(aal) : {} })
  })
}

async function signIn(page: Page) {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Вход в админку' })).toBeVisible()
  await page.getByLabel('Почта').fill('owner@example.test')
  await page.getByLabel('Пароль').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Подтверди вход' })).toBeVisible()
  await page.getByLabel('Код').fill('123456')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible()
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => !element.closest('.adm-table-wrap, .adm-rail, .adm-tabs'))
      .map((element) => ({ className: String(element.className), tag: element.tagName, right: Math.round(element.getBoundingClientRect().right) }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }))
  expect(widths.scroll, JSON.stringify(widths.overflowing)).toBeLessThanOrEqual(widths.client)
}

test.describe('админка', () => {
  test('пускает только после второго фактора и показывает дашборд и пользователей', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
    })
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await expect(page.getByText('обращений без ответа дольше 30 мин')).toBeVisible()
    await expect(page.getByText('Выручка за период')).toBeVisible()
    await expect(page.getByText('Удержание по неделям регистрации')).toBeVisible()

    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Пользователи' }).click()
    await expect(page).toHaveURL(/section=users/)
    await page.getByText('alina@example.test').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`user=${studentId}`))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await expectNoPageOverflow(page)
    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Пользователи' }).click()
    await expect(page.getByText('alina@example.test').first()).toBeVisible()
    await expectNoPageOverflow(page)
  })
})
