/* Поддержка: типы, разбор ответов admin_support_* RPC, подписи, метки,
   экспорт и горячие клавиши. Здесь нет React - всё проверяется юнит-тестом. */

import type { Json } from '../../lib/database.types'
import { bool, formatKopecks, isRecord, num, numOrNull, obj, rows, str, strOrNull, arr } from '../api'
import type { CsvColumn, Row } from '../api'
import type { Tone } from '../ui'

export const PAGE_SIZE = 30
export const EXPORT_PAGE_SIZE = 200
export const EXPORT_LIMIT = 2000
export const APPROVAL_PHRASE = 'да это хорошая идея'

export const statusFilterOptions = [
  { value: 'open', label: 'Открытые' },
  { value: 'pending_owner', label: 'Ждут ответа' },
  { value: 'pending_user', label: 'Ждут ученика' },
  { value: 'resolved', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
]

export type SupportPeriod = 'day' | 'week' | 'month' | 'all'

export const periodOptions: { value: SupportPeriod; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё' },
]

/* Как база режет период (private.support_period_start): день - с полуночи
   по Москве, неделя - 7 дней с сегодняшним, месяц - 30. */
export const periodPhrases: Record<SupportPeriod, string> = {
  day: 'сегодня',
  week: 'за 7 дней',
  month: 'за 30 дней',
  all: 'за всё время',
}

export function asPeriod(value: string): SupportPeriod {
  return value === 'day' || value === 'week' || value === 'month' ? value : 'all'
}

export const statusLabels: Record<string, string> = { pending_owner: 'Ждёт ответа', pending_user: 'Ждём ученика', resolved: 'Закрыто' }
export const statusTones: Record<string, Tone> = { pending_owner: 'warning', pending_user: 'info', resolved: 'success' }
export const priorityOrder = ['urgent', 'high', 'normal', 'low']
export const priorityLabels: Record<string, string> = { urgent: 'Срочный', high: 'Высокий', normal: 'Обычный', low: 'Низкий' }
export const priorityTones: Record<string, Tone> = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' }
export const categoryLabels: Record<string, string> = { general: 'Общий вопрос', payment: 'Оплата и баланс', feature: 'Идея', wrong_solution: 'Неверное решение' }
export const taskStatusLabels: Record<string, string> = { queued: 'В очереди', running: 'Решается', done: 'Готово', failed: 'Ошибка' }
export const taskStatusTones: Record<string, Tone> = { queued: 'neutral', running: 'info', done: 'success', failed: 'danger' }
export const riskLabels: Record<string, string> = { high: 'высокий риск', medium: 'средний риск', low: 'низкий риск' }
export const riskTones: Record<string, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' }

/* ---------- Метки ---------- */

/* Зеркало ограничения support_conversations_tags_known
   (20260912094000_admin_support_v2.sql). Порядок - порядок показа. */
export const SUPPORT_TAGS = [
  { id: 'bug', label: 'Баг' },
  { id: 'payment', label: 'Платёж' },
  { id: 'question', label: 'Вопрос' },
  { id: 'solution', label: 'Неверное решение' },
  { id: 'refund', label: 'Возврат' },
  { id: 'account', label: 'Аккаунт' },
  { id: 'idea', label: 'Идея' },
] as const

export type SupportTag = (typeof SUPPORT_TAGS)[number]['id']

const tagOrder: readonly string[] = SUPPORT_TAGS.map((tag) => tag.id)

export function isSupportTag(value: unknown): value is SupportTag {
  return typeof value === 'string' && tagOrder.includes(value)
}

export function tagLabel(tag: string) {
  return SUPPORT_TAGS.find((item) => item.id === tag)?.label ?? tag
}

export function parseTags(value: Json | undefined): SupportTag[] {
  const found = new Set(arr(value).filter(isSupportTag))
  return SUPPORT_TAGS.map((tag) => tag.id).filter((id) => found.has(id))
}

/* ---------- Данные ---------- */

export type Agent = { id: string; email: string; role: string }

export type InboxItem = {
  id: string
  userId: string
  email: string
  fullName: string
  category: string
  subject: string
  status: string
  priority: string
  tags: SupportTag[]
  assignedTo: string | null
  assignedEmail: string | null
  createdAt: string
  lastMessageAt: string
  lastUserMessageAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  rating: number | null
  lastMessage: string
  lastAuthor: string
  unread: number
  waitingMinutes: number | null
  slaBreached: boolean
}

export type InboxCounts = { open: number; pendingOwner: number; overdue: number; unassigned: number; mine: number }

export type Inbox = { total: number; slaMinutes: number; agents: Agent[]; items: InboxItem[]; counts: InboxCounts | null }

export type ThreadConversation = {
  id: string
  category: string
  subject: string
  status: string
  priority: string
  tags: SupportTag[]
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

export type ThreadMessage = { id: string; authorType: 'user' | 'owner'; authorEmail: string | null; body: string; createdAt: string }
export type ThreadNote = { id: string; body: string; attachment: Row | null; authorEmail: string | null; createdAt: string }
export type ThreadUser = { id: string; email: string; fullName: string; grade: string; balance: number; planTitle: string; isBanned: boolean; createdAt: string }
export type RecentTask = { key: string; subject: string; task: string; preview: string; status: string; error: string | null; createdAt: string; logId: string | null }
export type Template = { id: string; title: string; body: string }
export type HistoryItem = {
  id: string
  subject: string
  category: string
  status: string
  tags: SupportTag[]
  createdAt: string
  lastMessageAt: string | null
  resolvedAt: string | null
  rating: number | null
}

export type Thread = {
  conversation: ThreadConversation
  messages: ThreadMessage[]
  notes: ThreadNote[]
  user: ThreadUser | null
  recentTasks: RecentTask[]
  flags: { ruleId: string; risk: string; explanation: string; status: string }[]
  walletEntries: { id: string; amount: number; description: string; createdAt: string }[]
  ideaApproval: { status: string; credited: boolean }
  templates: Template[]
  history: HistoryItem[]
  historyTotal: number
}

export type SupportStats = {
  period: SupportPeriod
  days: number
  created: number
  resolved: number
  responded: number
  perDay: number
  resolvedShare: number | null
  firstResponseAvgMinutes: number | null
  firstResponseMedianMinutes: number | null
  slaBreached: number
  slaMinutes: number
  rated: number
  ratingAvg: number | null
  now: { open: number; pendingOwner: number; overdue: number; unassigned: number }
  series: { date: string; created: number; resolved: number }[]
  byTag: { tag: SupportTag; count: number }[]
}

export function parseInboxItem(row: Row): InboxItem {
  return {
    id: str(row.id),
    userId: str(row.userId),
    email: str(row.email),
    fullName: str(row.fullName),
    category: str(row.category, 'general'),
    subject: str(row.subject, 'Обращение'),
    status: str(row.status, 'pending_owner'),
    priority: str(row.priority, 'normal'),
    tags: parseTags(row.tags),
    assignedTo: strOrNull(row.assignedTo),
    assignedEmail: strOrNull(row.assignedEmail),
    createdAt: str(row.createdAt),
    lastMessageAt: str(row.lastMessageAt),
    lastUserMessageAt: strOrNull(row.lastUserMessageAt),
    firstResponseAt: strOrNull(row.firstResponseAt),
    resolvedAt: strOrNull(row.resolvedAt),
    rating: numOrNull(row.rating),
    lastMessage: str(row.lastMessage),
    lastAuthor: str(row.lastAuthor),
    unread: num(row.unread),
    waitingMinutes: numOrNull(row.waitingMinutes),
    slaBreached: bool(row.slaBreached),
  }
}

export function parseInbox(value: Json): Inbox {
  const source = obj(value)
  const counts = isRecord(source.counts) ? source.counts : null
  return {
    total: num(source.total),
    slaMinutes: num(source.slaMinutes, 30),
    agents: rows(source.agents).map((row) => ({ id: str(row.id), email: str(row.email), role: str(row.role) })),
    items: rows(source.items).map(parseInboxItem),
    counts: counts
      ? { open: num(counts.open), pendingOwner: num(counts.pendingOwner), overdue: num(counts.overdue), unassigned: num(counts.unassigned), mine: num(counts.mine) }
      : null,
  }
}

function gradeText(value: Json | undefined) {
  if (typeof value === 'number') return String(value)
  return str(value)
}

export function parseThread(value: Json): Thread | null {
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
      tags: parseTags(conversation.tags),
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
    history: rows(source.history).map((row): HistoryItem => ({
      id: str(row.id),
      subject: str(row.subject, 'Обращение'),
      category: str(row.category, 'general'),
      status: str(row.status, 'pending_owner'),
      tags: parseTags(row.tags),
      createdAt: str(row.createdAt),
      lastMessageAt: strOrNull(row.lastMessageAt),
      resolvedAt: strOrNull(row.resolvedAt),
      rating: numOrNull(row.rating),
    })),
    historyTotal: num(source.historyTotal),
  }
}

export function parseStats(value: Json): SupportStats {
  const source = obj(value)
  const current = obj(source.now)
  return {
    period: asPeriod(str(source.period)),
    days: Math.max(1, num(source.days, 1)),
    created: num(source.created),
    resolved: num(source.resolved),
    responded: num(source.responded),
    perDay: num(source.perDay),
    resolvedShare: numOrNull(source.resolvedShare),
    firstResponseAvgMinutes: numOrNull(source.firstResponseAvgMinutes),
    firstResponseMedianMinutes: numOrNull(source.firstResponseMedianMinutes),
    slaBreached: num(source.slaBreached),
    slaMinutes: num(source.slaMinutes, 30),
    rated: num(source.rated),
    ratingAvg: numOrNull(source.ratingAvg),
    now: { open: num(current.open), pendingOwner: num(current.pendingOwner), overdue: num(current.overdue), unassigned: num(current.unassigned) },
    series: rows(source.series).map((row) => ({ date: str(row.date), created: num(row.created), resolved: num(row.resolved) })),
    byTag: rows(source.byTag).flatMap((row) => (isSupportTag(row.tag) ? [{ tag: row.tag, count: num(row.count) }] : [])),
  }
}

/* ---------- Помощники ---------- */

export function timeOf(value: string | null | undefined) {
  if (!value) return Number.NaN
  return new Date(value).getTime()
}

export function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function waitingMinutes(status: string, lastUserMessageAt: string | null, now: number) {
  if (status !== 'pending_owner') return null
  const started = timeOf(lastUserMessageAt)
  if (!Number.isFinite(started)) return null
  return Math.max(0, Math.floor((now - started) / 60_000))
}

/* 1 обращение, 2 обращения, 5 обращений. */
export function plural(count: number, one: string, few: string, many: string) {
  const value = Math.abs(Math.trunc(count)) % 100
  const last = value % 10
  if (value > 10 && value < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/* Длительность из минут для сводки: дробные минуты округляем, меньше
   минуты так и пишем. */
export function formatMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '-'
  if (value < 1) return 'меньше минуты'
  const minutes = Math.round(value)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`
  return `${Math.floor(hours / 24)} дн`
}

/* «Обновлено N назад» для индикатора живости списка. */
export function updatedAgo(updatedAt: number, now: number) {
  if (!updatedAt) return 'ещё не обновлялось'
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 10) return 'обновлено только что'
  if (seconds < 60) return `обновлено ${seconds} с назад`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `обновлено ${minutes} мин назад`
  return `обновлено ${Math.floor(minutes / 60)} ч назад`
}

// Зеркало private.normalize_support_idea_approval: та же чистка, что в базе.
export function normalizeApproval(value: string) {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/[^a-z0-9а-я\s]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function ideaDecision(thread: Thread): 'approved' | 'rejected' | 'pending' {
  if (thread.ideaApproval.status === 'rejected') return 'rejected'
  if (thread.ideaApproval.status === 'approved') return 'approved'
  // Ответ фразой одобрения база при начислении тоже принимает
  // (admin_credit_feature_balance), поэтому смотрим и в переписку.
  return thread.messages.some((message) => message.authorType === 'owner' && normalizeApproval(message.body) === APPROVAL_PHRASE)
    ? 'approved'
    : 'pending'
}

export function fillTemplate(body: string, thread: Thread | null) {
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

/* ---------- Экспорт ---------- */

const csvDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})

/* Дата для таблицы: «2026-09-12 10:28» по Москве - Excel её сортирует. */
export function csvDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : csvDateFormatter.format(date)
}

export const inboxCsvColumns: CsvColumn<InboxItem>[] = [
  { header: 'ID', value: (item) => item.id },
  { header: 'Создано (МСК)', value: (item) => csvDate(item.createdAt) },
  { header: 'Ученик', value: (item) => item.fullName },
  { header: 'Почта', value: (item) => item.email },
  { header: 'Тема', value: (item) => item.subject },
  { header: 'Тип', value: (item) => categoryLabels[item.category] ?? item.category },
  { header: 'Метки', value: (item) => item.tags.map(tagLabel).join(', ') },
  { header: 'Статус', value: (item) => statusLabels[item.status] ?? item.status },
  { header: 'Приоритет', value: (item) => priorityLabels[item.priority] ?? item.priority },
  { header: 'Назначено', value: (item) => item.assignedEmail ?? '' },
  { header: 'Последнее сообщение (МСК)', value: (item) => csvDate(item.lastMessageAt) },
  { header: 'Первый ответ (МСК)', value: (item) => csvDate(item.firstResponseAt) },
  { header: 'Закрыто (МСК)', value: (item) => csvDate(item.resolvedAt) },
  { header: 'Ждёт ответа, мин', value: (item) => item.waitingMinutes ?? '' },
  { header: 'Просрочено по SLA', value: (item) => (item.slaBreached ? 'да' : 'нет') },
  { header: 'Оценка', value: (item) => item.rating ?? '' },
]

/* ---------- Горячие клавиши ---------- */

export type SupportHotkey = 'next' | 'prev' | 'reply' | 'resolve' | 'back' | 'help'

/* Ctrl+A - «выделить всё», Ctrl+E и Alt+E в Chrome заняты адресной строкой
   и меню браузера. Поэтому одиночные клавиши вне полей ввода, как в почте.
   Сравнение по event.code: на русской раскладке J - это «о». */
export const SUPPORT_SHORTCUTS: { keys: string[]; text: string }[] = [
  { keys: ['J'], text: 'следующее обращение' },
  { keys: ['K'], text: 'предыдущее обращение' },
  { keys: ['R'], text: 'перейти к ответу' },
  { keys: ['Ctrl', 'Enter'], text: 'отправить ответ из поля' },
  { keys: ['E'], text: 'закрыть обращение' },
  { keys: ['Esc'], text: 'вернуться к списку' },
  { keys: ['?'], text: 'шпаргалка' },
  { keys: ['Ctrl', 'K'], text: 'быстрый переход по админке' },
]

type KeyLike = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

const textInputTypes = new Set(['', 'text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week'])

export function isTextEntry(target: EventTarget | null) {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  const tag = String(element.tagName).toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return textInputTypes.has(String((element as HTMLInputElement).type ?? '').toLowerCase())
  return false
}

export function resolveHotkey(event: KeyLike, target: EventTarget | null): SupportHotkey | null {
  if (isTextEntry(target)) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) return 'help'
  if (event.shiftKey) return null
  switch (event.code) {
    case 'KeyJ': return 'next'
    case 'KeyK': return 'prev'
    case 'KeyR': return 'reply'
    case 'KeyE': return 'resolve'
    case 'Escape': return 'back'
    default: return null
  }
}

/* Соседнее обращение в списке для J/K. Без выбранного J берёт первое. */
export function neighbourId(ids: readonly string[], current: string, step: 1 | -1) {
  if (!ids.length) return null
  const index = ids.indexOf(current)
  if (index === -1) return step === 1 ? ids[0] : ids[ids.length - 1]
  const next = index + step
  return next >= 0 && next < ids.length ? ids[next] : null
}
