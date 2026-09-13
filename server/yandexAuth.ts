import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/* Вход через Яндекс ID.

   406-ФЗ: российский сайт авторизует пользователей из России только через
   российский сервис входа, российский номер телефона, Госуслуги или ЕБС.
   Провайдера «Яндекс» у Supabase нет, поэтому поток OAuth ведёт этот код,
   а сессию выдаёт сам Supabase по одноразовой ссылке входа:

   1. `start` - браузер присылает случайный nonce (он же лежит в его
      sessionStorage) и отметку «согласия приняты». Сервер отдаёт адрес
      авторизации Яндекса с подписанным `state`: nonce, согласия, срок
      десять минут. `state` подписан, но не зашифрован и уходит через
      Яндекс, поэтому метки браузера и токена приглашения в нём нет.
   2. Яндекс возвращает на `https://www.homeworkcopilot.ru/app?code=…&state=…`.
      `src/main.tsx` забирает код из адреса до создания клиента Supabase.
   3. `finish` - браузер присылает code, state, nonce, метку браузера и
      токен приглашения. Сервер проверяет подпись, срок и nonce, меняет код
      на токен Яндекса, читает профиль и требует почту. Нет аккаунта с этой
      почтой - создаёт его (`email_confirm`: почту подтвердил Яндекс) с теми
      же метаданными, что шлёт регистрация по почте. Есть - входит в него.
      Наружу отдаётся одноразовый `token_hash` ссылки входа; браузер меняет
      его на сессию через `verifyOtp`. Сама ссылка никуда не отправляется.

   Повтор `finish` не страшен: код Яндекса одноразовый.
   Нет ключей - 503 и кнопка ведёт в понятный отказ (флаг `auth_yandex`
   держит её скрытой, пока владелец их не поставил). */

export type YandexAuthConfig = {
  clientId: string
  clientSecret: string
  stateSecret: string
  redirectUri: string
}

export const defaultYandexRedirectUri = 'https://www.homeworkcopilot.ru/app'
export const stateLifetimeMs = 10 * 60 * 1000
const yandexTimeoutMs = 10_000
const maxBodyBytes = 8 * 1024
const noncePattern = /^[A-Za-z0-9_-]{16,64}$/u

const allowedOrigins = new Set([
  'https://www.homeworkcopilot.ru',
  'https://homeworkcopilot.ru',
  'http://localhost:5173',
])

export const yandexAuthMessages = {
  notConfigured: 'Вход через Яндекс ID пока не подключён',
  stale: 'Вход через Яндекс ID устарел. Нажми «Войти с Яндекс ID» ещё раз',
  yandexFailed: 'Яндекс не подтвердил вход. Попробуй ещё раз',
  noEmail: 'В аккаунте Яндекса нет почты. Добавь её в Яндекс ID или войди другим способом',
  accountFailed: 'Не получилось завершить вход. Попробуй ещё раз',
}

export class YandexAuthError extends Error {
  readonly status: number
  readonly reason: string

  constructor(status: number, message: string, reason: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

function log(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...details }))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: string | undefined) {
  return (value ?? '').trim()
}

export function yandexAuthConfigFromEnv(env: Record<string, string | undefined>): YandexAuthConfig | null {
  const clientId = text(env.YANDEX_CLIENT_ID)
  const clientSecret = text(env.YANDEX_CLIENT_SECRET)
  const stateSecret = text(env.AUTH_STATE_SECRET)
  // Короткий секрет подписи хуже, чем никакого: вход просто не включается.
  if (!clientId || !clientSecret || stateSecret.length < 32) return null
  return { clientId, clientSecret, stateSecret, redirectUri: text(env.YANDEX_REDIRECT_URI) || defaultYandexRedirectUri }
}

/* ---------- state ---------- */

export type YandexState = { nonce: string; consents: boolean; expiresAt: number }

function stateSignature(body: string, secret: string) {
  return createHmac('sha256', secret).update(`yandex-state.${body}`, 'utf8').digest()
}

export function signState(state: YandexState, secret: string) {
  const body = Buffer.from(JSON.stringify({ n: state.nonce, c: state.consents ? 1 : 0, e: state.expiresAt }), 'utf8').toString('base64url')
  return `${body}.${stateSignature(body, secret).toString('base64url')}`
}

export function verifyState(state: unknown, secret: string, now = Date.now()): YandexState | null {
  if (typeof state !== 'string' || state.length > 512) return null
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, signature] = parts
  const expected = stateSignature(body, secret)
  const received = Buffer.from(signature, 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null

  let parsed: Record<string, unknown>
  try {
    parsed = record(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown)
  } catch {
    return null
  }
  if (typeof parsed.n !== 'string' || !noncePattern.test(parsed.n)) return null
  if (typeof parsed.e !== 'number' || !Number.isFinite(parsed.e) || parsed.e < now) return null
  return { nonce: parsed.n, consents: parsed.c === 1, expiresAt: parsed.e }
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function authorizeUrl(config: YandexAuthConfig, state: string) {
  const url = new URL('https://oauth.yandex.ru/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', 'login:email login:info')
  url.searchParams.set('state', state)
  return url.toString()
}

/* ---------- Яндекс ---------- */

export type YandexProfile = { id: string; email: string; fullName: string }

export async function exchangeCode(config: YandexAuthConfig, code: string, fetchImpl: typeof fetch) {
  let response: Response
  try {
    response = await fetchImpl('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId, client_secret: config.clientSecret }),
      signal: AbortSignal.timeout(yandexTimeoutMs),
    })
  } catch {
    throw new YandexAuthError(502, yandexAuthMessages.yandexFailed, 'token_unreachable')
  }
  const payload = record(await response.json().catch(() => null))
  if (response.ok && typeof payload.access_token === 'string' && payload.access_token) return payload.access_token
  // invalid_grant - код истёк или уже обменян: человеку нужно начать заново.
  if (payload.error === 'invalid_grant') throw new YandexAuthError(400, yandexAuthMessages.stale, 'invalid_grant')
  throw new YandexAuthError(502, yandexAuthMessages.yandexFailed, `token_${String(payload.error ?? response.status)}`)
}

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null
}

function nonEmpty(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export async function fetchYandexProfile(token: string, fetchImpl: typeof fetch): Promise<YandexProfile> {
  let response: Response
  try {
    response = await fetchImpl('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(yandexTimeoutMs),
    })
  } catch {
    throw new YandexAuthError(502, yandexAuthMessages.yandexFailed, 'info_unreachable')
  }
  if (!response.ok) throw new YandexAuthError(502, yandexAuthMessages.yandexFailed, `info_${response.status}`)
  const info = record(await response.json().catch(() => null))
  const id = typeof info.id === 'number' ? String(info.id) : nonEmpty(info.id)
  if (!id) throw new YandexAuthError(502, yandexAuthMessages.yandexFailed, 'info_without_id')

  const emails = Array.isArray(info.emails) ? info.emails : []
  const email = normalizeEmail(info.default_email) ?? emails.map(normalizeEmail).find((entry): entry is string => Boolean(entry)) ?? null
  if (!email) throw new YandexAuthError(400, yandexAuthMessages.noEmail, 'no_email')

  const fullName = (
    nonEmpty(info.real_name)
    || [nonEmpty(info.first_name), nonEmpty(info.last_name)].filter(Boolean).join(' ')
    || nonEmpty(info.display_name)
  ).slice(0, 80)
  return { id, email, fullName }
}

/* ---------- Supabase ---------- */

/* Две операции служебного клиента Supabase, которые нужны входу. Отдельный
   тип - чтобы тест подменил их, не поднимая клиента. */
export type AuthAdminPort = {
  createUser(input: {
    email: string
    userMetadata: Record<string, unknown>
    appMetadata: Record<string, unknown>
  }): Promise<{ ok: true } | { ok: false; exists: boolean; message: string }>
  magicLink(email: string): Promise<{ tokenHash: string; verificationType: string } | null>
}

export function supabaseAuthAdmin(supabaseUrl: string, serviceRoleKey: string): AuthAdminPort {
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  return {
    async createUser({ email, userMetadata, appMetadata }) {
      const { error } = await service.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: userMetadata,
        app_metadata: appMetadata,
      })
      if (!error) return { ok: true }
      const exists = error.code === 'email_exists' || /already (?:been )?registered|already exists/iu.test(error.message)
      return { ok: false, exists, message: error.message }
    },
    async magicLink(email) {
      const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email })
      if (error || !data.properties?.hashed_token) return null
      return { tokenHash: data.properties.hashed_token, verificationType: data.properties.verification_type }
    },
  }
}

export type YandexFinishInput = {
  code?: unknown
  state?: unknown
  nonce?: unknown
  deviceId?: unknown
  referralClaimToken?: unknown
}

export type YandexFinishResult = { tokenHash: string; verificationType: 'magiclink' | 'signup' | 'email'; created: boolean }

const devicePattern = /^[A-Za-z0-9-]{8,64}$/u
const claimTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export async function finishYandexSignIn(
  config: YandexAuthConfig,
  input: YandexFinishInput,
  deps: { admin: AuthAdminPort; fetchImpl: typeof fetch; now?: number },
): Promise<YandexFinishResult> {
  const state = verifyState(input.state, config.stateSecret, deps.now)
  if (!state) throw new YandexAuthError(400, yandexAuthMessages.stale, 'bad_state')
  // nonce из sessionStorage той вкладки, что начинала вход: чужой state из
  // подсунутой ссылки в эту вкладку не войдёт.
  if (typeof input.nonce !== 'string' || !sameText(state.nonce, input.nonce)) throw new YandexAuthError(400, yandexAuthMessages.stale, 'nonce_mismatch')
  if (typeof input.code !== 'string' || !/^[\w.-]{4,256}$/u.test(input.code)) throw new YandexAuthError(400, yandexAuthMessages.stale, 'bad_code')

  const token = await exchangeCode(config, input.code, deps.fetchImpl)
  const profile = await fetchYandexProfile(token, deps.fetchImpl)

  const deviceId = typeof input.deviceId === 'string' && devicePattern.test(input.deviceId) ? input.deviceId : null
  const claimToken = typeof input.referralClaimToken === 'string' && claimTokenPattern.test(input.referralClaimToken.toLowerCase())
    ? input.referralClaimToken.toLowerCase()
    : null

  /* Метаданные те же, что у регистрации по почте (AccountDialog): их читают
     триггеры базы - кошелёк и стартовые 20 ₽ раз на метку браузера,
     привязка приглашения, отметка о согласии. Отметку ставим, только если
     согласия приняты на вкладке «Регистрация»; иначе новый аккаунт
     остановит окно согласия в приложении. */
  const created = await deps.admin.createUser({
    email: profile.email,
    userMetadata: {
      full_name: profile.fullName,
      ...(deviceId ? { device_id: deviceId } : {}),
      ...(claimToken ? { referral_claim_token: claimToken } : {}),
      ...(state.consents ? { legal_source: 'yandex' } : {}),
    },
    // app_metadata ученик сам не меняет, в отличие от user_metadata.
    appMetadata: { provider: 'yandex', yandex_id: profile.id },
  })
  if (!created.ok && !created.exists) throw new YandexAuthError(502, yandexAuthMessages.accountFailed, `create_user: ${created.message}`)

  const link = await deps.admin.magicLink(profile.email)
  if (!link) throw new YandexAuthError(502, yandexAuthMessages.accountFailed, 'magic_link')
  const verificationType = link.verificationType === 'signup' || link.verificationType === 'email' ? link.verificationType : 'magiclink'
  return { tokenHash: link.tokenHash, verificationType, created: created.ok }
}

/* ---------- HTTP ---------- */

export type YandexAuthServerOptions = {
  supabaseUrl?: string
  serviceRoleKey?: string
  yandex: YandexAuthConfig | null
  fetchImpl?: typeof fetch
  /* Подмена в тестах. На проде - служебный клиент Supabase. */
  admin?: AuthAdminPort
  now?: () => number
}

function sendJson(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function allowBrowser(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (!origin || !allowedOrigins.has(origin)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')
  return true
}

async function readRaw(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new YandexAuthError(413, 'Запрос слишком большой', 'too_large')
  return await new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBodyBytes) {
        reject(new YandexAuthError(413, 'Запрос слишком большой', 'too_large'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => reject(new YandexAuthError(400, 'Не получилось прочитать запрос', 'read_failed')))
  })
}

export async function handleYandexAuthRequest(request: IncomingMessage, response: ServerResponse, options: YandexAuthServerOptions) {
  const browserAllowed = allowBrowser(request, response)
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

  try {
    let body: Record<string, unknown>
    try {
      body = record(JSON.parse((await readRaw(request)) || '{}') as unknown)
    } catch (error) {
      if (error instanceof YandexAuthError) throw error
      throw new YandexAuthError(400, 'Некорректный формат запроса', 'bad_json')
    }
    const config = options.yandex
    if (!config) throw new YandexAuthError(503, yandexAuthMessages.notConfigured, 'not_configured')
    const now = options.now?.() ?? Date.now()
    const action = typeof body.action === 'string' ? body.action : ''

    if (action === 'start') {
      if (typeof body.nonce !== 'string' || !noncePattern.test(body.nonce)) throw new YandexAuthError(400, 'Некорректный запрос входа', 'bad_nonce')
      const state = signState({ nonce: body.nonce, consents: body.consents === true, expiresAt: now + stateLifetimeMs }, config.stateSecret)
      sendJson(response, 200, { url: authorizeUrl(config, state) })
      return
    }

    if (action === 'finish') {
      let admin = options.admin
      if (!admin) {
        if (!options.supabaseUrl || !options.serviceRoleKey) throw new YandexAuthError(503, yandexAuthMessages.notConfigured, 'supabase_not_configured')
        admin = supabaseAuthAdmin(options.supabaseUrl, options.serviceRoleKey)
      }
      const result = await finishYandexSignIn(config, body, { admin, fetchImpl: options.fetchImpl ?? fetch, now })
      log('yandex_auth_finished', { created: result.created })
      sendJson(response, 200, { tokenHash: result.tokenHash, verificationType: result.verificationType })
      return
    }

    throw new YandexAuthError(400, 'Неизвестное действие', 'unknown_action')
  } catch (error) {
    const apiError = error instanceof YandexAuthError ? error : new YandexAuthError(500, yandexAuthMessages.accountFailed, 'unexpected')
    log('yandex_auth_failed', {
      reason: apiError.reason,
      ...(error instanceof YandexAuthError ? {} : { message: error instanceof Error ? error.message : 'unknown' }),
    })
    sendJson(response, apiError.status, { error: apiError.message })
  }
}
