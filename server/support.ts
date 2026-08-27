import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database, Json } from '../src/lib/database.types.ts'

export type SupportCategory = 'general' | 'payment' | 'feature' | 'wrong_solution'

type SupportConversation = Database['public']['Tables']['support_conversations']['Row']
type SupportMessage = Database['public']['Tables']['support_messages']['Row']

type ServerConfig = {
  supabaseUrl: string
  publishableKey: string
  serviceKey: string
  telegramBotToken?: string
  telegramOwnerChatId?: string
  telegramWebhookSecret?: string
  fetchImpl: typeof fetch
}

type SupportPayload = {
  conversationId?: unknown
  category?: unknown
  body?: unknown
  context?: unknown
}

type SupportContext = Record<string, Json | undefined>

const categoryLabels: Record<SupportCategory, string> = {
  general: 'Общий вопрос',
  payment: 'Проблема с оплатой или балансом',
  feature: 'Идея для сервиса',
  wrong_solution: 'Решение оказалось неверным',
}

const maxBodyBytes = 600_000
const telegramChunkSize = 3800

export class SupportApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, maxLength: number) {
  return text(value).slice(0, maxLength)
}

function boundedTextArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function jsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function sanitizeWrongSolution(value: unknown) {
  const source = jsonObject(value)
  const goal = jsonObject(source.goal)
  return {
    textbookId: boundedText(source.textbookId, 150),
    textbookTitle: boundedText(source.textbookTitle, 300),
    subject: boundedText(source.subject, 150),
    grade: boundedText(source.grade, 40),
    edition: boundedText(source.edition, 200),
    source: source.source === 'photo' ? 'photo' : 'number',
    task: boundedText(source.task, 120),
    condition: boundedText(source.condition, 12_000),
    given: boundedTextArray(source.given, 40, 1_000),
    goal: {
      title: boundedText(goal.title, 150),
      text: boundedText(goal.text, 2_000),
    },
    steps: boundedTextArray(source.steps, 100, 2_000),
    answer: boundedText(source.answer, 2_000),
    sourceUrl: boundedText(source.sourceUrl, 500),
    sourcePage: Number.isInteger(source.sourcePage) ? Number(source.sourcePage) : undefined,
  }
}

function sanitizeClientContext(category: SupportCategory, value: unknown): SupportContext {
  const source = jsonObject(value)
  if (category !== 'wrong_solution') return {}
  return { wrongSolution: sanitizeWrongSolution(source.wrongSolution) as unknown as Json }
}

function category(value: unknown): SupportCategory | null {
  return value === 'general' || value === 'payment' || value === 'feature' || value === 'wrong_solution' ? value : null
}

function responseJson(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new SupportApiError(413, 'Сообщение слишком большое')
  }

  return await new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBodyBytes) {
        reject(new SupportApiError(413, 'Сообщение слишком большое'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new SupportApiError(400, 'Некорректный формат запроса'))
      }
    })
    request.on('error', () => reject(new SupportApiError(400, 'Не получилось прочитать запрос')))
  })
}

function bearerToken(request: IncomingMessage) {
  const header = request.headers.authorization
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null
  return match?.[1]?.trim() || ''
}

function getConfig(fetchImpl: typeof fetch = fetch): ServerConfig {
  const supabaseUrl = text(process.env.VITE_SUPABASE_URL)
  const publishableKey = text(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const serviceKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  if (!supabaseUrl || !publishableKey || !serviceKey) throw new SupportApiError(503, 'Поддержка временно недоступна')
  return {
    supabaseUrl,
    publishableKey,
    serviceKey,
    telegramBotToken: text(process.env.TELEGRAM_BOT_TOKEN) || undefined,
    telegramOwnerChatId: text(process.env.TELEGRAM_OWNER_CHAT_ID) || undefined,
    telegramWebhookSecret: text(process.env.TELEGRAM_WEBHOOK_SECRET) || undefined,
    fetchImpl,
  }
}

function createAdminClient(config: ServerConfig) {
  return createClient<Database>(config.supabaseUrl, config.serviceKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

async function authenticateUser(request: IncomingMessage, config: ServerConfig, adminClient: SupabaseClient<Database>) {
  const token = bearerToken(request)
  if (!token) throw new SupportApiError(401, 'Войди в аккаунт, чтобы написать в поддержку')

  const authClient = createClient<Database>(config.supabaseUrl, config.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) throw new SupportApiError(401, 'Сессия закончилась. Войди в аккаунт ещё раз')

  const { data: control } = await adminClient
    .from('account_controls')
    .select('is_banned')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (control?.is_banned) throw new SupportApiError(403, 'Аккаунт временно заблокирован')
  return data.user
}

async function loadAccountContext(adminClient: SupabaseClient<Database>, user: User) {
  const [{ data: profile }, { data: wallet }, { data: entries }] = await Promise.all([
    adminClient.from('profiles').select('full_name, grade').eq('id', user.id).maybeSingle(),
    adminClient.from('wallet_accounts').select('balance').eq('user_id', user.id).maybeSingle(),
    adminClient.from('wallet_entries').select('amount, kind, description, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
  ])

  return {
    fullName: profile?.full_name ?? '',
    grade: profile?.grade ?? null,
    balance: wallet?.balance ?? null,
    walletEntries: (entries ?? []).map((entry) => ({
      amount: entry.amount,
      kind: entry.kind,
      description: entry.description,
      createdAt: entry.created_at,
    })),
  }
}

function paymentContext(account: Awaited<ReturnType<typeof loadAccountContext>>) {
  return {
    payment: {
      paymentsConnected: false,
      reviewStatus: 'manual_review_required',
      currentBalance: account.balance,
      recentWalletEntries: account.walletEntries,
      note: 'Платёжный провайдер пока не подключён. Автоматический возврат не выполняется.',
    } as unknown as Json,
  }
}

function sourceKey(chatId: string, messageId: number) {
  return createHash('sha256').update(`${chatId}:${messageId}`).digest('hex')
}

function splitTelegramText(value: string) {
  const chunks: string[] = []
  let remaining = value
  while (remaining.length > telegramChunkSize) {
    let splitAt = remaining.lastIndexOf('\n', telegramChunkSize)
    if (splitAt < 500) splitAt = telegramChunkSize
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, '')
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function safeTelegramId(value: unknown) {
  const candidate = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(candidate) ? String(candidate) : ''
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

async function telegramMessage(config: ServerConfig, textValue: string) {
  if (!config.telegramBotToken || !config.telegramOwnerChatId) throw new Error('telegram configuration missing')
  const telegramResponse = await config.fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegramOwnerChatId, text: textValue, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!telegramResponse.ok) throw new Error(`telegram returned ${telegramResponse.status}`)
  const payload = await telegramResponse.json() as { ok?: boolean; result?: { message_id?: number; chat?: { id?: number } } }
  const messageId = payload.result?.message_id
  if (!payload.ok || typeof messageId !== 'number' || !Number.isSafeInteger(messageId)) throw new Error('telegram response missing message id')
  return { messageId, chatId: safeTelegramId(payload.result?.chat?.id) || config.telegramOwnerChatId }
}

function contextForTelegram(context: Json) {
  try {
    return JSON.stringify(context, null, 2).slice(0, 45_000)
  } catch {
    return '{}'
  }
}

async function notifyOwner(
  adminClient: SupabaseClient<Database>,
  config: ServerConfig,
  conversation: SupportConversation,
  message: SupportMessage,
  user: User,
  account: Awaited<ReturnType<typeof loadAccountContext>>,
) {
  if (!config.telegramBotToken || !config.telegramOwnerChatId) return 'pending' as const

  const notification = [
    `Homework Copilot · ${categoryLabels[conversation.category as SupportCategory]}`,
    `Обращение ${conversation.id}`,
    `Пользователь: ${account.fullName || 'Ученик'} · ${user.email ?? 'без почты'}`,
    `Аккаунт: ${user.id} · класс ${account.grade ?? '—'} · баланс ${account.balance ?? '—'} ₽`,
    `Статус: ${conversation.status}`,
    '',
    `Сообщение пользователя:\n${message.body}`,
    '',
    'Контекст:\n' + contextForTelegram(conversation.context),
    '',
    'Ответь на это сообщение в Telegram — ответ попадёт в этот диалог.',
  ].join('\n')

  try {
    const chunks = splitTelegramText(notification)
    for (const chunk of chunks) {
      const sent = await telegramMessage(config, chunk)
      const { error } = await adminClient.from('support_telegram_message_map').insert({
        telegram_chat_id: Number(sent.chatId),
        telegram_message_id: sent.messageId,
        conversation_id: conversation.id,
        direction: 'outbound',
      })
      if (error) throw error
    }
    return 'sent' as const
  } catch (error) {
    console.error('support telegram delivery failed', error instanceof Error ? error.message : 'unknown error')
    return 'failed' as const
  }
}

async function saveUserMessage(
  adminClient: SupabaseClient<Database>,
  config: ServerConfig,
  user: User,
  payload: SupportPayload,
) {
  const body = boundedText(payload.body, 4000)
  if (!body) throw new SupportApiError(400, 'Напиши сообщение')

  const requestedCategory = category(payload.category)
  const requestedConversationId = boundedText(payload.conversationId, 80)
  let conversation: SupportConversation
  let account = await loadAccountContext(adminClient, user)

  if (requestedConversationId) {
    const { data, error } = await adminClient
      .from('support_conversations')
      .select('*')
      .eq('id', requestedConversationId)
      .eq('user_id', user.id)
      .single()
    if (error || !data) throw new SupportApiError(404, 'Обращение не найдено')
    conversation = data
  } else {
    if (!requestedCategory) throw new SupportApiError(400, 'Выбери тему обращения')
    const context = requestedCategory === 'payment'
      ? { ...sanitizeClientContext(requestedCategory, payload.context), ...paymentContext(account) }
      : sanitizeClientContext(requestedCategory, payload.context)
    const { data, error } = await adminClient
      .from('support_conversations')
      .insert({
        user_id: user.id,
        category: requestedCategory,
        subject: categoryLabels[requestedCategory],
        context,
      })
      .select('*')
      .single()
    if (error || !data) throw new SupportApiError(500, 'Не получилось создать обращение')
    conversation = data
  }

  const { data: message, error: messageError } = await adminClient
    .from('support_messages')
    .insert({ conversation_id: conversation.id, author_type: 'user', author_user_id: user.id, body })
    .select('*')
    .single()
  if (messageError || !message) throw new SupportApiError(500, 'Не получилось сохранить сообщение')

  const { data: updatedConversation, error: updateError } = await adminClient
    .from('support_conversations')
    .update({ status: 'pending_owner', updated_at: new Date().toISOString(), last_message_at: new Date().toISOString(), resolved_at: null })
    .eq('id', conversation.id)
    .select('*')
    .single()
  if (updateError || !updatedConversation) throw new SupportApiError(500, 'Не получилось обновить обращение')

  const deliveryStatus = await notifyOwner(adminClient, config, updatedConversation, message, user, account)
  if (deliveryStatus !== updatedConversation.owner_notification_status) {
    await adminClient
      .from('support_conversations')
      .update({ owner_notification_status: deliveryStatus, updated_at: new Date().toISOString() })
      .eq('id', conversation.id)
  }

  return { conversation: updatedConversation, message, deliveryStatus }
}

export async function handleSupportRequest(request: IncomingMessage, response: ServerResponse, fetchImpl: typeof fetch = fetch) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      responseJson(response, 405, { error: 'method_not_allowed' })
      return
    }
    const config = getConfig(fetchImpl)
    const adminClient = createAdminClient(config)
    const user = await authenticateUser(request, config, adminClient)
    const payload = jsonObject(await readJson(request)) as SupportPayload
    const result = await saveUserMessage(adminClient, config, user, payload)
    responseJson(response, result.deliveryStatus === 'failed' ? 202 : 200, {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      deliveryStatus: result.deliveryStatus,
    })
  } catch (error) {
    const apiError = error instanceof SupportApiError ? error : new SupportApiError(500, 'Не получилось отправить сообщение')
    responseJson(response, apiError.status, { error: apiError.message })
  }
}

type TelegramUpdate = {
  update_id?: unknown
  message?: {
    message_id?: unknown
    text?: unknown
    caption?: unknown
    chat?: { id?: unknown }
    reply_to_message?: { message_id?: unknown }
  }
}

function ignoreTelegramUpdate(response: ServerResponse, reason: string) {
  console.info(`support telegram update ignored: ${reason}`)
  responseJson(response, 200, { ok: true, ignored: true })
}

export async function handleTelegramWebhook(request: IncomingMessage, response: ServerResponse, fetchImpl: typeof fetch = fetch) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      responseJson(response, 405, { error: 'method_not_allowed' })
      return
    }
    const config = getConfig(fetchImpl)
    if (!config.telegramBotToken || !config.telegramOwnerChatId || !config.telegramWebhookSecret) {
      responseJson(response, 503, { error: 'telegram_configuration_missing' })
      return
    }
    const providedSecret = request.headers['x-telegram-bot-api-secret-token']
    if (typeof providedSecret !== 'string' || !secureEqual(providedSecret, config.telegramWebhookSecret)) {
      responseJson(response, 401, { error: 'invalid_webhook_secret' })
      return
    }

    const update = jsonObject(await readJson(request)) as TelegramUpdate
    const message = isRecord(update.message) ? update.message : null
    const chatId = safeTelegramId(jsonObject(message?.chat).id)
    const replyToMessageId = Number(jsonObject(message?.reply_to_message).message_id)
    const messageId = Number(message?.message_id)
    const replyText = boundedText(message?.text ?? message?.caption, 4000)
    if (!message) {
      ignoreTelegramUpdate(response, 'message_missing')
      return
    }
    if (chatId !== config.telegramOwnerChatId) {
      ignoreTelegramUpdate(response, 'owner_chat_mismatch')
      return
    }
    if (!Number.isSafeInteger(replyToMessageId) || replyToMessageId < 1) {
      ignoreTelegramUpdate(response, 'reply_target_missing')
      return
    }
    if (!Number.isSafeInteger(messageId) || messageId < 1) {
      ignoreTelegramUpdate(response, 'message_id_invalid')
      return
    }
    if (!replyText) {
      ignoreTelegramUpdate(response, 'reply_text_missing')
      return
    }

    const adminClient = createAdminClient(config)
    const { data: mapping, error: mappingError } = await adminClient
      .from('support_telegram_message_map')
      .select('conversation_id')
      .eq('telegram_chat_id', Number(chatId))
      .eq('telegram_message_id', replyToMessageId)
      .eq('direction', 'outbound')
      .maybeSingle()
    if (mappingError || !mapping) {
      ignoreTelegramUpdate(response, mappingError ? 'mapping_lookup_failed' : 'mapping_not_found')
      return
    }

    const updateId = Number(update.update_id)
    const dedupeKey = Number.isSafeInteger(updateId) ? `telegram-update:${updateId}` : `telegram-message:${chatId}:${messageId}`
    const { data: ownerMessage, error: ownerMessageError } = await adminClient
      .from('support_messages')
      .insert({
        conversation_id: mapping.conversation_id,
        author_type: 'owner',
        body: replyText,
        source_key: sourceKey(chatId, messageId),
      })
      .select('id')
      .maybeSingle()
    if (ownerMessageError?.code === '23505') {
      responseJson(response, 200, { ok: true, duplicate: true })
      return
    }
    if (ownerMessageError || !ownerMessage) throw ownerMessageError ?? new Error('owner message was not created')

    await adminClient
      .from('support_conversations')
      .update({ status: 'pending_user', updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
      .eq('id', mapping.conversation_id)
    await adminClient.from('support_telegram_message_map').insert({
      telegram_chat_id: Number(chatId),
      telegram_message_id: messageId,
      conversation_id: mapping.conversation_id,
      direction: 'inbound',
    })

    responseJson(response, 200, { ok: true, messageId: ownerMessage.id, dedupeKey })
  } catch (error) {
    const apiError = error instanceof SupportApiError ? error : new SupportApiError(500, 'Webhook processing failed')
    responseJson(response, apiError.status, { error: apiError.message })
  }
}

export { categoryLabels, secureEqual, splitTelegramText }
