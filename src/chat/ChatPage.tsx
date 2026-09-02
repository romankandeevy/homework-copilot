import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowClockwise,
  ArrowRight,
  CaretDown,
  ChatsCircle,
  Check,
  CopySimple,
  GlobeSimple,
  ImageSquare,
  Paperclip,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Prohibit,
  SignIn,
  SpinnerGap,
  Stop,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  CHAT_ATTACHMENT_LIMIT,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MIME_TYPES,
  ChatError,
  createIdempotencyKey,
  signChatAttachments,
  sortConversations,
} from '../lib/chatClient'
import type {
  ChatCitation,
  ChatConversation,
  ChatErrorCode,
  ChatMessage,
  ChatModel,
  ChatStreamUsage,
} from '../lib/chatClient'
import { formatKopecks } from '../lib/currency'
import { useModalIsolation } from '../lib/useModalIsolation'
import {
  createConversation,
  isChatMockMode,
  loadChatConversations,
  loadChatMessages,
  loadChatModels,
  removeConversation,
  renameConversation,
  sendChatMessage,
  uploadAttachment,
} from './chatApi'
import ChatMarkup from './ChatMarkup'
import './ChatPage.css'

const MODEL_STORAGE_KEY = 'homework-copilot:chat-model-v1'

/* Начала вопросов на пустом листе: подставляются в поле ввода и ждут продолжения,
   ничего не отправляют сами. */
const CHAT_PROMPT_IDEAS = [
  { label: 'Разобрать задачу по шагам', prompt: 'Разбери задачу по шагам: ' },
  { label: 'Объяснить тему с примером', prompt: 'Объясни тему простыми словами и приведи пример: ' },
  { label: 'Проверить моё решение', prompt: 'Проверь моё решение и найди ошибку: ' },
] as const

type LoadState = 'loading' | 'ready' | 'error'

type PendingAttachment = {
  id: string
  file: File
  previewUrl: string
}

type OutgoingRequest = {
  text: string
  attachments: string[]
  previews: string[]
}

type ChatFailure = {
  code: ChatErrorCode
  message: string
}

type ChatPageProps = {
  userId?: string | null
  onRequireAuth?: () => void
  onOpenWallet?: () => void
}

function failureFrom(error: unknown, fallback: string): ChatFailure {
  if (error instanceof ChatError) return { code: error.code, message: error.message || fallback }
  return { code: 'unknown', message: error instanceof Error && error.message ? error.message : fallback }
}

function messageTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function conversationDate(conversation: ChatConversation) {
  const parsed = new Date(conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function attachmentWord(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  if (last === 1 && lastTwo !== 11) return 'фотография'
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'фотографии'
  return 'фотографий'
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ChatModel[]
  value: string
  onChange: (id: string) => void
  disabled: boolean
}) {
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, models.findIndex((model) => model.id === value))
  const [highlighted, setHighlighted] = useState(selectedIndex)
  const selected = models[selectedIndex]

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (!open) return
    containerRef.current?.querySelector<HTMLElement>(`[data-model-index="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted, open])

  const choose = (index: number) => {
    const model = models[index]
    if (!model) return
    onChange(model.id)
    setHighlighted(index)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) {
        setHighlighted(selectedIndex)
        setOpen(true)
        return
      }
      setHighlighted((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return models.length - 1
        return Math.min(models.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))
      })
      return
    }

    if (event.key === 'Enter' && open && event.target === triggerRef.current) {
      event.preventDefault()
      choose(highlighted)
    }
  }

  return (
    <div
      className="chat-model-select"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="chat-model-trigger"
        type="button"
        role="combobox"
        aria-label={`Модель для ответа: ${selected?.title ?? 'не выбрана'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${highlighted}` : undefined}
        disabled={disabled || models.length === 0}
        onClick={() => {
          setHighlighted(selectedIndex)
          setOpen((current) => !current)
        }}
      >
        <span className="chat-model-trigger-copy">
          <strong>{selected?.title ?? 'Модель недоступна'}</strong>
        </span>
        <CaretDown size={15} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div id={listboxId} className="chat-model-menu" role="listbox" aria-label="Выбрать модель">
          {models.map((model, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={model.id}
              data-model-index={index}
              className={`chat-model-option${index === highlighted ? ' is-highlighted' : ''}`}
              type="button"
              role="option"
              aria-selected={model.id === value}
              tabIndex={-1}
              onClick={() => choose(index)}
              onMouseEnter={() => setHighlighted(index)}
            >
              <span className="chat-model-option-head">
                <strong>{model.title}</strong>
                <span className="chat-model-price">от {formatKopecks(model.minChargeKopecks)}</span>
              </span>
              <span className="chat-model-option-description">{model.description}</span>
              <span className="chat-model-option-tags">
                {model.supportsImages && <span><ImageSquare size={13} weight="bold" aria-hidden="true" />Фото</span>}
                {model.supportsWebSearch && <span><GlobeSimple size={13} weight="bold" aria-hidden="true" />Интернет</span>}
                {model.id === value && <span className="is-current"><Check size={13} weight="bold" aria-hidden="true" />Выбрана</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConversationList({
  conversations,
  status,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onRetry,
}: {
  conversations: ChatConversation[]
  status: LoadState
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (conversation: ChatConversation) => void
  onDelete: (conversation: ChatConversation) => void
  onRetry: () => void
}) {
  if (status === 'loading') return <p className="chat-sidebar-state" role="status">Загружаем диалоги…</p>

  if (status === 'error') {
    return (
      <div className="chat-sidebar-state is-error" role="alert">
        <span>Список диалогов не загрузился.</span>
        <button type="button" onClick={onRetry}>Повторить</button>
      </div>
    )
  }

  if (conversations.length === 0) {
    return <p className="chat-sidebar-state">Диалогов пока нет. Начни новый чат — он появится здесь.</p>
  }

  return (
    <ul className="chat-conversation-list">
      {conversations.map((conversation) => (
        <li key={conversation.id} className={conversation.id === activeId ? 'is-active' : undefined}>
          <button
            className="chat-conversation-open"
            type="button"
            aria-current={conversation.id === activeId ? 'true' : undefined}
            onClick={() => onSelect(conversation.id)}
          >
            <span className="chat-conversation-title">{conversation.title || 'Без названия'}</span>
            <span className="chat-conversation-date">{conversationDate(conversation)}</span>
          </button>
          <span className="chat-conversation-actions">
            <button
              type="button"
              aria-label={`Переименовать чат «${conversation.title || 'Без названия'}»`}
              onClick={() => onRename(conversation)}
            >
              <PencilSimple size={16} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Удалить чат «${conversation.title || 'Без названия'}»`}
              onClick={() => onDelete(conversation)}
            >
              <Trash size={16} weight="bold" aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}

function RenameDialog({
  conversation,
  onSubmit,
  onClose,
  returnFocusRef,
}: {
  conversation: ChatConversation
  onSubmit: (title: string) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose, returnFocusRef)
  const [title, setTitle] = useState(conversation.title)
  const trimmed = title.trim()

  return createPortal(
    <div className="chat-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section ref={dialogRef} className="chat-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-rename-title" tabIndex={-1}>
        <header>
          <h2 id="chat-rename-title">Переименовать чат</h2>
          <button type="button" aria-label="Закрыть переименование" onClick={onClose}><X size={18} weight="bold" aria-hidden="true" /></button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!trimmed) return
            onSubmit(trimmed)
          }}
        >
          <label className="chat-dialog-field" htmlFor="chat-rename-input">
            <span>Название</span>
            <input
              id="chat-rename-input"
              value={title}
              maxLength={80}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <footer>
            <button className="chat-dialog-secondary" type="button" onClick={onClose}>Отмена</button>
            <button className="chat-dialog-primary" type="submit" disabled={!trimmed}>Сохранить</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function DeleteDialog({
  conversation,
  onConfirm,
  onClose,
  returnFocusRef,
}: {
  conversation: ChatConversation
  onConfirm: () => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose, returnFocusRef)

  return createPortal(
    <div className="chat-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section ref={dialogRef} className="chat-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-delete-title" tabIndex={-1}>
        <header>
          <h2 id="chat-delete-title">Удалить чат?</h2>
          <button type="button" aria-label="Закрыть удаление" onClick={onClose}><X size={18} weight="bold" aria-hidden="true" /></button>
        </header>
        <p className="chat-dialog-copy">
          «{conversation.title || 'Без названия'}» и все его сообщения будут удалены без возможности восстановить.
        </p>
        <footer>
          <button className="chat-dialog-secondary" type="button" onClick={onClose}>Отмена</button>
          <button className="chat-dialog-danger" type="button" autoFocus onClick={onConfirm}>Удалить</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      className="chat-message-action"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))
      }}
    >
      {copied ? <Check size={15} weight="bold" aria-hidden="true" /> : <CopySimple size={15} weight="bold" aria-hidden="true" />}
      {copied ? 'Скопировано' : 'Скопировать'}
    </button>
  )
}

export default function ChatPage({ userId = null, onRequireAuth, onOpenWallet }: ChatPageProps) {
  const reduceMotion = useReducedMotion()

  const [models, setModels] = useState<ChatModel[]>([])
  const [chatEnabled, setChatEnabled] = useState(true)
  const [modelsStatus, setModelsStatus] = useState<LoadState>('loading')
  const [mockMode, setMockMode] = useState(isChatMockMode())
  const [selectedModelId, setSelectedModelId] = useState(() => {
    try {
      return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [conversationsStatus, setConversationsStatus] = useState<LoadState>('loading')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesStatus, setMessagesStatus] = useState<LoadState>('ready')
  const [citations, setCitations] = useState<Record<string, ChatCitation[]>>({})
  const [previews, setPreviews] = useState<Record<string, string[]>>({})

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState('')
  const [useWebSearch, setUseWebSearch] = useState(false)

  const [streaming, setStreaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [usage, setUsage] = useState<ChatStreamUsage | null>(null)
  const [failure, setFailure] = useState<ChatFailure | null>(null)
  const [liveStatus, setLiveStatus] = useState('')

  const [renameTarget, setRenameTarget] = useState<ChatConversation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const lastRequestRef = useRef<OutgoingRequest | null>(null)
  const objectUrlsRef = useRef<string[]>([])
  const threadRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const drawerButtonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? models[0] ?? null,
    [models, selectedModelId],
  )
  const requiresAuth = !mockMode && !userId

  const loadModels = useCallback(async () => {
    setModelsStatus('loading')
    try {
      const state = await loadChatModels()
      setModels(state.models)
      setChatEnabled(state.enabled)
      setModelsStatus('ready')
      setMockMode(isChatMockMode())
      setSelectedModelId((current) => (state.models.some((model) => model.id === current) ? current : state.models[0]?.id ?? ''))
    } catch (error) {
      setModelsStatus('error')
      setFailure(failureFrom(error, 'Не получилось загрузить список моделей'))
    }
  }, [])

  const loadConversations = useCallback(async () => {
    setConversationsStatus('loading')
    try {
      const list = await loadChatConversations()
      setConversations(sortConversations(list))
      setConversationsStatus('ready')
      setMockMode(isChatMockMode())
    } catch {
      setConversationsStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (requiresAuth) {
      setConversationsStatus('ready')
      return
    }
    void loadConversations()
  }, [loadConversations, requiresAuth])

  useEffect(() => {
    try {
      if (selectedModelId) window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId)
    } catch {
      // Приватный режим браузера: выбор модели просто не запоминается.
    }
  }, [selectedModelId])

  // Переключатель поиска не должен «залипать» на модели, которая поиск не умеет.
  useEffect(() => {
    if (selectedModel && !selectedModel.supportsWebSearch) setUseWebSearch(false)
  }, [selectedModel])

  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  const openConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId)
    setMessagesStatus('loading')
    setFailure(null)
    setUsage(null)
    try {
      const list = await loadChatMessages(conversationId)
      setMessages(list)
      setMessagesStatus('ready')
      // Ссылки на вложения живут только в текущей вкладке: после перезахода
      // их нужно взять заново, иначе от фотографии остаётся один счётчик.
      const stored = list.filter((message) => message.attachments.length > 0)
      if (stored.length > 0) {
        const signed = await signChatAttachments(stored.flatMap((message) => message.attachments))
        setPreviews((current) => ({
          ...Object.fromEntries(stored.map((message) => [
            message.id,
            message.attachments.map((path) => signed[path]).filter(Boolean),
          ])),
          ...current,
        }))
      }
    } catch (error) {
      setMessagesStatus('error')
      setFailure(failureFrom(error, 'Не получилось открыть диалог'))
    }
  }, [])

  useEffect(() => {
    if (!threadRef.current || !stickToBottomRef.current) return
    const node = threadRef.current
    if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight })
    else node.scrollTop = node.scrollHeight
  }, [messages])

  const runGeneration = useCallback(async (conversationId: string, request: OutgoingRequest, appendUserMessage: boolean) => {
    const model = selectedModel
    if (!model) return

    const controller = new AbortController()
    abortRef.current = controller
    lastRequestRef.current = request

    const localUserId = `local-user-${createIdempotencyKey()}`
    const localAssistantId = `local-assistant-${createIdempotencyKey()}`
    const createdAt = new Date().toISOString()
    let assistantId = localAssistantId

    setFailure(null)
    setUsage(null)
    setStreaming(true)
    setLiveStatus('Модель печатает ответ')
    stickToBottomRef.current = true

    if (appendUserMessage && request.previews.length > 0) {
      setPreviews((current) => ({ ...current, [localUserId]: request.previews }))
    }

    setMessages((current) => [
      ...current,
      ...(appendUserMessage
        ? [{
            id: localUserId,
            conversationId,
            role: 'user' as const,
            content: request.text,
            attachments: request.attachments,
            modelId: model.id,
            status: 'done' as const,
            createdAt,
          }]
        : []),
      {
        id: localAssistantId,
        conversationId,
        role: 'assistant' as const,
        content: '',
        attachments: [],
        modelId: model.id,
        status: 'streaming' as const,
        createdAt,
      },
    ])

    try {
      const outcome = await sendChatMessage(
        {
          conversationId,
          modelId: model.id,
          text: request.text,
          attachments: request.attachments,
          useWebSearch: useWebSearch && model.supportsWebSearch,
          idempotencyKey: createIdempotencyKey(),
        },
        {
          onMeta: (meta) => {
            if (!meta.messageId) return
            const previousId = assistantId
            assistantId = meta.messageId
            setMessages((current) => current.map((item) => (item.id === previousId ? { ...item, id: meta.messageId } : item)))
          },
          onDelta: (text) => {
            setMessages((current) => current.map((item) => (item.id === assistantId ? { ...item, content: item.content + text } : item)))
          },
          onCitation: (citation) => {
            setCitations((current) => ({ ...current, [assistantId]: [...(current[assistantId] ?? []), citation] }))
          },
          onUsage: (value) => setUsage(value),
        },
        controller.signal,
      )

      setMessages((current) => current.map((item) => (
        item.id === assistantId ? { ...item, status: outcome === 'cancelled' ? 'cancelled' : 'done' } : item
      )))
      setLiveStatus(outcome === 'cancelled' ? 'Генерация остановлена' : 'Ответ готов')
      setMockMode(isChatMockMode())
      void loadConversations()

      if (outcome === 'done') {
        // Тихо подтягиваем сохранённую серверную версию, не теряя уже показанный текст.
        try {
          const stored = await loadChatMessages(conversationId)
          setMessages((current) => (stored.length >= current.length ? stored : current))
          // Превью фотографий переносим на серверный id, иначе они пропадут после синхронизации.
          const storedUserMessage = [...stored].reverse().find((item) => item.role === 'user')
          if (appendUserMessage && request.previews.length > 0 && storedUserMessage) {
            setPreviews((current) => ({ ...current, [storedUserMessage.id]: request.previews }))
          }
        } catch {
          // Ответ уже на экране, повторную загрузку можно пропустить.
        }
      }
    } catch (error) {
      const next = failureFrom(error, 'Не получилось получить ответ')
      setFailure(next)
      setLiveStatus(next.message)
      setMessages((current) => current.map((item) => (item.id === assistantId ? { ...item, status: 'failed' } : item)))
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [loadConversations, selectedModel, useWebSearch])

  const startNewChat = useCallback(() => {
    if (streaming) return
    setActiveConversationId(null)
    setMessages([])
    setMessagesStatus('ready')
    setFailure(null)
    setUsage(null)
    lastRequestRef.current = null
    setDrawerOpen(false)
    textareaRef.current?.focus()
  }, [streaming])

  const applyPromptIdea = useCallback((prompt: string) => {
    setDraft(prompt)
    const field = textareaRef.current
    if (!field) return
    field.focus()
    window.requestAnimationFrame(() => field.setSelectionRange(prompt.length, prompt.length))
  }, [])

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const accepted: PendingAttachment[] = []
    let notice = ''

    for (const file of Array.from(files)) {
      if (attachments.length + accepted.length >= CHAT_ATTACHMENT_LIMIT) {
        notice = `Можно прикрепить не больше ${CHAT_ATTACHMENT_LIMIT} фотографий`
        break
      }
      if (!CHAT_ATTACHMENT_MIME_TYPES.includes(file.type)) {
        notice = 'Подойдут фотографии JPEG, PNG, WebP или HEIC'
        continue
      }
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        notice = `«${file.name}» больше 10 МБ`
        continue
      }
      const previewUrl = URL.createObjectURL(file)
      objectUrlsRef.current.push(previewUrl)
      accepted.push({ id: createIdempotencyKey(), file, previewUrl })
    }

    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted])
    setAttachmentNotice(notice)
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
    setAttachmentNotice('')
  }

  const canSend = Boolean(
    chatEnabled
    && selectedModel
    && !requiresAuth
    && !streaming
    && !uploading
    && (draft.trim() || attachments.length > 0),
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend || !selectedModel) return

    const text = draft.trim()
    const pending = attachments
    setDraft('')
    setAttachments([])
    setAttachmentNotice('')

    let conversationId = activeConversationId
    if (!conversationId) {
      try {
        const conversation = await createConversation()
        conversationId = conversation.id
        setConversations((current) => sortConversations([conversation, ...current]))
        setActiveConversationId(conversation.id)
        setConversationsStatus('ready')
      } catch (error) {
        setFailure(failureFrom(error, 'Не получилось создать чат'))
        return
      }
    }

    const targetId = conversationId
    if (!targetId) return

    let uploaded: string[] = []
    if (pending.length > 0) {
      setUploading(true)
      try {
        uploaded = await Promise.all(pending.map((item) => uploadAttachment(item.file, targetId)))
      } catch (error) {
        setFailure(failureFrom(error, 'Не получилось загрузить фотографии'))
        setAttachments(pending)
        setUploading(false)
        return
      }
      setUploading(false)
    }

    await runGeneration(targetId, { text, attachments: uploaded, previews: pending.map((item) => item.previewUrl) }, true)
  }

  const stopGeneration = () => {
    abortRef.current?.abort()
  }

  const retryAnswer = () => {
    const request = lastRequestRef.current
    if (!request || !activeConversationId || streaming) return
    setMessages((current) => {
      const last = current[current.length - 1]
      return last && last.role === 'assistant' && last.status !== 'done' ? current.slice(0, -1) : current
    })
    void runGeneration(activeConversationId, request, false)
  }

  const applyRename = async (title: string) => {
    const target = renameTarget
    setRenameTarget(null)
    if (!target) return
    setConversations((current) => current.map((item) => (item.id === target.id ? { ...item, title } : item)))
    try {
      await renameConversation(target.id, title)
    } catch (error) {
      setFailure(failureFrom(error, 'Не получилось переименовать чат'))
      void loadConversations()
    }
  }

  const applyDelete = async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    setConversations((current) => current.filter((item) => item.id !== target.id))
    if (target.id === activeConversationId) {
      setActiveConversationId(null)
      setMessages([])
    }
    try {
      await removeConversation(target.id)
    } catch (error) {
      setFailure(failureFrom(error, 'Не получилось удалить чат'))
      void loadConversations()
    }
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant') ?? null
  const canRetry = Boolean(lastRequestRef.current && activeConversationId && !streaming)

  const sidebar = (
    <>
      <div className="chat-sidebar-head">
        <h3>Диалоги</h3>
        <button className="chat-new-chat" type="button" onClick={startNewChat} disabled={streaming}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          Новый чат
        </button>
      </div>
      <ConversationList
        conversations={conversations}
        status={conversationsStatus}
        activeId={activeConversationId}
        onSelect={(id) => {
          setDrawerOpen(false)
          void openConversation(id)
        }}
        onRename={setRenameTarget}
        onDelete={setDeleteTarget}
        onRetry={() => { void loadConversations() }}
      />
    </>
  )

  return (
    <section className="chat-page" aria-labelledby="chat-page-title">
      <header className="chat-heading">
        <div className="chat-heading-copy">
          <div className="chat-title-line">
            <h1 id="chat-page-title">ИИ-чат</h1>
            <span>помощник по домашке</span>
          </div>
          <p>
            Задай вопрос текстом или прикрепи фото задачи. Модель выбираешь сам, а списание проходит после ответа и по факту.
          </p>
        </div>
        <button
          ref={drawerButtonRef}
          className="chat-drawer-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <ChatsCircle size={18} weight="bold" aria-hidden="true" />
          Диалоги
        </button>
      </header>

      {mockMode && (
        <p className="chat-demo-banner" role="status">
          Демо-режим: сервер чата ещё не подключён, ответы и списания показываются локально.
        </p>
      )}

      <div className="chat-workspace">
        <aside className="chat-sidebar" aria-label="Список диалогов">{sidebar}</aside>

        <div className="chat-main">
          <div
            className="chat-thread"
            ref={threadRef}
            tabIndex={0}
            aria-label="Переписка"
            onScroll={() => {
              const node = threadRef.current
              if (!node) return
              stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
            }}
          >
            {modelsStatus === 'loading' && <p className="chat-state" role="status">Загружаем чат…</p>}

            {modelsStatus === 'error' && (
              <div className="chat-state is-error" role="alert">
                <WarningCircle size={32} weight="duotone" aria-hidden="true" />
                <strong>Чат не загрузился</strong>
                <p>Проверь соединение и попробуй ещё раз.</p>
                <button type="button" onClick={() => { void loadModels() }}>Повторить</button>
              </div>
            )}

            {modelsStatus === 'ready' && !chatEnabled && (
              <div className="chat-state" role="status">
                <Prohibit size={32} weight="duotone" aria-hidden="true" />
                <strong>Чат временно отключён</strong>
                <p>Мы приостановили ИИ-чат. Деньги за это не списываются — загляни позже.</p>
              </div>
            )}

            {modelsStatus === 'ready' && chatEnabled && requiresAuth && (
              <div className="chat-state" role="status">
                <SignIn size={32} weight="duotone" aria-hidden="true" />
                <strong>Нужен вход</strong>
                <p>ИИ-чат доступен только в аккаунте: там хранятся диалоги и баланс.</p>
                {onRequireAuth && <button type="button" onClick={onRequireAuth}>Войти</button>}
              </div>
            )}

            {modelsStatus === 'ready' && chatEnabled && !requiresAuth && messagesStatus === 'loading' && (
              <p className="chat-state" role="status">Открываем диалог…</p>
            )}

            {modelsStatus === 'ready' && chatEnabled && !requiresAuth && messagesStatus === 'error' && messages.length === 0 && (
              <div className="chat-state is-error" role="alert">
                <WarningCircle size={32} weight="duotone" aria-hidden="true" />
                <strong>Диалог не открылся</strong>
                <p>Повтори попытку — сообщения не потеряны.</p>
                <button type="button" onClick={() => { if (activeConversationId) void openConversation(activeConversationId) }}>Повторить</button>
              </div>
            )}

            {modelsStatus === 'ready' && chatEnabled && !requiresAuth && messagesStatus === 'ready' && messages.length === 0 && (
              <div className="chat-empty">
                <p className="chat-empty-label">Чистый лист</p>
                <h3>Спроси что угодно по домашке</h3>
                <p className="chat-empty-copy">
                  Разберём задачу по шагам, объясним тему или проверим готовое решение.
                  Можно написать текстом или приложить фото.
                </p>
                <ul className="chat-empty-ideas">
                  {CHAT_PROMPT_IDEAS.map((idea) => (
                    <li key={idea.label}>
                      <button type="button" onClick={() => applyPromptIdea(idea.prompt)}>
                        <ArrowRight size={15} weight="bold" aria-hidden="true" />
                        {idea.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="chat-empty-price">
                  {selectedModel
                    ? <>Отвечает {selectedModel.title}. Обычный вопрос — {formatKopecks(selectedModel.minChargeKopecks)}, длинный разбор дороже.</>
                    : 'Модели пока недоступны.'}
                </p>
              </div>
            )}

            {messages.map((message) => {
              const messageCitations = citations[message.id] ?? []
              const messagePreviews = previews[message.id] ?? []
              const isAssistant = message.role === 'assistant'
              const isStreamingMessage = isAssistant && message.status === 'streaming'

              return (
                <article key={message.id} className={`chat-entry is-${message.role}`}>
                  <div className="chat-entry-margin">
                    <span className="chat-entry-time">{messageTime(message.createdAt)}</span>
                  </div>

                  <div className="chat-entry-main">
                    <p className="chat-entry-author">
                      {isAssistant ? models.find((model) => model.id === message.modelId)?.title ?? 'Ответ' : 'Вопрос'}
                    </p>

                    <div
                      className="chat-entry-body"
                      aria-live={isStreamingMessage ? 'polite' : undefined}
                      aria-atomic={isStreamingMessage ? false : undefined}
                    >
                      {isAssistant
                        ? <ChatMarkup text={message.content} />
                        : <p className="chat-user-text">{message.content}</p>}
                      {isStreamingMessage && message.content === '' && <p className="chat-typing">Модель думает…</p>}
                    </div>

                    {messagePreviews.length > 0 && (
                      <ul className="chat-message-photos">
                        {messagePreviews.map((url) => (
                          <li key={url}><img src={url} alt="Прикреплённая фотография задачи" /></li>
                        ))}
                      </ul>
                    )}

                    {messagePreviews.length === 0 && message.attachments.length > 0 && (
                      <p className="chat-message-attachments">
                        <Paperclip size={14} weight="bold" aria-hidden="true" />
                        {message.attachments.length} {attachmentWord(message.attachments.length)}
                      </p>
                    )}

                    {messageCitations.length > 0 && (
                      <div className="chat-citations">
                        <h4>Источники</h4>
                        <ul>
                          {messageCitations.map((citation) => (
                            <li key={citation.url}>
                              <a href={citation.url} target="_blank" rel="noreferrer noopener">{citation.title || citation.url}</a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {message.status === 'cancelled' && <p className="chat-message-note">Генерация остановлена. Списываем только фактический расход.</p>}
                    {message.status === 'failed' && <p className="chat-message-note is-error">Ответ не получен. Деньги за неудачную генерацию не списываются.</p>}

                    {isAssistant && !isStreamingMessage && message.content !== '' && (
                      <footer className="chat-message-actions">
                        <CopyAnswerButton text={message.content} />
                        {message.id === lastAssistant?.id && canRetry && (
                          <button className="chat-message-action" type="button" onClick={retryAnswer}>
                            <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
                            Повторить ответ
                          </button>
                        )}
                      </footer>
                    )}
                  </div>
                </article>
              )
            })}

            {usage && (
              <p className="chat-usage" role="status">
                Списано {formatKopecks(usage.chargedKopecks)}
                {usage.refundedKopecks > 0 && <> · возвращено из резерва {formatKopecks(usage.refundedKopecks)}</>}
                {' '}· баланс {formatKopecks(usage.balanceKopecks)}
              </p>
            )}
          </div>

          {failure && (
            <div className={`chat-failure${failure.code === 'insufficient_funds' || failure.code === 'limit' ? ' is-soft' : ''}`} role="alert">
              <WarningCircle size={18} weight="bold" aria-hidden="true" />
              <span>{failure.message}</span>
              {failure.code === 'insufficient_funds' && onOpenWallet && (
                <button type="button" onClick={onOpenWallet}>Пополнить баланс</button>
              )}
              {failure.code !== 'insufficient_funds' && canRetry && (
                <button type="button" onClick={retryAnswer}>Повторить ответ</button>
              )}
            </div>
          )}

          <form className="chat-composer" onSubmit={(event) => { void submit(event) }}>
            <div className="chat-composer-field">
              {attachments.length > 0 && (
                <ul className="chat-attachment-strip">
                  {attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <img src={attachment.previewUrl} alt={`Фото «${attachment.file.name}»`} />
                      <button
                        type="button"
                        aria-label={`Убрать фото «${attachment.file.name}»`}
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        <X size={13} weight="bold" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="sr-only" htmlFor="chat-input">Вопрос модели</label>
              <textarea
                id="chat-input"
                ref={textareaRef}
                className="chat-input"
                value={draft}
                rows={2}
                maxLength={8000}
                placeholder={chatEnabled ? 'Например: объясни, как решать квадратные уравнения' : 'Чат временно отключён'}
                disabled={!chatEnabled || requiresAuth}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />

              <div className="chat-composer-controls">
                <div className="chat-composer-left">
                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept={CHAT_ATTACHMENT_MIME_TYPES.join(',')}
                    multiple
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      addFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                  <button
                    className="chat-icon-button"
                    type="button"
                    disabled={!chatEnabled || requiresAuth || !selectedModel?.supportsImages || attachments.length >= CHAT_ATTACHMENT_LIMIT}
                    aria-label={selectedModel?.supportsImages
                      ? `Прикрепить фото, до ${CHAT_ATTACHMENT_LIMIT} штук по 10 МБ`
                      : 'Выбранная модель не читает фотографии'}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageSquare size={18} weight="bold" aria-hidden="true" />
                  </button>

                  {selectedModel?.supportsWebSearch && (
                    <label className="chat-web-toggle">
                      <input
                        type="checkbox"
                        checked={useWebSearch}
                        disabled={!chatEnabled || requiresAuth}
                        onChange={(event) => setUseWebSearch(event.target.checked)}
                      />
                      <span><GlobeSimple size={15} weight="bold" aria-hidden="true" />Искать в интернете</span>
                    </label>
                  )}

                  <ModelPicker
                    models={models}
                    value={selectedModel?.id ?? ''}
                    onChange={setSelectedModelId}
                    disabled={!chatEnabled || requiresAuth || streaming}
                  />
                </div>

                <div className="chat-composer-right">
                  {streaming ? (
                    <button className="chat-stop" type="button" onClick={stopGeneration}>
                      <Stop size={16} weight="fill" aria-hidden="true" />
                      Остановить
                    </button>
                  ) : (
                    <button className="chat-send" type="submit" disabled={!canSend}>
                      {uploading
                        ? <SpinnerGap size={16} weight="bold" aria-hidden="true" className="chat-spin" />
                        : <PaperPlaneTilt size={16} weight="fill" aria-hidden="true" />}
                      {uploading ? 'Загружаем фото' : 'Отправить'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {attachmentNotice && <p className="chat-attachment-notice" role="alert">{attachmentNotice}</p>}

            <p className="chat-price-hint">
              {selectedModel
                ? <>Спишем после ответа и по факту: обычный вопрос — {formatKopecks(selectedModel.minChargeKopecks)}. Заранее с баланса ничего не снимаем, а если модель недоступна, списания не будет вовсе.</>
                : 'Модели пока недоступны.'}
            </p>
          </form>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{liveStatus}</p>

      {createPortal(
        <AnimatePresence>
          {drawerOpen && (
            <motion.div
              className="chat-drawer-backdrop"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              onMouseDown={(event) => { if (event.currentTarget === event.target) setDrawerOpen(false) }}
            >
              <ChatDrawer onClose={() => setDrawerOpen(false)} returnFocusRef={drawerButtonRef} reduceMotion={Boolean(reduceMotion)}>
                {sidebar}
              </ChatDrawer>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {renameTarget && (
        <RenameDialog
          conversation={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSubmit={(title) => { void applyRename(title) }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          conversation={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => { void applyDelete() }}
        />
      )}
    </section>
  )
}

function ChatDrawer({
  children,
  onClose,
  returnFocusRef,
  reduceMotion,
}: {
  children: ReactNode
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  reduceMotion: boolean
}) {
  const drawerRef = useModalIsolation<HTMLElement>(true, onClose, returnFocusRef)

  return (
    <motion.aside
      ref={drawerRef}
      className="chat-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Диалоги"
      tabIndex={-1}
      initial={reduceMotion ? false : { x: '-100%' }}
      animate={{ x: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
      transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="chat-drawer-head">
        <button type="button" aria-label="Закрыть список диалогов" onClick={onClose}>
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      {children}
    </motion.aside>
  )
}
