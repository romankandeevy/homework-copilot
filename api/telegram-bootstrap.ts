import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

type TelegramMessage = {
  date?: number
  text?: string
  chat?: {
    id?: number
    type?: string
  }
  from?: {
    id?: number
    is_bot?: boolean
  }
}

type TelegramUpdate = {
  message?: TelegramMessage
}

function json(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function authorized(request: IncomingMessage, expected: string) {
  const provided = request.headers['x-bootstrap-secret']
  if (typeof provided !== 'string') return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function readAction(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  const value = raw ? (JSON.parse(raw) as { action?: unknown }) : {}
  return typeof value.action === 'string' ? value.action : ''
}

async function telegram<T>(token: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const payload = (await response.json()) as TelegramResponse<T>
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed`)
  return payload.result as T
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    json(response, 405, { error: 'Method not allowed' })
    return
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || ''
  if (!token || !secret) {
    json(response, 503, { error: 'Bootstrap is not configured' })
    return
  }
  if (!authorized(request, secret)) {
    json(response, 401, { error: 'Unauthorized' })
    return
  }

  try {
    const action = await readAction(request)
    if (action === 'discover') {
      const updates = await telegram<TelegramUpdate[]>(token, 'getUpdates')
      const starts = updates
        .map((update) => update.message)
        .filter((message): message is TelegramMessage => Boolean(message))
        .filter(
          (message) =>
            message.chat?.type === 'private' &&
            message.chat.id === message.from?.id &&
            message.from?.is_bot === false &&
            message.text?.trim().startsWith('/start'),
        )
        .sort((left, right) => (right.date || 0) - (left.date || 0))
      const ownerChatId = starts[0]?.chat?.id
      if (!Number.isSafeInteger(ownerChatId)) {
        json(response, 404, { error: 'No private /start update found' })
        return
      }
      json(response, 200, { ok: true, ownerChatId })
      return
    }

    if (action === 'configure') {
      const webhookUrl = 'https://www.homeworkcopilot.ru/api/telegram-webhook'
      await telegram<boolean>(token, 'setWebhook', {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message'],
        drop_pending_updates: false,
      })
      const info = await telegram<{
        url?: string
        has_custom_certificate?: boolean
        pending_update_count?: number
        last_error_message?: string
      }>(token, 'getWebhookInfo')
      json(response, 200, {
        ok: info.url === webhookUrl,
        url: info.url || '',
        hasCustomCertificate: Boolean(info.has_custom_certificate),
        pendingUpdateCount: info.pending_update_count || 0,
        lastErrorMessage: info.last_error_message || '',
      })
      return
    }

    json(response, 400, { error: 'Unknown action' })
  } catch {
    json(response, 502, { error: 'Telegram bootstrap failed' })
  }
}
