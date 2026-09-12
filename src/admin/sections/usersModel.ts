/* Логика раздела «Пользователи» без React: состояние фильтров в адресе,
   фильтры для admin_users_list, подписи активности и шкала ползунка
   баланса. Отдельно - чтобы проверять юнит-тестами. */

import { rublesInputToKopecks } from '../api'

export const USERS_QUERY_DEFAULTS = {
  u_q: '',
  u_seen: '',
  u_status: '',
  u_paid: '',
  u_plan: '',
  u_grade: '',
  u_from: '',
  u_to: '',
  u_bmin: '',
  u_bmax: '',
  u_sort: 'last_seen',
  u_dir: 'desc',
  u_page: '1',
}

export type UsersQuery = typeof USERS_QUERY_DEFAULTS

/* Что запоминается между заходами: всё, кроме страницы. */
export const USERS_PERSISTED_KEYS = ['u_q', 'u_seen', 'u_status', 'u_paid', 'u_plan', 'u_grade', 'u_from', 'u_to', 'u_bmin', 'u_bmax', 'u_sort', 'u_dir'] as const

export const USERS_FILTER_KEYS = ['u_q', 'u_seen', 'u_status', 'u_paid', 'u_plan', 'u_grade', 'u_from', 'u_to', 'u_bmin', 'u_bmax'] as const

export const USERS_STORAGE_KEY = 'homework-copilot:admin-users-filters'

/* Сколько минут после последнего сигнала человек считается онлайн. Та же
   граница, что у счётчика «онлайн» в шапке и в admin_users_stats. */
export const ONLINE_MINUTES = 10

/* Пульс активности из приложения заработал 12 сентября 2026: раньше
   last_seen_at не писался ни у кого. */
export const ACTIVITY_SINCE = '12.09.2026'

export const SEEN_OPTIONS = [
  { value: '', label: 'Активность' },
  { value: 'online', label: 'Онлайн сейчас' },
  { value: 'today', label: 'Заходил сегодня' },
  { value: '7d', label: 'За 7 дней' },
  { value: '30d', label: 'За 30 дней' },
  { value: 'stale', label: 'Давно не заходил' },
] as const

export const STATUS_OPTIONS = [
  { value: '', label: 'Статус' },
  { value: 'active', label: 'Активен' },
  { value: 'banned', label: 'Забанен' },
  { value: 'fraud', label: 'Проверка антифрода' },
] as const

export const PAID_OPTIONS = [
  { value: '', label: 'Оплаты' },
  { value: 'yes', label: 'Платили' },
  { value: 'no', label: 'Не платили' },
] as const

export function buildUsersFilters(query: UsersQuery) {
  const filters: Record<string, string | number> = {}
  if (SEEN_OPTIONS.some((option) => option.value && option.value === query.u_seen)) filters.seen = query.u_seen
  if (query.u_status === 'active' || query.u_status === 'banned' || query.u_status === 'fraud') {
    filters.status = query.u_status
    // Старые ключи - чтобы фильтр работал и до применения миграции v2.
    if (query.u_status === 'banned') filters.banned = 'true'
    if (query.u_status === 'fraud') filters.fraud = 'true'
  }
  if (query.u_paid === 'yes' || query.u_paid === 'no') filters.paid = query.u_paid
  if (query.u_plan) filters.plan = query.u_plan
  if (/^([1-9]|1[01])$/.test(query.u_grade)) filters.grade = query.u_grade
  if (query.u_from) filters.registeredFrom = query.u_from
  if (query.u_to) filters.registeredTo = query.u_to
  const min = query.u_bmin ? rublesInputToKopecks(query.u_bmin) : null
  if (min !== null && min > 0) filters.balanceMin = min
  const max = query.u_bmax ? rublesInputToKopecks(query.u_bmax) : null
  if (max !== null) filters.balanceMax = max
  return filters
}

/* Счётчик на кнопке «Фильтры»: только то, что спрятано в панели. Даты и
   баланс - по одному фильтру, хотя полей у каждого два. */
export function countPanelFilters(query: UsersQuery) {
  return [query.u_plan, query.u_grade, query.u_from || query.u_to, query.u_bmin || query.u_bmax].filter(Boolean).length
}

export function hasUsersFilters(query: UsersQuery) {
  return USERS_FILTER_KEYS.some((key) => query[key] !== '')
}

export const USERS_RESET: Partial<UsersQuery> = Object.fromEntries([...USERS_FILTER_KEYS.map((key) => [key, '']), ['u_page', '1']])

export function isOnline(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false
  const time = new Date(lastSeenAt).getTime()
  return Number.isFinite(time) && now - time <= ONLINE_MINUTES * 60_000
}

function plural(count: number, forms: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/* «5 мин назад», «3 ч назад», «12 дней назад». Пустое значение - null. */
export function sinceText(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return null
  const time = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(time)) return null
  const minutes = Math.max(0, Math.floor((now - time) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`
  const years = Math.floor(days / 365)
  return `${years} ${plural(years, ['год', 'года', 'лет'])} назад`
}

/* Шкала ползунка баланса в рублях: правый край - круглое число не меньше
   самого большого баланса, шаг - сотая часть шкалы. */
export function balanceScale(ceilingKopecks: number, ...values: number[]) {
  const largest = Math.max(0, Math.ceil(ceilingKopecks / 100), ...values.filter((value) => Number.isFinite(value)))
  let max = 100
  while (max < largest) {
    const exponent = 10 ** Math.floor(Math.log10(max))
    const fraction = max / exponent
    max = (fraction < 2 ? 2 : fraction < 5 ? 5 : 10) * exponent
  }
  return { max, step: Math.max(1, max / 100) }
}

export function rubles(value: string): number | null {
  const kopecks = value ? rublesInputToKopecks(value) : null
  return kopecks === null ? null : kopecks / 100
}
