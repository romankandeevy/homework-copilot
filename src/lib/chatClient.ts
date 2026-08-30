import { supabase } from './supabase'

/* Типы контракта ИИ-чата. Серверная часть (RPC, таблицы, /api/chat) делается отдельно,
   здесь описан только клиентский доступ к ней. */

export type ChatModel = {
  id: string
  title: string
  description: string
  supportsImages: boolean
  supportsWebSearch: boolean
  maxChargeKopecks: number
  minChargeKopecks: number
}

export type ChatModelsState = {
  enabled: boolean
  models: ChatModel[]
}

export type ChatConversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export type ChatRole = 'user' | 'assistant'
export type ChatMessageStatus = 'streaming' | 'done' | 'failed' | 'cancelled'

export type ChatMessage = {
  id: string
  conversationId: string
  role: ChatRole
  content: string
  attachments: string[]
  modelId: string | null
  status: ChatMessageStatus
  createdAt: string
}

export type ChatCitation = {
  title: string
  url: string
}

export type ChatStreamMeta = {
  generationId: string
  messageId: string
  reservedKopecks: number
}

export type ChatStreamUsage = {
  chargedKopecks: number
  refundedKopecks: number
  balanceKopecks: number
}

export type ChatStreamRequest = {
  conversationId: string
  modelId: string
  text: string
  attachments: string[]
  useWebSearch: boolean
  idempotencyKey: string
}

export type ChatStreamHandlers = {
  onMeta?: (meta: ChatStreamMeta) => void
  onDelta: (text: string) => void
  onCitation?: (citation: ChatCitation) => void
  onUsage?: (usage: ChatStreamUsage) => void
  onDone?: (messageId: string) => void
}

export type ChatStreamOutcome = 'done' | 'cancelled'

export type ChatErrorCode =
  | 'disabled'
  | 'insufficient_funds'
  | 'limit'
  | 'unauthorized'
  | 'network'
  | 'backend_missing'
  | 'unknown'

export class ChatError extends Error {
  readonly code: ChatErrorCode

  constructor(message: string, code: ChatErrorCode = 'unknown') {
    super(message)
    this.name = 'ChatError'
    this.code = code
  }
}

function requireClient() {
  if (!supabase) throw new ChatError('Чат ещё не подключён к серверу', 'backend_missing')
  return supabase
}

/* Признак того, что серверной части чата ещё нет: отсутствует RPC, таблица или маршрут. */
export function isChatBackendMissing(error: unknown) {
  if (error instanceof ChatError) return error.code === 'backend_missing'
  const record = asRecord(error)
  const code = record ? readOptionalString(record, 'code') : null
  if (code && ['PGRST202', 'PGRST205', '42883', '42P01'].includes(code)) return true
  const message = error instanceof Error ? error.message : record ? readOptionalString(record, 'message') ?? '' : ''
  return /could not find the (function|table)|schema cache|bucket not found|relation .+ does not exist/i.test(message)
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readOptionalString(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === 'string' ? value : null
}

function readString(source: Record<string, unknown>, key: string, fallback = '') {
  return readOptionalString(source, key) ?? fallback
}

function readNumber(source: Record<string, unknown>, key: string, fallback = 0) {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function toChatError(error: { message: string; code?: string }): ChatError {
  const message = error.message || 'Не получилось выполнить запрос'
  if (isChatBackendMissing(error)) return new ChatError(message, 'backend_missing')
  return new ChatError(message, chatErrorCodeFromMessage(message))
}

function chatErrorCodeFromMessage(message: string): ChatErrorCode {
  const normalized = message.toLocaleLowerCase('ru-RU')
  if (/не хватает|недостаточно|insufficient|not enough/.test(normalized)) return 'insufficient_funds'
  if (/лимит|слишком часто|слишком много|дождись|limit|too many requests/.test(normalized)) return 'limit'
  if (/отключ|не настроен|временно недоступ|disabled/.test(normalized)) return 'disabled'
  if (/войди|сессия закончилась|заблокирован|unauthorized|jwt/.test(normalized)) return 'unauthorized'
  return 'unknown'
}

function chatErrorCodeFromStatus(status: number): ChatErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 402) return 'insufficient_funds'
  if (status === 429) return 'limit'
  if (status === 503) return 'disabled'
  if (status >= 500) return 'network'
  return 'unknown'
}

export async function listChatModels(): Promise<ChatModelsState> {
  const { data, error } = await requireClient().rpc('list_chat_models')
  if (error) throw toChatError(error)

  const models: ChatModel[] = (data?.models ?? [])
    .filter((model) => Boolean(model?.id))
    .map((model) => ({
      id: model.id,
      title: model.title || model.id,
      description: model.description ?? '',
      supportsImages: Boolean(model.supportsImages),
      supportsWebSearch: Boolean(model.supportsWebSearch),
      maxChargeKopecks: Math.max(0, Math.round(model.maxChargeKopecks ?? 0)),
      minChargeKopecks: Math.max(0, Math.round(model.minChargeKopecks ?? 0)),
    }))

  return { enabled: Boolean(data?.enabled), models }
}

/* Сортируем на клиенте: у нового диалога ещё нет `last_message_at`,
   но он должен оставаться первым в списке. */
export function sortConversations(conversations: ChatConversation[]) {
  return [...conversations].sort((left, right) => {
    const leftTime = Date.parse(left.lastMessageAt ?? left.updatedAt ?? left.createdAt)
    const rightTime = Date.parse(right.lastMessageAt ?? right.updatedAt ?? right.createdAt)
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })
}

export async function listChatConversations(): Promise<ChatConversation[]> {
  const { data, error } = await requireClient()
    .from('chat_conversations')
    .select('id, title, created_at, updated_at, last_message_at')
    .order('updated_at', { ascending: false })
  if (error) throw toChatError(error)

  return sortConversations((data ?? []).map((row) => ({
    id: row.id,
    title: row.title || 'Новый чат',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  })))
}

function messageStatus(value: string): ChatMessageStatus {
  return value === 'streaming' || value === 'failed' || value === 'cancelled' ? value : 'done'
}

export async function listChatMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await requireClient()
    .from('chat_messages')
    .select('id, conversation_id, role, content, attachments, model_id, status, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw toChatError(error)

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: row.content,
    attachments: readStringArray(row.attachments),
    modelId: row.model_id,
    status: messageStatus(row.status),
    createdAt: row.created_at,
  }))
}

export async function createChatConversation(title?: string): Promise<ChatConversation> {
  const { data, error } = await requireClient().rpc('create_chat_conversation', title ? { p_title: title } : {})
  if (error) throw toChatError(error)
  if (!data?.id) throw new ChatError('Не получилось создать чат')

  return {
    id: data.id,
    title: data.title || title || 'Новый чат',
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
    lastMessageAt: null,
  }
}

export async function renameChatConversation(conversationId: string, title: string) {
  const { data, error } = await requireClient()
    .rpc('rename_chat_conversation', { p_conversation_id: conversationId, p_title: title })
  if (error) throw toChatError(error)
  return { id: data?.id ?? conversationId, title: data?.title ?? title }
}

export async function deleteChatConversation(conversationId: string) {
  const { data, error } = await requireClient().rpc('delete_chat_conversation', { p_conversation_id: conversationId })
  if (error) throw toChatError(error)
  return { deleted: Boolean(data?.deleted), messages: data?.messages ?? 0 }
}

export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments'
export const CHAT_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_ATTACHMENT_LIMIT = 4

/* Фото лежат в приватном бакете, в API уходит только путь к файлу.
   RLS пускает пользователя лишь в папку со своим id, поэтому он идёт первым сегментом. */
export async function uploadChatAttachment(file: File, conversationId: string): Promise<string> {
  const client = requireClient()
  const { data } = await client.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new ChatError('Нужно войти в аккаунт', 'unauthorized')

  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${conversationId}/${createIdempotencyKey()}.${extension}`
  const { error } = await client.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (error) throw toChatError(error)
  return path
}

export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function chatApiUrl() {
  const configured = import.meta.env.VITE_CHAT_API_URL as string | undefined
  return configured && configured.trim() ? configured.trim() : '/api/chat'
}

async function accessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export type SseFrame = { event: string; data: string }

/* Разбор SSE: возвращаем целые события и остаток буфера, который ещё не дочитан. */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const frames: SseFrame[] = []

  for (const part of parts) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of part.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    if (dataLines.length > 0 || event !== 'message') frames.push({ event, data: dataLines.join('\n') })
  }

  return { frames, rest }
}

function parseFrameData(frame: SseFrame): Record<string, unknown> | null {
  if (!frame.data) return null
  try {
    return asRecord(JSON.parse(frame.data) as unknown)
  } catch {
    return null
  }
}

function applyFrame(frame: SseFrame, handlers: ChatStreamHandlers) {
  const payload = parseFrameData(frame)

  if (frame.event === 'error') {
    const message = payload ? readString(payload, 'message', 'Генерация не удалась') : 'Генерация не удалась'
    throw new ChatError(message, chatErrorCodeFromMessage(message))
  }

  if (!payload) return

  if (frame.event === 'meta') {
    handlers.onMeta?.({
      generationId: readString(payload, 'generationId'),
      messageId: readString(payload, 'messageId'),
      reservedKopecks: readNumber(payload, 'reservedKopecks'),
    })
    return
  }

  if (frame.event === 'delta') {
    const text = readString(payload, 'text')
    if (text) handlers.onDelta(text)
    return
  }

  if (frame.event === 'citation') {
    const url = readString(payload, 'url')
    if (url) handlers.onCitation?.({ title: readString(payload, 'title', url), url })
    return
  }

  if (frame.event === 'usage') {
    handlers.onUsage?.({
      chargedKopecks: readNumber(payload, 'chargedKopecks'),
      refundedKopecks: readNumber(payload, 'refundedKopecks'),
      balanceKopecks: readNumber(payload, 'balanceKopecks'),
    })
    return
  }

  if (frame.event === 'done') handlers.onDone?.(readString(payload, 'messageId'))
}

async function readResponseError(response: Response) {
  let message = ''
  try {
    const payload = asRecord(JSON.parse(await response.text()) as unknown)
    const nested = payload ? asRecord(payload.error) : null
    message = (payload ? readOptionalString(payload, 'message') ?? readOptionalString(payload, 'error') : null)
      ?? (nested ? readString(nested, 'message') : '')
  } catch {
    message = ''
  }

  // 404 без разбираемого тела — это отсутствующий маршрут, а не ошибка чата.
  const code = response.status === 404 && !message ? 'backend_missing' : chatErrorCodeFromStatus(response.status)
  return new ChatError(message || defaultErrorMessage(code), code)
}

function defaultErrorMessage(code: ChatErrorCode) {
  if (code === 'insufficient_funds') return 'На балансе не хватает денег для этого ответа'
  if (code === 'limit') return 'Превышен лимит запросов. Попробуй чуть позже'
  if (code === 'disabled') return 'Чат временно отключён'
  if (code === 'unauthorized') return 'Нужно войти в аккаунт'
  if (code === 'backend_missing') return 'Сервер чата ещё не подключён'
  return 'Не получилось получить ответ'
}

export async function streamChatMessage(
  request: ChatStreamRequest,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<ChatStreamOutcome> {
  const token = await accessToken()
  if (!token) throw new ChatError('Нужно войти в аккаунт', 'unauthorized')

  let response: Response
  try {
    response = await fetch(chatApiUrl(), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        conversationId: request.conversationId,
        modelId: request.modelId,
        text: request.text,
        attachments: request.attachments,
        useWebSearch: request.useWebSearch,
        idempotencyKey: request.idempotencyKey,
      }),
    })
  } catch (error) {
    if (isAbortError(error)) return 'cancelled'
    throw new ChatError('Нет связи с сервером чата', 'network')
  }

  if (!response.ok) throw await readResponseError(response)

  /* Если маршрута ещё нет, dev-сервер отдаёт HTML вместо потока — это тоже «сервера нет». */
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new ChatError('Потоковый /api/chat ещё не подключён', 'backend_missing')
  }
  if (!response.body) throw new ChatError('Поток ответа недоступен', 'network')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = parseSseFrames(buffer)
      buffer = rest
      for (const frame of frames) applyFrame(frame, handlers)
    }
  } catch (error) {
    if (isAbortError(error) || signal.aborted) return 'cancelled'
    throw error
  } finally {
    void reader.cancel().catch(() => undefined)
  }

  return signal.aborted ? 'cancelled' : 'done'
}
