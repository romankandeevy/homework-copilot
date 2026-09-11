/* Рабочее место поддержки: входящие, переписка и карточка ученика.

   Чтение и запись - только через admin_support_* RPC. Живость - Realtime:
   агенту со вторым фактором RLS открывает таблицы обращений, поэтому
   postgres_changes доходят сюда напрямую. «Печатает» идёт широковещанием
   по каналу support-typing:<id> - его же слушает окно поддержки ученика. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Bell,
  BellRinging,
  ChatCircleText,
  Check,
  Checks,
  Clock,
  FileText,
  Gift,
  NotePencil,
  PaperPlaneTilt,
  Paperclip,
  PencilSimple,
  Plus,
  Star,
  Trash,
  UserCircle,
  UserPlus,
} from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { keyed } from '../../lib/listKeys'
import { supabase } from '../../lib/supabase'
import {
  adminErrorMessage,
  adminRpc,
  arr,
  bool,
  formatDate,
  formatDateTime,
  formatDuration,
  formatKopecks,
  formatNumber,
  isRecord,
  num,
  numOrNull,
  obj,
  relativeTime,
  rows,
  str,
  strOrNull,
} from '../api'
import type { Row } from '../api'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  JsonView,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Segmented,
  useAction,
  useAsync,
  useQueryState,
  useToast,
} from '../ui'
import type { Tone } from '../ui'
import { useAdmin } from '../context'
import './support.css'

const PAGE_SIZE = 30
const TYPING_SEND_MS = 2000
const TYPING_SHOW_MS = 4000
const APPROVAL_PHRASE = 'да это хорошая идея'

const statusFilterOptions = [
  { value: 'open', label: 'Открытые' },
  { value: 'pending_owner', label: 'Ждут ответа' },
  { value: 'pending_user', label: 'Ждут ученика' },
  { value: 'resolved', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
]

const statusLabels: Record<string, string> = { pending_owner: 'Ждёт ответа', pending_user: 'Ждём ученика', resolved: 'Закрыто' }
const statusTones: Record<string, Tone> = { pending_owner: 'warning', pending_user: 'info', resolved: 'success' }
const priorityOrder = ['urgent', 'high', 'normal', 'low']
const priorityLabels: Record<string, string> = { urgent: 'Срочный', high: 'Высокий', normal: 'Обычный', low: 'Низкий' }
const priorityTones: Record<string, Tone> = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' }
const categoryLabels: Record<string, string> = { general: 'Общий вопрос', payment: 'Оплата и баланс', feature: 'Идея', wrong_solution: 'Неверное решение' }
const taskStatusLabels: Record<string, string> = { queued: 'В очереди', running: 'Решается', done: 'Готово', failed: 'Ошибка' }
const taskStatusTones: Record<string, Tone> = { queued: 'neutral', running: 'info', done: 'success', failed: 'danger' }
const riskLabels: Record<string, string> = { high: 'высокий риск', medium: 'средний риск', low: 'низкий риск' }
const riskTones: Record<string, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' }

/* ---------- Данные ---------- */

type Agent = { id: string; email: string; role: string }

type InboxItem = {
  id: string
  userId: string
  email: string
  fullName: string
  category: string
  subject: string
  status: string
  priority: string
  assignedTo: string | null
  assignedEmail: string | null
  lastMessageAt: string
  lastUserMessageAt: string | null
  rating: number | null
  lastMessage: string
  lastAuthor: string
  unread: number
}

type Inbox = { total: number; slaMinutes: number; agents: Agent[]; items: InboxItem[] }

type ThreadConversation = {
  id: string
  category: string
  subject: string
  status: string
  priority: string
  assignedTo: string | null
  userLastReadAt: string | null
  lastUserMessageAt: string | null
  createdAt: string
  rating: number | null
  ratingComment: string | null
  ratedAt: string | null
  slaMinutes: number
  context: Row
}

type ThreadMessage = { id: string; authorType: 'user' | 'owner'; authorEmail: string | null; body: string; createdAt: string }
type ThreadNote = { id: string; body: string; attachment: Row | null; authorEmail: string | null; createdAt: string }
type ThreadUser = { id: string; email: string; fullName: string; grade: string; balance: number; planTitle: string; isBanned: boolean; createdAt: string }
type RecentTask = { key: string; subject: string; task: string; preview: string; status: string; error: string | null; createdAt: string; logId: string | null }
type Template = { id: string; title: string; body: string }

type Thread = {
  conversation: ThreadConversation
  messages: ThreadMessage[]
  notes: ThreadNote[]
  user: ThreadUser | null
  recentTasks: RecentTask[]
  flags: { ruleId: string; risk: string; explanation: string; status: string }[]
  walletEntries: { id: string; amount: number; description: string; createdAt: string }[]
  ideaApproval: { status: string; credited: boolean }
  templates: Template[]
}

function parseInbox(value: Json): Inbox {
  const source = obj(value)
  return {
    total: num(source.total),
    slaMinutes: num(source.slaMinutes, 30),
    agents: rows(source.agents).map((row) => ({ id: str(row.id), email: str(row.email), role: str(row.role) })),
    items: rows(source.items).map((row): InboxItem => ({
      id: str(row.id),
      userId: str(row.userId),
      email: str(row.email),
      fullName: str(row.fullName),
      category: str(row.category, 'general'),
      subject: str(row.subject, 'Обращение'),
      status: str(row.status, 'pending_owner'),
      priority: str(row.priority, 'normal'),
      assignedTo: strOrNull(row.assignedTo),
      assignedEmail: strOrNull(row.assignedEmail),
      lastMessageAt: str(row.lastMessageAt),
      lastUserMessageAt: strOrNull(row.lastUserMessageAt),
      rating: numOrNull(row.rating),
      lastMessage: str(row.lastMessage),
      lastAuthor: str(row.lastAuthor),
      unread: num(row.unread),
    })),
  }
}

function gradeText(value: Json | undefined) {
  if (typeof value === 'number') return String(value)
  return str(value)
}

function parseThread(value: Json): Thread | null {
  const source = obj(value)
  // conversation - это to_jsonb строки таблицы, поэтому ключи в snake_case.
  const conversation = obj(source.conversation)
  const id = str(conversation.id)
  if (!id) return null
  const user = isRecord(source.user) ? source.user : null
  const approval = obj(source.ideaApproval)
  return {
    conversation: {
      id,
      category: str(conversation.category, 'general'),
      subject: str(conversation.subject, 'Обращение'),
      status: str(conversation.status, 'pending_owner'),
      priority: str(conversation.priority, 'normal'),
      assignedTo: strOrNull(conversation.assigned_to),
      userLastReadAt: strOrNull(conversation.user_last_read_at),
      lastUserMessageAt: strOrNull(conversation.last_user_message_at),
      createdAt: str(conversation.created_at),
      rating: numOrNull(conversation.rating),
      ratingComment: strOrNull(conversation.rating_comment),
      ratedAt: strOrNull(conversation.rated_at),
      slaMinutes: num(conversation.slaMinutes, 30),
      context: obj(conversation.context),
    },
    messages: rows(source.messages).map((row): ThreadMessage => ({
      id: str(row.id),
      authorType: str(row.authorType) === 'owner' ? 'owner' : 'user',
      authorEmail: strOrNull(row.authorEmail),
      body: str(row.body),
      createdAt: str(row.createdAt),
    })),
    notes: rows(source.notes).map((row): ThreadNote => ({
      id: str(row.id),
      body: str(row.body),
      attachment: isRecord(row.attachment) ? row.attachment : null,
      authorEmail: strOrNull(row.authorEmail),
      createdAt: str(row.createdAt),
    })),
    user: user ? {
      id: str(user.id),
      email: str(user.email),
      fullName: str(user.fullName),
      grade: gradeText(user.grade),
      balance: num(user.balance),
      planTitle: str(user.planTitle),
      isBanned: bool(user.isBanned),
      createdAt: str(user.createdAt),
    } : null,
    recentTasks: rows(source.recentTasks).map((row): RecentTask => ({
      key: str(row.key),
      subject: str(row.subject),
      task: str(row.task),
      preview: str(row.preview),
      status: str(row.status),
      error: strOrNull(row.error),
      createdAt: str(row.createdAt),
      logId: strOrNull(row.logId),
    })),
    flags: rows(source.flags).map((row) => ({ ruleId: str(row.ruleId), risk: str(row.risk), explanation: str(row.explanation), status: str(row.status) })),
    walletEntries: rows(source.walletEntries).map((row) => ({ id: str(row.id), amount: num(row.amount), description: str(row.description), createdAt: str(row.createdAt) })),
    ideaApproval: { status: str(approval.status, 'pending'), credited: bool(approval.credited) },
    templates: rows(source.templates).map((row) => ({ id: str(row.id), title: str(row.title), body: str(row.body) })),
  }
}

/* ---------- Помощники ---------- */

function timeOf(value: string | null | undefined) {
  if (!value) return Number.NaN
  return new Date(value).getTime()
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function waitingMinutes(status: string, lastUserMessageAt: string | null, now: number) {
  if (status !== 'pending_owner') return null
  const started = timeOf(lastUserMessageAt)
  if (!Number.isFinite(started)) return null
  return Math.max(0, Math.floor((now - started) / 60_000))
}

// Зеркало private.normalize_support_idea_approval: та же чистка, что в базе.
function normalizeApproval(value: string) {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/[^a-z0-9а-я\s]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function ideaDecision(thread: Thread): 'approved' | 'rejected' | 'pending' {
  if (thread.ideaApproval.status === 'rejected') return 'rejected'
  if (thread.ideaApproval.status === 'approved') return 'approved'
  // admin_support_thread читает решение только из таблицы решений, а её
  // пишет лишь кнопка в Telegram. Ответ фразой одобрения база при начислении
  // тоже принимает (admin_credit_feature_balance), поэтому смотрим и в
  // переписку - иначе после ответа из админки форма не открылась бы.
  return thread.messages.some((message) => message.authorType === 'owner' && normalizeApproval(message.body) === APPROVAL_PHRASE)
    ? 'approved'
    : 'pending'
}

function fillTemplate(body: string, thread: Thread | null) {
  const user = thread?.user
  const lastTask = thread?.recentTasks[0]
  const values: Record<string, string> = {
    name: user ? (user.fullName.trim() || user.email) : '',
    email: user?.email ?? '',
    balance: user ? formatKopecks(user.balance) : '',
    lastTask: lastTask ? clip(lastTask.preview || lastTask.task || lastTask.subject, 120) : '',
  }
  return body.replace(/\{\{\s*(name|email|balance|lastTask)\s*\}\}/g, (_match, key: string) => values[key] ?? '')
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/* Звук без файлов: короткий двухтоновый сигнал через WebAudio. */
function audioContext(ref: { current: AudioContext | null }) {
  if (ref.current) return ref.current
  const Context: typeof AudioContext | undefined = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return null
  ref.current = new Context()
  return ref.current
}

function playBeep(ref: { current: AudioContext | null }) {
  const context = audioContext(ref)
  if (!context) return
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  const start = context.currentTime + 0.01
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, start)
  oscillator.frequency.setValueAtTime(1175, start + 0.1)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + 0.34)
}

/* Канал «печатает». Имя топика общее с окном ученика, поэтому клиент
   Supabase отдаёт уже существующий канал с тем же именем: если прошлый
   ещё закрывается (повторное монтирование), подписка на него молча не
   сработает. Старый канал снимаем до создания нового. */
function useSupportTyping(conversationId: string | null) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const [peer, setPeer] = useState<{ id: string; at: number } | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client || !conversationId) return
    const topic = `support-typing:${conversationId}`
    let cancelled = false
    let channel: RealtimeChannel | null = null
    const open = async () => {
      const stale = client.getChannels().find((item) => item.topic === `realtime:${topic}`)
      if (stale) await client.removeChannel(stale)
      if (cancelled) return
      channel = client
        .channel(topic)
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const from = isRecord(payload as Json) ? (payload as Row).from : undefined
          if (from === 'user') setPeer({ id: conversationId, at: Date.now() })
        })
        .subscribe()
      channelRef.current = channel
    }
    void open()
    return () => {
      cancelled = true
      channelRef.current = null
      if (channel) void client.removeChannel(channel)
    }
  }, [conversationId])

  useEffect(() => {
    if (!peer) return
    const timer = window.setTimeout(() => setPeer(null), Math.max(0, TYPING_SHOW_MS - (Date.now() - peer.at)))
    return () => window.clearTimeout(timer)
  }, [peer])

  const notifyTyping = useCallback(() => {
    const channel = channelRef.current
    const now = Date.now()
    if (!channel || now - lastSentRef.current < TYPING_SEND_MS) return
    lastSentRef.current = now
    void channel.send({ type: 'broadcast', event: 'typing', payload: { from: 'owner', at: now } })
  }, [])

  const clearPeer = useCallback(() => setPeer(null), [])

  return { peerTyping: peer !== null && peer.id === conversationId, notifyTyping, clearPeer }
}

/* ---------- Раздел ---------- */

export default function SupportSection() {
  const { access, openUser, refreshSignals } = useAdmin()
  const [query, setQuery] = useQueryState({ s_status: 'open', s_assignee: 'all', s_priority: 'all', s_q: '', s_page: '1', conversation: '' })
  const conversationId = query.conversation
  const page = Math.max(1, Math.floor(Number(query.s_page)) || 1)
  const now = useNow(30_000)
  const [mobileView, setMobileView] = useState<'inbox' | 'thread' | 'card'>(query.conversation ? 'thread' : 'inbox')
  const view = conversationId ? mobileView : 'inbox'
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [logId, setLogId] = useState<string | null>(null)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))

  const refreshSignalsRef = useRef(refreshSignals)
  refreshSignalsRef.current = refreshSignals

  // Поиск уходит в адрес с задержкой, чтобы не звать базу на каждую букву.
  const [searchDraft, setSearchDraft] = useState(query.s_q)
  const appliedSearch = useRef(query.s_q)
  appliedSearch.current = query.s_q
  useEffect(() => {
    if (searchDraft.trim() === appliedSearch.current) return
    const timer = window.setTimeout(() => setQuery({ s_q: searchDraft.trim(), s_page: '1' }, { replace: true }), 350)
    return () => window.clearTimeout(timer)
  }, [searchDraft, setQuery])

  const inbox = useAsync(() => adminRpc<Json>('admin_support_inbox', {
    p_status: query.s_status,
    p_assignee: query.s_assignee === 'all' ? null : query.s_assignee,
    p_priority: query.s_priority === 'all' ? null : query.s_priority,
    p_search: query.s_q,
    p_page: page,
    p_page_size: PAGE_SIZE,
  }).then(parseInbox), [query.s_status, query.s_assignee, query.s_priority, query.s_q, page])
  const reloadInbox = inbox.reload

  /* ---------- Переписка ---------- */

  const [thread, setThread] = useState<Thread | null>(null)
  const [threadError, setThreadError] = useState('')
  const threadTicket = useRef(0)
  const shownThreadId = useRef('')

  const loadThread = useCallback(async (id: string, silent = false) => {
    const ticket = ++threadTicket.current
    if (!silent) setThreadError('')
    try {
      const parsed = parseThread(await adminRpc<Json>('admin_support_thread', { p_conversation_id: id }))
      if (ticket !== threadTicket.current) return
      if (parsed) {
        shownThreadId.current = parsed.conversation.id
        setThread(parsed)
      } else {
        setThreadError('Обращение не найдено.')
      }
    } catch (failure) {
      if (ticket !== threadTicket.current) return
      // Тихое обновление открытой переписки не ломает экран ошибкой.
      if (!silent || shownThreadId.current !== id) setThreadError(failure instanceof Error ? failure.message : 'Не получилось загрузить обращение.')
    }
  }, [])

  const markRead = useCallback((id: string) => {
    void adminRpc('admin_support_mark_read', { p_conversation_id: id }).then(() => refreshSignalsRef.current(), () => undefined)
  }, [])

  useEffect(() => {
    if (!conversationId) return
    void loadThread(conversationId)
    markRead(conversationId)
  }, [conversationId, loadThread, markRead])

  const activeThread = thread && thread.conversation.id === conversationId ? thread : null

  /* ---------- Обновления ---------- */

  const timers = useRef({ inbox: 0, thread: 0 })
  const scheduleInbox = useCallback(() => {
    window.clearTimeout(timers.current.inbox)
    timers.current.inbox = window.setTimeout(reloadInbox, 500)
  }, [reloadInbox])
  const scheduleThread = useCallback((id: string) => {
    window.clearTimeout(timers.current.thread)
    timers.current.thread = window.setTimeout(() => { void loadThread(id, true) }, 250)
  }, [loadThread])
  useEffect(() => {
    const pending = timers.current
    return () => {
      window.clearTimeout(pending.inbox)
      window.clearTimeout(pending.thread)
    }
  }, [])

  const afterChange = useCallback(() => {
    if (conversationId) void loadThread(conversationId, true)
    scheduleInbox()
    refreshSignalsRef.current()
  }, [conversationId, loadThread, scheduleInbox])

  const typing = useSupportTyping(conversationId || null)

  const openConversation = useCallback((id: string) => {
    setQuery({ conversation: id })
    setMobileView('thread')
  }, [setQuery])

  /* ---------- Звук и уведомления ---------- */

  const audioRef = useRef<AudioContext | null>(null)
  useEffect(() => {
    // Браузер пускает звук только после жеста: контекст заводим на первом касании.
    const unlock = () => {
      const context = audioContext(audioRef)
      if (context?.state === 'suspended') void context.resume().catch(() => undefined)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      const context = audioRef.current
      audioRef.current = null
      if (context) void context.close().catch(() => undefined)
    }
  }, [])

  const inboxItemsRef = useRef<InboxItem[]>([])
  inboxItemsRef.current = inbox.data?.items ?? []

  const showNotification = (target: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
    const item = inboxItemsRef.current.find((entry) => entry.id === target)
    try {
      const notification = new Notification(item ? `Поддержка: ${item.fullName || item.email}` : 'Новое сообщение в поддержке', {
        body: clip(body, 180),
        tag: `support-${target}`,
      })
      notification.onclick = () => {
        window.focus()
        if (target) openConversation(target)
        notification.close()
      }
    } catch {
      // Мобильный Chrome требует service worker для уведомлений - там только звук.
    }
  }

  const requestNotifications = () => {
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission().then(setPermission)
  }

  /* ---------- Realtime ---------- */

  const conversationRef = useRef(conversationId)
  conversationRef.current = conversationId
  const pendingRead = useRef(false)

  const onRealtime = useRef<(kind: 'message' | 'conversation', row: Record<string, unknown>) => void>(() => undefined)
  onRealtime.current = (kind, row) => {
    scheduleInbox()
    const current = conversationRef.current
    if (kind === 'conversation') {
      if (current && row.id === current) scheduleThread(current)
      return
    }
    const target = typeof row.conversation_id === 'string' ? row.conversation_id : ''
    const fromUser = row.author_type === 'user'
    if (current && target === current) {
      scheduleThread(current)
      if (fromUser) {
        typing.clearPeer()
        // Прочитанным считаем только то, что было на экране.
        if (document.visibilityState === 'visible') markRead(current)
        else pendingRead.current = true
      }
    }
    if (!fromUser) return
    refreshSignalsRef.current()
    playBeep(audioRef)
    showNotification(target, typeof row.body === 'string' ? row.body : '')
  }

  useEffect(() => {
    const client = supabase
    if (!client) return
    // Своё имя на каждое монтирование: канал с тем же именем клиент отдал
    // бы повторно, и добавить к нему обработчики после subscribe нельзя.
    const channel = client
      .channel(`admin-support-desk-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        onRealtime.current('message', payload.new)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, (payload) => {
        onRealtime.current('conversation', { ...payload.old, ...payload.new })
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !pendingRead.current || !conversationRef.current) return
      pendingRead.current = false
      markRead(conversationRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [markRead])

  /* ---------- Отрисовка ---------- */

  if (!supabase) {
    return (
      <>
        <PageHeader title="Поддержка" />
        <ErrorState message="Подключение к базе не настроено: обращения недоступны." />
      </>
    )
  }

  const inboxData = inbox.data
  const inboxSla = inboxData?.slaMinutes ?? 30
  const items = inboxData?.items ?? []
  const unreadTotal = items.reduce((sum, item) => sum + item.unread, 0)
  const overdueTotal = items.filter((item) => {
    const waiting = waitingMinutes(item.status, item.lastUserMessageAt, now)
    return waiting !== null && waiting >= inboxSla
  }).length
  const inboxItem = items.find((item) => item.id === conversationId) ?? null
  const draft = conversationId ? drafts[conversationId] ?? '' : ''
  const setDraft = (value: string) => {
    if (conversationId) setDrafts((current) => ({ ...current, [conversationId]: value }))
  }
  const filtered = query.s_status !== 'open' || query.s_assignee !== 'all' || query.s_priority !== 'all' || query.s_q !== ''

  const notificationControl = permission === 'default'
    ? <Button size="sm" icon={<Bell size={16} weight="bold" aria-hidden="true" />} onClick={requestNotifications}>Включить уведомления</Button>
    : permission === 'granted'
      ? <Badge tone="success" title="Покажем уведомление, когда вкладка в фоне"><BellRinging size={13} weight="bold" aria-hidden="true" /> Уведомления включены</Badge>
      : permission === 'denied'
        ? <Badge title="Разреши уведомления для сайта в настройках браузера">Уведомления запрещены</Badge>
        : null

  return (
    <>
      <PageHeader
        title="Поддержка"
        description={inboxData
          ? `В выборке ${formatNumber(inboxData.total)} · непрочитанных сообщений ${formatNumber(unreadTotal)} · просрочено по SLA ${formatNumber(overdueTotal)} · SLA первого ответа ${inboxSla} мин`
          : 'Обращения учеников в реальном времени.'}
        actions={(
          <>
            {notificationControl}
            <Button
              size="sm"
              icon={<FileText size={16} weight="bold" aria-hidden="true" />}
              onClick={() => setTemplatesOpen(true)}
              title="Шаблоны быстрых ответов"
            >
              Шаблоны
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />}
              onClick={() => {
                reloadInbox()
                if (conversationId) void loadThread(conversationId, true)
              }}
            >
              Обновить
            </Button>
          </>
        )}
      />

      <div className="sup-desk" data-view={view}>
        <InboxPane
          inbox={inboxData}
          loading={inbox.loading}
          error={inbox.error}
          onRetry={reloadInbox}
          filters={query}
          filtered={filtered}
          onFilter={(patch) => setQuery({ ...patch, s_page: '1' })}
          search={searchDraft}
          onSearch={setSearchDraft}
          selectedId={conversationId}
          onSelect={openConversation}
          now={now}
          page={page}
          onPage={(next) => setQuery({ s_page: String(next) })}
        />

        <section className="adm-panel sup-pane sup-thread" aria-label="Переписка">
          {!conversationId ? (
            <EmptyState><ChatCircleText size={20} weight="duotone" aria-hidden="true" /> Выбери обращение в списке.</EmptyState>
          ) : activeThread ? (
            <ThreadView
              thread={activeThread}
              inboxItem={inboxItem}
              agents={inboxData?.agents ?? []}
              myId={access.userId}
              canCredit={access.permissions.money}
              now={now}
              draft={draft}
              onDraft={setDraft}
              peerTyping={typing.peerTyping}
              onTyping={typing.notifyTyping}
              onChanged={afterChange}
              onBack={() => setMobileView('inbox')}
              onShowCard={() => setMobileView('card')}
              onOpenLog={setLogId}
            />
          ) : threadError ? (
            <>
              <Button className="sup-mobile-only" size="sm" variant="ghost" icon={<ArrowLeft size={16} weight="bold" aria-hidden="true" />} onClick={() => setMobileView('inbox')}>Все обращения</Button>
              <ErrorState message={threadError} onRetry={() => { void loadThread(conversationId) }} />
            </>
          ) : (
            <LoadingState label="Загружаем переписку…" />
          )}
        </section>

        <aside className="adm-panel sup-pane sup-card" aria-label="Ученик">
          {activeThread ? (
            <UserCard thread={activeThread} onOpenUser={openUser} onBack={() => setMobileView('thread')} />
          ) : (
            <EmptyState>{conversationId ? 'Карточка появится вместе с перепиской.' : 'Здесь будет карточка ученика.'}</EmptyState>
          )}
        </aside>
      </div>

      {templatesOpen && (
        <TemplatesModal onClose={() => setTemplatesOpen(false)} onChanged={() => { if (conversationId) afterChange() }} />
      )}
      {logId && <SolutionLogModal logId={logId} onClose={() => setLogId(null)} />}
    </>
  )
}

/* ---------- Входящие ---------- */

type InboxFilters = { s_status: string; s_assignee: string; s_priority: string }

function InboxPane({ inbox, loading, error, onRetry, filters, filtered, onFilter, search, onSearch, selectedId, onSelect, now, page, onPage }: {
  inbox: Inbox | null
  loading: boolean
  error: string
  onRetry: () => void
  filters: InboxFilters
  filtered: boolean
  onFilter: (patch: Partial<InboxFilters>) => void
  search: string
  onSearch: (value: string) => void
  selectedId: string
  onSelect: (id: string) => void
  now: number
  page: number
  onPage: (page: number) => void
}) {
  const agents = inbox?.agents ?? []
  const items = inbox?.items ?? []
  const sla = inbox?.slaMinutes ?? 30
  return (
    <section className="adm-panel sup-pane sup-inbox" aria-label="Входящие обращения">
      <div className="sup-filters">
        <Segmented label="Статус обращений" value={filters.s_status} options={statusFilterOptions} onChange={(value) => onFilter({ s_status: value })} />
        <div className="sup-filter-row">
          <Field label="Назначено">
            <select value={filters.s_assignee} onChange={(event) => onFilter({ s_assignee: event.target.value })}>
              <option value="all">Всем</option>
              <option value="me">Мне</option>
              <option value="none">Никому</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.email}</option>)}
            </select>
          </Field>
          <Field label="Приоритет">
            <select value={filters.s_priority} onChange={(event) => onFilter({ s_priority: event.target.value })}>
              <option value="all">Любой</option>
              {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Поиск">
          <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Почта, имя или тема" />
        </Field>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !inbox && loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState>{filtered ? 'Под эти фильтры обращений нет.' : 'Открытых обращений нет.'}</EmptyState>
      ) : (
        <ul className={`sup-inbox-list${loading ? ' is-stale' : ''}`}>
          {items.map((item) => {
            const waiting = waitingMinutes(item.status, item.lastUserMessageAt, now)
            const overdue = waiting !== null && waiting >= sla
            const selected = item.id === selectedId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`sup-inbox-item${selected ? ' is-selected' : ''}${item.unread > 0 ? ' is-unread' : ''}${overdue ? ' is-overdue' : ''}`}
                  onClick={() => onSelect(item.id)}
                  aria-current={selected || undefined}
                >
                  <span className="sup-inbox-top">
                    <strong>{item.fullName || item.email}</strong>
                    <time dateTime={item.lastMessageAt}>{relativeTime(item.lastMessageAt)}</time>
                  </span>
                  <span className="sup-inbox-subject">{item.subject}</span>
                  <span className="sup-inbox-preview">{item.lastAuthor === 'owner' ? 'Поддержка: ' : ''}{item.lastMessage || 'Без текста'}</span>
                  <span className="sup-inbox-meta">
                    <Badge tone={statusTones[item.status] ?? 'neutral'}>{statusLabels[item.status] ?? item.status}</Badge>
                    {item.priority !== 'normal' && <Badge tone={priorityTones[item.priority] ?? 'neutral'}>{priorityLabels[item.priority] ?? item.priority}</Badge>}
                    {waiting !== null && <SlaTimer minutes={waiting} slaMinutes={sla} />}
                    {item.rating !== null && <span className="sup-inbox-rating" title="Оценка ученика"><Star size={12} weight="fill" aria-hidden="true" />{item.rating}</span>}
                    {item.unread > 0 && <span className="sup-unread" title="Непрочитанные сообщения ученика">{item.unread}</span>}
                    <span className="sup-assignee">{item.assignedEmail ?? 'не назначено'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {inbox && inbox.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={inbox.total} onPage={onPage} />}
    </section>
  )
}

function SlaTimer({ minutes, slaMinutes }: { minutes: number; slaMinutes: number }) {
  const overdue = minutes >= slaMinutes
  const close = !overdue && minutes >= slaMinutes * 0.66
  return (
    <span className={`sup-sla${overdue ? ' is-overdue' : close ? ' is-close' : ''}`} title={`Ждёт ответа ${formatDuration(minutes)}, SLA ${slaMinutes} мин`}>
      <Clock size={12} weight="bold" aria-hidden="true" />
      {formatDuration(minutes)}{overdue ? ' · просрочено' : ''}
    </span>
  )
}

/* ---------- Переписка ---------- */

function ThreadView({ thread, inboxItem, agents, myId, canCredit, now, draft, onDraft, peerTyping, onTyping, onChanged, onBack, onShowCard, onOpenLog }: {
  thread: Thread
  inboxItem: InboxItem | null
  agents: Agent[]
  myId: string
  canCredit: boolean
  now: number
  draft: string
  onDraft: (value: string) => void
  peerTyping: boolean
  onTyping: () => void
  onChanged: () => void
  onBack: () => void
  onShowCard: () => void
  onOpenLog: (logId: string) => void
}) {
  const conversation = thread.conversation
  const waiting = waitingMinutes(conversation.status, conversation.lastUserMessageAt, now)
  return (
    <>
      <div className="sup-mobile-bar">
        <Button className="sup-mobile-only" size="sm" variant="ghost" icon={<ArrowLeft size={16} weight="bold" aria-hidden="true" />} onClick={onBack}>Все обращения</Button>
        <Button className="sup-mobile-only" size="sm" icon={<UserCircle size={16} weight="bold" aria-hidden="true" />} onClick={onShowCard}>Ученик</Button>
      </div>
      <header className="sup-thread-head">
        <div className="sup-badges">
          <Badge tone="accent">{categoryLabels[conversation.category] ?? conversation.category}</Badge>
          <Badge tone={statusTones[conversation.status] ?? 'neutral'}>{statusLabels[conversation.status] ?? conversation.status}</Badge>
          {conversation.priority !== 'normal' && <Badge tone={priorityTones[conversation.priority] ?? 'neutral'}>{priorityLabels[conversation.priority] ?? conversation.priority}</Badge>}
          {waiting !== null && <SlaTimer minutes={waiting} slaMinutes={conversation.slaMinutes} />}
        </div>
        <h2>{conversation.subject}</h2>
        <p className="adm-muted">
          {thread.user ? `${thread.user.fullName || 'Без имени'} · ${thread.user.email}` : 'Профиль ученика не найден'} · открыто {formatDateTime(conversation.createdAt)}
        </p>
      </header>

      <ThreadControls conversation={conversation} agents={agents} myId={myId} assignedEmail={inboxItem?.assignedEmail ?? null} onChanged={onChanged} />

      {conversation.rating !== null && (
        <div className={`sup-rating${conversation.rating <= 2 ? ' is-low' : ''}`}>
          <span className="sup-stars" role="img" aria-label={`Оценка ${conversation.rating} из 5`}>
            {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={15} weight={value <= (conversation.rating ?? 0) ? 'fill' : 'regular'} aria-hidden="true" />)}
          </span>
          <span>Оценка ученика{conversation.ratedAt ? `, ${formatDateTime(conversation.ratedAt)}` : ''}</span>
          {conversation.ratingComment && <q>{conversation.ratingComment}</q>}
        </div>
      )}

      <ConversationContext context={conversation.context} />
      <MessageList thread={thread} peerTyping={peerTyping} />
      <Composer key={`reply-${conversation.id}`} thread={thread} draft={draft} onDraft={onDraft} onTyping={onTyping} onSent={onChanged} />
      {conversation.category === 'feature' && <FeatureCredit key={`credit-${conversation.id}`} thread={thread} canCredit={canCredit} onChanged={onChanged} />}
      <NotesPanel key={`notes-${conversation.id}`} thread={thread} onChanged={onChanged} onOpenLog={onOpenLog} />
    </>
  )
}

function ThreadControls({ conversation, agents, myId, assignedEmail, onChanged }: {
  conversation: ThreadConversation
  agents: Agent[]
  myId: string
  assignedEmail: string | null
  onChanged: () => void
}) {
  const { pending, run } = useAction()
  const update = async (key: string, patch: Record<string, unknown>, success: string) => {
    const result = await run(key, () => adminRpc('admin_support_update', { p_conversation_id: conversation.id, ...patch }), success)
    if (result !== undefined) onChanged()
  }
  const resolved = conversation.status === 'resolved'
  const assigneeKnown = !conversation.assignedTo || agents.some((agent) => agent.id === conversation.assignedTo)
  return (
    <div className="sup-controls">
      <div className="sup-control-buttons">
        {resolved ? (
          <Button size="sm" loading={pending === 'reopen'} onClick={() => { void update('reopen', { p_status: 'pending_owner' }, 'Обращение открыто снова') }}>Открыть снова</Button>
        ) : (
          <Button size="sm" variant="primary" loading={pending === 'resolve'} onClick={() => { void update('resolve', { p_status: 'resolved' }, 'Обращение закрыто') }}>Закрыть</Button>
        )}
        {conversation.status !== 'pending_user' && (
          <Button size="sm" loading={pending === 'wait'} onClick={() => { void update('wait', { p_status: 'pending_user' }, 'Ждём ответа ученика') }}>Ждать ученика</Button>
        )}
        {conversation.assignedTo !== myId && (
          <Button size="sm" variant="ghost" icon={<UserPlus size={16} weight="bold" aria-hidden="true" />} loading={pending === 'take'} onClick={() => { void update('take', { p_assigned_to: myId }, 'Обращение за тобой') }}>Взять себе</Button>
        )}
      </div>
      <label className="sup-inline-field">
        <span>Приоритет</span>
        <select value={conversation.priority} disabled={pending === 'priority'} onChange={(event) => { void update('priority', { p_priority: event.target.value }, 'Приоритет изменён') }}>
          {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
        </select>
      </label>
      <label className="sup-inline-field">
        <span>Назначено</span>
        <select
          value={conversation.assignedTo ?? ''}
          disabled={pending === 'assign'}
          onChange={(event) => {
            const value = event.target.value
            void (value ? update('assign', { p_assigned_to: value }, 'Назначение изменено') : update('assign', { p_unassign: true }, 'Назначение снято'))
          }}
        >
          <option value="">Никому</option>
          {!assigneeKnown && conversation.assignedTo && <option value={conversation.assignedTo}>{assignedEmail ?? 'Администратор'}</option>}
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id === myId ? `${agent.email} (я)` : agent.email}</option>)}
        </select>
      </label>
    </div>
  )
}

function ConversationContext({ context }: { context: Row }) {
  const wrong = isRecord(context.wrongSolution) ? context.wrongSolution : null
  const payment = isRecord(context.payment) ? context.payment : null
  if (!wrong && !payment) return null
  const steps = wrong ? arr(wrong.steps).filter((step): step is string => typeof step === 'string') : []
  return (
    <details className="sup-context">
      <summary>{wrong ? 'Контекст неверного решения' : 'Контекст оплаты'}</summary>
      {wrong && (
        <dl className="adm-kv">
          <dt>Учебник и задача</dt>
          <dd>{[str(wrong.textbookTitle), str(wrong.task) && `№ ${str(wrong.task)}`].filter(Boolean).join(' · ') || '-'}</dd>
          <dt>Условие</dt>
          <dd className="sup-prewrap">{str(wrong.condition) || '-'}</dd>
          {steps.length > 0 && (
            <>
              <dt>Решение</dt>
              <dd><ol className="sup-steps">{keyed(steps, (step) => step).map(({ key, item }) => <li key={key}>{item}</li>)}</ol></dd>
            </>
          )}
          <dt>Ответ</dt>
          <dd>{str(wrong.answer) || '-'}</dd>
        </dl>
      )}
      {payment && <p>{str(payment.note, 'Платежи не подключены, нужна ручная проверка.')}</p>}
    </details>
  )
}

function MessageList({ thread, peerTyping }: { thread: Thread; peerTyping: boolean }) {
  const listRef = useRef<HTMLDivElement>(null)
  const count = thread.messages.length
  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [count, peerTyping])
  const userRead = timeOf(thread.conversation.userLastReadAt)
  return (
    <div ref={listRef} className="sup-messages" aria-live="polite">
      {count === 0 && <p className="adm-muted">Сообщений нет.</p>}
      {thread.messages.map((message) => {
        const own = message.authorType === 'owner'
        const read = own && Number.isFinite(userRead) && userRead >= timeOf(message.createdAt)
        return (
          <article key={message.id} className={`sup-message ${own ? 'is-owner' : 'is-user'}`}>
            <header>
              <strong>{own ? (message.authorEmail ?? 'Владелец из Telegram') : 'Ученик'}</strong>
              <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
            </header>
            <p>{message.body}</p>
            {own && (
              <span className={`sup-receipt${read ? ' is-read' : ''}`} title={read ? 'Ученик открыл переписку после этого сообщения' : 'Сообщение сохранено, ученик его ещё не открыл'}>
                {read ? <Checks size={14} weight="bold" aria-hidden="true" /> : <Check size={14} weight="bold" aria-hidden="true" />}
                {read ? 'Прочитано' : 'Доставлено'}
              </span>
            )}
          </article>
        )
      })}
      {peerTyping && (
        <p className="sup-typing" role="status">
          <span className="sup-typing-dots" aria-hidden="true"><i /><i /><i /></span>
          Ученик печатает…
        </p>
      )}
    </div>
  )
}

function Composer({ thread, draft, onDraft, onTyping, onSent }: {
  thread: Thread
  draft: string
  onDraft: (value: string) => void
  onTyping: () => void
  onSent: () => void
}) {
  const { pending, run } = useAction()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputId = `sup-reply-${thread.conversation.id}`

  const send = async () => {
    const body = draft.trim()
    if (!body || pending) return
    const result = await run('reply', () => adminRpc('admin_support_reply', { p_conversation_id: thread.conversation.id, p_body: body }))
    if (result === undefined) return
    onDraft('')
    onSent()
  }

  const insertTemplate = (template: Template) => {
    const text = fillTemplate(template.body, thread)
    onDraft(draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <form className="sup-composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send() }}>
      {thread.templates.length > 0 && (
        <div className="sup-templates" role="group" aria-label="Быстрые ответы">
          {thread.templates.map((template) => (
            <button key={template.id} type="button" className="sup-chip" onClick={() => insertTemplate(template)} title={fillTemplate(template.body, thread)}>
              {template.title}
            </button>
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor={inputId}>Ответ ученику</label>
      <textarea
        id={inputId}
        ref={textareaRef}
        value={draft}
        maxLength={4000}
        rows={4}
        placeholder="Ответ ученику. Ctrl+Enter - отправить"
        onChange={(event) => {
          onDraft(event.target.value)
          if (event.target.value) onTyping()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void send()
          }
        }}
      />
      <div className="sup-composer-foot">
        <span className="adm-muted adm-mono">{draft.length}/4000</span>
        <Button type="submit" variant="accent" loading={pending === 'reply'} disabled={!draft.trim()} icon={<PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />}>Отправить</Button>
      </div>
    </form>
  )
}

/* ---------- Начисление за идею ---------- */

function FeatureCredit({ thread, canCredit, onChanged }: { thread: Thread; canCredit: boolean; onChanged: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('10')
  const [reason, setReason] = useState('Спасибо за полезную идею')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decision = ideaDecision(thread)
  const credited = thread.ideaApproval.credited

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || busy) return
    // Поле в рублях, база считает в копейках (переход 30 августа).
    const rubles = Number(amount)
    const normalizedReason = reason.trim()
    if (!Number.isInteger(rubles) || rubles < 1 || rubles > 10_000) {
      setError('Сумма - целое число от 1 до 10 000 ₽.')
      return
    }
    if (normalizedReason.length < 3 || normalizedReason.length > 160) {
      setError('Причина - от 3 до 160 символов.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data, error: creditError } = await supabase.rpc('admin_credit_feature_balance', {
        p_conversation_id: thread.conversation.id,
        p_amount: rubles * 100,
        p_reason: normalizedReason,
      })
      if (creditError) {
        setError(/owner approval required/i.test(creditError.message)
          ? `База не видит одобрения: нужен ответ в этом диалоге «${APPROVAL_PHRASE}».`
          : /idea was rejected/i.test(creditError.message)
            ? 'Идея отклонена: начисление закрыто.'
            : adminErrorMessage(creditError))
        return
      }
      toast.success(bool(obj(data).credited) ? `Начислено ${formatKopecks(rubles * 100)}.` : 'За эту идею баланс уже начисляли.')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`sup-credit is-${credited ? 'credited' : decision}`} aria-label="Начисление за идею">
      <header><Gift size={18} weight="duotone" aria-hidden="true" /><h3>Начисление за идею</h3></header>
      {credited ? (
        <p>За эту идею баланс уже начислен.</p>
      ) : decision === 'rejected' ? (
        <p>Идея отклонена. Начисление закрыто.</p>
      ) : decision === 'pending' ? (
        <p>Начисление откроется после одобрения владельцем: ответ в этом диалоге <strong>«{APPROVAL_PHRASE}»</strong> или кнопка в Telegram.</p>
      ) : !canCredit ? (
        <p>Идея одобрена. Начислить может роль с доступом к деньгам - admin или owner.</p>
      ) : (
        <form onSubmit={(event) => { void submit(event) }}>
          <p>Идея одобрена. Начисление одноразовое.</p>
          <div className="sup-credit-fields">
            <Field label="Сумма, ₽">
              <input type="number" inputMode="numeric" min={1} max={10000} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <Field label="Причина">
              <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          {error && <p className="sup-error" role="alert">{error}</p>}
          <div className="adm-form-actions">
            <Button type="submit" variant="primary" loading={busy}>Начислить на баланс</Button>
          </div>
        </form>
      )}
    </section>
  )
}

/* ---------- Внутренние заметки ---------- */

function NotesPanel({ thread, onChanged, onOpenLog }: { thread: Thread; onChanged: () => void; onOpenLog: (logId: string) => void }) {
  const [draft, setDraft] = useState('')
  const { pending, run } = useAction()
  const conversationId = thread.conversation.id
  const attached = new Set(thread.notes.map((note) => (note.attachment ? str(note.attachment.logId) : '')).filter(Boolean))
  const tasksWithLogs = thread.recentTasks.filter((task): task is RecentTask & { logId: string } => Boolean(task.logId))

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    const result = await run('note', () => adminRpc('admin_support_note', { p_conversation_id: conversationId, p_body: body }), 'Заметка сохранена')
    if (result === undefined) return
    setDraft('')
    onChanged()
  }

  const attach = async (logId: string) => {
    const result = await run(`log:${logId}`, () => adminRpc('admin_support_note', { p_conversation_id: conversationId, p_body: null, p_log_id: logId }), 'Лог приложен к заметкам')
    if (result !== undefined) onChanged()
  }

  return (
    <section className="sup-notes" aria-label="Внутренние заметки">
      <header>
        <h3><NotePencil size={17} weight="duotone" aria-hidden="true" /> Внутренние заметки</h3>
        <small>Ученик их не видит</small>
      </header>
      {thread.notes.length ? (
        <ol className="sup-note-list">
          {thread.notes.map((note) => {
            const attachment = note.attachment
            const noteLogId = attachment ? str(attachment.logId) : ''
            return (
              <li key={note.id}>
                <p>{note.body}</p>
                {attachment && (
                  <div className="sup-note-attachment">
                    <span>
                      {[str(attachment.subject) || 'Без предмета', str(attachment.outcome), str(attachment.models), numOrNull(attachment.seconds) !== null ? `${formatNumber(num(attachment.seconds))} с` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {str(attachment.error) && <small className="sup-error">{str(attachment.error)}</small>}
                    {noteLogId && <Button size="sm" variant="ghost" icon={<FileText size={15} weight="bold" aria-hidden="true" />} onClick={() => onOpenLog(noteLogId)}>Открыть лог</Button>}
                  </div>
                )}
                <small className="adm-muted">{note.authorEmail ?? 'Администратор'} · {formatDateTime(note.createdAt)}</small>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="adm-muted">Заметок пока нет.</p>
      )}
      {tasksWithLogs.length > 0 && (
        <div className="sup-attach">
          <span className="adm-muted">Приложить лог задачи:</span>
          {tasksWithLogs.map((task) => (
            <Button
              key={task.logId}
              size="sm"
              variant="ghost"
              icon={<Paperclip size={15} weight="bold" aria-hidden="true" />}
              loading={pending === `log:${task.logId}`}
              disabled={attached.has(task.logId)}
              title={clip(task.preview || task.task, 160)}
              onClick={() => { void attach(task.logId) }}
            >
              {attached.has(task.logId) ? 'Приложен: ' : ''}{task.subject || 'Без предмета'} · {formatDateTime(task.createdAt)}
            </Button>
          ))}
        </div>
      )}
      <form className="sup-note-form" onSubmit={(event) => { void add(event) }}>
        <textarea value={draft} maxLength={8000} rows={3} placeholder="Заметка для команды" aria-label="Текст внутренней заметки" onChange={(event) => setDraft(event.target.value)} />
        <div className="adm-form-actions">
          <Button type="submit" size="sm" loading={pending === 'note'} disabled={!draft.trim()}>Сохранить заметку</Button>
        </div>
      </form>
    </section>
  )
}

/* ---------- Карточка ученика ---------- */

function UserCard({ thread, onOpenUser, onBack }: { thread: Thread; onOpenUser: (userId: string) => void; onBack: () => void }) {
  const user = thread.user
  return (
    <>
      <Button className="sup-mobile-only" size="sm" variant="ghost" icon={<ArrowLeft size={16} weight="bold" aria-hidden="true" />} onClick={onBack}>К переписке</Button>
      {user ? (
        <div className="sup-card-block">
          <div className="sup-card-id">
            <UserCircle size={34} weight="duotone" aria-hidden="true" />
            <div>
              <strong>{user.fullName || 'Без имени'}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <dl className="sup-kv">
            <dt>Тариф</dt><dd>{user.planTitle || '-'}</dd>
            <dt>Баланс</dt><dd className="adm-mono">{formatKopecks(user.balance)}</dd>
            <dt>Класс</dt><dd>{user.grade || '-'}</dd>
            <dt>Статус</dt><dd>{user.isBanned ? <Badge tone="danger">Заблокирован</Badge> : <Badge tone="success">Активен</Badge>}</dd>
            <dt>С нами с</dt><dd>{formatDate(user.createdAt)}</dd>
          </dl>
          <Button size="sm" icon={<ArrowSquareOut size={16} weight="bold" aria-hidden="true" />} onClick={() => onOpenUser(user.id)}>Открыть карточку</Button>
        </div>
      ) : (
        <EmptyState>Профиль ученика не найден.</EmptyState>
      )}

      <div className="sup-card-block">
        <h3>Последние задачи</h3>
        {thread.recentTasks.length ? (
          <ul className="sup-mini-list">
            {thread.recentTasks.map((task) => (
              <li key={task.key || task.createdAt}>
                <span className="sup-mini-top">
                  <Badge tone={taskStatusTones[task.status] ?? 'neutral'}>{taskStatusLabels[task.status] ?? task.status}</Badge>
                  <strong>{task.subject || 'Без предмета'}</strong>
                  <time dateTime={task.createdAt}>{relativeTime(task.createdAt)}</time>
                </span>
                {(task.preview || task.task) && <span className="sup-mini-text">{clip(task.preview || task.task, 140)}</span>}
                {task.error && <small className="sup-error">{clip(task.error, 200)}</small>}
              </li>
            ))}
          </ul>
        ) : <p className="adm-muted">Задач не было.</p>}
      </div>

      <div className="sup-card-block">
        <h3>Флаги антифрода</h3>
        {thread.flags.length ? (
          <ul className="sup-mini-list">
            {thread.flags.map((flag) => (
              <li key={`${flag.ruleId}-${flag.status}-${flag.explanation}`}>
                <span className="sup-mini-top">
                  <Badge tone={riskTones[flag.risk] ?? 'neutral'}>{riskLabels[flag.risk] ?? flag.risk}</Badge>
                  <strong className="adm-mono">{flag.ruleId}</strong>
                  {flag.status === 'deferred' && <Badge>отложен</Badge>}
                </span>
                <span className="sup-mini-text">{flag.explanation}</span>
              </li>
            ))}
          </ul>
        ) : <p className="adm-muted">Открытых флагов нет.</p>}
      </div>

      <div className="sup-card-block">
        <h3>Операции кошелька</h3>
        {thread.walletEntries.length ? (
          <ul className="sup-mini-list">
            {thread.walletEntries.map((entry) => (
              <li key={entry.id} className="sup-wallet-row">
                <b className={entry.amount >= 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatKopecks(entry.amount)}</b>
                <span className="sup-mini-text">{entry.description || 'Без описания'}</span>
                <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : <p className="adm-muted">Операций нет.</p>}
      </div>
    </>
  )
}

/* ---------- Шаблоны ---------- */

type TemplateDraft = { id: string | null; title: string; body: string }

function TemplatesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { pending, run } = useAction()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Список читается сам: шаблоны правят и без открытого обращения.
  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminRpc<Json>('admin_support_template', { p_action: 'list' })
      setTemplates(arr(data).flatMap((item) => (item && typeof item === 'object' && !Array.isArray(item)
        ? [{ id: String(item.id ?? ''), title: String(item.title ?? ''), body: String(item.body ?? '') }]
        : [])))
      setLoadError('')
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : 'Не получилось загрузить шаблоны.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTemplates() }, [loadTemplates])

  const [editing, setEditing] = useState<TemplateDraft | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const title = editing.title.trim()
    const body = editing.body.trim()
    if (title.length < 1 || title.length > 80 || body.length < 1 || body.length > 4000) {
      setError('Название - до 80 символов, текст - до 4000, оба не пустые.')
      return
    }
    setError('')
    const result = await run('save', () => adminRpc('admin_support_template', {
      p_action: 'save',
      p_id: editing.id,
      p_title: title,
      p_body: body,
      // У существующего шаблона порядок не трогаем: база берёт прежний.
      p_sort: editing.id ? null : templates.length,
    }), 'Шаблон сохранён')
    if (result === undefined) return
    setEditing(null)
    void loadTemplates()
    onChanged()
  }

  const remove = async (id: string) => {
    const result = await run(`delete:${id}`, () => adminRpc('admin_support_template', { p_action: 'delete', p_id: id }), 'Шаблон удалён')
    setConfirmId(null)
    if (result !== undefined) {
      void loadTemplates()
      onChanged()
    }
  }

  return (
    <Modal open title={editing ? (editing.id ? 'Изменить шаблон' : 'Новый шаблон') : 'Шаблоны ответов'} onClose={onClose}>
      {editing ? (
        <form className="sup-template-form" onSubmit={(event) => { void save(event) }}>
          <Field label="Название">
            <input value={editing.title} maxLength={80} data-initial-focus onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
          </Field>
          <Field label="Текст" hint={<>Подстановки: {'{{name}}'}, {'{{email}}'}, {'{{balance}}'}, {'{{lastTask}}'}</>}>
            <textarea value={editing.body} maxLength={4000} rows={6} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
          </Field>
          {error && <p className="sup-error" role="alert">{error}</p>}
          <div className="adm-form-actions">
            <Button onClick={() => { setEditing(null); setError('') }}>Отмена</Button>
            <Button type="submit" variant="primary" loading={pending === 'save'}>Сохранить</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="adm-muted">Подстановки заполняются из обращения: {'{{name}}'} - имя, {'{{email}}'} - почта, {'{{balance}}'} - баланс, {'{{lastTask}}'} - последняя задача.</p>
          {loading && !templates.length ? (
            <LoadingState label="Загружаем шаблоны…" />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={() => { void loadTemplates() }} />
          ) : templates.length ? (
            <ul className="sup-template-list">
              {templates.map((template) => (
                <li key={template.id}>
                  <div>
                    <strong>{template.title}</strong>
                    <p>{template.body}</p>
                  </div>
                  <div className="sup-template-actions">
                    <Button size="sm" variant="ghost" icon={<PencilSimple size={15} weight="bold" aria-hidden="true" />} onClick={() => setEditing({ id: template.id, title: template.title, body: template.body })}>Изменить</Button>
                    {confirmId === template.id ? (
                      <Button size="sm" variant="danger" loading={pending === `delete:${template.id}`} onClick={() => { void remove(template.id) }}>Точно удалить</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<Trash size={15} weight="bold" aria-hidden="true" />} onClick={() => setConfirmId(template.id)}>Удалить</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Шаблонов нет.</EmptyState>
          )}
          <div className="adm-form-actions">
            <Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing({ id: null, title: '', body: '' })}>Новый шаблон</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ---------- Лог решения ---------- */

function SolutionLogModal({ logId, onClose }: { logId: string; onClose: () => void }) {
  const log = useAsync(() => adminRpc<Json>('admin_solution_log', { p_log_id: logId }), [logId])
  const data = obj(log.data)
  const issues = arr(data.issues)
  const calls = arr(data.calls)
  return (
    <Modal open title="Лог решения" onClose={onClose}>
      {log.loading && !log.data ? (
        <LoadingState />
      ) : log.error ? (
        <ErrorState message={log.error} onRetry={log.reload} />
      ) : (
        <>
          <dl className="sup-kv">
            <dt>Ученик</dt><dd>{str(data.email) || '-'}</dd>
            <dt>Предмет</dt><dd>{str(data.subject) || '-'}{str(data.grade) ? `, ${str(data.grade)} класс` : ''}</dd>
            <dt>Итог</dt><dd>{str(data.outcome) || '-'}{numOrNull(data.status) !== null ? ` · HTTP ${num(data.status)}` : ''}</dd>
            <dt>Модели</dt><dd className="adm-mono">{str(data.models) || '-'}</dd>
            <dt>Время</dt><dd>{formatNumber(num(data.seconds))} с</dd>
            <dt>Себестоимость</dt><dd>{numOrNull(data.cost_kopecks) !== null ? formatKopecks(num(data.cost_kopecks)) : '-'}</dd>
            <dt>Request id</dt><dd className="adm-mono">{str(data.request_id) || '-'}</dd>
            <dt>Создан</dt><dd>{formatDateTime(strOrNull(data.created_at))}</dd>
          </dl>
          {str(data.error) && <p className="sup-error">{str(data.error)}</p>}
          {str(data.condition) && (
            <>
              <h4 className="sup-subhead">Условие</h4>
              <p className="sup-prewrap">{str(data.condition)}</p>
            </>
          )}
          <h4 className="sup-subhead">Запрос к модели</h4>
          <JsonView value={data.request ?? null} maxHeight={320} />
          <h4 className="sup-subhead">Ответ модели</h4>
          <JsonView value={data.response ?? null} maxHeight={320} />
          {issues.length > 0 && (
            <>
              <h4 className="sup-subhead">Замечания проверки</h4>
              <JsonView value={issues} maxHeight={240} />
            </>
          )}
          {calls.length > 0 && (
            <>
              <h4 className="sup-subhead">Вызовы модели</h4>
              <JsonView value={calls} maxHeight={240} />
            </>
          )}
        </>
      )}
    </Modal>
  )
}
