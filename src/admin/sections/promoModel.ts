/* Логика раздела «Промокоды» без React: состояние кода, поиск, фильтр и
   сортировка списка, пакетная генерация, ссылка с кодом и файлы CSV.
   Отдельно от раздела - её проверяют юнит-тесты (promoModel.test.ts). */

import { applicationPath } from '../../lib/appPath'
import {
  arr, bool, formatDateTime, formatKopecks, formatNumber, intOrNull, isRecord, num, numOrNull, rows,
  rublesInputToKopecks, str, strOrNull, type CsvColumn, type Row,
} from '../api'
import type { Tone } from '../ui'

/* Пакет кодов, список активаций, удаление и «только новым аккаунтам»
   пришли миграцией 20260914220000 (14 сентября 2026). Фронт может выйти
   раньше неё: тогда новые функции отвечают PGRST202, и раздел спокойно
   говорит, что нужна миграция, а старое работает как прежде. */
export const PROMO_MIGRATION = '20260914220000'
export const PROMO_MIGRATION_TEXT = `Нужно применить миграцию ${PROMO_MIGRATION}.`

export type PromoKind = 'balance' | 'plan'

export type Promo = {
  code: string
  kind: PromoKind
  amountKopecks: number | null
  planId: string | null
  planDays: number | null
  startsAt: string | null
  expiresAt: string | null
  maxUses: number | null
  active: boolean
  note: string | null
  /** Код примет аккаунт не старше стольких дней. null - любой аккаунт. */
  newUsersDays: number | null
  createdAt: string | null
  uses: number
  lastUsedAt: string | null
  creditedKopecks: number
  paidAfter: number
  recent: { email: string; redeemedAt: string }[]
}

/* То, что задаёт администратор: без счётчиков и истории. */
export type PromoSettings = Pick<Promo, 'code' | 'kind' | 'amountKopecks' | 'planId' | 'planDays' | 'startsAt' | 'expiresAt' | 'maxUses' | 'active' | 'note' | 'newUsersDays'>

export type PromoPlan = { id: string; title: string; active: boolean; isDefault: boolean }
export type PromoFlag = { enabled: boolean; rolloutPercent: number }

export function parsePromo(row: Row): Promo {
  return {
    code: str(row.code),
    kind: str(row.kind) === 'plan' ? 'plan' : 'balance',
    amountKopecks: numOrNull(row.amountKopecks),
    planId: strOrNull(row.planId),
    planDays: numOrNull(row.planDays),
    startsAt: strOrNull(row.startsAt),
    expiresAt: strOrNull(row.expiresAt),
    maxUses: numOrNull(row.maxUses),
    active: bool(row.active),
    note: strOrNull(row.note),
    // До миграции поля в списке нет - значит, и ограничения нет.
    newUsersDays: numOrNull(row.newUsersDays),
    createdAt: strOrNull(row.createdAt),
    uses: num(row.uses),
    lastUsedAt: strOrNull(row.lastUsedAt),
    creditedKopecks: num(row.creditedKopecks),
    paidAfter: num(row.paidAfter),
    recent: rows(row.recent).map((item) => ({ email: str(item.email), redeemedAt: str(item.redeemedAt) })),
  }
}

/* Тарифы и флаг promo_codes раздел берёт из admin_settings_overview. */
export function parsePromoContext(data: unknown): { plans: PromoPlan[]; flag: PromoFlag | null } {
  const overview: Row = isRecord(data) ? data : {}
  const plans = rows(overview.plans).map((row) => ({ id: str(row.id), title: str(row.title), active: bool(row.active), isDefault: bool(row.isDefault) }))
  const flag = rows(overview.flags).find((row) => str(row.key) === 'promo_codes')
  return { plans, flag: flag ? { enabled: bool(flag.enabled), rolloutPercent: num(flag.rolloutPercent, 100) } : null }
}

/* Тело admin_promo_save. newUsersDays уходит всегда: новая функция без
   этого поля оставляет прежнее ограничение, а с полем - ставит присланное. */
export function promoPayload(promo: PromoSettings) {
  return {
    code: promo.code,
    kind: promo.kind,
    amountKopecks: promo.kind === 'balance' ? promo.amountKopecks : null,
    planId: promo.kind === 'plan' ? promo.planId : null,
    planDays: promo.kind === 'plan' ? promo.planDays : null,
    startsAt: promo.startsAt,
    expiresAt: promo.expiresAt,
    maxUses: promo.maxUses,
    active: promo.active,
    note: promo.note ?? '',
    newUsersDays: promo.newUsersDays,
  }
}

/* ---------- Состояние ---------- */

export type PromoState = 'active' | 'scheduled' | 'exhausted' | 'expired' | 'off'
export type PromoFilter = 'all' | PromoState

export const PROMO_STATE_ORDER: readonly PromoState[] = ['active', 'scheduled', 'exhausted', 'expired', 'off']

export const promoStateMeta: Record<PromoState, { label: string; plural: string; tone: Tone }> = {
  active: { label: 'действует', plural: 'Действуют', tone: 'success' },
  scheduled: { label: 'ещё не начался', plural: 'Не начались', tone: 'info' },
  exhausted: { label: 'исчерпан', plural: 'Исчерпаны', tone: 'warning' },
  expired: { label: 'истёк', plural: 'Истекли', tone: 'warning' },
  off: { label: 'выключен', plural: 'Выключены', tone: 'neutral' },
}

/* Одно состояние на код, по старшинству: выключенный не действует, даже
   если не истёк; истёкший - даже если не исчерпан. Так счётчики фильтра
   складываются ровно в число кодов. */
export function promoState(promo: Pick<Promo, 'active' | 'startsAt' | 'expiresAt' | 'maxUses' | 'uses'>, now = Date.now()): PromoState {
  if (!promo.active) return 'off'
  if (promo.expiresAt && Date.parse(promo.expiresAt) <= now) return 'expired'
  if (promo.startsAt && Date.parse(promo.startsAt) > now) return 'scheduled'
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return 'exhausted'
  return 'active'
}

export function parsePromoFilter(value: string): PromoFilter {
  return (PROMO_STATE_ORDER as readonly string[]).includes(value) ? value as PromoState : 'all'
}

export function promoCounts(promos: readonly Promo[], now = Date.now()): Record<PromoFilter, number> {
  const counts: Record<PromoFilter, number> = { all: promos.length, active: 0, scheduled: 0, exhausted: 0, expired: 0, off: 0 }
  for (const promo of promos) counts[promoState(promo, now)] += 1
  return counts
}

/* ---------- Поиск, фильтр, сортировка, страницы ---------- */

export const PROMO_QUERY_DEFAULTS = { pr_q: '', pr_state: 'all', pr_sort: 'created', pr_dir: 'desc', pr_page: '1', pr_code: '' }
export const PROMO_PAGE_SIZE = 50
export const REDEMPTIONS_PAGE_SIZE = 20

export type PromoSort = 'created' | 'uses' | 'credited'
export type SortDirection = 'asc' | 'desc'

export const sortOptions: readonly { value: `${PromoSort}:${SortDirection}`; label: string }[] = [
  { value: 'created:desc', label: 'Сначала новые' },
  { value: 'created:asc', label: 'Сначала старые' },
  { value: 'uses:desc', label: 'Больше использований' },
  { value: 'uses:asc', label: 'Меньше использований' },
  { value: 'credited:desc', label: 'Больше начислено' },
  { value: 'credited:asc', label: 'Меньше начислено' },
]

export function parsePromoSort(value: string): PromoSort {
  return value === 'uses' || value === 'credited' ? value : 'created'
}

export function parseDirection(value: string): SortDirection {
  return value === 'asc' ? 'asc' : 'desc'
}

function searchable(text: string) {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim()
}

export function filterPromos(promos: readonly Promo[], { q, state }: { q: string; state: PromoFilter }, now = Date.now()) {
  const needle = searchable(q)
  return promos.filter((promo) => (state === 'all' || promoState(promo, now) === state)
    && (!needle || searchable(promo.code).includes(needle) || searchable(promo.note ?? '').includes(needle)))
}

const sortValue: Record<PromoSort, (promo: Promo) => number> = {
  created: (promo) => (promo.createdAt ? Date.parse(promo.createdAt) || 0 : 0),
  uses: (promo) => promo.uses,
  credited: (promo) => promo.creditedKopecks,
}

/* Равные по выбранному полю идут от новых к старым, дальше по коду:
   порядок не прыгает между перезагрузками. */
export function sortPromos(promos: readonly Promo[], sort: PromoSort, direction: SortDirection): Promo[] {
  const value = sortValue[sort]
  const sign = direction === 'asc' ? 1 : -1
  return [...promos].sort((a, b) => (value(a) - value(b)) * sign
    || sortValue.created(b) - sortValue.created(a)
    || a.code.localeCompare(b.code))
}

export function pageSlice<T>(items: readonly T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages)
  return { page: current, pages, items: items.slice((current - 1) * size, current * size) }
}

/* ---------- Код, копия, пакет ---------- */

export const CODE_MAX = 32

export function isValidCode(code: string) {
  return /^[A-Z0-9_-]{3,32}$/.test(code)
}

/* Свободный код рядом с образцом: PLUS50 → PLUS50-2 → PLUS50-3. Хвост «-N»
   у образца отбрасывается, чтобы копия копии не росла в PLUS50-2-2, а длина
   не выходит за 32 знака. */
export function freeCode(base: string, taken: readonly string[]): string {
  const busy = new Set(taken)
  if (!busy.has(base)) return base
  const root = base.replace(/-\d{1,3}$/, '')
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`
    const candidate = `${root.slice(0, CODE_MAX - suffix.length)}${suffix}`
    if (!busy.has(candidate)) return candidate
  }
  return base
}

/* «Дублировать»: те же настройки, свободный код рядом с исходным. */
export function duplicateOf(promo: Promo, taken: readonly string[]): PromoSettings {
  return {
    code: freeCode(promo.code, taken),
    kind: promo.kind,
    amountKopecks: promo.amountKopecks,
    planId: promo.planId,
    planDays: promo.planDays,
    startsAt: promo.startsAt,
    expiresAt: promo.expiresAt,
    maxUses: promo.maxUses,
    active: promo.active,
    note: promo.note,
    newUsersDays: promo.newUsersDays,
  }
}

export const BATCH_MAX = 500
export const PREFIX_MAX = 20

/* Как в базе: заглавные, без дефисов по краям - «school-» и «SCHOOL»
   дают один префикс. */
export function normalizePrefix(value: string) {
  return value.trim().toUpperCase().replace(/^-+|-+$/g, '')
}

export function prefixProblem(prefix: string) {
  return /^[A-Z0-9_-]{0,20}$/.test(prefix) ? '' : `Префикс - до ${PREFIX_MAX} символов: латиница, цифры, _ и -.`
}

/* Образец для формы. Настоящие коды выбирает база: шесть случайных знаков
   без 0, O, 1, I и L - их путают, переписывая с листка. */
export function sampleCode(prefix: string) {
  return prefix ? `${prefix}-7F3K9Q` : '7F3K9Q'
}

export function parseBatchResult(data: unknown): string[] {
  const result: Row = isRecord(data) ? data : {}
  return arr(result.codes).filter((code): code is string => typeof code === 'string')
}

/* ---------- Черновик формы ---------- */

export type PromoDraft = {
  kind: PromoKind
  amount: string
  planId: string
  planDays: string
  startsAt: string
  expiresAt: string
  newUsersDays: string
}

// Поле datetime-local живёт в поясе браузера, база хранит момент времени.
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function readDraft(draft: PromoDraft) {
  return {
    amountKopecks: rublesInputToKopecks(draft.amount),
    planDays: intOrNull(draft.planDays),
    startsAt: fromLocalInput(draft.startsAt),
    expiresAt: fromLocalInput(draft.expiresAt),
    newUsersDays: draft.newUsersDays.trim() === '' ? null : intOrNull(draft.newUsersDays),
  }
}

/* Общее для одного кода и для пакета: что даёт, сроки, кому. */
export function draftProblem(draft: PromoDraft): string {
  const value = readDraft(draft)
  if (draft.kind === 'balance' && (value.amountKopecks === null || value.amountKopecks < 1 || value.amountKopecks > 1_000_000)) return 'Сумма начисления - от 0,01 до 10 000 ₽.'
  if (draft.kind === 'plan' && !draft.planId) return 'Выбери тариф.'
  if (draft.kind === 'plan' && (value.planDays === null || value.planDays < 1 || value.planDays > 3650)) return 'Срок тарифа - от 1 до 3650 дней.'
  if (draft.newUsersDays.trim() !== '' && (value.newUsersDays === null || value.newUsersDays < 1 || value.newUsersDays > 365)) return '«Только новым аккаунтам» - от 1 до 365 дней или пусто.'
  if (value.startsAt && value.expiresAt && value.startsAt >= value.expiresAt) return 'Окончание должно быть позже начала.'
  return ''
}

/* Шаблоны - только то, что умеет admin_promo_save: деньги на баланс или
   тариф на срок. Тариф по умолчанию в шаблоны не идёт: он и так у всех. */
export type PromoTemplate = { id: string; label: string; kind: PromoKind; amount: string; planId: string; days: string; code: string }

export function promoTemplates(plans: readonly PromoPlan[]): PromoTemplate[] {
  const list: PromoTemplate[] = [
    { id: 'plus50', label: '+50 ₽ на баланс', kind: 'balance', amount: '50', planId: '', days: '', code: 'PLUS50' },
    { id: 'plus100', label: '+100 ₽ на баланс', kind: 'balance', amount: '100', planId: '', days: '', code: 'PLUS100' },
  ]
  for (const plan of plans) {
    if (!plan.active || plan.isDefault) continue
    list.push({
      id: `plan:${plan.id}`,
      label: `«${plan.title}» на 7 дней`,
      kind: 'plan',
      amount: '',
      planId: plan.id,
      days: '7',
      code: `${plan.id.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 25)}-7D`,
    })
  }
  return list
}

/* ---------- Подписи ---------- */

export function promoWhat(promo: Pick<Promo, 'kind' | 'amountKopecks' | 'planId' | 'planDays'>, plans: readonly PromoPlan[]) {
  if (promo.kind === 'balance') return `+${formatKopecks(promo.amountKopecks ?? 0)} на баланс`
  const title = plans.find((plan) => plan.id === promo.planId)?.title ?? promo.planId ?? 'тариф'
  return `«${title}» на ${formatNumber(promo.planDays ?? 0)} дн.`
}

export function promoPeriod(promo: Pick<Promo, 'startsAt' | 'expiresAt'>) {
  if (!promo.startsAt && !promo.expiresAt) return 'бессрочно'
  return [promo.startsAt ? `с ${formatDateTime(promo.startsAt)}` : '', promo.expiresAt ? `до ${formatDateTime(promo.expiresAt)}` : ''].filter(Boolean).join(' ')
}

export function promoAudience(newUsersDays: number | null) {
  return newUsersDays === null ? 'все аккаунты' : `аккаунты не старше ${formatNumber(newUsersDays)} дн.`
}

/* Ссылка с кодом: баланс откроется с уже вписанным кодом (BalancePage). */
export function promoLink(code: string, origin: string) {
  return `${origin}${applicationPath('/balance')}?promo=${encodeURIComponent(code)}`
}

/* ---------- Активации ---------- */

export type Redemption = {
  id: string
  userId: string
  email: string | null
  phone: string | null
  fullName: string | null
  redeemedAt: string | null
  /** Сколько начислено на баланс. null - код выдал тариф, а не деньги. */
  creditedKopecks: number | null
  paidAfter: boolean
}

export function parseRedemption(row: Row): Redemption {
  return {
    id: str(row.id),
    userId: str(row.userId),
    email: strOrNull(row.email),
    phone: strOrNull(row.phone),
    fullName: strOrNull(row.fullName),
    redeemedAt: strOrNull(row.redeemedAt),
    creditedKopecks: numOrNull(row.creditedKopecks),
    paidAfter: bool(row.paidAfter),
  }
}

/* Кто погасил: почта, у входа по телефону - номер. */
export function redemptionWho(item: Pick<Redemption, 'email' | 'phone' | 'userId'>) {
  return item.email || (item.phone ? `+${item.phone}` : '') || item.userId
}

/* ---------- CSV ---------- */

function rublesCsv(kopecks: number | null) {
  return kopecks === null ? '' : (kopecks / 100).toFixed(2).replace('.', ',')
}

export function redemptionCsv(code: string): CsvColumn<Redemption>[] {
  return [
    { header: 'Код', value: () => code },
    { header: 'Когда', value: (item) => item.redeemedAt },
    { header: 'Почта', value: (item) => item.email },
    { header: 'Телефон', value: (item) => (item.phone ? `+${item.phone}` : '') },
    { header: 'Имя', value: (item) => item.fullName },
    { header: 'Начислено, ₽', value: (item) => rublesCsv(item.creditedKopecks) },
    { header: 'Пополнил после', value: (item) => (item.paidAfter ? 'да' : 'нет') },
    { header: 'ID пользователя', value: (item) => item.userId },
  ]
}

export function batchCsv(plans: readonly PromoPlan[], origin: string): CsvColumn<PromoSettings>[] {
  return [
    { header: 'Код', value: (promo) => promo.code },
    { header: 'Ссылка', value: (promo) => promoLink(promo.code, origin) },
    { header: 'Что даёт', value: (promo) => promoWhat(promo, plans) },
    { header: 'Начало', value: (promo) => promo.startsAt },
    { header: 'Окончание', value: (promo) => promo.expiresAt },
    { header: 'Только новым, дней', value: (promo) => promo.newUsersDays },
    { header: 'Заметка', value: (promo) => promo.note },
  ]
}
