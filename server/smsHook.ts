import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeRussianMobile } from '../src/lib/phone.ts'

/* Send SMS Hook: код входа по номеру телефона.

   У Supabase нет российского СМС-провайдера, поэтому код отправляет наш
   хук. Supabase Auth зовёт его сам, из Франкфурта, - прокси не нужен:
   `POST /api/sms-hook` с телом `{ user: { id, phone }, sms: { otp } }` и
   подписью по Standard Webhooks (`webhook-id`, `webhook-timestamp`,
   `webhook-signature`).

   - Подпись: base64(HMAC-SHA256(ключ, `${id}.${timestamp}.${тело}`)) в виде
     `v1,<подпись>`, подписей в заголовке может быть несколько через пробел.
     Ключ - секрет хука из Supabase `v1,whsec_<base64>` без префиксов.
   - Отметке времени старше пяти минут не верим: это повтор чужого запроса.
   - Номер ещё раз проверяется здесь: только российский мобильный. Иначе
     чужой скрипт мог бы гонять нам СМС на платные зарубежные номера.
   - Успех - 200 с пустым телом. Ошибка - `{ error: { http_code, message } }`:
     так её понимает Supabase и отдаёт клиенту.
   - Нет ключей - 503: вход по телефону выключен, пока их не поставили.

   Провайдер спрятан за `SmsSender`: сменить SMS.ru - одна функция. */

export type SmsSender = (phone: string, text: string) => Promise<void>

export type SmsHookConfig = {
  key: Buffer
  sendSms: SmsSender
}

export const webhookToleranceSeconds = 5 * 60
const maxBodyBytes = 16 * 1024
const smsTimeoutMs = 10_000

export class SmsSendError extends Error {}

function log(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...details }))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Секрет из Supabase («v1,whsec_<base64>») - в ключ HMAC. */
export function webhookSecretKey(secret: string | undefined): Buffer | null {
  let value = (secret ?? '').trim()
  if (value.startsWith('v1,')) value = value.slice(3)
  if (value.startsWith('whsec_')) value = value.slice(6)
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return null
  const key = Buffer.from(value, 'base64')
  return key.length >= 16 ? key : null
}

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature' }

export function verifyWebhook(input: {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
  body: string
  key: Buffer
  nowSeconds?: number
}): WebhookCheck {
  const { id, timestamp, signature } = input
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' }
  if (!/^\d{1,12}$/u.test(timestamp)) return { ok: false, reason: 'bad_timestamp' }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(timestamp)) > webhookToleranceSeconds) return { ok: false, reason: 'stale_timestamp' }

  const expected = createHmac('sha256', input.key).update(`${id}.${timestamp}.${input.body}`, 'utf8').digest()
  for (const entry of signature.trim().split(/\s+/u)) {
    const separator = entry.indexOf(',')
    if (separator < 0 || entry.slice(0, separator) !== 'v1') continue
    const received = Buffer.from(entry.slice(separator + 1), 'base64')
    if (received.length === expected.length && timingSafeEqual(received, expected)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}

export function smsText(otp: string) {
  return `Homework Copilot: код входа ${otp}`
}

/* SMS.ru: `https://sms.ru/sms/send`. Параметры те же, что в GET-примере из
   документации, но идут телом POST - так ключ не оседает в журналах адресов.
   Успех - общий `status: "OK"` и `status: "OK"` у самого номера. */
export function smsRuSender(options: { apiId: string; test?: boolean; fetchImpl?: typeof fetch }): SmsSender {
  return async (phone, text) => {
    const body = new URLSearchParams({ api_id: options.apiId, to: phone, msg: text, json: '1' })
    if (options.test) body.set('test', '1')
    let response: Response
    try {
      response = await (options.fetchImpl ?? fetch)('https://sms.ru/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(smsTimeoutMs),
      })
    } catch {
      throw new SmsSendError('sms.ru did not respond')
    }
    const payload = record(await response.json().catch(() => null))
    if (!response.ok || payload.status !== 'OK') {
      throw new SmsSendError(`sms.ru rejected the request: ${String(payload.status_code ?? response.status)} ${String(payload.status_text ?? '')}`.trim())
    }
    const entry = record(record(payload.sms)[phone])
    if (entry.status !== 'OK') {
      throw new SmsSendError(`sms.ru rejected the number: ${String(entry.status_code ?? '')} ${String(entry.status_text ?? '')}`.trim())
    }
  }
}

export function smsHookConfigFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): SmsHookConfig | null {
  const key = webhookSecretKey(env.SEND_SMS_HOOK_SECRET)
  const apiId = (env.SMSRU_API_ID ?? '').trim()
  if (!key || !apiId) return null
  const test = ['1', 'true', 'yes'].includes((env.SMSRU_TEST ?? '').trim().toLowerCase())
  return { key, sendSms: smsRuSender({ apiId, test, fetchImpl }) }
}

// В журнал - только начало и конец номера.
function maskPhone(digits: string) {
  return `+7${digits.slice(0, 1)}******${digits.slice(-3)}`
}

function header(request: IncomingMessage, name: string) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

async function readRaw(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new Error('payload too large')
  return await new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBodyBytes) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => reject(new Error('read failed')))
  })
}

function hookError(response: ServerResponse, status: number, message: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ error: { http_code: status, message } }))
}

export async function handleSmsHookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: SmsHookConfig | null,
  nowSeconds?: number,
) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    hookError(response, 405, 'Method not allowed')
    return
  }
  if (!config) {
    log('sms_hook_not_configured', {})
    hookError(response, 503, 'SMS sending is not configured')
    return
  }

  let raw: string
  try {
    raw = await readRaw(request)
  } catch {
    hookError(response, 413, 'Payload too large')
    return
  }

  const check = verifyWebhook({
    id: header(request, 'webhook-id'),
    timestamp: header(request, 'webhook-timestamp'),
    signature: header(request, 'webhook-signature'),
    body: raw,
    key: config.key,
    nowSeconds,
  })
  if (!check.ok) {
    log('sms_hook_rejected', { reason: check.reason })
    hookError(response, 401, 'Invalid webhook signature')
    return
  }

  let payload: Record<string, unknown>
  try {
    payload = record(JSON.parse(raw) as unknown)
  } catch {
    hookError(response, 400, 'Invalid JSON')
    return
  }

  const otp = record(payload.sms).otp
  if (typeof otp !== 'string' || !/^\d{4,10}$/u.test(otp)) {
    hookError(response, 400, 'Invalid OTP')
    return
  }
  const digits = normalizeRussianMobile(record(payload.user).phone)
  if (!digits) {
    log('sms_hook_foreign_number', {})
    hookError(response, 400, 'Only Russian mobile numbers are supported')
    return
  }

  try {
    await config.sendSms(`7${digits}`, smsText(otp))
  } catch (error) {
    log('sms_hook_send_failed', { phone: maskPhone(digits), message: error instanceof Error ? error.message : 'unknown' })
    hookError(response, 502, 'SMS provider did not accept the message')
    return
  }

  log('sms_hook_sent', { phone: maskPhone(digits) })
  response.statusCode = 200
  response.setHeader('Cache-Control', 'no-store')
  response.end()
}
