/* Телеметрия функций для админки.

   Каждая функция на Vercel пишет в базу три вещи: строку журнала запроса
   (маршрут, статус, длительность, кто и откуда), ошибку с группировкой по
   отпечатку и отметку устройства. Пишет служебной ролью, мимо ученика.

   Запись телеметрии никогда не роняет ответ: учёт - не часть работы.
   Логи Vercel живут считаные дни, а админке нужно минимум 30 дней. */

import type { IncomingMessage } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../src/lib/database.types.ts'

export type TelemetryRoute = 'solve' | 'chat' | 'support' | 'admin' | 'telegram'
export type ErrorKind = 'frontend' | 'api' | 'llm' | 'payments' | 'db'
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

export type TelemetryOptions = {
  supabaseUrl?: string
  serviceRoleKey?: string
}

let cachedClient: { key: string; client: SupabaseClient<Database> } | null = null

export function telemetryClient(options: TelemetryOptions): SupabaseClient<Database> | null {
  if (!options.supabaseUrl || !options.serviceRoleKey) return null
  const key = options.supabaseUrl + options.serviceRoleKey.slice(-12)
  if (cachedClient?.key === key) return cachedClient.client
  const client = createClient<Database>(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  cachedClient = { key, client }
  return client
}

function headerText(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value ?? '').trim()
}

/* Адрес клиента. За прокси на Supabase настоящий адрес приходит в
   `x-client-ip` - но только с верной подписью, иначе его может подставить
   кто угодно. Проверка подписи живёт в решателе; сюда приходит уже
   проверенный адрес или обычный x-forwarded-for. */
export function requestAddress(request: IncomingMessage, trustedProxyAddress: string | null) {
  if (trustedProxyAddress) return trustedProxyAddress.slice(0, 64)
  const forwarded = headerText(request.headers['x-forwarded-for'])
  return (forwarded.split(',')[0]?.trim() || request.socket?.remoteAddress || '').slice(0, 64) || null
}

export function requestUserAgent(request: IncomingMessage) {
  return headerText(request.headers['user-agent']).slice(0, 400) || null
}

export function requestIdOf(request: IncomingMessage) {
  return headerText(request.headers['x-vercel-id']) || 'local'
}

export function requestBytes(request: IncomingMessage) {
  const declared = Number(request.headers['content-length'] ?? 0)
  return Number.isFinite(declared) && declared > 0 ? Math.trunc(declared) : null
}

const guestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function requestGuestId(request: IncomingMessage) {
  const value = headerText(request.headers['x-guest-id']).toLowerCase()
  return guestPattern.test(value) ? value : null
}

export type RequestLogEntry = {
  route: TelemetryRoute
  status: number
  requestId: string
  method?: string
  userId?: string | null
  guestId?: string | null
  ip?: string | null
  userAgent?: string | null
  durationMs?: number
  bytesIn?: number | null
  error?: string | null
}

export async function recordRequestLog(options: TelemetryOptions, entry: RequestLogEntry) {
  const client = telemetryClient(options)
  if (!client) return
  try {
    await client.rpc('record_request_log', {
      p_route: entry.route,
      p_status: entry.status,
      p_request_id: entry.requestId,
      p_method: entry.method ?? 'POST',
      p_user_id: entry.userId ?? null,
      p_guest_id: entry.guestId ?? null,
      p_ip: entry.ip ?? null,
      p_user_agent: entry.userAgent ?? null,
      p_duration_ms: entry.durationMs !== undefined ? Math.round(entry.durationMs) : null,
      p_bytes_in: entry.bytesIn ?? null,
      p_error: entry.error ? entry.error.slice(0, 400) : null,
    })
  } catch {
    // Журнал - не часть ответа.
  }
}

export type ErrorEntry = {
  kind: ErrorKind
  severity?: ErrorSeverity
  route: string
  message: string
  stack?: string | null
  requestId?: string | null
  userId?: string | null
  guestId?: string | null
  ip?: string | null
  input?: Record<string, unknown> | null
  environment?: Record<string, unknown> | null
}

export async function recordError(options: TelemetryOptions, entry: ErrorEntry) {
  const client = telemetryClient(options)
  if (!client) return
  try {
    await client.rpc('record_error_event', {
      p_kind: entry.kind,
      p_severity: entry.severity ?? 'error',
      p_route: entry.route,
      p_message: entry.message.slice(0, 1000),
      p_stack: entry.stack ? entry.stack.slice(0, 8000) : null,
      p_request_id: entry.requestId ?? null,
      p_user_id: entry.userId ?? null,
      p_guest_id: entry.guestId ?? null,
      p_ip: entry.ip ?? null,
      p_input: (entry.input ?? null) as Json,
      p_environment: {
        runtime: 'vercel',
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
        environment: process.env.VERCEL_ENV ?? 'local',
        ...(entry.environment ?? {}),
      } as Json,
    })
  } catch {
    // Ошибка записи ошибки не должна ничего ронять.
  }
}

export async function recordDeviceTouch(
  options: TelemetryOptions,
  touch: { userId?: string | null; guestId?: string | null; deviceId?: string | null; ip?: string | null; userAgent?: string | null },
) {
  if (!touch.userId && !touch.guestId) return
  const client = telemetryClient(options)
  if (!client) return
  try {
    await client.rpc('record_client_touch', {
      p_user_id: touch.userId ?? null,
      p_guest_id: touch.guestId ?? null,
      p_device_id: touch.deviceId ?? null,
      p_ip: touch.ip ?? null,
      p_user_agent: touch.userAgent ?? null,
    })
  } catch {
    // Отметка устройства - не часть ответа.
  }
}

/* Настройки решателя для конкретного человека: дневной лимит тарифа,
   включён ли предмет, промпт владельца для предмета, флаги функций. Не
   прочиталось - работаем по умолчанию, как до админки: наш сбой не должен
   останавливать ученика. */
export type SolverContext = {
  dailySolveLimit: number | null
  subjectEnabled: boolean
  prompt: string | null
  promptVersion: number | null
  flags: Record<string, boolean>
}

export const defaultSolverContext: SolverContext = {
  dailySolveLimit: null,
  subjectEnabled: true,
  prompt: null,
  promptVersion: null,
  flags: {},
}

export async function loadSolverContext(
  options: TelemetryOptions,
  identity: { userId?: string | null; guestId?: string | null; subjectId?: string | null },
): Promise<SolverContext> {
  const client = telemetryClient(options)
  if (!client) return defaultSolverContext
  try {
    const { data, error } = await client.rpc('solver_context', {
      p_user_id: identity.userId ?? null,
      p_guest_id: identity.guestId ?? null,
      p_subject_id: identity.subjectId ?? null,
    })
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return defaultSolverContext
    const record = data as Record<string, unknown>
    const flags = record.flags && typeof record.flags === 'object' && !Array.isArray(record.flags)
      ? Object.fromEntries(Object.entries(record.flags as Record<string, unknown>).map(([key, value]) => [key, value !== false]))
      : {}
    return {
      dailySolveLimit: typeof record.dailySolveLimit === 'number' ? record.dailySolveLimit : null,
      subjectEnabled: record.subjectEnabled !== false,
      prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : null,
      promptVersion: typeof record.promptVersion === 'number' ? record.promptVersion : null,
      flags,
    }
  } catch {
    return defaultSolverContext
  }
}

export function flagEnabled(context: SolverContext, key: string) {
  return context.flags[key] !== false
}
