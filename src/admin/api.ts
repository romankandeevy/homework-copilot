/* Доступ админки к данным.

   Все чтения и изменения идут через admin-RPC базы: роль, второй фактор,
   предел частоты и журнал обращений проверяет сама база. Типы у этих
   функций - JSON, поэтому здесь один нетипизированный вызов и набор
   безопасных читателей полей. */

import type { Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Row = Record<string, Json | undefined>

type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: Json | null; error: { message: string; code?: string } | null }>

export class AdminRequestError extends Error {
  readonly code: string

  constructor(message: string, code = '') {
    super(message)
    this.code = code
  }
}

const knownErrors: [RegExp, string][] = [
  [/admin mfa enrollment required/i, 'Подключи второй фактор, чтобы работать в админке.'],
  [/admin mfa verification required/i, 'Подтверди вход кодом из приложения-аутентификатора.'],
  [/admin role insufficient/i, 'Твоя роль не позволяет это действие.'],
  [/admin access required/i, 'Нет доступа к админке.'],
  [/admin rate limit exceeded/i, 'Слишком много запросов подряд. Подожди минуту.'],
  [/balance cannot become negative/i, 'Баланс не может стать отрицательным.'],
  [/adjustment reason/i, 'Укажи причину: от 3 до 160 символов.'],
  [/balance adjustment must be/i, 'Сумма должна быть ненулевой и не больше 100 000 ₽ по модулю.'],
  [/top up amount/i, 'Сумма пополнения - от 1 копейки до 1 000 000 ₽.'],
  [/invalid provider reference/i, 'Идентификатор транзакции: от 6 символов, латиница, цифры и ._:/-.'],
  [/provider reference conflict/i, 'Этот идентификатор уже относится к другому пополнению.'],
  [/block reason/i, 'Причина блокировки - от 3 до 500 символов.'],
  [/block end must be in the future/i, 'Срок блокировки должен быть в будущем.'],
  [/cannot block their own/i, 'Нельзя заблокировать собственный аккаунт.'],
  [/user not found/i, 'Пользователь не найден.'],
  [/plan not found/i, 'Тариф не найден или выключен.'],
  [/plan end must be in the future/i, 'Срок тарифа должен быть в будущем.'],
  [/default plan cannot be deleted/i, 'Тариф по умолчанию удалить нельзя.'],
  [/refund amount exceeds/i, 'Сумма возврата больше, чем осталось вернуть по этому пополнению.'],
  [/balance is lower than the refund/i, 'На балансе ученика меньше суммы возврата.'],
  [/refund reason/i, 'Причина возврата - от 3 до 300 символов.'],
  [/owner cannot demote themselves/i, 'Владелец не может понизить сам себя.'],
  [/at least one subject/i, 'Хотя бы один предмет должен остаться включённым.'],
  [/promo_codes_format/i, 'Код - от 3 до 32 символов: латиница, цифры, _ и -.'],
  [/promo_codes_shape/i, 'Для начисления нужна сумма от 1 копейки до 10 000 ₽, для тарифа - тариф и срок в днях.'],
  [/plans_id_format/i, 'Идентификатор тарифа - латиница, цифры, _ и -, от 2 до 40 символов.'],
  [/plans_title_length/i, 'Название тарифа - от 1 до 80 символов.'],
  [/note must contain/i, 'Заметка - от 1 до 2000 символов.'],
  [/message must contain/i, 'Сообщение - от 1 до 4000 символов.'],
  [/select 1 to 500 users/i, 'Выбери от 1 до 500 пользователей.'],
  [/invalid banner/i, 'Текст баннера - не длиннее 300 символов.'],
  [/invalid numeric setting/i, 'Значение должно быть числом от 0 до 10 000.'],
  [/limit must be between/i, 'Лимит - от 0 до 1000 решений в сутки.'],
  [/support conversation not found/i, 'Обращение не найдено.'],
  [/assignee is not an administrator/i, 'Назначить можно только администратора.'],
  [/flag not found|rule not found|log not found|error group not found|prompt not found/i, 'Запись не найдена - обнови страницу.'],
  [/period start is after/i, 'Начало периода позже его конца.'],
]

export function adminErrorMessage(error: { message?: string } | null | undefined) {
  const message = error?.message ?? ''
  for (const [pattern, text] of knownErrors) {
    if (pattern.test(message)) return text
  }
  return /[а-яё]/i.test(message) ? message : 'Операция не выполнилась. Повтори попытку.'
}

export async function adminRpc<T = Json>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new AdminRequestError('Подключение к базе не настроено.')
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc(name, args)
  if (error) throw new AdminRequestError(adminErrorMessage(error), error.code ?? '')
  return data as T
}

/* Функция админки на Vercel - через тот же прокси на домене Supabase,
   что и решатель: из российских сетей до *.vercel.app доходит через раз. */
export function adminApiUrl() {
  const explicit = import.meta.env.VITE_ADMIN_API_URL as string | undefined
  if (explicit) return explicit
  const solve = import.meta.env.VITE_HOMEWORK_API_URL as string | undefined
  if (solve && /\/solve$/.test(solve)) return solve.replace(/\/solve$/, '/admin')
  return '/api/admin'
}

export async function adminAction<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new AdminRequestError('Подключение к базе не настроено.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AdminRequestError('Сессия закончилась. Войди заново.')
  const response = await fetch(adminApiUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new AdminRequestError(typeof payload.error === 'string' ? payload.error : `Сервер ответил ${response.status}`)
  return payload as T
}

/* ---------- Чтение полей ---------- */

export function isRecord(value: Json | undefined | null | unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function str(value: Json | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function strOrNull(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function num(value: Json | undefined, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

export function numOrNull(value: Json | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function bool(value: Json | undefined): boolean {
  return value === true
}

export function arr(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : []
}

export function rows(value: Json | undefined): Row[] {
  return arr(value).filter(isRecord)
}

export function obj(value: Json | undefined): Row {
  return isRecord(value) ? value : {}
}

/* ---------- Форматирование ---------- */

const integerFormatter = new Intl.NumberFormat('ru-RU')
const decimalFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export function formatNumber(value: number) {
  return Number.isInteger(value) ? integerFormatter.format(value) : decimalFormatter.format(value)
}

export function formatKopecks(value: number) {
  const rubles = value / 100
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Number.isInteger(rubles) ? 0 : 2, maximumFractionDigits: 2 }).format(rubles)} ₽`
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${decimalFormatter.format(value)} %`
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(date)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' }).format(date)
}

export function formatShortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' }).format(date)
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ч ${minutes % 60} мин`
  return `${Math.floor(hours / 24)} дн`
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return '—'
  const diff = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diff)) return '—'
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return formatDateTime(value)
}

/* Изменение к прошлому периоду. null - сравнивать не с чем. */
export function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function todayMsk() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())
}

export function shiftDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/* ---------- CSV ---------- */

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined }

export function toCsv<T>(items: readonly T[], columns: readonly CsvColumn<T>[]) {
  const escape = (value: string | number | boolean | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  // Точка с запятой и BOM - так файл открывается в Excel с русской локалью.
  const lines = [columns.map((column) => escape(column.header)).join(';')]
  for (const item of items) lines.push(columns.map((column) => escape(column.value(item))).join(';'))
  return '﻿' + lines.join('\r\n')
}

export function downloadCsv<T>(fileName: string, items: readonly T[], columns: readonly CsvColumn<T>[]) {
  const blob = new Blob([toCsv(items, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function rublesInputToKopecks(value: string): number | null {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}
