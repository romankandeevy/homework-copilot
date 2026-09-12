import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { financeFixtures } from './financeMocks'

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
  paid: true, paidTotal: 10000, openFlags: 1, maxRisk: 'medium', status: 'fraud', isStaff: false,
}

const moreStudents = [
  { ...student, id: '33333333-3333-4333-8333-333333333333', email: 'misha.volkov@example.test', fullName: 'Миша Волков', grade: 7, lastSeenAt: ago(3), balance: 400, tasks: 3, paid: false, paidTotal: 0, openFlags: 0, maxRisk: null, status: 'active' },
  { ...student, id: '44444444-4444-4444-8444-444444444444', email: 'sofia@example.test', fullName: 'София Крылова', grade: 11, balance: 0, tasks: 22, paidTotal: 30000, openFlags: 0, maxRisk: null, isBanned: true, status: 'banned' },
]

const conversation = {
  id: 'conversation-1', user_id: studentId, category: 'payment', subject: 'Проблема с оплатой или балансом', status: 'pending_owner',
  context: {}, owner_notification_status: 'sent', created_at: ago(90), updated_at: ago(45), last_message_at: ago(45),
  resolved_at: null, priority: 'high', assigned_to: null, first_response_at: null, last_user_message_at: ago(45),
  user_last_read_at: ago(45), owner_last_read_at: null, rating: null, rating_comment: null, rated_at: null, slaMinutes: 30,
}

/* База решений: форма ответа admin_solutions_v2 и admin_solution_detail_v2. */
export const solutionList = {
  total: 3, page: 1, pageSize: 50,
  stats: { total: 34, today: 2, week: 12, catalog: 0, personal: 31, guest: 3, firstAt: '2026-09-04T19:21:47Z', lastAt: ago(40), verifiedTasks: 0, costsSince: '2026-09-06T11:47:10Z' },
  facets: {
    subjects: [{ value: 'Геометрия', count: 8 }, { value: 'Алгебра', count: 7 }, { value: 'Физика', count: 5 }],
    sources: [{ value: 'text', count: 22 }, { value: 'photo', count: 9 }],
    statuses: [{ value: 'passed', count: 31 }],
    kinds: [{ value: 'personal', count: 31 }, { value: 'guest', count: 3 }],
  },
  items: [
    { id: '9807d724-75df-4919-a6ff-38496faeac87', kind: 'personal', source: 'text', subject: 'Алгебра', task: null, textbookTitle: 'Любой учебник', condition: '862. Решите неравенство и изобразите на координатной прямой множество его решений: 0,7x - 7 > 0', answer: 'x > 10', userId: studentId, email: 'alina@example.test', accessCount: 1, status: 'passed', failedChecks: 0, priceKopecks: 500, costKopecks: 38, createdAt: ago(40) },
    { id: '88129c80-3392-4718-8d8c-2c133d74102f', kind: 'personal', source: 'photo', subject: 'Геометрия', task: null, textbookTitle: 'Любой учебник', condition: 'Диагонали ромба 10 и 24 см. Найдите сторону ромба.', answer: '13 см', userId: studentId, email: 'alina@example.test', accessCount: 1, status: 'passed', failedChecks: 0, priceKopecks: 600, costKopecks: null, createdAt: ago(3000) },
    { id: 'guest:5b2c:solution-guest-1', kind: 'guest', source: 'text', subject: 'Геометрия', task: null, textbookTitle: 'Любой учебник', condition: 'В треугольнике ABC угол C прямой, AC = 6, BC = 8. Найдите AB.', answer: '10', userId: null, email: null, accessCount: 1, status: 'passed', failedChecks: 0, priceKopecks: null, costKopecks: 41, createdAt: ago(9000) },
  ],
}

export const emptySolutionList = {
  total: 0, page: 1, pageSize: 50,
  stats: { total: 0, today: 0, week: 0, catalog: 0, personal: 0, guest: 0, firstAt: null, lastAt: null, verifiedTasks: 0, costsSince: null },
  facets: { subjects: [], sources: [], statuses: [], kinds: [] },
  items: [],
}

const solutionDetail = {
  id: '9807d724-75df-4919-a6ff-38496faeac87', kind: 'personal', source: 'text', subject: 'Алгебра', task: null,
  textbookTitle: 'Любой учебник', textbookEdition: 'по фото или тексту', createdAt: ago(40),
  userId: studentId, email: 'alina@example.test', guest: false, status: 'passed', engineVersion: 3,
  solution: {
    condition: '862. Решите неравенство и изобразите на координатной прямой множество его решений: 0,7x - 7 > 0',
    explanation: ['Неравенство линейное: переносим свободный член вправо и делим на положительное число, знак не меняется.', 'Ответ записываем промежутком и отмечаем на прямой.'],
    given: [],
    goal: { title: 'Найти', text: 'Значения x, при которых 0,7x - 7 > 0.' },
    steps: ['0,7x - 7 > 0', '0,7x > 7 |:0,7', 'x > 10'],
    answer: 'x > 10',
    diagram: { kind: 'none', description: '' },
    quality: { reviewPassed: true },
    verification: { checks: [
      { label: 'Источник', note: 'Условие совпадает с приложенным заданием', passed: true },
      { label: 'Запись в тетради', note: '13 строк · 100% обозначений', passed: true },
    ] },
  },
  accesses: [{ userId: studentId, email: 'alina@example.test', at: ago(40) }],
  wallet: [{ amount: -500, kind: 'debit', description: 'Решение задачи', at: ago(40) }],
  cost: { models: 'gpt-5-6-sol×1', calls: 1, credits: 0.9, costKopecks: 38, priceKopecks: 500, seconds: 41.2, outcome: 'solved', at: ago(40) },
  job: { status: 'done', stage: 'done', grade: '8 класс', createdAt: ago(41), finishedAt: ago(40) },
  ratings: { helpful: 0, unhelpful: 0, comments: [] },
}

export const rpcFixtures: Record<string, (aal: string, body: Record<string, unknown>) => unknown> = {
  ...financeFixtures,
  admin_solutions_v2: () => solutionList,
  admin_solution_detail_v2: () => solutionDetail,
  get_admin_context: (aal) => ({
    isAdmin: true,
    role: 'owner',
    mfaEnrolled: true,
    aal,
    permissions: { users: true, support: true, moderate: true, money: true, settings: true, delete: true, payouts: true, admins: true },
  }),
  admin_signal_counts: () => ({ pendingTickets: 1, overdueTickets: 1, openFlags: 1, openErrors: 1, online: 3 }),
  admin_dashboard_v2: () => dashboard,
  admin_dashboard_feed: () => ({ items: (rpcFixtures.admin_dashboard_period('aal2') as { feed: unknown[] }).feed, hasMore: false, total: 5 }),
  admin_dashboard_period: () => ({
    period: 'week', from: ago(7 * 1440), previousFrom: ago(14 * 1440), previousTo: ago(7 * 1440),
    series: days(7).map((label, index) => ({ label, solved: 3 + index, failed: index % 2, revenue: index * 1000, llmCost: 120 + index * 10, registrations: index % 3, active: 2 + index, guests: 0 })),
    subjects: [{ subject: 'Физика', solved: 12, failed: 1 }, { subject: 'Алгебра', solved: 9, failed: 2 }],
    attention: { slaMinutes: 30, overdueTickets: [{ id: 'conversation-1', subject: 'Проблема с оплатой или балансом', email: 'alina@example.test', waitingMinutes: 45 }], fraudOpen: 1, errorSpike: { lastHour: 2, norm: 0.4, spike: false }, stuckJobs: 0, reconciliation: { stuckReservations: 3, stuckAmount: 1500, walletMismatches: 1 } },
    current: { solved: 6, failed: 1, revenue: 20000, registrations: 2, llmCost: 240, active: 5, guests: 3 },
    previous: { solved: 4, failed: 0, revenue: 10000, registrations: 3, llmCost: 180, active: 4, guests: 1 },
    online: 3,
    gateway: { credits: 684.55, ok: true, status: 'ok', checkedAt: ago(2), avgCreditsPerTask: 0.41, tasksLast7Days: 44 },
    services: {
      total: 8, down: [], notConfigured: ['email'], checkedAt: ago(2),
      list: [
        { service: 'email', ok: false, status: 'not_configured', latencyMs: 0, checkedAt: ago(2), downSince: null },
        { service: 'database', ok: true, status: 'ok', latencyMs: 640, checkedAt: ago(2), downSince: null },
        { service: 'kie', ok: true, status: 'ok', latencyMs: 110, checkedAt: ago(2), downSince: null },
      ],
    },
    feed: [
      { kind: 'solution', at: ago(3), userId: studentId, email: student.email, name: student.fullName, subject: 'Физика', ok: true, amount: 500, cost: 38, seconds: 41, text: null },
      { kind: 'ticket', at: ago(45), userId: studentId, email: student.email, name: student.fullName, subject: 'Проблема с оплатой или балансом', ok: false, amount: null, cost: null, seconds: null, text: 'Можно вернуть деньги или прислать решение?' },
      { kind: 'payment', at: ago(120), userId: studentId, email: student.email, name: student.fullName, subject: null, ok: true, amount: 10000, cost: null, seconds: null, text: 'bank-0001' },
      { kind: 'solution', at: ago(95), userId: null, email: null, name: null, subject: 'Химия', ok: false, amount: 600, cost: 52, seconds: 88, text: null },
      { kind: 'signup', at: ago(300), userId: moreStudents[0].id, email: moreStudents[0].email, name: moreStudents[0].fullName, subject: null, ok: true, amount: null, cost: null, seconds: null, text: null },
    ],
  }),
  // Поиск «nobody» - пустой ответ: так проверяется пустое состояние таблицы.
  admin_users_list: (_aal, body) => (body.p_search === 'nobody'
    ? { total: 0, page: 1, pageSize: 50, items: [], plans: [{ id: 'base', title: 'Базовый' }] }
    : { total: 3, page: 1, pageSize: 50, items: [student, ...moreStudents], plans: [{ id: 'base', title: 'Базовый' }] }),
  admin_users_stats: () => ({ students: 3, new7d: 1, payers: 2, paidKopecks: 40000, online: 1, balanceCeiling: 1850 }),
  admin_set_user_ban: (_aal, body) => ({ userId: body.p_user_id, isBanned: body.p_is_banned, reason: body.p_reason ?? null, until: body.p_until ?? null }),
  admin_adjust_balance: (_aal, body) => ({ userId: body.p_user_id, amount: body.p_amount }),
  admin_users_bulk: (_aal, body) => ({ done: Array.isArray(body.p_user_ids) ? body.p_user_ids.length : 0, failed: [] }),
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
    total: 2, page: 1, pageSize: 50, slaMinutes: 30, period: 'all', since: null,
    agents: [{ id: ownerId, email: 'owner@example.test', role: 'owner' }],
    counts: { open: 2, pendingOwner: 1, overdue: 1, unassigned: 1, mine: 1 },
    items: [
      { id: 'conversation-1', userId: studentId, email: student.email, fullName: student.fullName, category: 'payment', subject: conversation.subject, status: 'pending_owner', priority: 'high', tags: ['payment', 'refund'], assignedTo: null, assignedEmail: null, createdAt: ago(90), updatedAt: ago(45), lastMessageAt: ago(45), lastUserMessageAt: ago(45), firstResponseAt: null, resolvedAt: null, ownerLastReadAt: null, rating: null, lastMessage: 'Списалось 9 ₽, а решение не пришло', lastAuthor: 'user', unread: 2, waitingMinutes: 45, slaBreached: true },
      { id: 'conversation-2', userId: moreStudents[0].id, email: moreStudents[0].email, fullName: moreStudents[0].fullName, category: 'feature', subject: 'Идея для сервиса', status: 'pending_user', priority: 'normal', tags: ['idea'], assignedTo: ownerId, assignedEmail: 'owner@example.test', createdAt: ago(2000), updatedAt: ago(600), lastMessageAt: ago(600), lastUserMessageAt: ago(1200), firstResponseAt: ago(1100), resolvedAt: null, ownerLastReadAt: ago(600), rating: null, lastMessage: 'Спасибо, посмотрим', lastAuthor: 'owner', unread: 0, waitingMinutes: null, slaBreached: false },
    ],
  }),
  admin_support_stats: () => ({
    period: 'all', since: null, days: 12, slaMinutes: 30,
    created: 18, resolved: 13, responded: 16, perDay: 1.5, resolvedShare: 72.2,
    firstResponseAvgMinutes: 24.5, firstResponseMedianMinutes: 11, slaBreached: 3, rated: 9, ratingAvg: 4.56,
    now: { open: 2, pendingOwner: 1, overdue: 1, unassigned: 1 },
    series: days(12).map((date, index) => ({ date, created: (index * 7) % 4, resolved: (index * 5) % 3 })),
    byTag: [{ tag: 'payment', count: 7 }, { tag: 'question', count: 5 }, { tag: 'bug', count: 4 }, { tag: 'idea', count: 2 }],
  }),
  admin_support_bulk_update: (_aal, body) => {
    const ids = Array.isArray(body.p_conversation_ids) ? body.p_conversation_ids : []
    return { requested: ids.length, updated: ids.length, ids }
  },
  admin_support_thread: () => ({
    history: [
      { id: 'conversation-0', subject: 'Не приходит код входа', category: 'general', status: 'resolved', tags: ['account'], createdAt: ago(9000), lastMessageAt: ago(8800), resolvedAt: ago(8800), rating: 5 },
    ],
    historyTotal: 1,
    conversation: { ...conversation, tags: ['payment', 'refund'] },
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
  // ---- Настройки v2 (20260912098000_admin_settings_v2.sql) ----
  admin_settings_history: (_aal, body) => (body.p_scope === 'flags' || body.p_scope === 'plans'
    ? {
      total: 1,
      events: [],
      items: [body.p_scope === 'flags'
        ? { id: 'history-flag-1', event: 'flag_saved', actorEmail: 'owner@example.test', actorRole: 'owner', targetEmail: null, payload: { key: 'ai_chat', bulk: 'disable' }, before: { key: 'ai_chat', enabled: true, rollout_percent: 100 }, after: { key: 'ai_chat', enabled: false, rollout_percent: 100 }, createdAt: ago(30) }
        : { id: 'history-plan-1', event: 'plan_saved', actorEmail: 'owner@example.test', actorRole: 'owner', targetEmail: null, payload: { planId: 'base' }, before: { id: 'base', daily_solve_limit: 50 }, after: { id: 'base', daily_solve_limit: 60 }, createdAt: ago(300) }],
    }
    : { total: 0, events: [], items: [] }),
  admin_flags_bulk: (_aal, body) => {
    const keys = Array.isArray(body.p_keys) ? body.p_keys : []
    return { selected: keys.length, changed: keys.length }
  },
  admin_prompt_preview_quota: () => ({
    hourLimit: 6, dayLimit: 30, hourUsed: 1, dayUsed: 3, running: false,
    subjectAvgCredits: 1.24, subjectMaxCredits: 2.16, subjectSamples: 9, overallAvgCredits: 1.97, spent30d: 2.5,
  }),
  admin_prompt_previews: () => [],
  admin_notifications_overview: () => ({
    rules: [{ event: 'payment_new', title: 'Новый платёж', telegram: true, email: false }, { event: 'ticket_new', title: 'Новый тикет', telegram: true, email: false }],
    emails: [], dailySummaryHour: 9, recent: [], lastCron: { status: 'succeeded', startedAt: ago(0), message: '1 row' }, lastDelivery: null,
  }),
  admin_audit_log_list: () => ({
    total: 1, page: 1, pageSize: 50,
    items: [{ id: 'audit-1', event: 'balance_adjusted', actorEmail: 'owner@example.test', actorRole: 'owner', actorIp: '10.0.0.9', targetUserId: studentId, targetEmail: student.email, payload: { reason: 'Возврат за сбой' }, before: { balance: 950 }, after: { balance: 1850 }, createdAt: ago(1000) }],
  }),
  admin_audit_log_v2: () => ({
    total: 3, page: 1, pageSize: 50,
    items: [
      { id: 'audit-1', event: 'balance_adjusted', actorId: ownerId, actorEmail: 'owner@example.test', actorRole: 'owner', actorIp: '10.0.0.9', targetUserId: studentId, targetEmail: student.email, targetName: student.fullName, payload: { amount: -45000, reason: 'Списание ошибочного пополнения', balanceAfter: 1850 }, before: null, after: null, dangerous: true, createdAt: ago(40) },
      { id: 'audit-2', event: 'support_status_changed', actorId: ownerId, actorEmail: 'owner@example.test', actorRole: 'owner', actorIp: '10.0.0.9', targetUserId: studentId, targetEmail: student.email, targetName: student.fullName, payload: { conversationId: 'conversation-1' }, before: { status: 'pending_owner', priority: 'high', assignedTo: null }, after: { status: 'resolved', priority: 'high', assignedTo: ownerId }, dangerous: false, createdAt: ago(90) },
      { id: 'audit-3', event: 'user_unbanned', actorId: null, actorEmail: null, actorRole: null, actorIp: null, targetUserId: moreStudents[1].id, targetEmail: moreStudents[1].email, targetName: moreStudents[1].fullName, payload: { reason: 'срок блокировки вышел', system: true }, before: { isBanned: true, reason: 'Спам в поддержку', until: ago(5) }, after: { isBanned: false }, dangerous: false, createdAt: ago(1500) },
    ],
    actors: [{ id: ownerId, email: 'owner@example.test', role: 'owner', current: true }],
    hasSystem: true,
    eventCounts: { balance_adjusted: 1, support_status_changed: 1, user_unbanned: 1 },
    dangerEvents: ['plan_deleted', 'solution_deleted', 'user_note_deleted', 'user_banned', 'payment_refunded', 'reservation_refunded', 'reconciliation_fixed', 'password_reset_sent', 'admin_role_changed'],
    oldestAt: '2026-08-28T18:34:34Z',
  }),
  admin_request_log_v2: () => ({
    total: 3, page: 1, pageSize: 100, distinctIps: 2, myIp: '10.0.0.9',
    items: [
      { id: 3, actorId: ownerId, actorEmail: 'owner@example.test', role: 'owner', path: '/rpc/admin_signal_counts', ip: '10.0.0.9', createdAt: ago(1) },
      { id: 2, actorId: ownerId, actorEmail: 'owner@example.test', role: 'owner', path: '/rpc/admin_audit_log_v2', ip: '10.0.0.9', createdAt: ago(2) },
      { id: 1, actorId: ownerId, actorEmail: 'owner@example.test', role: 'owner', path: '/rpc/admin_users_list', ip: '185.126.65.177', createdAt: ago(300) },
    ],
    paths: [{ path: '/rpc/admin_signal_counts', calls: 2003 }, { path: '/rpc/admin_dashboard_period', calls: 186 }, { path: '/rpc/admin_users_list', calls: 7 }],
    ips: [{ ip: '10.0.0.9', calls: 2190 }, { ip: '185.126.65.177', calls: 7 }],
    actors: [{ id: ownerId, email: 'owner@example.test', role: 'owner' }],
  }),
  admin_request_log_summary: () => ({
    total: 2196, distinctIps: 2, distinctPaths: 3, threshold: 2, myIp: '10.0.0.9',
    items: [
      { path: '/rpc/admin_signal_counts', calls: 2003, share: 91.2, peakPerMinute: 5, peakAt: ago(50), activeMinutes: 707, hotMinutes: 618, actors: 1, ips: 1, firstAt: ago(700), lastAt: ago(1) },
      { path: '/rpc/admin_dashboard_period', calls: 186, share: 8.5, peakPerMinute: 12, peakAt: ago(49), activeMinutes: 147, hotMinutes: 6, actors: 1, ips: 1, firstAt: ago(150), lastAt: ago(1) },
      { path: '/rpc/admin_users_list', calls: 7, share: 0.3, peakPerMinute: 2, peakAt: ago(300), activeMinutes: 5, hotMinutes: 0, actors: 1, ips: 1, firstAt: ago(600), lastAt: ago(300) },
    ],
  }),
  // ---- Мониторинг v2 (20260912095000_admin_monitoring_v2.sql) ----
  admin_monitoring_overview: () => monitoringOverview(),
  admin_errors_timeline: () => ({
    hasMore: false,
    nextBefore: 101,
    items: [
      { id: 102, fingerprint: 'fp-1', kind: 'llm', severity: 'error', route: 'solve', message: 'Провайдер модели временно недоступен', title: 'Провайдер модели временно недоступен', status: 'new', requestId: 'req-42', userId: studentId, email: student.email, guestId: null, ip: '10.0.0.1', createdAt: ago(12) },
      { id: 101, fingerprint: 'fp-2', kind: 'frontend', severity: 'error', route: '/app', message: "Cannot read properties of undefined (reading 'steps')", title: "Cannot read properties of undefined (reading 'steps')", status: 'in_progress', requestId: null, userId: null, email: null, guestId: '55555555-5555-4555-8555-555555555555', ip: '10.0.0.2', createdAt: ago(1500) },
    ],
  }),
  admin_error_routes: () => [
    { route: 'solve', errors: 7, requests: 120 },
    { route: '/app', errors: 3, requests: 0 },
    { route: 'chat', errors: 0, requests: 44 },
  ],
  admin_error_detail: () => ({
    group: { fingerprint: 'fp-2', kind: 'frontend', severity: 'error', route: '/app', title: "Cannot read properties of undefined (reading 'steps')", status: 'in_progress', occurrences: 3, users_affected: 2, first_seen_at: ago(5000), last_seen_at: ago(400), resolved_at: null },
    stats: { lastHour: 0, last24h: 1, stored: 3, trend: days(7).map((date, index) => ({ date, count: index === 6 || index % 3 === 0 ? 1 : 0 })) },
    events: [monitoringEvent],
  }),
  admin_error_event: () => monitoringEvent,
  admin_errors_set_status_bulk: (_aal, body) => ({
    status: body.p_status ?? 'resolved',
    updated: Array.isArray(body.p_fingerprints) ? body.p_fingerprints.length : 0,
    unchanged: 0,
    missing: 0,
  }),
  admin_quality: () => ({
    from: days(30)[0], to: days(30)[29],
    bySubject: [
      { subject: 'Физика', total: 42, solved: 39, failed: 3, truncated: 1, truncatedShare: 2.4, failedShare: 7.1, share: 46.7, helpful: 11, notHelpful: 2, helpfulShare: 84.6, p50: 38.2, p95: 96.4 },
      { subject: 'Химия', total: 18, solved: 15, failed: 3, truncated: 2, truncatedShare: 11.1, failedShare: 16.7, share: 20, helpful: 3, notHelpful: 1, helpfulShare: 75, p50: 44.8, p95: 120.3 },
      { subject: 'Алгебра', total: 30, solved: 29, failed: 1, truncated: 0, truncatedShare: 0, failedShare: 3.3, share: 33.3, helpful: 0, notHelpful: 0, helpfulShare: null, p50: 51.5, p95: 132.9 },
    ],
    latency: { p50: 41.3, p95: 118.7, p99: 161.2, count: 83 },
    chatLatency: { p50: 6.4, p95: 18.9, p99: 27.5, count: 57 },
    answerLength: [{ bucket: 500, count: 12 }, { bucket: 1000, count: 31 }, { bucket: 1500, count: 22 }, { bucket: 2000, count: 9 }],
    diagrams: { withDiagram: 17, total: 90, complaints: 1, notHelpful: 3 },
    rateLimit: { hits: 4, users: 2, byRoute: { solve: 3, chat: 1 } },
    chatTruncated: { total: 57, failed: 2 },
  }),
  admin_logs_search: () => ({
    total: 3,
    items: [
      { id: 3, requestId: 'req-42', route: 'solve', method: 'POST', status: 503, userId: studentId, email: student.email, guestId: null, ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', durationMs: 41250, bytesIn: 2048, error: 'Провайдер модели временно недоступен', createdAt: ago(12) },
      { id: 2, requestId: 'req-41', route: 'chat', method: 'POST', status: 200, userId: null, email: null, guestId: '55555555-5555-4555-8555-555555555555', ip: '10.0.0.2', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', durationMs: 5230, bytesIn: 512, error: null, createdAt: ago(30) },
      { id: 1, requestId: 'req-40', route: 'solve', method: 'POST', status: 429, userId: studentId, email: student.email, guestId: null, ip: '10.0.0.1', userAgent: null, durationMs: 12, bytesIn: 300, error: 'rate limited', createdAt: ago(55) },
    ],
  }),
}

const monitoringAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const monitoringEvent = {
  id: 101, fingerprint: 'fp-2', kind: 'frontend', severity: 'error', route: '/app',
  message: "Cannot read properties of undefined (reading 'steps')",
  stack: "TypeError: Cannot read properties of undefined (reading 'steps')\n    at SolutionView (https://www.homeworkcopilot.ru/assets/app.js:1:2345)\n    at renderWithHooks (https://www.homeworkcopilot.ru/assets/react.js:9:8765)",
  requestId: 'req-42', userId: studentId, email: student.email, guestId: null, ip: '10.0.0.1',
  input: { subject: 'Физика', task: '12' },
  environment: { url: '/app', viewport: '390x844', language: 'ru-RU', build: 'production', userAgent: monitoringAgent },
  createdAt: ago(400),
  userAgent: monitoringAgent,
  request: { id: 3, method: 'POST', route: 'solve', status: 503, durationMs: 41250, createdAt: ago(400) },
  solutionLog: { id: 'log-1', subject: 'Физика', grade: '8', outcome: 'failed', status: 503, createdAt: ago(400) },
}

/* Сводка мониторинга: 24 столбца по часу, два открытых, всплеск - жёлтым. */
export function monitoringOverview(patch: Record<string, unknown> = {}) {
  const hour = 3_600_000
  const end = Math.ceil(Date.now() / hour) * hour
  const series = Array.from({ length: 24 }, (_, index) => {
    const start = end - (24 - index) * hour
    const frontend = index % 5 === 0 ? 1 : 0
    const api = index % 7 === 2 ? 1 : 0
    const llm = index >= 21 ? 1 + (index % 2) : index % 6 === 1 ? 1 : 0
    const payments = index === 12 ? 1 : 0
    return { start: new Date(start).toISOString(), end: new Date(start + hour).toISOString(), frontend, api, llm, payments, db: 0, total: frontend + api + llm + payments }
  })
  return {
    now: new Date().toISOString(), period: 'day', from: series[0].start, to: series[23].end, bucketMinutes: 60,
    cards: { open: 2, critical: 0, newLastHour: 1, eventsLastHour: 3, resolvedLastDay: 1 },
    series,
    errors: { lastHour: 3, hourlyNorm: 0.4, threshold: 20 },
    requests: { lastHour: 64, failedLastHour: 1, share: 1.6, normShare: 0.8 },
    services: { total: 8, down: 0, notConfigured: 1, lastCheckAt: ago(2) },
    thresholds: { spikeHourly: 20, downMinutes: 10, staleMinutes: 15, minRequests: 20 },
    alerts: [{ id: 'errors_spike', level: 'warning', kind: 'errors_spike', value: 3, norm: 0.4, ratio: 7.5 }],
    ...patch,
  }
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
    let body: Record<string, unknown> = {}
    try {
      const parsed: unknown = route.request().postDataJSON()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    } catch {
      // Вызов без тела - фикстура получит пустой объект.
    }
    return route.fulfill({ json: fixture ? fixture(aal, body) : {} })
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
