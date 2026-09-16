import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../src/lib/database.types.ts'
import { checkTopUpKopecks, maxTopUpKopecks, minTopUpKopecks } from '../src/lib/topUpLimits.ts'
import { buildPaymentUrl, classifyOpState, formatOutSum, opStateUrl, parseOpState, verifyResultNotice } from './robokassa.ts'
import type { OpStateVerdict, RobokassaConfig } from './robokassa.ts'

/* Оплата: заказ, уведомление Result, проверка статуса.

   Сюда приходят два разных собеседника по одному адресу `/api/payment`:
   - браузер ученика - JSON с `action` и токеном сессии;
   - Робокасса - уведомление Result с InvId и подписью, без токена: POST с
     формой `application/x-www-form-urlencoded` или GET с теми же полями в
     строке запроса - метод выбирается в кабинете, и принимаем оба. Ей
     отвечаем `OK{InvId}` простым текстом, иначе она будет слать
     уведомление снова.

   Деньги зачисляет только база (`confirm_payment_order`) и только после
   проверки подписи здесь. Вебхуку одному не верим: если уведомление не
   дошло, заказ дозапрашивается у Робокассы - кроном раз в минуту
   (`reconcilePaymentOrders` из админского cron) и по возвращении ученика
   на сайт (действие `status`). */

export type PaymentServerOptions = {
  supabaseUrl?: string
  supabasePublishableKey?: string
  serviceRoleKey?: string
  robokassa: RobokassaConfig | null
  fetchImpl?: typeof fetch
}

const allowedBrowserOrigins = new Set([
  'https://www.homeworkcopilot.ru',
  'https://homeworkcopilot.ru',
])

/* Превью Vercel этого проекта: AGENTS велит проходить тестовый платёж
   сначала на Preview, а без CORS форма пополнения там не появится. Только
   вне боевого окружения - на проде (`VERCEL_ENV=production`) чужой
   `homework-copilot-что-угодно.vercel.app` права не получает. */
const previewOrigin = /^https:\/\/homework-copilot-[a-z0-9-]+\.vercel\.app$/u

export function isAllowedPaymentOrigin(origin: string, vercelEnv = process.env.VERCEL_ENV) {
  if (allowedBrowserOrigins.has(origin)) return true
  return vercelEnv !== 'production' && previewOrigin.test(origin)
}

const maxBodyBytes = 16 * 1024
// Незаплаченный заказ живёт трое суток, потом сверка закрывает его.
const orderLifetimeMs = 3 * 24 * 60 * 60 * 1000
const opStateTimeoutMs = 8000

export class PaymentApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type ServiceClient = SupabaseClient<Database>

type ConfirmArgs = { invId: number; amountKopecks: number; isTest: boolean; via: 'result' | 'reconcile' | 'status'; payload: Record<string, string> }
export type ConfirmOrder = (args: ConfirmArgs) => Promise<void>
export type CloseOrder = (invId: number, status: 'cancelled' | 'expired') => Promise<void>
/* Случай, который владелец должен разобрать руками: деньги могли прийти, а
   зачисления нет. Уходит в очередь уведомлений админки (Telegram и почта). */
export type PaymentIncident = { kind: 'result_mismatch' | 'result_rejected' | 'reconcile_failed'; invId: number | null; detail: string }
export type ReportIncident = (incident: PaymentIncident) => Promise<void>

function log(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...details }))
}

function sendJson(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function sendText(response: ServerResponse, status: number, body: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function allowBrowser(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (!origin || !isAllowedPaymentOrigin(origin)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')
  return true
}

async function readRaw(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new PaymentApiError(413, 'Запрос слишком большой')
  return await new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBodyBytes) {
        reject(new PaymentApiError(413, 'Запрос слишком большой'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => reject(new PaymentApiError(400, 'Не получилось прочитать запрос')))
  })
}

function bearerToken(request: IncomingMessage) {
  const header = request.headers.authorization
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null
  return match?.[1]?.trim() || ''
}

function clientOptions() {
  return { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }
}

function serviceClient(options: PaymentServerOptions): ServiceClient {
  if (!options.supabaseUrl || !options.serviceRoleKey) throw new PaymentApiError(503, 'Оплата временно недоступна')
  return createClient<Database>(options.supabaseUrl, options.serviceRoleKey, clientOptions())
}

async function authenticate(request: IncomingMessage, options: PaymentServerOptions) {
  const token = bearerToken(request)
  if (!token) throw new PaymentApiError(401, 'Войди в аккаунт, чтобы пополнить баланс')
  if (!options.supabaseUrl || !options.supabasePublishableKey) throw new PaymentApiError(503, 'Оплата временно недоступна')
  const authClient = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, clientOptions())
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) throw new PaymentApiError(401, 'Сессия закончилась. Войди в аккаунт ещё раз')
  return data.user
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function confirmWith(service: ServiceClient): ConfirmOrder {
  return async ({ invId, amountKopecks, isTest, via, payload }) => {
    const { error } = await service.rpc('confirm_payment_order', {
      p_inv_id: invId,
      p_amount: amountKopecks,
      p_is_test: isTest,
      p_via: via,
      p_payload: payload as unknown as Json,
    })
    if (error) throw new Error(error.message)
  }
}

export function closeWith(service: ServiceClient): CloseOrder {
  return async (invId, status) => {
    const { error } = await service.rpc('close_payment_order', { p_inv_id: invId, p_status: status })
    if (error) throw new Error(error.message)
  }
}

/* Журнал Vercel на Hobby живёт час, поэтому денежный случай уходит ещё и
   владельцу. Адрес Result публичный, и неверную подпись может прислать кто
   угодно: такие отказы - не чаще раза в десять минут на экземпляр функции,
   а база сверх того гасит повтор в течение часа. Сбой постановки
   уведомления не меняет ответ Робокассе. */
const rejectedReportIntervalMs = 10 * 60 * 1000
let lastRejectedReportAt = 0

export function reportWith(service: ServiceClient): ReportIncident {
  return async ({ kind, invId, detail }) => {
    if (kind === 'result_rejected') {
      if (Date.now() - lastRejectedReportAt < rejectedReportIntervalMs) return
      lastRejectedReportAt = Date.now()
    }
    const { error } = await service.rpc('report_payment_incident', { p_kind: kind, p_inv_id: invId, p_detail: detail.slice(0, 300) })
    if (error) throw new Error(error.message)
  }
}

async function reportSafely(report: ReportIncident | undefined, incident: PaymentIncident) {
  if (!report) return
  try {
    await report(incident)
  } catch (error) {
    console.error(JSON.stringify({ event: 'payment_incident_report_failed', kind: incident.kind, invId: incident.invId, message: error instanceof Error ? error.message : 'unknown' }))
  }
}

/* Отказы базы, которые повтором не лечатся: заказа нет, сумма или режим не
   те. Робокассе на них отвечаем 400 - повторять незачем, - а сам случай
   громко пишем в журнал и владельцу: деньги могли уйти, и разбирать его
   руками. */
const permanentRejections = ['payment order not found', 'payment amount mismatch', 'payment mode mismatch', 'provider reference conflict']

/* Отказ подписи, о котором стоит знать владельцу: поля на месте, а подпись
   или сумма не сошлись - так выглядит настоящий платёж при неверном пароле
   2 или алгоритме. Запрос без полей - просто шум. */
const reportedRejections = new Set(['bad signature', 'bad OutSum'])

export async function handleResultNotice(
  config: RobokassaConfig,
  body: string | URLSearchParams,
  confirm: ConfirmOrder,
  report?: ReportIncident,
): Promise<{ status: number; body: string }> {
  const params = typeof body === 'string' ? new URLSearchParams(body) : body
  const check = verifyResultNotice(config, params)
  if (!check.ok) {
    const rawInvId = Number(params.get('InvId'))
    const invId = Number.isSafeInteger(rawInvId) && rawInvId > 0 ? rawInvId : null
    log('robokassa_result_rejected', { reason: check.reason, invId })
    if (reportedRejections.has(check.reason)) await reportSafely(report, { kind: 'result_rejected', invId, detail: check.reason })
    return { status: 400, body: 'bad sign' }
  }
  const { notice } = check
  try {
    await confirm({ invId: notice.invId, amountKopecks: notice.amountKopecks, isTest: notice.isTest, via: 'result', payload: notice.payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    const permanent = permanentRejections.some((rejection) => message.includes(rejection))
    log(permanent ? 'robokassa_result_mismatch' : 'robokassa_result_failed', { invId: notice.invId, amount: notice.amountKopecks, isTest: notice.isTest, message })
    if (permanent) {
      await reportSafely(report, { kind: 'result_mismatch', invId: notice.invId, detail: `${message}, сумма ${formatOutSum(notice.amountKopecks)}${notice.isTest ? ', тест' : ''}` })
    }
    return permanent ? { status: 400, body: 'rejected' } : { status: 500, body: 'retry' }
  }
  log('robokassa_result_confirmed', { invId: notice.invId, amount: notice.amountKopecks, isTest: notice.isTest })
  return { status: 200, body: `OK${notice.invId}` }
}

export type OrderToCheck = { invId: number; amount: number; isTest: boolean; createdAt: string }

/* Спросить Робокассу о заказе и довести его до конца: оплачен - зачислить,
   отменён - закрыть, трое суток без оплаты - закрыть сроком.

   Зачисляется сумма заказа, а не `OutSum` из ответа: в блоке Info может
   оказаться сумма за вычетом комиссии, база ответила бы `payment amount
   mismatch`, и заказ висел бы в «обрабатывается» вечно - ровно на том пути,
   который должен спасать при потерянном Result. Код 100 по подписанному
   запросу говорит, что оплачен именно этот InvId; сумма из ответа только
   пишется в журнал и в `provider_payload`.

   Срок трое суток закрывает любой неоплаченный вердикт, включая `error`
   (неверная подпись, другой алгоритм, сеть): иначе такой заказ опрашивался
   бы раз в час вечно. Поздний Result всё равно зачислится. */
export async function checkOrderWithRobokassa(
  config: RobokassaConfig,
  order: OrderToCheck,
  deps: { fetchImpl: typeof fetch; confirm: ConfirmOrder; close: CloseOrder; via: 'reconcile' | 'status'; now?: number; report?: ReportIncident },
): Promise<OpStateVerdict | 'expired'> {
  const url = opStateUrl(config, order.invId, order.isTest)
  let verdict: OpStateVerdict = 'error'
  let outSumKopecks: number | null = null
  let failure = url ? '' : 'нет паролей для режима заказа'
  if (url) {
    try {
      const response = await deps.fetchImpl(url, { signal: AbortSignal.timeout(opStateTimeoutMs) })
      const state = parseOpState(await response.text())
      verdict = classifyOpState(state)
      outSumKopecks = state?.outSumKopecks ?? null
      if (verdict === 'error') failure = state ? `код ответа ${state.resultCode}` : `нечитаемый ответ, HTTP ${response.status}`
    } catch (error) {
      verdict = 'error'
      failure = error instanceof Error ? error.message.slice(0, 200) : 'нет ответа'
    }
  }

  if (verdict === 'paid') {
    if (outSumKopecks !== null && outSumKopecks !== order.amount) {
      log('robokassa_opstate_sum_differs', { invId: order.invId, amount: order.amount, outSum: outSumKopecks, isTest: order.isTest })
    }
    await deps.confirm({
      invId: order.invId,
      amountKopecks: order.amount,
      isTest: order.isTest,
      via: deps.via,
      payload: outSumKopecks === null ? { OpState: '100' } : { OpState: '100', OutSum: formatOutSum(outSumKopecks) },
    })
    return 'paid'
  }
  if (verdict === 'cancelled') {
    await deps.close(order.invId, 'cancelled')
    return 'cancelled'
  }
  const age = (deps.now ?? Date.now()) - Date.parse(order.createdAt)
  if (age > orderLifetimeMs) {
    await deps.close(order.invId, 'expired')
    log('robokassa_reconcile_failed', { invId: order.invId, verdict, reason: failure || verdict, closed: 'expired', isTest: order.isTest })
    // Не дошёл до оплаты - обычное дело. Трое суток без ответа Робокассы - нет.
    if (verdict === 'error') await reportSafely(deps.report, { kind: 'reconcile_failed', invId: order.invId, detail: failure || 'ошибка' })
    return 'expired'
  }
  return verdict
}

function parseOrder(value: unknown): OrderToCheck | null {
  const source = record(value)
  const invId = Number(source.invId)
  const amount = Number(source.amount)
  if (!Number.isSafeInteger(invId) || !Number.isSafeInteger(amount) || typeof source.createdAt !== 'string') return null
  return { invId, amount, isTest: source.isTest === true, createdAt: source.createdAt }
}

/* Сверка из админского cron: раз в минуту берём заказы, по которым пора
   спросить Робокассу, - база отдаёт их с нарастающей паузой. Сбой одного
   заказа не останавливает остальные. */
export async function reconcilePaymentOrders(service: ServiceClient, config: RobokassaConfig | null, fetchImpl: typeof fetch = fetch) {
  const summary = { checked: 0, paid: 0, closed: 0, errors: 0 }
  if (!config) return summary
  const { data, error } = await service.rpc('payment_orders_due', { p_limit: 20 })
  if (error) throw new Error(error.message)
  const orders = (Array.isArray(data) ? data : []).map(parseOrder).filter((order): order is OrderToCheck => order !== null)
  const deps = { fetchImpl, confirm: confirmWith(service), close: closeWith(service), via: 'reconcile' as const, report: reportWith(service) }
  for (const order of orders) {
    summary.checked += 1
    try {
      // Последовательно: заказов единицы, а залп запросов их API ни к чему.
      // eslint-disable-next-line no-await-in-loop
      const verdict = await checkOrderWithRobokassa(config, order, deps)
      if (verdict === 'paid') summary.paid += 1
      else if (verdict === 'cancelled' || verdict === 'expired') summary.closed += 1
      else if (verdict === 'error') summary.errors += 1
    } catch (checkError) {
      summary.errors += 1
      log('robokassa_reconcile_failed', { invId: order.invId, message: checkError instanceof Error ? checkError.message : 'unknown' })
    }
  }
  if (summary.checked > 0) log('robokassa_reconciled', summary)
  return summary
}

function createErrorMessage(message: string) {
  if (message.includes('test payments are staff only')) return new PaymentApiError(403, 'Тестовая оплата доступна только служебным аккаунтам')
  if (message.includes('account is blocked')) return new PaymentApiError(403, 'Аккаунт заблокирован')
  if (message.includes('too many payment orders')) return new PaymentApiError(429, 'Слишком много попыток оплаты. Попробуй через час')
  if (message.includes('top up amount out of range')) return new PaymentApiError(400, 'Сумма пополнения вне допустимых границ')
  return new PaymentApiError(500, 'Не получилось создать платёж. Попробуй ещё раз')
}

async function paymentConfig(options: PaymentServerOptions, service: ServiceClient, userId: string) {
  const config = options.robokassa
  let enabled = Boolean(config)
  if (config?.testMode) {
    const { data } = await service.rpc('payment_user_is_staff', { p_user_id: userId })
    enabled = data === true
  }
  return { enabled, testMode: Boolean(config?.testMode), minKopecks: minTopUpKopecks, maxKopecks: maxTopUpKopecks }
}

/* Почта аккаунта нужна только чеку: при `ROBOKASSA_RECEIPTS=1` Робокасса
   шлёт на неё чек НПД. Без чеков `buildPaymentUrl` её не берёт. */
async function createOrder(options: PaymentServerOptions, service: ServiceClient, userId: string, email: string | undefined, body: Record<string, unknown>) {
  const config = options.robokassa
  if (!config) throw new PaymentApiError(503, 'Оплата временно недоступна')
  const amount = checkTopUpKopecks(Number(body.amountKopecks))
  if (!amount.ok) throw new PaymentApiError(400, amount.error)
  const { data, error } = await service.rpc('create_payment_order', { p_user_id: userId, p_amount: amount.kopecks, p_is_test: config.testMode })
  if (error) throw createErrorMessage(error.message)
  const order = record(data)
  const invId = Number(order.invId)
  if (!Number.isSafeInteger(invId)) throw new PaymentApiError(500, 'Не получилось создать платёж. Попробуй ещё раз')
  log('robokassa_order_created', { invId, amount: amount.kopecks, isTest: config.testMode, receipt: config.receipts })
  return { url: buildPaymentUrl(config, { invId, amountKopecks: amount.kopecks, isTest: config.testMode, email }), invId, amountKopecks: amount.kopecks, testMode: config.testMode }
}

async function readOrderStatus(service: ServiceClient, userId: string, invId: number) {
  const { data, error } = await service.rpc('payment_order_status', { p_user_id: userId, p_inv_id: invId })
  if (error) throw new PaymentApiError(500, 'Не получилось проверить платёж')
  return data ? record(data) : null
}

/* Ученик вернулся с Робокассы. Если уведомление ещё не дошло, спрашиваем
   статус сами - не чаще раза в десять секунд на заказ (claim в базе). */
async function orderStatus(options: PaymentServerOptions, service: ServiceClient, userId: string, body: Record<string, unknown>) {
  const invId = Number(body.invId)
  if (!Number.isSafeInteger(invId) || invId < 1) throw new PaymentApiError(400, 'Неизвестный платёж')
  let order = await readOrderStatus(service, userId, invId)
  if (!order) throw new PaymentApiError(404, 'Платёж не найден')
  const config = options.robokassa
  if (order.status === 'pending' && config) {
    const { data: claimed } = await service.rpc('claim_payment_order_check', { p_user_id: userId, p_inv_id: invId })
    if (claimed === true) {
      const parsed = parseOrder(order)
      if (parsed) {
        await checkOrderWithRobokassa(config, parsed, {
          fetchImpl: options.fetchImpl ?? fetch,
          confirm: confirmWith(service),
          close: closeWith(service),
          via: 'status',
          report: reportWith(service),
        }).catch((error: unknown) => log('robokassa_status_check_failed', { invId, message: error instanceof Error ? error.message : 'unknown' }))
        order = await readOrderStatus(service, userId, invId) ?? order
      }
    }
  }
  return { invId, status: String(order.status), amountKopecks: Number(order.amount), testMode: order.isTest === true }
}

async function answerResultNotice(response: ServerResponse, options: PaymentServerOptions, params: URLSearchParams) {
  if (!options.robokassa) {
    sendText(response, 503, 'not configured')
    return
  }
  const service = serviceClient(options)
  const result = await handleResultNotice(options.robokassa, params, confirmWith(service), reportWith(service))
  sendText(response, result.status, result.body)
}

export async function handlePaymentRequest(request: IncomingMessage, response: ServerResponse, options: PaymentServerOptions) {
  const browserAllowed = allowBrowser(request, response)
  if (request.method === 'OPTIONS') {
    response.statusCode = browserAllowed ? 204 : 403
    response.end()
    return
  }
  if (request.method !== 'POST' && request.method !== 'GET') {
    response.setHeader('Allow', 'GET, POST, OPTIONS')
    sendJson(response, 405, { error: 'Допустимы только GET и POST' })
    return
  }

  try {
    // GET бывает только у Result: браузер ученика ходит POST с JSON.
    if (request.method === 'GET') {
      await answerResultNotice(response, options, new URL(request.url ?? '/', 'http://localhost').searchParams)
      return
    }

    const raw = await readRaw(request)
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase()

    if (contentType.includes('application/x-www-form-urlencoded')) {
      await answerResultNotice(response, options, new URLSearchParams(raw))
      return
    }

    let body: Record<string, unknown>
    try {
      body = record(JSON.parse(raw || '{}'))
    } catch {
      throw new PaymentApiError(400, 'Некорректный формат запроса')
    }
    const action = typeof body.action === 'string' ? body.action : ''
    const user = await authenticate(request, options)
    const service = serviceClient(options)

    if (action === 'config') sendJson(response, 200, await paymentConfig(options, service, user.id))
    else if (action === 'create') sendJson(response, 200, await createOrder(options, service, user.id, user.email, body))
    else if (action === 'status') sendJson(response, 200, await orderStatus(options, service, user.id, body))
    else throw new PaymentApiError(400, 'Неизвестное действие')
  } catch (error) {
    const apiError = error instanceof PaymentApiError ? error : new PaymentApiError(500, 'Не получилось выполнить запрос оплаты')
    if (!(error instanceof PaymentApiError)) log('payment_request_failed', { message: error instanceof Error ? error.message : 'unknown' })
    sendJson(response, apiError.status, { error: apiError.message })
  }
}
