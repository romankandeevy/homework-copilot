/* Функция админки на Vercel.

   Всё, что админка умеет делать через базу, она делает через admin-RPC.
   Сюда вынесено только то, чего база не может сама:

   - вход под пользователем (одноразовая ссылка авторизации);
   - письмо сброса пароля;
   - доставка уведомлений в Telegram и на почту;
   - проверка внешних сервисов: провайдер моделей, прокси, Telegram, почта.

   Два входа. Администратор приходит со своим JWT: роль и второй фактор
   проверяет база (`get_admin_context`). pg_cron приходит раз в минуту с
   одноразовым токеном, который выписала сама база; токен подтверждается
   обратным вызовом `claim_admin_cron` и сгорает после первого использования. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../src/lib/database.types.ts'
import { recordError, recordRequestLog, requestAddress, requestIdOf, requestUserAgent, telemetryClient } from './telemetry.ts'

export type AdminServerOptions = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  serviceRoleKey?: string
  kieApiKey?: string
  telegramBotToken?: string
  telegramOwnerChatId?: string
  resendApiKey?: string
  resendFrom?: string
  fetchImpl?: typeof fetch
}

export class AdminApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const allowedOrigins = new Set([
  'https://www.homeworkcopilot.ru',
  'https://homeworkcopilot.ru',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

const productionOrigin = 'https://www.homeworkcopilot.ru'
const vercelOrigin = 'https://homework-copilot-taupe.vercel.app'
const proxyOrigin = 'https://opacucumlgwmhgjonhhe.supabase.co/functions/v1/api'

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  response.end(JSON.stringify(payload))
}

function allowBrowser(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (!origin || !allowedOrigins.has(origin)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')
  return true
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const existing = (request as IncomingMessage & { body?: unknown }).body
  if (existing !== undefined) {
    if (typeof existing === 'string') {
      try {
        return JSON.parse(existing) as Record<string, unknown>
      } catch {
        throw new AdminApiError(400, 'Некорректное тело запроса')
      }
    }
    return existing && typeof existing === 'object' ? existing as Record<string, unknown> : {}
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer)
    size += buffer.length
    if (size > 64_000) throw new AdminApiError(413, 'Запрос слишком большой')
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    throw new AdminApiError(400, 'Некорректное тело запроса')
  }
}

function serviceClient(options: AdminServerOptions): SupabaseClient<Database> {
  const client = telemetryClient(options)
  if (!client) throw new AdminApiError(503, 'Сервер админки не настроен')
  return client
}

type AdminContext = {
  userId: string
  client: SupabaseClient<Database>
  role: string
  permissions: Record<string, boolean>
}

async function authenticateAdmin(request: IncomingMessage, options: AdminServerOptions): Promise<AdminContext> {
  if (!options.supabaseUrl || !options.supabasePublishableKey) throw new AdminApiError(503, 'Сервер админки не настроен')
  const header = request.headers.authorization
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new AdminApiError(401, 'Нужен вход администратора')

  const client = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData.user) throw new AdminApiError(401, 'Сессия закончилась')

  const { data, error } = await client.rpc('get_admin_context')
  const context = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  if (error || !context || context.isAdmin !== true) throw new AdminApiError(403, 'Нет доступа к админке')
  if (context.aal !== 'aal2') throw new AdminApiError(403, 'Подтверди вход вторым фактором')
  const permissions = context.permissions && typeof context.permissions === 'object'
    ? Object.fromEntries(Object.entries(context.permissions as Record<string, unknown>).map(([key, value]) => [key, value === true]))
    : {}
  return { userId: userData.user.id, client, role: String(context.role ?? ''), permissions }
}

async function targetUser(options: AdminServerOptions, userId: unknown) {
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) throw new AdminApiError(400, 'Не указан пользователь')
  const service = serviceClient(options)
  const { data, error } = await service.auth.admin.getUserById(userId)
  if (error || !data.user?.email) throw new AdminApiError(404, 'Пользователь не найден')
  return { user: data.user, email: data.user.email }
}

async function isAdminAccount(options: AdminServerOptions, userId: string) {
  const service = serviceClient(options)
  const { data, error } = await service.rpc('is_admin_user', { p_user_id: userId })
  // Не смогли проверить - считаем администратором: лучше отказать, чем
  // выписать ссылку входа в чужой пульт.
  if (error) return true
  return data === true
}

/* ------------------------------------------------------------------------
   Действия администратора
   ------------------------------------------------------------------------ */

async function impersonate(options: AdminServerOptions, admin: AdminContext, body: Record<string, unknown>) {
  if (!admin.permissions.moderate) throw new AdminApiError(403, 'Роль не позволяет входить под пользователем')
  const { user, email } = await targetUser(options, body.userId)
  if (user.id === admin.userId) throw new AdminApiError(400, 'Это твой собственный аккаунт')
  if (await isAdminAccount(options, user.id)) throw new AdminApiError(403, 'Под администратором входить нельзя')

  const service = serviceClient(options)
  const { data, error } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${productionOrigin}/app` },
  })
  if (error || !data.properties?.action_link) throw new AdminApiError(502, 'Не получилось выписать ссылку входа')

  await admin.client.rpc('admin_record_external_action', {
    p_event: 'user_impersonated',
    p_target_user_id: user.id,
    p_payload: { email, reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : null } as Json,
  })
  return { link: data.properties.action_link, email }
}

async function resetPassword(options: AdminServerOptions, admin: AdminContext, body: Record<string, unknown>) {
  if (!admin.permissions.moderate) throw new AdminApiError(403, 'Роль не позволяет сбрасывать пароль')
  const { user, email } = await targetUser(options, body.userId)
  if (!options.supabaseUrl || !options.supabasePublishableKey) throw new AdminApiError(503, 'Сервер админки не настроен')

  // Письмо шлёт Supabase Auth тем же шаблоном, что и «Не помню пароль».
  const publicClient = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo: `${productionOrigin}/app?auth=reset` })
  if (error) throw new AdminApiError(502, 'Письмо сброса пароля не ушло')

  await admin.client.rpc('admin_record_external_action', {
    p_event: 'password_reset_sent',
    p_target_user_id: user.id,
    p_payload: { email } as Json,
  })
  return { sent: true, email }
}

/* ------------------------------------------------------------------------
   Проверки внешних сервисов
   ------------------------------------------------------------------------ */

type HealthResult = { service: string; ok: boolean; status: string; latencyMs: number | null; detail: string | null }

async function probe(
  options: AdminServerOptions,
  service: string,
  run: (fetchImpl: typeof fetch) => Promise<{ ok: boolean; status: string; detail?: string | null }>,
): Promise<HealthResult> {
  const startedAt = Date.now()
  try {
    const result = await run(options.fetchImpl ?? fetch)
    return { service, ok: result.ok, status: result.status, latencyMs: Date.now() - startedAt, detail: result.detail ?? null }
  } catch (error) {
    return {
      service,
      ok: false,
      status: 'unreachable',
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message.slice(0, 300) : 'нет ответа',
    }
  }
}

function timeout(ms: number) {
  return AbortSignal.timeout(ms)
}

export async function runHealthChecks(options: AdminServerOptions): Promise<HealthResult[]> {
  const checks: Promise<HealthResult>[] = [
    probe(options, 'kie', async (fetchImpl) => {
      if (!options.kieApiKey) return { ok: false, status: 'not_configured', detail: 'Нет KIE_API_KEY' }
      const response = await fetchImpl('https://api.kie.ai/api/v1/chat/credit', {
        headers: { Authorization: `Bearer ${options.kieApiKey}` },
        signal: timeout(10_000),
      })
      const payload = await response.json().catch(() => null) as { code?: number; data?: unknown; msg?: string } | null
      const credits = typeof payload?.data === 'number' ? payload.data : null
      const ok = response.ok && (payload?.code === undefined || payload.code === 200)
      return {
        ok: ok && (credits === null || credits > 0),
        status: ok ? (credits !== null && credits <= 0 ? 'no_credits' : 'ok') : `http_${response.status}`,
        detail: credits !== null ? `Баланс шлюза: ${credits} кредитов` : payload?.msg ?? null,
      }
    }),
    probe(options, 'vercel-api', async (fetchImpl) => {
      const response = await fetchImpl(`${vercelOrigin}/api/solve`, { signal: timeout(10_000) })
      const payload = await response.json().catch(() => null) as { configured?: boolean; engineVersion?: string } | null
      return {
        ok: response.ok && payload?.configured === true,
        status: response.ok ? (payload?.configured ? 'ok' : 'not_configured') : `http_${response.status}`,
        detail: payload?.engineVersion ? `Движок ${payload.engineVersion}` : null,
      }
    }),
    probe(options, 'supabase-proxy', async (fetchImpl) => {
      const response = await fetchImpl(`${proxyOrigin}/solve`, { signal: timeout(15_000) })
      return { ok: response.ok, status: response.ok ? 'ok' : `http_${response.status}`, detail: 'Путь браузер → Supabase → Vercel' }
    }),
    probe(options, 'frontend', async (fetchImpl) => {
      const response = await fetchImpl(`${productionOrigin}/`, { signal: timeout(10_000) })
      return { ok: response.ok, status: response.ok ? 'ok' : `http_${response.status}`, detail: 'GitHub Pages' }
    }),
    probe(options, 'database', async () => {
      const service = serviceClient(options)
      const { error } = await service.from('profiles').select('id', { head: true, count: 'exact' })
      return { ok: !error, status: error ? 'error' : 'ok', detail: error?.message ?? null }
    }),
    probe(options, 'storage', async () => {
      const service = serviceClient(options)
      const { data, error } = await service.storage.listBuckets()
      return { ok: !error, status: error ? 'error' : 'ok', detail: error ? error.message : `Бакетов: ${data?.length ?? 0}` }
    }),
    probe(options, 'telegram', async (fetchImpl) => {
      if (!options.telegramBotToken) return { ok: false, status: 'not_configured', detail: 'Нет TELEGRAM_BOT_TOKEN' }
      const response = await fetchImpl(`https://api.telegram.org/bot${options.telegramBotToken}/getMe`, { signal: timeout(10_000) })
      const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { username?: string } } | null
      return { ok: payload?.ok === true, status: payload?.ok ? 'ok' : `http_${response.status}`, detail: payload?.result?.username ? `@${payload.result.username}` : null }
    }),
    probe(options, 'email', async (fetchImpl) => {
      if (!options.resendApiKey) return { ok: false, status: 'not_configured', detail: 'Нет RESEND_API_KEY на Vercel' }
      const response = await fetchImpl('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${options.resendApiKey}` },
        signal: timeout(10_000),
      })
      return { ok: response.ok, status: response.ok ? 'ok' : `http_${response.status}`, detail: 'Resend' }
    }),
  ]

  const results = await Promise.all(checks)
  const service = telemetryClient(options)
  if (service) {
    await Promise.all(results.map((result) => service.rpc('record_health_check', {
      p_service: result.service,
      p_ok: result.ok,
      p_status: result.status,
      p_latency_ms: result.latencyMs,
      p_detail: result.detail,
    }).then(() => undefined, () => undefined)))
  }
  return results
}

/* ------------------------------------------------------------------------
   Доставка уведомлений
   ------------------------------------------------------------------------ */

type QueuedNotification = { id: string; event: string; title: string; body: string; telegram: boolean; email: boolean }

async function sendTelegram(options: AdminServerOptions, text: string) {
  if (!options.telegramBotToken || !options.telegramOwnerChatId) throw new Error('Telegram не настроен')
  const response = await (options.fetchImpl ?? fetch)(`https://api.telegram.org/bot${options.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: options.telegramOwnerChatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: timeout(10_000),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null
  if (!payload?.ok) throw new Error(payload?.description ?? `Telegram ответил ${response.status}`)
}

async function sendEmail(options: AdminServerOptions, recipients: string[], subject: string, text: string) {
  if (!options.resendApiKey) throw new Error('Нет RESEND_API_KEY')
  if (recipients.length === 0) throw new Error('Не заданы адреса уведомлений')
  const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: options.resendFrom || 'Homework Copilot <noreply@homeworkcopilot.ru>',
      to: recipients,
      subject,
      text,
    }),
    signal: timeout(10_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Resend ответил ${response.status}`)
  }
}

export async function deliverNotifications(options: AdminServerOptions, notifications: QueuedNotification[], emails: string[]) {
  const results: { id: string; telegram: boolean; email: boolean; error?: string }[] = []
  for (const notification of notifications) {
    const text = `Homework Copilot · ${notification.title}\n\n${notification.body}\n\n${productionOrigin}/admin`
    const outcome = { id: notification.id, telegram: false, email: false, error: '' }
    if (notification.telegram) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendTelegram(options, text)
        outcome.telegram = true
      } catch (error) {
        outcome.error = `telegram: ${error instanceof Error ? error.message : 'ошибка'}`
      }
    }
    if (notification.email) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendEmail(options, emails, `Homework Copilot · ${notification.title}`, text)
        outcome.email = true
      } catch (error) {
        outcome.error = [outcome.error, `email: ${error instanceof Error ? error.message : 'ошибка'}`].filter(Boolean).join('; ')
      }
    }
    results.push({ id: outcome.id, telegram: outcome.telegram, email: outcome.email, ...(outcome.error ? { error: outcome.error } : {}) })
  }
  return results
}

async function runCron(options: AdminServerOptions, body: Record<string, unknown>) {
  const service = serviceClient(options)
  const { data, error } = await service.rpc('claim_admin_cron', { p_token: typeof body.token === 'string' ? body.token : '' })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new AdminApiError(401, 'Токен cron не принят')
  const claim = data as { emails?: unknown; notifications?: unknown }
  const emails = Array.isArray(claim.emails) ? claim.emails.filter((entry): entry is string => typeof entry === 'string' && entry.includes('@')) : []
  const notifications = (Array.isArray(claim.notifications) ? claim.notifications : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id),
      event: String(entry.event),
      title: String(entry.title),
      body: String(entry.body),
      telegram: entry.telegram === true,
      email: entry.email === true,
    }))

  const results = await deliverNotifications(options, notifications, emails)
  if (results.length > 0) {
    await service.rpc('complete_admin_notifications', { p_results: results as unknown as Json })
  }

  // Внешние сервисы проверяем раз в пять минут: чаще - лишняя нагрузка на них.
  const minute = new Date().getUTCMinutes()
  const health = minute % 5 === 0 ? await runHealthChecks(options) : []
  return { delivered: results.length, health: health.length }
}

/* ------------------------------------------------------------------------
   Вход
   ------------------------------------------------------------------------ */

export async function handleAdminRequest(request: IncomingMessage, response: ServerResponse, options: AdminServerOptions) {
  const browserAllowed = allowBrowser(request, response)
  const startedAt = Date.now()
  if (request.method === 'OPTIONS') {
    response.statusCode = browserAllowed ? 204 : 403
    response.end()
    return
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS')
    sendJson(response, 405, { error: 'Допустим только POST' })
    return
  }

  let action = ''
  let adminId: string | null = null
  let status = 200
  let failure: string | null = null
  try {
    const body = await readBody(request)
    action = typeof body.action === 'string' ? body.action : ''

    if (action === 'cron') {
      sendJson(response, 200, await runCron(options, body))
      return
    }

    const admin = await authenticateAdmin(request, options)
    adminId = admin.userId
    if (action === 'impersonate') {
      sendJson(response, 200, await impersonate(options, admin, body))
    } else if (action === 'reset_password') {
      sendJson(response, 200, await resetPassword(options, admin, body))
    } else if (action === 'health_now') {
      if (!admin.permissions.settings) throw new AdminApiError(403, 'Роль не позволяет запускать проверки')
      sendJson(response, 200, { results: await runHealthChecks(options) })
    } else if (action === 'test_notification') {
      if (!admin.permissions.settings) throw new AdminApiError(403, 'Роль не позволяет отправлять проверку')
      // Адреса берём из тех же настроек, что и рассылка по расписанию.
      const { data: overview } = await admin.client.rpc('admin_notifications_overview')
      const emails = overview && typeof overview === 'object' && !Array.isArray(overview) && Array.isArray((overview as Record<string, unknown>).emails)
        ? ((overview as Record<string, unknown>).emails as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.includes('@'))
        : []
      const results = await deliverNotifications(options, [{
        id: 'test',
        event: 'test',
        title: 'Проверка уведомлений',
        body: `Тестовое сообщение из админки, ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК.`,
        telegram: true,
        email: emails.length > 0,
      }], emails)
      sendJson(response, 200, { results, emails })
    } else {
      throw new AdminApiError(400, 'Неизвестное действие')
    }
  } catch (error) {
    const apiError = error instanceof AdminApiError ? error : new AdminApiError(500, 'Не получилось выполнить действие')
    status = apiError.status
    failure = apiError.message
    if (!(error instanceof AdminApiError)) {
      await recordError(options, {
        kind: 'api',
        route: 'admin',
        message: error instanceof Error ? error.message : 'unknown admin error',
        stack: error instanceof Error ? error.stack ?? null : null,
        requestId: requestIdOf(request),
        userId: adminId,
        input: { action },
      })
    }
    sendJson(response, apiError.status, { error: apiError.message })
  } finally {
    if (action !== 'cron') {
      await recordRequestLog(options, {
        route: 'admin',
        status,
        requestId: requestIdOf(request),
        userId: adminId,
        ip: requestAddress(request, null),
        userAgent: requestUserAgent(request),
        durationMs: Date.now() - startedAt,
        error: failure ? `${action}: ${failure}` : null,
      })
    }
  }
}
