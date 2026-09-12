/* Чистая логика журнала действий: названия и группы событий, разница
   «было → стало», какие значения ведут к пользователю или обращению,
   период и порог частого опроса. Без React и без сети - её проверяют
   юнит-тесты (auditModel.test.ts). */

/* ---------- События ---------- */

export const eventLabels: Record<string, string> = {
  balance_adjusted: 'Изменён баланс',
  user_banned: 'Пользователь заблокирован',
  user_unbanned: 'Блокировка снята',
  user_profile_updated: 'Изменён профиль',
  user_plan_granted: 'Выдан тариф',
  user_plan_revoked: 'Тариф отозван',
  user_limit_changed: 'Изменён дневной лимит',
  user_note_added: 'Добавлена заметка',
  user_note_deleted: 'Удалена заметка',
  user_impersonated: 'Вход под пользователем',
  password_reset_sent: 'Отправлен сброс пароля',
  payment_refunded: 'Возврат пополнения',
  reservation_refunded: 'Возврат зависшего резерва',
  wallet_aligned: 'Баланс выровнен по проводкам',
  reconciliation_fixed: 'Сверка исправлена: резервы возвращены',
  fraud_flag_decided: 'Решение по флагу фрода',
  fraud_rule_updated: 'Изменено правило антифрода',
  fraud_whitelist_added: 'Добавлено в белый список',
  fraud_whitelist_removed: 'Убрано из белого списка',
  support_status_changed: 'Изменён статус обращения',
  support_replied: 'Ответ в поддержке',
  support_bulk_updated: 'Обращение изменено: статус, назначение или метки',
  support_feature_credited: 'Начисление за идею',
  solution_deleted: 'Удалено решение',
  plan_saved: 'Сохранён тариф',
  plan_deleted: 'Удалён тариф',
  plan_disabled: 'Тариф выключен',
  promo_saved: 'Сохранён промокод',
  prompt_saved: 'Новая версия промпта',
  prompt_rolled_back: 'Промпт откачен',
  prompt_disabled: 'Промпт выключен',
  prompt_previewed: 'Проверка промпта на задаче',
  subjects_saved: 'Изменены предметы',
  flag_saved: 'Изменён фиче-флаг',
  setting_saved: 'Изменена настройка',
  notification_rule_saved: 'Изменено правило уведомлений',
  admin_role_changed: 'Изменена роль администратора',
  error_status_changed: 'Изменён статус ошибки',
  jobs_expired: 'Закрыты зависшие задачи',
}

/* Группы по смыслу. Каждое событие из словаря - ровно в одной группе. */
export const eventGroups: readonly { title: string; events: readonly string[] }[] = [
  {
    title: 'Пользователи',
    events: ['user_banned', 'user_unbanned', 'user_profile_updated', 'user_plan_granted', 'user_plan_revoked', 'user_limit_changed', 'user_note_added', 'user_note_deleted', 'user_impersonated', 'password_reset_sent'],
  },
  { title: 'Права администраторов', events: ['admin_role_changed'] },
  { title: 'Тарифы', events: ['plan_saved', 'plan_disabled', 'plan_deleted', 'promo_saved'] },
  { title: 'Финансы', events: ['balance_adjusted', 'payment_refunded', 'reservation_refunded', 'wallet_aligned', 'reconciliation_fixed'] },
  { title: 'Поддержка', events: ['support_replied', 'support_status_changed', 'support_bulk_updated', 'support_feature_credited'] },
  { title: 'Фрод', events: ['fraud_flag_decided', 'fraud_rule_updated', 'fraud_whitelist_added', 'fraud_whitelist_removed'] },
  { title: 'Настройки', events: ['flag_saved', 'setting_saved', 'notification_rule_saved', 'subjects_saved', 'prompt_saved', 'prompt_rolled_back', 'prompt_disabled', 'prompt_previewed'] },
  { title: 'Решения и очередь', events: ['solution_deleted', 'jobs_expired'] },
  { title: 'Мониторинг', events: ['error_status_changed'] },
]

export function eventLabel(event: string) {
  return eventLabels[event] ?? event
}

export type EventOption = { key: string; label: string; count: number }
export type EventOptionGroup = { title: string; options: EventOption[] }

function normalize(text: string) {
  return text.toLowerCase().replaceAll('ё', 'е').trim()
}

/* Группы для выбора события с поиском по названию, ключу и группе.
   Событие, которого нет в словаре (появилось в базе позже интерфейса),
   попадает в «Другие» под своим ключом. */
export function groupedEventOptions(counts: Record<string, number>, search = ''): EventOptionGroup[] {
  const known = new Set(eventGroups.flatMap((group) => group.events))
  const toOption = (key: string): EventOption => ({ key, label: eventLabel(key), count: counts[key] ?? 0 })
  const groups: EventOptionGroup[] = eventGroups.map((group) => ({ title: group.title, options: group.events.map(toOption) }))
  const unknown = Object.keys(counts).filter((key) => !known.has(key)).sort()
  if (unknown.length > 0) groups.push({ title: 'Другие', options: unknown.map(toOption) })

  const needle = normalize(search)
  if (!needle) return groups
  return groups
    .map((group) => (normalize(group.title).includes(needle)
      ? group
      : { title: group.title, options: group.options.filter((option) => normalize(option.label).includes(needle) || option.key.includes(needle)) }))
    .filter((group) => group.options.length > 0)
}

/* ---------- Было → стало ---------- */

// Служебные отметки меняются при каждом сохранении и заслоняют суть.
const noiseKeys = new Set(['updated_at', 'updated_by', 'updatedAt'])

export type FieldRow = { key: string; before: unknown; after: unknown; changed: boolean }

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { значение: value }
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/* Все поля из «было» и «стало»: сначала изменённые, потом остальные. */
export function fieldRows(before: unknown, after: unknown): FieldRow[] {
  const left = asObject(before)
  const right = asObject(after)
  if (!left && !right) return []
  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].filter((key) => !noiseKeys.has(key))
  const all = keys.map((key) => {
    const a = left ? left[key] ?? null : null
    const b = right ? right[key] ?? null : null
    return { key, before: a, after: b, changed: !sameValue(a, b) }
  })
  return [...all.filter((row) => row.changed), ...all.filter((row) => !row.changed)]
}

export function changedFields(before: unknown, after: unknown) {
  return fieldRows(before, after).filter((row) => row.changed)
}

export function formatValue(value: unknown, limit = 240): string {
  if (value === null || value === undefined || value === '') return 'пусто'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return String(value)
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/* Одна строка для таблицы: первое изменение или главное из подробностей. */
export function changeSummary(before: unknown, after: unknown, payload: Record<string, unknown>): string {
  const changes = changedFields(before, after)
  if (changes.length > 0) {
    const first = changes[0]
    const head = before === null || before === undefined
      ? `${first.key}: ${formatValue(first.after, 40)}`
      : `${first.key}: ${formatValue(first.before, 40)} → ${formatValue(first.after, 40)}`
    return changes.length > 1 ? `${head} и ещё ${changes.length - 1}` : head
  }
  const keys = Object.keys(payload)
  if (keys.length === 0) return ''
  const key = keys.includes('reason') ? 'reason' : keys[0]
  return `${key}: ${formatValue(payload[key], 60)}`
}

export function changeText(before: unknown, after: unknown) {
  return changedFields(before, after).map((row) => `${row.key}: ${formatValue(row.before)} → ${formatValue(row.after)}`).join('; ')
}

/* ---------- Ссылки из значений ---------- */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Поля, где база кладёт id пользователя (ученика или администратора).
const userKeys = new Set(['userId', 'user_id', 'targetUserId', 'actorId', 'actor', 'assignedTo', 'assigned_to', 'grantedBy', 'granted_by', 'referrerId', 'inviteeId'])
const conversationKeys = new Set(['conversationId', 'conversation_id'])

export type LinkKind = 'user' | 'conversation'

/* Куда ведёт значение. UUID в незнакомом поле (id решения, промпта)
   ссылкой не становится, если это не автор и не адресат записи. */
export function linkKind(key: string | null, value: unknown, knownUserIds: readonly string[] = []): LinkKind | null {
  if (typeof value !== 'string' || value === '') return null
  if (key && conversationKeys.has(key)) return 'conversation'
  if (!UUID_RE.test(value)) return null
  if ((key && userKeys.has(key)) || knownUserIds.includes(value)) return 'user'
  return null
}

/* ---------- Частый опрос ---------- */

/* Живой администратор редко вызывает одну и ту же функцию чаще двух раз в
   минуту: открыл раздел, сменил фильтр, сохранил. Больше - обычно таймер
   автообновления или повтор в цикле, то есть частый опрос. */
export const POLL_PER_MINUTE = 2

/* Превышение в одной-двух минутах бывает от быстрых кликов. Если таких
   минут за период десять и больше, путь опрашивается постоянно. */
export const POLL_SUSTAINED_MINUTES = 10

export type PollLevel = 'ok' | 'warning' | 'danger'

export function pollLevel(peakPerMinute: number, hotMinutes: number): PollLevel {
  if (peakPerMinute <= POLL_PER_MINUTE) return 'ok'
  return hotMinutes >= POLL_SUSTAINED_MINUTES ? 'danger' : 'warning'
}

/* ---------- Период ---------- */

export type PeriodKey = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom'

export const periodLabels: Record<PeriodKey, string> = {
  all: 'Всё время',
  today: 'Сегодня',
  '7d': '7 дней',
  '30d': '30 дней',
  '90d': '90 дней',
  custom: 'Свой период',
}

export function parsePeriod(value: string, allowed: readonly PeriodKey[], fallback: PeriodKey): PeriodKey {
  return (allowed as readonly string[]).includes(value) ? value as PeriodKey : fallback
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/* Границы для базы: дни по Москве включительно, null - без границы. */
export function periodRange(period: PeriodKey, custom: { from: string; to: string }, today: string): { from: string | null; to: string | null } {
  switch (period) {
    case 'today': return { from: today, to: today }
    case '7d': return { from: addDays(today, -6), to: today }
    case '30d': return { from: addDays(today, -29), to: today }
    case '90d': return { from: addDays(today, -89), to: today }
    case 'custom': {
      const from = ISO_DATE.test(custom.from) ? custom.from : null
      const to = ISO_DATE.test(custom.to) ? custom.to : null
      // Перепутанные границы меняем местами, а не отдаём базе на отказ.
      if (from && to && from > to) return { from: to, to: from }
      return { from, to }
    }
    default: return { from: null, to: null }
  }
}
