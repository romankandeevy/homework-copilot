/* Рабочее место поддержки: входящие, переписка и карточка ученика.

   Чтение и запись - только через admin_support_* RPC. Живость - Realtime:
   агенту со вторым фактором RLS открывает таблицы обращений, поэтому
   postgres_changes доходят сюда напрямую; сигнал admin-live из каркаса
   (signals.pulse) и тихий опрос раз в 45 секунд - запасной путь, кнопки
   «Обновить» нет. «Печатает» идёт широковещанием по каналу
   support-typing:<id> - его же слушает окно поддержки ученика.

   Без выбранного обращения - широкий список и сводка; с выбранным -
   список, переписка и карточка ученика; на телефоне по одной колонке. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Check,
  CheckCircle,
  Checks,
  Clock,
  DownloadSimple,
  FileText,
  Gift,
  Keyboard,
  NotePencil,
  PaperPlaneTilt,
  Paperclip,
  PencilSimple,
  Plus,
  Printer,
  Star,
  Trash,
  UserCircle,
  UserPlus,
  WarningOctagon,
  X,
} from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { keyed } from '../../lib/listKeys'
import { supabase } from '../../lib/supabase'
import {
  adminErrorMessage,
  adminRpc,
  arr,
  bool,
  downloadCsv,
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
  str,
  strOrNull,
  todayMsk,
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
import { useAdmin } from '../context'
import {
  APPROVAL_PHRASE,
  EXPORT_LIMIT,
  EXPORT_PAGE_SIZE,
  PAGE_SIZE,
  SUPPORT_TAGS,
  asPeriod,
  categoryLabels,
  clip,
  fillTemplate,
  ideaDecision,
  inboxCsvColumns,
  neighbourId,
  parseInbox,
  parseStats,
  parseThread,
  periodOptions,
  periodPhrases,
  plural,
  priorityLabels,
  priorityOrder,
  priorityTones,
  resolveHotkey,
  riskLabels,
  riskTones,
  statusFilterOptions,
  statusLabels,
  statusTones,
  tagLabel,
  taskStatusLabels,
  taskStatusTones,
  timeOf,
  updatedAgo,
  waitingMinutes,
} from './supportModel'
import type {
  Agent,
  Inbox,
  InboxCounts,
  InboxItem,
  RecentTask,
  SupportHotkey,
  SupportPeriod,
  SupportTag,
  Template,
  Thread,
  ThreadConversation,
} from './supportModel'
import { InboxEmptyArt, PickConversationArt } from './SupportIllustrations'
import { ShortcutKeys, ShortcutList, ShortcutsModal } from './SupportShortcuts'
import { SupportStatsPanel } from './SupportStats'
import './support.css'

const TYPING_SEND_MS = 2000
const TYPING_SHOW_MS = 4000
const POLL_MS = 45_000

const defaultQuery = {
  s_status: 'open',
  s_assignee: 'all',
  s_priority: 'all',
  s_tag: 'all',
  s_period: 'all',
  s_overdue: '',
  s_q: '',
  s_page: '1',
  conversation: '',
}

type SupportQuery = typeof defaultQuery

const emptyTitles: Record<string, string> = {
  open: 'Открытых обращений нет',
  pending_owner: 'Никто не ждёт ответа',
  pending_user: 'Ответа учеников не ждём',
  resolved: 'Закрытых обращений нет',
  all: 'Обращений ещё не было',
}

/* ---------- Помощники ---------- */

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

type LiveState<T> = { data: T | null; error: string; loading: boolean; updatedAt: number }

/* Загрузка с тихим обновлением: фоновые обновления не гасят список и не
   показывают ошибку поверх данных, которые уже на экране. */
function useLiveData<T>(loader: () => Promise<T>, key: string, enabled = true) {
  const [state, setState] = useState<LiveState<T>>({ data: null, error: '', loading: enabled, updatedAt: 0 })
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const ticket = useRef(0)

  const load = useCallback(async (silent: boolean) => {
    const current = ++ticket.current
    if (!silent) setState((previous) => ({ ...previous, loading: true, error: '' }))
    try {
      const data = await loaderRef.current()
      if (current !== ticket.current) return
      setState({ data, error: '', loading: false, updatedAt: Date.now() })
    } catch (failure) {
      if (current !== ticket.current) return
      const message = failure instanceof Error ? failure.message : 'Не получилось загрузить данные.'
      setState((previous) => ({ ...previous, loading: false, error: silent && previous.data ? previous.error : message }))
    }
  }, [])

  useEffect(() => {
    if (enabled) void load(false)
  }, [key, enabled, load])

  const refresh = useCallback(() => { void load(true) }, [load])
  const reload = useCallback(() => { void load(false) }, [load])
  return { ...state, refresh, reload }
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
  const joinedRef = useRef(false)
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
        .subscribe((status) => { joinedRef.current = status === 'SUBSCRIBED' })
      channelRef.current = channel
    }
    void open()
    return () => {
      cancelled = true
      channelRef.current = null
      joinedRef.current = false
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
    // Без подключённого канала supabase-js шлёт «печатает» запросом по HTTP -
    // для подсказки, которая живёт 4 секунды, это лишний трафик и ошибки.
    if (!channel || !joinedRef.current || now - lastSentRef.current < TYPING_SEND_MS) return
    lastSentRef.current = now
    void channel.send({ type: 'broadcast', event: 'typing', payload: { from: 'owner', at: now } })
  }, [])

  const clearPeer = useCallback(() => setPeer(null), [])

  return { peerTyping: peer !== null && peer.id === conversationId, notifyTyping, clearPeer }
}

function inboxArgs(query: SupportQuery, page: number, pageSize: number) {
  return {
    p_status: query.s_status,
    p_assignee: query.s_assignee === 'all' ? null : query.s_assignee,
    p_priority: query.s_priority === 'all' ? null : query.s_priority,
    p_tag: query.s_tag === 'all' ? null : query.s_tag,
    p_period: asPeriod(query.s_period),
    p_overdue: query.s_overdue === '1',
    p_search: query.s_q,
    p_page: page,
    p_page_size: pageSize,
  }
}

function filterSummary(query: SupportQuery, agents: Agent[]) {
  const assignee = query.s_assignee === 'all' ? null
    : query.s_assignee === 'me' ? 'назначено мне'
      : query.s_assignee === 'none' ? 'без назначения'
        : `назначено ${agents.find((agent) => agent.id === query.s_assignee)?.email ?? 'администратору'}`
  return [
    statusFilterOptions.find((option) => option.value === query.s_status)?.label ?? query.s_status,
    `созданы ${periodPhrases[asPeriod(query.s_period)]}`,
    query.s_overdue === '1' ? 'только просроченные по SLA' : null,
    assignee,
    query.s_priority !== 'all' ? `приоритет «${priorityLabels[query.s_priority] ?? query.s_priority}»` : null,
    query.s_tag !== 'all' ? `метка «${tagLabel(query.s_tag)}»` : null,
    query.s_q ? `поиск «${query.s_q}»` : null,
  ].filter(Boolean).join(', ')
}

type PrintKind = 'list' | 'thread'

function startPrint(kind: PrintKind) {
  const root = document.documentElement
  root.dataset.supPrint = kind
  const done = () => {
    delete root.dataset.supPrint
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

/* ---------- Раздел ---------- */

export default function SupportSection() {
  const { access, openUser, refreshSignals, signals } = useAdmin()
  const toast = useToast()
  const [query, setQuery] = useQueryState(defaultQuery)
  const conversationId = query.conversation
  const page = Math.max(1, Math.floor(Number(query.s_page)) || 1)
  const period: SupportPeriod = asPeriod(query.s_period)
  const now = useNow(30_000)
  const [mobileView, setMobileView] = useState<'thread' | 'card'>('thread')
  const view = conversationId ? mobileView : 'inbox'
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [logId, setLogId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [live, setLive] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'print' | null>(null)
  const [printSheet, setPrintSheet] = useState<{ items: InboxItem[]; total: number } | null>(null)
  const bulkAction = useAction()
  const threadAction = useAction()

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

  const listArgs = inboxArgs(query, page, PAGE_SIZE)
  const inbox = useLiveData(() => adminRpc<Json>('admin_support_inbox', listArgs).then(parseInbox), JSON.stringify(listArgs))
  const stats = useLiveData(() => adminRpc<Json>('admin_support_stats', { p_period: period }).then(parseStats), period, !conversationId)

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

  const refreshInboxRef = useRef(inbox.refresh)
  refreshInboxRef.current = inbox.refresh
  const refreshStatsRef = useRef(stats.refresh)
  refreshStatsRef.current = stats.refresh
  const conversationRef = useRef(conversationId)
  conversationRef.current = conversationId

  const timers = useRef({ inbox: 0, thread: 0 })
  const scheduleInbox = useCallback(() => {
    window.clearTimeout(timers.current.inbox)
    timers.current.inbox = window.setTimeout(() => {
      refreshInboxRef.current()
      if (!conversationRef.current) refreshStatsRef.current()
    }, 500)
  }, [])
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

  // Сигнал каркаса: новое сообщение, смена обращения, новая ошибка.
  const pulse = signals.pulse
  useEffect(() => {
    if (pulse) scheduleInbox()
  }, [pulse, scheduleInbox])

  // Запасной путь, если Realtime отвалился: тихий опрос видимой вкладки.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== 'visible') return
      refreshInboxRef.current()
      const current = conversationRef.current
      if (current) void loadThread(current, true)
      else refreshStatsRef.current()
    }
    const timer = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [loadThread])

  const afterChange = useCallback(() => {
    const current = conversationRef.current
    if (current) void loadThread(current, true)
    scheduleInbox()
    refreshSignalsRef.current()
  }, [loadThread, scheduleInbox])

  const typing = useSupportTyping(conversationId || null)

  const openConversation = useCallback((id: string) => {
    setQuery({ conversation: id })
    setMobileView('thread')
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-conversation="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }, [setQuery])

  const closeConversation = useCallback(() => setQuery({ conversation: '' }), [setQuery])

  /* ---------- Звук и системные уведомления ---------- */

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

  // Разрешение включают в разделе «Уведомления» (BrowserNotificationsPanel).
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

  /* ---------- Realtime ---------- */

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
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))
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

  /* ---------- Печать через Ctrl+P тоже даёт печатную версию ---------- */

  useEffect(() => {
    const before = () => {
      const root = document.documentElement
      if (!root.dataset.supPrint) root.dataset.supPrint = conversationRef.current ? 'thread' : 'list'
    }
    const after = () => { delete document.documentElement.dataset.supPrint }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      delete document.documentElement.dataset.supPrint
    }
  }, [])

  /* ---------- Производные ---------- */

  const inboxData = inbox.data
  const sla = inboxData?.slaMinutes ?? 30
  const items = inboxData?.items ?? []
  const counts: InboxCounts | null = inboxData?.counts ?? null
  const overdueTotal = counts?.overdue ?? items.filter((item) => {
    const waiting = waitingMinutes(item.status, item.lastUserMessageAt, now)
    return waiting !== null && waiting >= sla
  }).length
  const inboxItem = items.find((item) => item.id === conversationId) ?? null
  const draft = conversationId ? drafts[conversationId] ?? '' : ''
  const setDraft = (value: string) => {
    if (conversationId) setDrafts((current) => ({ ...current, [conversationId]: value }))
  }
  const narrowed = query.s_assignee !== 'all' || query.s_priority !== 'all' || query.s_tag !== 'all' || query.s_period !== 'all' || query.s_overdue === '1' || query.s_q !== ''
  const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id)

  /* ---------- Действия ---------- */

  const onFilter = (patch: Partial<SupportQuery>) => {
    setQuery({ ...patch, s_page: '1' })
    setSelected(new Set())
  }

  const resetFilters = () => {
    setSearchDraft('')
    onFilter({ s_assignee: 'all', s_priority: 'all', s_tag: 'all', s_period: 'all', s_overdue: '', s_q: '' })
  }

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((current) => {
      const all = items.length > 0 && items.every((item) => current.has(item.id))
      return all ? new Set() : new Set(items.map((item) => item.id))
    })
  }

  const runBulk = async (key: string, patch: Record<string, unknown>, verb: string) => {
    if (!selectedIds.length) return
    const result = await bulkAction.run(key, () => adminRpc<Json>('admin_support_bulk_update', { p_conversation_ids: selectedIds, ...patch }), (data) => {
      const report = obj(data)
      const updated = num(report.updated)
      const requested = num(report.requested, selectedIds.length)
      const rest = requested - updated
      return `${verb}: ${formatNumber(updated)} ${plural(updated, 'обращение', 'обращения', 'обращений')}${rest > 0 ? `, ещё ${formatNumber(rest)} уже были такими` : ''}`
    })
    if (result === undefined) return
    setSelected(new Set())
    afterChange()
  }

  const resolveCurrent = async () => {
    if (!activeThread || activeThread.conversation.status === 'resolved' || threadAction.pending) return
    const result = await threadAction.run('resolve', () => adminRpc('admin_support_update', { p_conversation_id: activeThread.conversation.id, p_status: 'resolved' }), 'Обращение закрыто')
    if (result !== undefined) afterChange()
  }

  const fetchAll = async () => {
    const all: InboxItem[] = []
    let total = 0
    for (let next = 1; next <= Math.ceil(EXPORT_LIMIT / EXPORT_PAGE_SIZE); next += 1) {
      // Страницы по очереди: база отдаёт не больше 200 строк за вызов.
      // eslint-disable-next-line no-await-in-loop
      const chunk: Inbox = parseInbox(await adminRpc<Json>('admin_support_inbox', inboxArgs(query, next, EXPORT_PAGE_SIZE)))
      total = chunk.total
      all.push(...chunk.items)
      if (chunk.items.length < EXPORT_PAGE_SIZE || all.length >= total) break
    }
    return { items: all.slice(0, EXPORT_LIMIT), total }
  }

  const exportCsv = async () => {
    setExporting('csv')
    try {
      const { items: rowsForCsv, total } = await fetchAll()
      if (!rowsForCsv.length) {
        toast.info('Под эти фильтры обращений нет - выгружать нечего.')
        return
      }
      downloadCsv(`support-${todayMsk()}`, rowsForCsv, inboxCsvColumns)
      toast.success(total > rowsForCsv.length
        ? `Выгружены первые ${formatNumber(rowsForCsv.length)} из ${formatNumber(total)} обращений.`
        : `Выгружено ${formatNumber(rowsForCsv.length)} ${plural(rowsForCsv.length, 'обращение', 'обращения', 'обращений')}.`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Не получилось выгрузить обращения.')
    } finally {
      setExporting(null)
    }
  }

  const printView = async () => {
    if (conversationId) {
      startPrint('thread')
      return
    }
    setExporting('print')
    try {
      setPrintSheet(await fetchAll())
      // Печатная таблица должна успеть отрисоваться до окна печати.
      window.setTimeout(() => startPrint('list'), 60)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Не получилось подготовить печать.')
    } finally {
      setExporting(null)
    }
  }

  /* ---------- Горячие клавиши ---------- */

  const hotkeyRef = useRef<(action: SupportHotkey) => void>(() => undefined)
  hotkeyRef.current = (action) => {
    if (action === 'help') {
      setShortcutsOpen(true)
      return
    }
    if (action === 'next' || action === 'prev') {
      const target = neighbourId(items.map((item) => item.id), conversationId, action === 'next' ? 1 : -1)
      if (target) openConversation(target)
      return
    }
    if (!conversationId) return
    if (action === 'back') closeConversation()
    else if (action === 'resolve') void resolveCurrent()
    else if (action === 'reply') {
      setMobileView('thread')
      window.requestAnimationFrame(() => document.getElementById(`sup-reply-${conversationId}`)?.focus())
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // Поверх открыто окно или быстрый переход - клавиши принадлежат им.
      if (document.querySelector('.adm-overlay')) return
      const action = resolveHotkey(event, event.target)
      if (!action || (action === 'resolve' && event.repeat)) return
      event.preventDefault()
      hotkeyRef.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- Отрисовка ---------- */

  if (!supabase) {
    return (
      <>
        <PageHeader title="Поддержка" />
        <ErrorState message="Подключение к базе не настроено: обращения недоступны." />
      </>
    )
  }

  const overdueHref = `/admin?section=support&s_status=open&s_overdue=1`
  const showOverdue = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onFilter({ s_status: 'open', s_overdue: '1' })
  }

  const sheetItems = printSheet?.items ?? items

  return (
    <>
      <PageHeader
        title="Поддержка"
        description={<SupportPulse live={live} updatedAt={inbox.updatedAt} counts={counts} sla={sla} />}
        actions={(
          <>
            <Button size="sm" icon={<FileText size={16} weight="bold" aria-hidden="true" />} onClick={() => setTemplatesOpen(true)} title="Шаблоны быстрых ответов">Шаблоны</Button>
            <Button size="sm" icon={<DownloadSimple size={16} weight="bold" aria-hidden="true" />} loading={exporting === 'csv'} onClick={() => { void exportCsv() }} title="Все обращения под текущими фильтрами, файл для Excel">CSV</Button>
            <Button size="sm" icon={<Printer size={16} weight="bold" aria-hidden="true" />} loading={exporting === 'print'} onClick={() => { void printView() }} title={conversationId ? 'Печать открытой переписки; в окне печати можно сохранить в PDF' : 'Печать списка под текущими фильтрами; в окне печати можно сохранить в PDF'}>Печать / PDF</Button>
            <button type="button" className="adm-icon-button sup-keys-button" onClick={() => setShortcutsOpen(true)} aria-label="Горячие клавиши" title="Горячие клавиши (?)">
              <Keyboard size={18} weight="bold" aria-hidden="true" />
            </button>
          </>
        )}
      />

      {inboxData && (
        <SlaBanner
          overdue={overdueTotal}
          sla={sla}
          active={query.s_overdue === '1'}
          href={overdueHref}
          onShow={showOverdue}
          onReset={() => onFilter({ s_overdue: '' })}
        />
      )}

      <div className={`sup-desk ${conversationId ? 'is-open' : 'is-idle'}`} data-view={view}>
        <InboxPane
          inbox={inboxData}
          loading={inbox.loading}
          error={inbox.error}
          onRetry={inbox.reload}
          filters={query}
          period={period}
          narrowed={narrowed}
          onFilter={onFilter}
          onResetFilters={resetFilters}
          search={searchDraft}
          onSearch={setSearchDraft}
          selectedId={conversationId}
          onSelect={openConversation}
          checked={selected}
          onToggle={toggleSelected}
          onToggleAll={toggleAll}
          bulk={selectedIds.length > 0 ? (
            <BulkBar
              count={selectedIds.length}
              agents={inboxData?.agents ?? []}
              myId={access.userId}
              pending={bulkAction.pending}
              onResolve={() => { void runBulk('bulk:resolve', { p_status: 'resolved' }, 'Закрыто') }}
              onReopen={() => { void runBulk('bulk:reopen', { p_status: 'pending_owner' }, 'Открыто снова') }}
              onAssign={(value) => {
                if (value === 'none') void runBulk('bulk:assign', { p_unassign: true }, 'Назначение снято')
                else void runBulk('bulk:assign', { p_assigned_to: value === 'me' ? access.userId : value }, 'Переназначено')
              }}
              onTag={(mode, tag) => {
                void runBulk('bulk:tag', mode === 'add' ? { p_add_tags: [tag] } : { p_remove_tags: [tag] }, mode === 'add' ? `Метка «${tagLabel(tag)}» добавлена` : `Метка «${tagLabel(tag)}» снята`)
              }}
              onClear={() => setSelected(new Set())}
            />
          ) : null}
          now={now}
          page={page}
          onPage={(next) => setQuery({ s_page: String(next) })}
        />

        {conversationId ? (
          <>
            <section className="adm-panel sup-pane sup-thread" aria-label="Переписка">
              {activeThread ? (
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
                  onResolve={() => { void resolveCurrent() }}
                  resolving={threadAction.pending === 'resolve'}
                  onBack={closeConversation}
                  onShowCard={() => setMobileView('card')}
                  onOpenLog={setLogId}
                />
              ) : threadError ? (
                <>
                  <Button className="sup-mobile-only" size="sm" variant="ghost" icon={<ArrowLeft size={16} weight="bold" aria-hidden="true" />} onClick={closeConversation}>Все обращения</Button>
                  <ErrorState message={threadError} onRetry={() => { void loadThread(conversationId) }} />
                </>
              ) : (
                <LoadingState label="Загружаем переписку…" />
              )}
            </section>

            <aside className="adm-panel sup-pane sup-card" aria-label="Ученик">
              {activeThread ? (
                <StudentPanel thread={activeThread} onOpenUser={openUser} onOpenConversation={openConversation} onBack={() => setMobileView('thread')} />
              ) : (
                <LoadingState label="Карточка ученика…" />
              )}
            </aside>
          </>
        ) : (
          <div className="sup-side">
            <PickPanel onShowShortcuts={() => setShortcutsOpen(true)} />
            <SupportStatsPanel stats={stats.data} error={stats.error} onRetry={stats.reload} period={period} />
          </div>
        )}
      </div>

      <PrintSheet
        items={sheetItems}
        total={printSheet?.total ?? inboxData?.total ?? sheetItems.length}
        summary={filterSummary(query, inboxData?.agents ?? [])}
        sla={sla}
      />

      {templatesOpen && (
        <TemplatesModal onClose={() => setTemplatesOpen(false)} onChanged={() => { if (conversationId) afterChange() }} />
      )}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {logId && <SolutionLogModal logId={logId} onClose={() => setLogId(null)} />}
    </>
  )
}

/* ---------- Шапка: живость и SLA ---------- */

function SupportPulse({ live, updatedAt, counts, sla }: { live: boolean; updatedAt: number; counts: InboxCounts | null; sla: number }) {
  const now = useNow(10_000)
  return (
    <span className="sup-pulse">
      <span
        className={`sup-live${live ? ' is-live' : ''}`}
        title={live
          ? 'Список и переписка обновляются сами при каждом сообщении; раз в 45 секунд - контрольное обновление'
          : 'Живой канал не подключён, список обновляется раз в 45 секунд'}
      >
        <i aria-hidden="true" />{live ? 'Живое обновление' : 'Обновление раз в 45 с'}
      </span>
      <span>{updatedAgo(updatedAt, now)}</span>
      {counts && <span>открыто {formatNumber(counts.open)} · ждут ответа {formatNumber(counts.pendingOwner)} · без назначения {formatNumber(counts.unassigned)}</span>}
      <span>SLA первого ответа {sla} мин</span>
    </span>
  )
}

function SlaBanner({ overdue, sla, active, href, onShow, onReset }: {
  overdue: number
  sla: number
  active: boolean
  href: string
  onShow: (event: ReactMouseEvent<HTMLAnchorElement>) => void
  onReset: () => void
}) {
  if (overdue <= 0) {
    return (
      <p className="sup-sla-calm">
        <CheckCircle size={16} weight="fill" aria-hidden="true" />
        Просрочено по SLA: 0. Все, кто ждёт ответа, ждут меньше {sla} мин.
        {active && <button type="button" className="sup-link-button" onClick={onReset}>Показать все обращения</button>}
      </p>
    )
  }
  return (
    <div className="sup-sla-alert" role="alert">
      <WarningOctagon className="sup-sla-alert-icon" size={30} weight="fill" aria-hidden="true" />
      <div className="sup-sla-alert-text">
        <strong>Просрочено по SLA: {formatNumber(overdue)}</strong>
        <span>{formatNumber(overdue)} {plural(overdue, 'обращение ждёт', 'обращения ждут', 'обращений ждут')} ответа дольше {sla} мин.</span>
      </div>
      {active ? (
        <button type="button" className="sup-sla-alert-link is-quiet" onClick={onReset}>Показать все обращения</button>
      ) : (
        <a className="sup-sla-alert-link" href={href} onClick={onShow}>
          Показать просроченные <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </a>
      )}
    </div>
  )
}

/* ---------- Входящие ---------- */

function InboxPane({ inbox, loading, error, onRetry, filters, period, narrowed, onFilter, onResetFilters, search, onSearch, selectedId, onSelect, checked, onToggle, onToggleAll, bulk, now, page, onPage }: {
  inbox: Inbox | null
  loading: boolean
  error: string
  onRetry: () => void
  filters: SupportQuery
  period: SupportPeriod
  narrowed: boolean
  onFilter: (patch: Partial<SupportQuery>) => void
  onResetFilters: () => void
  search: string
  onSearch: (value: string) => void
  selectedId: string
  onSelect: (id: string) => void
  checked: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  bulk: React.ReactNode
  now: number
  page: number
  onPage: (page: number) => void
}) {
  const agents = inbox?.agents ?? []
  const items = inbox?.items ?? []
  const sla = inbox?.slaMinutes ?? 30
  const checkedOnPage = items.filter((item) => checked.has(item.id)).length
  const allChecked = items.length > 0 && checkedOnPage === items.length
  return (
    <section className="adm-panel sup-pane sup-inbox" aria-label="Входящие обращения">
      <div className="sup-filters">
        <Segmented label="Статус обращений" value={filters.s_status} options={statusFilterOptions} onChange={(value) => onFilter({ s_status: value })} />
        <div className="sup-filter-grid">
          <div className="adm-field sup-period">
            <span className="adm-field-label">Создано</span>
            <Segmented label="Когда создано обращение" value={period} options={periodOptions} onChange={(value) => onFilter({ s_period: value })} />
          </div>
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
          <Field label="Метка">
            <select value={filters.s_tag} onChange={(event) => onFilter({ s_tag: event.target.value })}>
              <option value="all">Любая</option>
              {SUPPORT_TAGS.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
            </select>
          </Field>
          <Field label="Поиск" className="sup-search">
            <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Почта, имя или тема" />
          </Field>
        </div>
        {filters.s_overdue === '1' && (
          <div className="sup-active-filters">
            <button type="button" className="sup-filter-chip" onClick={() => onFilter({ s_overdue: '' })} aria-label="Убрать фильтр: только просроченные по SLA">
              <Clock size={13} weight="bold" aria-hidden="true" /> Только просроченные по SLA <X size={13} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="sup-list-wrap">
        {items.length > 0 && (
          <div className="sup-list-head">
            <label className="sup-check-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(node) => { if (node) node.indeterminate = checkedOnPage > 0 && !allChecked }}
                onChange={onToggleAll}
              />
              Выбрать все на странице
            </label>
            <span>{formatNumber(inbox?.total ?? 0)} {plural(inbox?.total ?? 0, 'обращение', 'обращения', 'обращений')}</span>
          </div>
        )}
        {bulk}

        {error && !inbox ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : !inbox && loading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <div className="sup-empty">
            <InboxEmptyArt />
            <strong>{narrowed ? 'Под эти фильтры обращений нет' : emptyTitles[filters.s_status] ?? 'Обращений нет'}</strong>
            <p>{narrowed ? 'Измени условия или сбрось фильтры.' : 'Новые обращения появятся здесь сами - список обновляется без кнопки.'}</p>
            {narrowed && <Button size="sm" onClick={onResetFilters}>Сбросить фильтры</Button>}
          </div>
        ) : (
          <ul className={`sup-inbox-list${loading ? ' is-stale' : ''}`}>
            {items.map((item) => {
              const waiting = waitingMinutes(item.status, item.lastUserMessageAt, now)
              const overdue = waiting !== null && waiting >= sla
              const selected = item.id === selectedId
              const isChecked = checked.has(item.id)
              return (
                <li key={item.id} className={`sup-row${isChecked ? ' is-checked' : ''}`} data-conversation={item.id}>
                  <input type="checkbox" className="sup-row-check" checked={isChecked} onChange={() => onToggle(item.id)} aria-label={`Выбрать: ${item.subject}, ${item.fullName || item.email}`} />
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
                      <TagPills tags={item.tags} />
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
      </div>

      {inbox && inbox.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={inbox.total} onPage={onPage} />}
    </section>
  )
}

function BulkBar({ count, agents, myId, pending, onResolve, onReopen, onAssign, onTag, onClear }: {
  count: number
  agents: Agent[]
  myId: string
  pending: string | null
  onResolve: () => void
  onReopen: () => void
  onAssign: (value: string) => void
  onTag: (mode: 'add' | 'remove', tag: SupportTag) => void
  onClear: () => void
}) {
  const busy = pending !== null
  return (
    <div className="adm-bulkbar sup-bulkbar" role="region" aria-label="Действия с выбранными обращениями">
      <span className="sup-bulk-count">Выбрано: {formatNumber(count)}</span>
      <Button size="sm" icon={<Check size={15} weight="bold" aria-hidden="true" />} loading={pending === 'bulk:resolve'} disabled={busy} onClick={onResolve}>Закрыть</Button>
      <Button size="sm" loading={pending === 'bulk:reopen'} disabled={busy} onClick={onReopen}>Открыть снова</Button>
      <label className="sup-bulk-select">
        <span className="sr-only">Назначить выбранные</span>
        <select value="" disabled={busy} onChange={(event) => { if (event.target.value) onAssign(event.target.value) }}>
          <option value="" disabled>Назначить…</option>
          <option value="me">Мне</option>
          {agents.filter((agent) => agent.id !== myId).map((agent) => <option key={agent.id} value={agent.id}>{agent.email}</option>)}
          <option value="none">Снять назначение</option>
        </select>
      </label>
      <label className="sup-bulk-select">
        <span className="sr-only">Сменить метку у выбранных</span>
        <select
          value=""
          disabled={busy}
          onChange={(event) => {
            const [mode, tag] = event.target.value.split(':')
            if ((mode === 'add' || mode === 'remove') && SUPPORT_TAGS.some((item) => item.id === tag)) onTag(mode, tag as SupportTag)
          }}
        >
          <option value="" disabled>Метка…</option>
          <optgroup label="Добавить">
            {SUPPORT_TAGS.map((tag) => <option key={`add-${tag.id}`} value={`add:${tag.id}`}>+ {tag.label}</option>)}
          </optgroup>
          <optgroup label="Снять">
            {SUPPORT_TAGS.map((tag) => <option key={`remove-${tag.id}`} value={`remove:${tag.id}`}>- {tag.label}</option>)}
          </optgroup>
        </select>
      </label>
      <Button size="sm" variant="ghost" icon={<X size={15} weight="bold" aria-hidden="true" />} disabled={busy} onClick={onClear}>Снять выбор</Button>
    </div>
  )
}

function TagPills({ tags }: { tags: SupportTag[] }) {
  if (!tags.length) return null
  return (
    <span className="sup-tags">
      {tags.map((tag) => <span key={tag} className={`sup-tag is-${tag}`}>{tagLabel(tag)}</span>)}
    </span>
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

/* ---------- Пустая правая часть ---------- */

function PickPanel({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  return (
    <section className="adm-panel sup-pick" aria-label="Переписка">
      <PickConversationArt />
      <div className="sup-pick-text">
        <h2>Выбери обращение</h2>
        <p>Переписка и карточка ученика с историей его обращений откроются на месте сводки. Галочками слева можно закрыть, переназначить или сменить метку у нескольких обращений разом.</p>
      </div>
      <ShortcutList compact />
      <button type="button" className="sup-link-button" onClick={onShowShortcuts}>Все горячие клавиши</button>
    </section>
  )
}

/* ---------- Переписка ---------- */

function ThreadView({ thread, inboxItem, agents, myId, canCredit, now, draft, onDraft, peerTyping, onTyping, onChanged, onResolve, resolving, onBack, onShowCard, onOpenLog }: {
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
  onResolve: () => void
  resolving: boolean
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
          <TagPills tags={conversation.tags} />
          <Badge tone={statusTones[conversation.status] ?? 'neutral'}>{statusLabels[conversation.status] ?? conversation.status}</Badge>
          {conversation.priority !== 'normal' && <Badge tone={priorityTones[conversation.priority] ?? 'neutral'}>{priorityLabels[conversation.priority] ?? conversation.priority}</Badge>}
          {waiting !== null && <SlaTimer minutes={waiting} slaMinutes={conversation.slaMinutes} />}
        </div>
        <h2>{conversation.subject}</h2>
        <p className="adm-muted">
          {thread.user ? `${thread.user.fullName || 'Без имени'} · ${thread.user.email}` : 'Профиль ученика не найден'} · открыто {formatDateTime(conversation.createdAt)} · тип: {categoryLabels[conversation.category] ?? conversation.category}
        </p>
      </header>

      <ThreadControls
        conversation={conversation}
        agents={agents}
        myId={myId}
        assignedEmail={inboxItem?.assignedEmail ?? null}
        onChanged={onChanged}
        onResolve={onResolve}
        resolving={resolving}
      />

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

function ThreadControls({ conversation, agents, myId, assignedEmail, onChanged, onResolve, resolving }: {
  conversation: ThreadConversation
  agents: Agent[]
  myId: string
  assignedEmail: string | null
  onChanged: () => void
  onResolve: () => void
  resolving: boolean
}) {
  const { pending, run } = useAction()
  const update = async (key: string, patch: Record<string, unknown>, success: string) => {
    const result = await run(key, () => adminRpc('admin_support_update', { p_conversation_id: conversation.id, ...patch }), success)
    if (result !== undefined) onChanged()
  }
  const toggleTag = async (tag: SupportTag) => {
    const has = conversation.tags.includes(tag)
    const result = await run(`tag:${tag}`, () => adminRpc('admin_support_bulk_update', {
      p_conversation_ids: [conversation.id],
      ...(has ? { p_remove_tags: [tag] } : { p_add_tags: [tag] }),
    }))
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
          <Button size="sm" variant="primary" loading={resolving} onClick={onResolve} title="Закрыть обращение (E)">
            Закрыть <kbd className="sup-kbd-hint" aria-hidden="true">E</kbd>
          </Button>
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
      <div className="sup-tag-editor" role="group" aria-label="Метки обращения">
        <span className="sup-inline-label">Метки</span>
        {SUPPORT_TAGS.map((tag) => {
          const on = conversation.tags.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={`sup-tag is-toggle is-${tag.id}`}
              aria-pressed={on}
              disabled={pending !== null && pending.startsWith('tag:')}
              title={on ? `Снять метку «${tag.label}»` : `Поставить метку «${tag.label}»`}
              onClick={() => { void toggleTag(tag.id) }}
            >
              {tag.label}
            </button>
          )
        })}
      </div>
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
        placeholder="Ответ ученику"
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
        <span className="sup-composer-hint">
          <ShortcutKeys keys={['Ctrl', 'Enter']} /> отправить
          <span className="adm-mono">{draft.length}/4000</span>
        </span>
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

function StudentPanel({ thread, onOpenUser, onOpenConversation, onBack }: {
  thread: Thread
  onOpenUser: (userId: string) => void
  onOpenConversation: (id: string) => void
  onBack: () => void
}) {
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
        <h3>История обращений{thread.historyTotal > 0 ? ` · ${formatNumber(thread.historyTotal)}` : ''}</h3>
        {thread.history.length ? (
          <ul className="sup-history">
            {thread.history.map((item) => (
              <li key={item.id}>
                <button type="button" className="sup-history-item" onClick={() => onOpenConversation(item.id)} title="Открыть это обращение">
                  <span className="sup-mini-top">
                    <Badge tone={statusTones[item.status] ?? 'neutral'}>{statusLabels[item.status] ?? item.status}</Badge>
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </span>
                  <strong>{item.subject}</strong>
                  <span className="sup-history-meta">
                    <TagPills tags={item.tags} />
                    {item.rating !== null ? (
                      <span className="sup-inbox-rating" title="Оценка ученика"><Star size={12} weight="fill" aria-hidden="true" />{item.rating}</span>
                    ) : item.status === 'resolved' ? (
                      <span className="adm-muted">без оценки</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-muted">Других обращений у ученика не было.</p>
        )}
        {thread.historyTotal > thread.history.length && (
          <p className="adm-muted">Показаны последние {thread.history.length} из {formatNumber(thread.historyTotal)}.</p>
        )}
      </div>

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

/* ---------- Печатная версия списка ---------- */

function PrintSheet({ items, total, summary, sla }: { items: InboxItem[]; total: number; summary: string; sla: number }) {
  return (
    <section className="sup-print-sheet" aria-hidden="true">
      <h1>Обращения в поддержку</h1>
      <p>{summary}. Сформировано {formatDateTime(new Date().toISOString())} (МСК). В таблице {formatNumber(items.length)} из {formatNumber(total)}. SLA первого ответа {sla} мин.</p>
      <table>
        <thead>
          <tr>
            <th>Создано</th>
            <th>Ученик</th>
            <th>Тема</th>
            <th>Метки</th>
            <th>Статус</th>
            <th>Назначено</th>
            <th>Ждёт</th>
            <th>Оценка</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>{item.fullName || '-'}<br /><small>{item.email}</small></td>
              <td>{item.subject}</td>
              <td>{item.tags.map(tagLabel).join(', ') || '-'}</td>
              <td>{statusLabels[item.status] ?? item.status}{item.slaBreached ? ', просрочено' : ''}</td>
              <td>{item.assignedEmail ?? '-'}</td>
              <td>{item.waitingMinutes !== null ? formatDuration(item.waitingMinutes) : '-'}</td>
              <td>{item.rating ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
