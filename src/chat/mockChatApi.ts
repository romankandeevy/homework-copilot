import { createIdempotencyKey } from '../lib/chatClient'
import type {
  ChatConversation,
  ChatMessage,
  ChatModelsState,
  ChatStreamHandlers,
  ChatStreamOutcome,
  ChatStreamRequest,
} from '../lib/chatClient'

/* Демо-сервер чата: работает, пока настоящие RPC, таблицы и /api/chat не подключены.
   Хранит диалоги только в памяти вкладки и повторяет контракт событий SSE. */

const models: ChatModelsState = {
  enabled: true,
  models: [
    {
      id: 'gemini-3-7-flash',
      title: 'Gemini 3.7 Flash',
      description: 'Дешёвая и быстрая: короткие вопросы, проверка формул, черновики.',
      supportsImages: true,
      supportsWebSearch: true,
      maxChargeKopecks: 120,
      minChargeKopecks: 20,
    },
    {
      id: 'gpt-5-6-luna',
      title: 'GPT-5.6 Luna',
      description: 'Быстрая универсальная модель для повседневных задач.',
      supportsImages: false,
      supportsWebSearch: true,
      maxChargeKopecks: 250,
      minChargeKopecks: 20,
    },
    {
      id: 'gemini-3-1-pro',
      title: 'Gemini 3.1 Pro',
      description: 'Сильная мультимодальная: разбирает фото задачи и чертежи.',
      supportsImages: true,
      supportsWebSearch: true,
      maxChargeKopecks: 640,
      minChargeKopecks: 20,
    },
    {
      id: 'gpt-5-6-terra',
      title: 'GPT-5.6 Terra',
      description: 'Сбалансированная по цене и качеству, длинные объяснения.',
      supportsImages: true,
      supportsWebSearch: false,
      maxChargeKopecks: 480,
      minChargeKopecks: 20,
    },
    {
      id: 'claude-sonnet-5',
      title: 'Claude Sonnet 5',
      description: 'Премиальная модель для сложных и многошаговых разборов.',
      supportsImages: true,
      supportsWebSearch: true,
      maxChargeKopecks: 1200,
      minChargeKopecks: 20,
    },
  ],
}

type MockState = {
  conversations: ChatConversation[]
  messages: ChatMessage[]
  balanceKopecks: number
}

const state: MockState = {
  conversations: [],
  messages: [],
  balanceKopecks: 45000,
}

function nowIso() {
  return new Date().toISOString()
}

function clone<T>(value: T[]): T[] {
  return value.map((item) => ({ ...item }))
}

function titleFromText(text: string) {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return 'Новый чат'
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line
}

export async function mockListChatModels(): Promise<ChatModelsState> {
  return { enabled: models.enabled, models: clone(models.models) }
}

export async function mockListConversations(): Promise<ChatConversation[]> {
  return clone(state.conversations)
}

export async function mockListMessages(conversationId: string): Promise<ChatMessage[]> {
  return clone(state.messages.filter((message) => message.conversationId === conversationId))
}

export async function mockCreateConversation(title?: string): Promise<ChatConversation> {
  const createdAt = nowIso()
  const conversation: ChatConversation = {
    id: `mock-${createIdempotencyKey()}`,
    title: title?.trim() || 'Новый чат',
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: null,
  }
  state.conversations = [conversation, ...state.conversations]
  return { ...conversation }
}

export async function mockRenameConversation(conversationId: string, title: string) {
  state.conversations = state.conversations.map((conversation) => (
    conversation.id === conversationId ? { ...conversation, title, updatedAt: nowIso() } : conversation
  ))
  return { id: conversationId, title }
}

export async function mockDeleteConversation(conversationId: string) {
  const messages = state.messages.filter((message) => message.conversationId === conversationId).length
  state.conversations = state.conversations.filter((conversation) => conversation.id !== conversationId)
  state.messages = state.messages.filter((message) => message.conversationId !== conversationId)
  return { deleted: true, messages }
}

export async function mockUploadAttachment(file: File, conversationId: string) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  return `mock/${conversationId}/${createIdempotencyKey()}.${extension}`
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function mockAnswer(request: ChatStreamRequest) {
  const question = request.text.trim() || 'Задача без текста'
  const photos = request.attachments.length
  const lines = [
    `Разберём по шагам: **${titleFromText(question)}**`,
    '',
    'Что делаем:',
    '',
    '1. Выписываем данные и то, что нужно найти.',
    '2. Подбираем формулу или правило, которое связывает данные с ответом.',
    '3. Считаем аккуратно и проверяем размерность.',
    '',
  ]

  if (photos > 0) lines.push(`Фотографий получено: ${photos}. Условие с них уже учтено в разборе.`, '')
  if (request.useWebSearch) lines.push('Проверил формулировку по открытым источникам — ссылки под ответом.', '')

  lines.push(
    'Короткий пример записи решения:',
    '',
    '```',
    'Дано: a = 12, b = 5',
    'Найти: c',
    'c = sqrt(a^2 + b^2) = 13',
    '```',
    '',
    'Это демонстрационный ответ: сервер чата ещё не подключён, текст собран локально.',
  )

  return lines.join('\n')
}

export async function mockStreamChatMessage(
  request: ChatStreamRequest,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<ChatStreamOutcome> {
  const model = models.models.find((item) => item.id === request.modelId) ?? models.models[0]
  const assistantId = `mock-message-${createIdempotencyKey()}`

  state.messages.push({
    id: `mock-message-${createIdempotencyKey()}`,
    conversationId: request.conversationId,
    role: 'user',
    content: request.text,
    attachments: request.attachments,
    modelId: model.id,
    status: 'done',
    createdAt: nowIso(),
  })

  const assistant: ChatMessage = {
    id: assistantId,
    conversationId: request.conversationId,
    role: 'assistant',
    content: '',
    attachments: [],
    modelId: model.id,
    status: 'streaming',
    createdAt: nowIso(),
  }
  state.messages.push(assistant)

  // Автозаголовок демо-диалога берём из первого сообщения пользователя.
  state.conversations = state.conversations.map((conversation) => (
    conversation.id === request.conversationId
      ? {
          ...conversation,
          title: conversation.title === 'Новый чат' ? titleFromText(request.text) : conversation.title,
          updatedAt: nowIso(),
          lastMessageAt: nowIso(),
        }
      : conversation
  ))

  handlers.onMeta?.({
    generationId: `mock-generation-${createIdempotencyKey()}`,
    messageId: assistantId,
    reservedKopecks: model.maxChargeKopecks,
  })

  const chunks = mockAnswer(request).match(/\S+\s*|\s+/g) ?? []

  // Пауза между кусками изображает поток ответа — она и есть смысл цикла.
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    await delay(18, signal)
    if (signal.aborted) {
      assistant.status = 'cancelled'
      return 'cancelled'
    }
    assistant.content += chunk
    handlers.onDelta(chunk)
  }

  if (request.useWebSearch) {
    handlers.onCitation?.({ title: 'Алгебра — справочник формул', url: 'https://ru.wikipedia.org/wiki/Алгебра' })
    handlers.onCitation?.({ title: 'Теорема Пифагора', url: 'https://ru.wikipedia.org/wiki/Теорема_Пифагора' })
  }

  const chargedKopecks = Math.max(1, Math.round(model.maxChargeKopecks * 0.42))
  state.balanceKopecks = Math.max(0, state.balanceKopecks - chargedKopecks)
  handlers.onUsage?.({
    chargedKopecks,
    refundedKopecks: Math.max(0, model.maxChargeKopecks - chargedKopecks),
    balanceKopecks: state.balanceKopecks,
  })

  assistant.status = 'done'
  handlers.onDone?.(assistantId)
  return 'done'
}
