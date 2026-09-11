import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

/* Подмена Supabase для браузерных тестов админки: вход с паролем и кодом
   второго фактора и ответы admin-RPC тех же форм, что отдаёт прод. */

export const ownerId = '11111111-1111-4111-8111-111111111111'
export const studentId = '22222222-2222-4222-8222-222222222222'

function base64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function token(aal: 'aal1' | 'aal2') {
  const now = Math.floor(Date.now() / 1000)
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
    sub: ownerId,
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
  id: ownerId,
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

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
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

export const student = {
  id: studentId, email: 'alina@example.test', fullName: 'Алина Смирнова', grade: 8,
  createdAt: '2026-09-01T09:00:00Z', lastSeenAt: '2026-09-10T18:00:00Z', balance: 1850,
  isBanned: false, bannedUntil: null, planId: 'base', planTitle: 'Базовый', tasks: 7,
  paid: true, paidTotal: 10000, openFlags: 1, maxRisk: 'medium', status: 'fraud',
}

const moreStudents = [
  { ...student, id: '33333333-3333-4333-8333-333333333333', email: 'misha.volkov@example.test', fullName: 'Миша Волков', grade: 7, balance: 400, tasks: 3, paid: false, paidTotal: 0, openFlags: 0, maxRisk: null, status: 'active' },
  { ...student, id: '44444444-4444-4444-8444-444444444444', email: 'sofia@example.test', fullName: 'София Крылова', grade: 11, balance: 0, tasks: 22, paidTotal: 30000, openFlags: 0, maxRisk: null, isBanned: true, status: 'banned' },
]

const conversation = {
  id: 'conversation-1', user_id: studentId, category: 'payment', subject: 'Проблема с оплатой или балансом', status: 'pending_owner',
  context: {}, owner_notification_status: 'sent', created_at: ago(90), updated_at: ago(45), last_message_at: ago(45),
  resolved_at: null, priority: 'high', assigned_to: null, first_response_at: null, last_user_message_at: ago(45),
  user_last_read_at: ago(45), owner_last_read_at: null, rating: null, rating_comment: null, rated_at: null, slaMinutes: 30,
}

export const rpcFixtures: Record<string, (aal: string) => unknown> = {
  get_admin_context: (aal) => ({
    isAdmin: true,
    role: 'owner',
    mfaEnrolled: true,
    aal,
    permissions: { users: true, support: true, moderate: true, money: true, settings: true, delete: true, payouts: true, admins: true },
  }),
  admin_signal_counts: () => ({ pendingTickets: 1, overdueTickets: 1, openFlags: 1, openErrors: 1, online: 3 }),
  admin_dashboard_v2: () => dashboard,
  admin_users_list: () => ({ total: 3, page: 1, pageSize: 50, items: [student, ...moreStudents], plans: [{ id: 'base', title: 'Базовый' }] }),
  admin_user_card: () => ({
    profile: { id: studentId, email: student.email, fullName: student.fullName, grade: 8, createdAt: student.createdAt, lastSeenAt: student.lastSeenAt, lastSignInAt: student.lastSeenAt, emailConfirmedAt: student.createdAt, providers: ['email'], isAdmin: false },
    controls: { isBanned: false, banReason: null, bannedAt: null, bannedUntil: null, dailySolveLimit: null, limitReason: null },
    wallet: { balance: 1850, credited: 12000, debited: 10150, entries: [{ id: 'entry-1', amount: -450, kind: 'debit', description: 'Решение задачи', key: 'solution-1', createdAt: '2026-09-10T18:00:00Z' }, { id: 'entry-2', amount: 10000, kind: 'credit', description: 'Пополнение баланса', key: 'verified-top-up:1', createdAt: '2026-09-05T10:00:00Z' }] },
    plan: { current: { id: 'base', title: 'Базовый', dailySolveLimit: 60, priceKopecks: 0 }, grant: null, history: [], available: [{ id: 'base', title: 'Базовый' }] },
    payments: [{ id: 'topup-1', amount: 10000, reference: 'bank-0001', source: 'admin', createdAt: '2026-09-05T10:00:00Z', refunded: 0 }],
    tasks: [{ key: 'solution-1', subject: 'Физика', grade: '8 класс', source: 'text', task: 'Задача', preview: 'Тело массой 2 кг бросили вертикально вверх', status: 'done', stage: 'done', error: null, createdAt: '2026-09-10T18:00:00Z', finishedAt: '2026-09-10T18:01:00Z', logId: null, costKopecks: 38 }],
    economics: { solutionCostKopecks: 380, chatCostKopecks: 0, chatChargedKopecks: 0, solutionChargedKopecks: 3150, paidKopecks: 10000, refundedKopecks: 0 },
    devices: [{ ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', deviceId: 'device-1', hits: 14, firstSeenAt: '2026-09-01T09:00:00Z', lastSeenAt: '2026-09-10T18:00:00Z' }],
    activity: [], linked: [], tickets: [{ id: 'conversation-1', subject: conversation.subject, category: 'payment', status: 'pending_owner', updatedAt: ago(45) }],
    flags: [{ id: 'flag-1', ruleId: 'ip_accounts', risk: 'medium', explanation: 'С адреса 10.0.0.1 за 24 ч зарегистрировано 3 аккаунтов', status: 'open', createdAt: ago(300) }],
    notes: [], audit: [], viewerRole: 'owner',
  }),
  admin_support_inbox: () => ({
    total: 2, page: 1, pageSize: 50, slaMinutes: 30,
    agents: [{ id: ownerId, email: 'owner@example.test', role: 'owner' }],
    items: [
      { id: 'conversation-1', userId: studentId, email: student.email, fullName: student.fullName, category: 'payment', subject: conversation.subject, status: 'pending_owner', priority: 'high', assignedTo: null, assignedEmail: null, createdAt: ago(90), updatedAt: ago(45), lastMessageAt: ago(45), lastUserMessageAt: ago(45), firstResponseAt: null, ownerLastReadAt: null, rating: null, lastMessage: 'Списалось 9 ₽, а решение не пришло', lastAuthor: 'user', unread: 2, waitingMinutes: 45, slaBreached: true },
      { id: 'conversation-2', userId: moreStudents[0].id, email: moreStudents[0].email, fullName: moreStudents[0].fullName, category: 'feature', subject: 'Идея для сервиса', status: 'pending_user', priority: 'normal', assignedTo: ownerId, assignedEmail: 'owner@example.test', createdAt: ago(2000), updatedAt: ago(600), lastMessageAt: ago(600), lastUserMessageAt: ago(1200), firstResponseAt: ago(1100), ownerLastReadAt: ago(600), rating: null, lastMessage: 'Спасибо, посмотрим', lastAuthor: 'owner', unread: 0, waitingMinutes: null, slaBreached: false },
    ],
  }),
  admin_support_thread: () => ({
    conversation,
    messages: [
      { id: 'message-1', authorType: 'user', authorEmail: null, body: 'Здравствуйте! Списалось 9 ₽, а решение не пришло. Задача по физике про брошенное тело.', createdAt: ago(90) },
      { id: 'message-2', authorType: 'user', authorEmail: null, body: 'Можно вернуть деньги или прислать решение?', createdAt: ago(45) },
    ],
    notes: [],
    user: { id: studentId, email: student.email, fullName: student.fullName, grade: 8, balance: 1850, planTitle: 'Базовый', isBanned: false, createdAt: student.createdAt },
    recentTasks: [{ key: 'solution-1', subject: 'Физика', task: 'Задача', preview: 'Тело массой 2 кг бросили вертикально вверх', status: 'failed', error: 'Решение не прошло проверку', createdAt: ago(95), logId: null }],
    flags: [],
    walletEntries: [{ id: 'entry-1', amount: -900, description: 'Решение задачи', createdAt: ago(95) }],
    ideaApproval: { status: 'not_applicable', credited: false },
    templates: [{ id: 'template-1', title: 'Приветствие', body: 'Здравствуйте, {{name}}! Уже смотрю ваш вопрос.' }],
  }),
  admin_fraud_overview: () => ({
    total: 1, page: 1, pageSize: 50, counts: { open: 1, high: 0, deferred: 0 },
    rules: [{ id: 'ip_accounts', title: 'Аккаунты с одного IP', description: 'Столько и больше аккаунтов зашли с одного адреса за окно.', enabled: true, threshold: 3, windowHours: 24, risk: 'medium', updatedAt: ago(5000) }],
    whitelist: [],
    items: [{ id: 'flag-1', userId: studentId, email: student.email, fullName: student.fullName, ruleId: 'ip_accounts', ruleTitle: 'Аккаунты с одного IP', risk: 'medium', explanation: 'С адреса 10.0.0.1 за 24 ч зарегистрировано 3 аккаунтов', evidence: { ip: '10.0.0.1' }, status: 'open', createdAt: ago(300), updatedAt: ago(300), deferredUntil: null, isBanned: false, balance: 1850 }],
  }),
  admin_errors_list: () => ({
    total: 2, page: 1, pageSize: 50, routes: ['solve', 'chat'],
    items: [
      { fingerprint: 'fp-1', kind: 'llm', severity: 'error', route: 'solve', title: 'Провайдер модели временно недоступен', status: 'new', occurrences: 7, usersAffected: 4, firstSeenAt: ago(900), lastSeenAt: ago(12), trend: [0, 1, 0, 2, 1, 0, 3], lastHour: 2 },
      { fingerprint: 'fp-2', kind: 'frontend', severity: 'error', route: '/app', title: "Cannot read properties of undefined (reading 'steps')", status: 'in_progress', occurrences: 3, usersAffected: 2, firstSeenAt: ago(5000), lastSeenAt: ago(400), trend: [1, 0, 0, 1, 0, 1, 0], lastHour: 0 },
    ],
  }),
  admin_health: () => ({
    services: [
      { service: 'kie', ok: true, status: 'ok', latencyMs: 127, detail: 'Баланс шлюза: 684.55 кредитов', checkedAt: ago(2), lastOkAt: ago(2), downSince: null, uptime24h: 100, uptime7d: 99.8 },
      { service: 'email', ok: false, status: 'not_configured', latencyMs: 0, detail: 'Нет RESEND_API_KEY на Vercel', checkedAt: ago(2), lastOkAt: null, downSince: ago(60), uptime24h: 0, uptime7d: 0 },
    ],
    database: { ok: true, now: ago(0), sizeBytes: 48_000_000, connections: 12 },
    storage: { buckets: 2, objects: 40, bytes: 5_200_000 },
    queue: { queued: 0, running: 1, stuck: 0, staleQueued: 0, failedLastHour: 1, doneLastHour: 6, chatReserved: 0, items: [] },
    cron: [{ job: 'admin-cron', schedule: '* * * * *', active: true, lastRun: { status: 'succeeded', startedAt: ago(0), message: '1 row' } }],
  }),
  admin_finance_payments: () => ({
    total: 2, page: 1, pageSize: 50, from: days(30)[0], to: days(30)[29],
    items: [
      { id: 'topup-1', type: 'top_up', userId: studentId, email: student.email, amount: 10000, status: 'succeeded', method: 'ручное подтверждение', reference: 'bank-0001', reason: null, refunded: 0, createdAt: '2026-09-05T10:00:00Z' },
      { id: 'rejection-1', type: 'rejection', userId: moreStudents[0].id, email: moreStudents[0].email, amount: 0, status: 'failed', method: 'solve', reference: 'req-1', reason: 'Не хватило баланса', refunded: 0, createdAt: ago(600) },
    ],
  }),
  admin_settings_overview: () => ({
    plans: [{ id: 'base', title: 'Базовый', description: 'Оплата за каждое решение с баланса.', priceKopecks: 0, periodDays: 30, dailySolveLimit: 60, features: ['Решение задачи от 4 ₽'], isDefault: true, active: true, sort: 0, updatedAt: ago(5000), users: 0 }],
    subjects: [{ id: 'mathematics', enabled: true, sort: 0, promptVersion: null }, { id: 'physics', enabled: true, sort: 1, promptVersion: 2 }],
    flags: [{ key: 'ai_chat', description: 'ИИ-чат', enabled: true, rolloutPercent: 100, updatedAt: ago(5000) }],
    settings: { site_banner: { enabled: false, text: '', tone: 'info', link: '' }, support_sla_minutes: 30 },
  }),
  admin_promo_list: () => [],
  admin_notifications_overview: () => ({
    rules: [{ event: 'payment_new', title: 'Новый платёж', telegram: true, email: false }, { event: 'ticket_new', title: 'Новый тикет', telegram: true, email: false }],
    emails: [], dailySummaryHour: 9, recent: [], lastCron: { status: 'succeeded', startedAt: ago(0), message: '1 row' }, lastDelivery: null,
  }),
  admin_audit_log_list: () => ({
    total: 1, page: 1, pageSize: 50,
    items: [{ id: 'audit-1', event: 'balance_adjusted', actorEmail: 'owner@example.test', actorRole: 'owner', actorIp: '10.0.0.9', targetUserId: studentId, targetEmail: student.email, payload: { reason: 'Возврат за сбой' }, before: { balance: 950 }, after: { balance: 1850 }, createdAt: ago(1000) }],
  }),
}

export async function mockSupabase(page: Page) {
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

export async function signIn(page: Page) {
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
