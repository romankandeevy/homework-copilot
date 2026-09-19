/* Функция админки на Vercel.

   Всё, что админка умеет делать через базу, она делает через admin-RPC.
   Сюда вынесено только то, чего база не может сама:

   - письмо сброса пароля;
   - доставка уведомлений в Telegram и на почту;
   - проверка внешних сервисов: провайдер моделей, прокси, Telegram, почта.

   Входа под пользователем нет и не будет: он открывал администратору
   ИИ-чат и фотографии ученика, а политика обещает, что содержимое чата
   админке не видно (19 сентября 2026, «Админка» в AGENTS.md).

   Два входа. Администратор приходит со своим JWT: роль и второй фактор
   проверяет база (`get_admin_context`). pg_cron приходит раз в минуту с
   одноразовым токеном, который выписала сама база; токен подтверждается
   обратным вызовом `claim_admin_cron` и сгорает после первого использования. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../src/lib/database.types.ts'
import { recordError, recordRequestLog, requestAddress, requestIdOf, requestUserAgent, telemetryClient } from './telemetry.ts'
import { solveWithKie } from './homeworkSolver.ts'
import { parsePromptPreviewInput, PromptPreviewError, runPromptPreview } from './promptPreview.ts'
import type { PromptPreviewInput, PromptPreviewSolve } from './promptPreview.ts'
import { reconcilePaymentOrders } from './payments.ts'
import { ensureTelegramWebhook } from './support.ts'
import type { RobokassaConfig } from './robokassa.ts'

export type AdminServerOptions = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  serviceRoleKey?: string
  kieApiKey?: string
  /* KIE_MODEL: если задан, проверка промпта решает этой моделью, как и решатель. */
  model?: string
  /* Подмена прогона в тестах. На проде - solveWithKie. */
  promptPreviewSolve?: PromptPreviewSolve
  telegramBotToken?: string
  telegramOwnerChatId?: string
  /* Проверка здоровья ставит webhook поддержки, если его нет или он сбит. */
  telegramWebhookSecret?: string
  resendApiKey?: string
  resendFrom?: string
  /* Сверка заказов Робокассы идёт этим же cron. Нет ключей - сверки нет. */
  robokassa?: RobokassaConfig | null
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
])

// Локальная разработка - только вне боевого окружения Vercel.
const developmentOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

export function isAllowedAdminOrigin(origin: string, vercelEnv = process.env.VERCEL_ENV) {
  return allowedOrigins.has(origin) || (vercelEnv !== 'production' && developmentOrigins.has(origin))
}

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
  if (!origin || !isAllowedAdminOrigin(origin)) return false
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
  if (error || !data.user) throw new AdminApiError(404, 'Пользователь не найден')
  return { user: data.user, email: data.user.email ?? '' }
}

/* Аккаунт, вошедший по номеру телефона, почты не имеет. Письмо сброса
   Supabase умеет только на почту, а пароля у такого аккаунта нет вовсе. */
function requireEmail(email: string) {
  if (email) return email
  throw new AdminApiError(409, 'У аккаунта нет почты и пароля: он входит по номеру телефона кодом из СМС')
}

async function isAdminAccount(options: AdminServerOptions, userId: string) {
  const service = serviceClient(options)
  const { data, error } = await service.rpc('is_admin_user', { p_user_id: userId })
  // Не смогли проверить - считаем администратором: лучше отказать, чем
  // удалить аккаунт администратора.
  if (error) return true
  return data === true
}

/* ------------------------------------------------------------------------
   Действия администратора
   ------------------------------------------------------------------------ */

async function resetPassword(options: AdminServerOptions, admin: AdminContext, body: Record<string, unknown>) {
  if (!admin.permissions.moderate) throw new AdminApiError(403, 'Роль не позволяет сбрасывать пароль')
  const target = await targetUser(options, body.userId)
  const { user } = target
  const email = requireEmail(target.email)
  if (!options.supabaseUrl || !options.supabasePublishableKey) throw new AdminApiError(503, 'Сервер админки не настроен')

  // Письмо шлёт Supabase Auth тем же шаблоном, что и «Не помню пароль».
  const publicClient = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo: `${productionOrigin}/app?auth=reset` })
  if (error) throw new AdminApiError(502, 'Письмо сброса пароля не ушло')

  const { error: auditError } = await admin.client.rpc('admin_record_external_action', {
    p_event: 'password_reset_sent',
    p_target_user_id: user.id,
    p_payload: { email } as Json,
  })
  // Письмо уже ушло, отменить его нельзя - но и потерять запись молча нельзя.
  if (auditError) console.log(JSON.stringify({ event: 'admin_audit_failed', action: 'password_reset_sent', message: auditError.message }))
  return { sent: true, email }
}

/* Удаление аккаунтов владельцем.

   Базу чистит admin_delete_user: журнал, каскад от auth.users и повторная
   сверка подтверждения. Файлы вложений чата живут в хранилище, база их не
   удалит - убираем здесь, до базы: после удаления аккаунта папка осталась
   бы без владельца. Если база потом откажет, файлы уже удалены, а аккаунт
   цел - это лучше обратного, когда аккаунта нет, а файлы висят.

   Один аккаунт подтверждается только его почтой или номером, как вписал
   владелец: слово «УДАЛИТЬ» для одного аккаунта не принимается, иначе
   сверка в базе была бы формальной - сервер сам подставляет ей почту.
   Несколько - словом «УДАЛИТЬ»; тогда почту для базы берём с сервера. */
const deleteConfirmWord = 'УДАЛИТЬ'
const paymentInFlightMessage = 'У аккаунта платёж в пути: заказ пополнения моложе суток ждёт оплаты. Удали аккаунт позже'
const deleteBatchLimit = 50

function deleteConfirmation(email: string, phone: string) {
  return email ? email.toLowerCase() : phone.replace(/\D/g, '')
}

function deleteConfirmMatches(typed: string, email: string, phone: string) {
  const expected = deleteConfirmation(email, phone)
  const given = email ? typed.toLowerCase().replace(/\s/g, '') : typed.replace(/\D/g, '')
  return expected !== '' && given === expected
}

async function removeChatAttachments(options: AdminServerOptions, userId: string) {
  const bucket = serviceClient(options).storage.from('chat-attachments')
  const paths: string[] = []
  const { data: entries, error: listError } = await bucket.list(userId, { limit: 1000 })
  if (listError) throw new Error(`хранилище: ${listError.message}`)
  for (const entry of entries ?? []) {
    // Файл на верхнем уровне папки: у объектов есть id, у папок его нет.
    if (entry.id) {
      paths.push(`${userId}/${entry.name}`)
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const { data: files } = await bucket.list(`${userId}/${entry.name}`, { limit: 1000 })
    for (const file of files ?? []) {
      if (file.id) paths.push(`${userId}/${entry.name}/${file.name}`)
    }
  }
  if (paths.length > 0) {
    const { error } = await bucket.remove(paths)
    if (error) throw new Error(`хранилище: ${error.message}`)
  }
  return paths.length
}

async function deleteUsers(options: AdminServerOptions, admin: AdminContext, body: Record<string, unknown>) {
  if (!admin.permissions.delete) throw new AdminApiError(403, 'Удалять аккаунты может только владелец')
  const userIds = Array.isArray(body.userIds)
    ? [...new Set(body.userIds.filter((id): id is string => typeof id === 'string'))]
    : []
  if (userIds.length === 0) throw new AdminApiError(400, 'Не выбраны пользователи')
  if (userIds.length > deleteBatchLimit) throw new AdminApiError(400, `За раз - не больше ${deleteBatchLimit} аккаунтов`)
  const typed = typeof body.confirm === 'string' ? body.confirm.trim() : ''
  const byWord = userIds.length > 1
  if (byWord && typed !== deleteConfirmWord) throw new AdminApiError(400, `Для нескольких аккаунтов впиши «${deleteConfirmWord}»`)
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : ''

  let done = 0
  const failed: { userId: string; error: string }[] = []
  // По одному и по порядку: у каждого своя проверка, свои файлы и своя запись в журнале.
  for (const userId of userIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { user, email } = await targetUser(options, userId)
      const phone = user.phone ?? ''
      if (user.id === admin.userId) throw new AdminApiError(400, 'Свой аккаунт отсюда не удалить')
      // eslint-disable-next-line no-await-in-loop
      if (await isAdminAccount(options, user.id)) throw new AdminApiError(403, 'Аккаунт администратора не удаляется - сначала сними роль')
      if (!byWord && !deleteConfirmMatches(typed, email, phone)) throw new AdminApiError(400, 'Подтверждение не совпало с почтой или номером аккаунта')
      // Платёж в пути база не даст удалить - узнаём об этом до того, как стёрты файлы.
      // eslint-disable-next-line no-await-in-loop
      const { data: paymentInFlight } = await serviceClient(options).rpc('account_has_payment_in_flight', { p_user_id: user.id })
      if (paymentInFlight === true) throw new AdminApiError(409, paymentInFlightMessage)
      // eslint-disable-next-line no-await-in-loop
      await removeChatAttachments(options, user.id)
      // eslint-disable-next-line no-await-in-loop
      const { error } = await admin.client.rpc('admin_delete_user', {
        p_user_id: user.id,
        p_confirm: deleteConfirmation(email, phone),
        p_reason: reason || null,
      })
      if (error) {
        throw new AdminApiError(502, error.message.includes('payment order pending') ? paymentInFlightMessage : error.message)
      }
      done += 1
    } catch (error) {
      failed.push({ userId, error: error instanceof Error ? error.message : 'не получилось' })
    }
  }
  return { done, failed }
}

/* Проверка промпта решателя без сохранения (server/promptPreview.ts).

   Модель зовётся тем же движком, что и у ученика, но мимо кошелька, очереди
   и каталога решений. Роль, второй фактор, предел частоты и запись в журнал
   делает база в admin_prompt_preview_start - до того, как потрачен первый
   кредит. Итог пишется в базу до ответа: прокси на Supabase живёт 150
   секунд, прогон бывает дольше, и тогда вкладка забирает результат из
   admin_prompt_previews. */
function previewStartFailure(error: { code?: string; message: string }) {
  const ours = /[а-яё]/iu.test(error.message)
  if (error.code === '53400') return new AdminApiError(429, ours ? error.message : 'Слишком много запросов подряд. Подожди минуту.')
  if (error.code === '55000') return new AdminApiError(409, ours ? error.message : 'Предыдущая проверка ещё идёт.')
  if (error.code === '22023') return new AdminApiError(400, ours ? error.message : 'Проверь поля проверки.')
  if (error.code === '42501') return new AdminApiError(403, 'Нет доступа: нужна роль администратора и подтверждённый второй фактор.')
  return new AdminApiError(502, 'Проверку не удалось начать. Повтори попытку.')
}

async function promptPreview(options: AdminServerOptions, admin: AdminContext, body: Record<string, unknown>) {
  if (!admin.permissions.settings) throw new AdminApiError(403, 'Роль не позволяет проверять промпты')
  let input: PromptPreviewInput
  try {
    input = parsePromptPreviewInput(body)
  } catch (error) {
    if (error instanceof PromptPreviewError) throw new AdminApiError(error.status, error.message)
    throw error
  }
  const apiKey = options.kieApiKey
  const solve: PromptPreviewSolve | null = options.promptPreviewSolve
    ?? (apiKey
      ? (request, instructions, onCost) => solveWithKie(request, { apiKey, model: options.model, fetchImpl: options.fetchImpl }, undefined, undefined, onCost, instructions)
      : null)
  if (!solve) throw new AdminApiError(503, 'Шлюз моделей не подключён: нет KIE_API_KEY на Vercel')

  const { data, error } = await admin.client.rpc('admin_prompt_preview_start', {
    p_subject_id: input.subjectId,
    p_grade: input.grade,
    p_prompt: input.prompt,
    p_condition: input.condition,
    p_compare: input.compare,
  })
  if (error) throw previewStartFailure(error)
  const started = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const previewId = typeof started.id === 'string' ? started.id : ''
  if (!previewId) throw new AdminApiError(502, 'Проверку не удалось начать. Повтори попытку.')

  const outcome = await runPromptPreview({
    input,
    previewId,
    currentPrompt: typeof started.currentPrompt === 'string' ? started.currentPrompt : null,
    currentVersion: typeof started.currentVersion === 'number' ? started.currentVersion : null,
    solve,
  })

  const { error: finishError } = await admin.client.rpc('admin_prompt_preview_finish', {
    p_id: previewId,
    p_status: outcome.runs.some((run) => run.ok) ? 'done' : 'failed',
    p_result: outcome as unknown as Json,
    p_credits: outcome.credits,
    p_seconds: outcome.seconds,
    p_error: outcome.runs.find((run) => run.error)?.error ?? null,
  })
  if (finishError) {
    // Ответ всё равно уходит: результат оплачен, терять его из-за записи нельзя.
    await recordError(options, {
      kind: 'db',
      route: 'admin',
      message: `prompt_preview finish: ${finishError.message}`,
      userId: admin.userId,
      input: { previewId },
    })
  }
  return { id: previewId, ...outcome }
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

function logHealthRecordFailure(service: string, message: string) {
  console.error(JSON.stringify({ event: 'admin_health_record_failed', service, message }))
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
    /* База отвечает за миллисекунды (сам запрос в Postgres - до 2 мс), но
       12 сентября проверка «падала» каждые 15-40 минут: PostgREST изредка
       отдавал пустую ошибку спустя ~5 с, и одна такая неудача считалась
       лежащей базой. Теперь неудача переспрашивается через полторы секунды,
       у запроса свой срок, а в подробности попадает код ответа. */
    probe(options, 'database', async () => {
      const service = serviceClient(options)
      const attempt = () => service.from('profiles').select('id', { head: true, count: 'exact' }).abortSignal(timeout(10_000))
      let { error, status, statusText } = await attempt()
      if (error) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        ;({ error, status, statusText } = await attempt())
      }
      const detail = error ? [error.message, error.code, status ? `HTTP ${status} ${statusText}`.trim() : ''].filter(Boolean).join(' · ') : null
      return { ok: !error, status: error ? 'error' : 'ok', detail }
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
      if (payload?.ok !== true) return { ok: false, status: `http_${response.status}`, detail: null }
      const bot = payload.result?.username ? `@${payload.result.username}` : null
      /* Бот жив, но без webhook ответы владельца и кнопки идей до сайта не
         доходят. Нет его или он сбит - ставим здесь же. */
      if (!options.telegramWebhookSecret) {
        return { ok: false, status: 'not_configured', detail: [bot, 'нет TELEGRAM_WEBHOOK_SECRET - ответы из Telegram не дойдут до сайта'].filter(Boolean).join(' · ') }
      }
      try {
        const webhook = await ensureTelegramWebhook(options.telegramBotToken, options.telegramWebhookSecret, fetchImpl)
        return { ok: true, status: 'ok', detail: [bot, webhook === 'set' ? 'webhook переустановлен' : null].filter(Boolean).join(' · ') || null }
      } catch (webhookError) {
        return { ok: false, status: 'webhook_failed', detail: [bot, `webhook: ${webhookError instanceof Error ? webhookError.message : 'ошибка'}`].filter(Boolean).join(' · ') }
      }
    }),
    probe(options, 'email', async (fetchImpl) => {
      if (!options.resendApiKey) return { ok: false, status: 'not_configured', detail: 'Нет RESEND_API_KEY на Vercel' }
      const response = await fetchImpl('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${options.resendApiKey}` },
        signal: timeout(10_000),
      })
      if (response.ok) return { ok: true, status: 'ok', detail: 'Resend' }
      /* Ключ «только отправка» на список доменов отвечает 401
         restricted_api_key: ключ живой, просто без права читать. Неверный
         ключ - 400 или 401 с другим именем. */
      const payload = await response.json().catch(() => null) as { name?: string } | null
      if (response.status === 401 && payload?.name === 'restricted_api_key') return { ok: true, status: 'ok', detail: 'Resend · ключ на отправку' }
      return { ok: false, status: `http_${response.status}`, detail: 'Resend' }
    }),
  ]

  const results = await Promise.all(checks)
  const service = telemetryClient(options)
  if (service) {
    /* Запись не прошла - проверка всё равно отдаётся админке, но молча это
       не проходит: без записи мониторинг показывает прошлое состояние, а
       тревога о падении не ставится. */
    await Promise.all(results.map((result) => service.rpc('record_health_check', {
      p_service: result.service,
      p_ok: result.ok,
      p_status: result.status,
      p_latency_ms: result.latencyMs,
      p_detail: result.detail,
    }).then(({ error }) => {
      if (error) logHealthRecordFailure(result.service, error.message)
    }, (error: unknown) => logHealthRecordFailure(result.service, error instanceof Error ? error.message : 'unknown'))))
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
      from: options.resendFrom || 'Homework Copilot <no-reply@homeworkcopilot.ru>',
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

/* Токен выписывает dispatch_admin_cron: `encode(gen_random_bytes(24), 'hex')` -
   ровно 48 строчных шестнадцатеричных знаков. Всё прочее отсекается до
   похода в базу: адрес публичный, и мусорный запрос не должен стоить
   вызова claim_admin_cron. */
const cronTokenPattern = /^[0-9a-f]{48}$/

export function isCronTokenShape(token: unknown): token is string {
  return typeof token === 'string' && cronTokenPattern.test(token)
}

async function runCron(options: AdminServerOptions, body: Record<string, unknown>) {
  if (!isCronTokenShape(body.token)) throw new AdminApiError(401, 'Токен cron не принят')
  const service = serviceClient(options)
  const { data, error } = await service.rpc('claim_admin_cron', { p_token: body.token })
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
    const { error: completeError } = await service.rpc('complete_admin_notifications', { p_results: results as unknown as Json })
    // Итог не записан - те же уведомления уйдут снова через минуту. Молча это
    // не проходит: событие видно в журнале Vercel.
    if (completeError) console.log(JSON.stringify({ event: 'admin_notifications_complete_failed', message: completeError.message }))
  }

  // Внешние сервисы проверяем раз в пять минут: чаще - лишняя нагрузка на них.
  const minute = new Date().getUTCMinutes()
  const health = minute % 5 === 0 ? await runHealthChecks(options) : []

  /* Заказы, по которым Робокасса не прислала уведомление: деньги могли
     списаться, а Result не дойти. Каждую минуту - база сама отдаёт только
     те, по которым пора спросить. Сбой сверки не роняет остальной cron. */
  let payments = 0
  try {
    payments = (await reconcilePaymentOrders(service, options.robokassa ?? null, options.fetchImpl ?? fetch)).checked
  } catch (reconcileError) {
    console.log(JSON.stringify({ event: 'robokassa_reconcile_unavailable', message: reconcileError instanceof Error ? reconcileError.message : 'unknown' }))
  }

  /* Отметка «cron дошёл»: её устаревание проверяет сама база (задание
     refresh-daily-metrics) и тревожит, если Vercel перестал отвечать. */
  const { error: markError } = await service.rpc('mark_admin_cron_ok')
  if (markError) console.error(JSON.stringify({ event: 'admin_cron_mark_failed', message: markError.message }))
  return { delivered: results.length, health: health.length, payments }
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
    if (action === 'reset_password') {
      sendJson(response, 200, await resetPassword(options, admin, body))
    } else if (action === 'delete_users') {
      sendJson(response, 200, await deleteUsers(options, admin, body))
    } else if (action === 'prompt_preview') {
      sendJson(response, 200, await promptPreview(options, admin, body))
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
