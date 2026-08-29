// Потоковый ИИ-чат.
//
// Деньги здесь устроены так же, как у решателя: резерв ДО вызова модели,
// расчёт по факту после. Разница в том, что стоимость сообщения заранее
// неизвестна, поэтому резервируется потолок модели, а неизрасходованный
// остаток возвращается в `settle_chat_generation`.
//
// Все проверки — бан, лимиты частоты, дневной потолок, доступность модели —
// живут в базе: RPC вызываются из браузера напрямую, и проверки здесь
// были бы просто вежливой просьбой.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import { ChatApiError } from './chatErrors.ts'
import { streamModelAnswer } from './chatProviders.ts'

export { ChatApiError } from './chatErrors.ts'

export type ChatOptions = {
  apiKey?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  serviceRoleKey?: string
  fetchImpl?: typeof fetch
}

type ChatRequestBody = {
  conversationId: string
  modelId: string
  text: string
  attachments: string[]
  useWebSearch: boolean
  idempotencyKey: string
}

type ChatAccount = {
  client: SupabaseClient<Database>
  userId: string
  token: string
}

const allowedBrowserOrigins = new Set([
  'https://www.homeworkcopilot.ru',
  'https://homeworkcopilot.ru',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

// Ответ модели ограничиваем и по времени, и по объёму: у serverless-функции
// есть потолок исполнения, а бесконечный поток — это ещё и счёт от провайдера.
const generationTimeoutMs = 120_000
const maxAnswerCharacters = 60_000
const maxPromptCharacters = 16_000
const maxContextMessages = 20

function textValue(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit).trim() : ''
}

function allowBrowser(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (!origin || !allowedBrowserOrigins.has(origin)) return false

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')
  return true
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const existing = (request as IncomingMessage & { body?: unknown }).body
  if (existing !== undefined) {
    if (typeof existing === 'string') {
      try {
        return JSON.parse(existing) as unknown
      } catch {
        throw new ChatApiError(400, 'Некорректное тело запроса')
      }
    }
    return existing
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer)
    size += buffer.length
    // Текст сообщения ограничен, вложения приходят ссылками на приватный бакет,
    // поэтому тело не имеет права быть большим.
    if (size > 256_000) throw new ChatApiError(413, 'Сообщение слишком большое')
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ChatApiError(400, 'Некорректное тело запроса')
  }
}

function validateBody(value: unknown): ChatRequestBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChatApiError(400, 'Некорректное тело запроса')
  }
  const raw = value as Record<string, unknown>

  const conversationId = textValue(raw.conversationId, 64)
  const modelId = textValue(raw.modelId, 120)
  const text = textValue(raw.text, maxPromptCharacters)
  const idempotencyKey = textValue(raw.idempotencyKey, 160)
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map((entry) => textValue(entry, 400)).filter(Boolean).slice(0, 4)
    : []

  if (!conversationId) throw new ChatApiError(400, 'Не указан диалог')
  if (!modelId) throw new ChatApiError(400, 'Не выбрана модель')
  if (!text && attachments.length === 0) throw new ChatApiError(400, 'Пустое сообщение')
  if (idempotencyKey.length < 8) throw new ChatApiError(400, 'Некорректный ключ запроса')

  return {
    conversationId,
    modelId,
    text,
    attachments,
    useWebSearch: raw.useWebSearch === true,
    idempotencyKey,
  }
}

async function authenticate(request: IncomingMessage, options: ChatOptions): Promise<ChatAccount> {
  if (!options.supabaseUrl || !options.supabasePublishableKey) {
    throw new ChatApiError(503, 'Чат временно недоступен')
  }

  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) throw new ChatApiError(401, 'Войди в аккаунт, чтобы пользоваться чатом')

  const client = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new ChatApiError(401, 'Сессия закончилась. Войди в аккаунт ещё раз')

  return { client, userId: data.user.id, token }
}

function serviceClient(options: ChatOptions): SupabaseClient<Database> {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    throw new ChatApiError(503, 'Чат временно недоступен')
  }
  return createClient<Database>(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Ошибки базы приходят текстом; переводим их в понятные пользователю
// сообщения и корректные коды, не раскрывая внутренностей.
function reservationError(message: string): ChatApiError {
  if (message.includes('insufficient balance')) return new ChatApiError(402, 'Не хватает денег на балансе')
  if (message.includes('chat is disabled')) return new ChatApiError(503, 'Чат сейчас отключён')
  if (message.includes('account is blocked')) return new ChatApiError(403, 'Аккаунт заблокирован')
  if (message.includes('generation already running')) return new ChatApiError(429, 'Дождись, пока закончится предыдущий ответ')
  if (message.includes('rate limit per minute')) return new ChatApiError(429, 'Слишком часто. Подожди минуту')
  if (message.includes('rate limit per hour')) return new ChatApiError(429, 'Слишком много сообщений за час. Попробуй позже')
  if (message.includes('daily spend limit')) return new ChatApiError(429, 'Дневной лимит трат исчерпан')
  if (message.includes('image quota')) return new ChatApiError(429, 'Дневной лимит фотографий исчерпан')
  if (message.includes('model is unavailable')) return new ChatApiError(400, 'Эта модель сейчас недоступна')
  if (message.includes('does not accept images')) return new ChatApiError(400, 'Эта модель не принимает фотографии')
  if (message.includes('does not support web search')) return new ChatApiError(400, 'Эта модель не умеет искать в интернете')
  if (message.includes('conversation not found')) return new ChatApiError(404, 'Диалог не найден')
  return new ChatApiError(502, 'Не получилось начать генерацию')
}

type SseWriter = {
  send: (event: string, payload: unknown) => void
  close: () => void
}

function openStream(response: ServerResponse): SseWriter {
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  // Отключает буферизацию у промежуточных прокси, иначе поток копится
  // и приходит одним куском в конце.
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders?.()

  let closed = false
  return {
    send(event, payload) {
      if (closed) return
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    },
    close() {
      if (closed) return
      closed = true
      response.end()
    },
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  response.end(JSON.stringify(payload))
}

export async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ChatOptions,
) {
  const browserAllowed = allowBrowser(request, response)

  if (request.method === 'OPTIONS') {
    response.statusCode = browserAllowed ? 204 : 403
    response.end()
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS')
    sendJson(response, 405, { error: 'Допустимы только POST и OPTIONS' })
    return
  }

  let stream: SseWriter | null = null
  let account: ChatAccount | null = null
  let generationId: string | null = null
  let service: SupabaseClient<Database> | null = null
  const startedAt = Date.now()

  try {
    if (!options.apiKey) throw new ChatApiError(503, 'Чат не настроен')

    const body = validateBody(await readJsonBody(request))
    account = await authenticate(request, options)
    service = serviceClient(options)

    // 1. Резерв. Он же проверяет бан, лимиты, доступность модели и деньги.
    const { data: reservation, error: reserveError } = await account.client.rpc('reserve_chat_generation', {
      p_idempotency_key: body.idempotencyKey,
      p_conversation_id: body.conversationId,
      p_model_id: body.modelId,
      p_image_count: body.attachments.length,
      p_use_web_search: body.useWebSearch,
    })

    if (reserveError) throw reservationError(reserveError.message)
    if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) {
      throw new ChatApiError(502, 'Не получилось начать генерацию')
    }

    generationId = String(reservation.generationId)

    // 2. Сообщение пользователя пишет сервер: у клиента нет права записи,
    // иначе историю можно было бы подделать задним числом.
    const { data: userMessage, error: userMessageError } = await service
      .from('chat_messages')
      .insert({
        conversation_id: body.conversationId,
        user_id: account.userId,
        role: 'user',
        content: body.text,
        attachments: body.attachments,
        model_id: body.modelId,
        status: 'done',
      })
      .select('id')
      .single()

    if (userMessageError || !userMessage) throw new ChatApiError(502, 'Не получилось сохранить сообщение')

    stream = openStream(response)
    stream.send('meta', {
      generationId,
      messageId: userMessage.id,
      reservedKopecks: reservation.reservedKopecks,
    })

    // 3. Контекст: последние сообщения диалога. Ограничение по количеству —
    // грубое, но предсказуемое; точный бюджет токенов считать нечем,
    // пока провайдер не отдаёт токенизатор.
    const { data: history } = await service
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', body.conversationId)
      .eq('user_id', account.userId)
      .order('created_at', { ascending: false })
      .limit(maxContextMessages)

    const messages = (history ?? [])
      .reverse()
      .map((entry) => ({ role: entry.role, content: entry.content }))
      .filter((entry) => entry.content)

    const answer = await streamModelAnswer({
      apiKey: options.apiKey,
      modelId: body.modelId,
      messages,
      useWebSearch: body.useWebSearch,
      maxAnswerCharacters,
      timeoutMs: generationTimeoutMs,
      fetchImpl: options.fetchImpl,
      onDelta: (delta) => stream?.send('delta', { text: delta }),
      onCitation: (citation) => stream?.send('citation', citation),
    })

    // 4. Ответ модели сохраняем и рассчитываемся по факту.
    const { data: assistantMessage } = await service
      .from('chat_messages')
      .insert({
        conversation_id: body.conversationId,
        user_id: account.userId,
        role: 'assistant',
        content: answer.text.slice(0, maxAnswerCharacters),
        model_id: body.modelId,
        status: 'done',
      })
      .select('id')
      .single()

    const { data: settlement } = await service.rpc('settle_chat_generation', {
      p_generation_id: generationId,
      p_status: 'succeeded',
      p_input_tokens: answer.inputTokens,
      p_output_tokens: answer.outputTokens,
      p_credits_consumed: answer.creditsConsumed,
      p_message_id: assistantMessage?.id ?? null,
      p_duration_ms: Date.now() - startedAt,
    })

    await service
      .from('chat_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', body.conversationId)

    stream.send('usage', {
      chargedKopecks: settlement && typeof settlement === 'object' && !Array.isArray(settlement)
        ? settlement.chargedKopecks
        : 0,
      refundedKopecks: settlement && typeof settlement === 'object' && !Array.isArray(settlement)
        ? settlement.refundedKopecks
        : 0,
      balanceKopecks: settlement && typeof settlement === 'object' && !Array.isArray(settlement)
        ? settlement.balanceKopecks
        : null,
    })
    stream.send('done', { messageId: assistantMessage?.id ?? null })
    stream.close()
  } catch (error) {
    const status = error instanceof ChatApiError ? error.status : 500
    const message = error instanceof ChatApiError
      ? error.message
      : 'Не получилось получить ответ. Попробуй ещё раз'

    // Резерв всегда возвращается: за неполученный ответ денег не берём.
    if (generationId && service) {
      try {
        await service.rpc('settle_chat_generation', {
          p_generation_id: generationId,
          p_status: 'failed',
          p_error: message,
          p_duration_ms: Date.now() - startedAt,
        })
      } catch {
        // Возврат разгребёт реапер брошенных резервов; исходную ошибку
        // пользователю это скрывать не должно.
      }
    }

    if (stream) {
      stream.send('error', { message })
      stream.close()
      return
    }

    sendJson(response, status, { error: message })
  }
}
