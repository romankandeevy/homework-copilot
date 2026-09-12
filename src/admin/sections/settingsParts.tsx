/* Детали раздела «Настройки»: вкладки, которые не ломаются на узком
   экране, история изменений по сущности, пустые состояния с чертежом и
   построчная разница текстов. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { adminRpc, formatDateTime, isRecord, num, obj, rows, str, strOrNull, type Row } from '../api'
import { Button, ErrorState, Panel, Tabs, useAsync } from '../ui'
import { useAdmin } from '../context'
import { solvableSubjects } from '../../lib/subjects'

/* ---------- Вкладки ---------- */

/* Семь подвкладок в одну строку не помещаются. Уже 720 пикселей - список
   вместо вкладок. Шире - полоса вкладок прокручивается, а край, за которым
   есть ещё вкладки, гаснет в фон: видно, что полоса не кончилась. */
export function SettingsTabs<T extends string>({ value, tabs, onChange, label }: {
  value: T
  tabs: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const node = wrapRef.current?.querySelector<HTMLElement>('.adm-tabs')
    if (!node) return
    const start = node.scrollLeft > 1
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])

  useEffect(() => {
    const node = wrapRef.current?.querySelector<HTMLElement>('.adm-tabs')
    if (!node) return undefined
    measure()
    node.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure])

  // Выбранная вкладка за краем полосы: двигаем полосу, а не страницу.
  useEffect(() => {
    const node = wrapRef.current?.querySelector<HTMLElement>('.adm-tabs')
    const tab = node?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!node || !tab) return
    const box = node.getBoundingClientRect()
    const item = tab.getBoundingClientRect()
    if (item.left < box.left) node.scrollLeft -= box.left - item.left + 32
    else if (item.right > box.right) node.scrollLeft += item.right - box.right + 32
    measure()
  }, [value, measure])

  return (
    <div className="set-tabs">
      <label className="set-tabs-select adm-field">
        <span className="adm-field-label">{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value as T)}>
          {tabs.map((tab) => <option key={tab.value} value={tab.value}>{tab.label}</option>)}
        </select>
      </label>
      <div ref={wrapRef} className={`set-tabs-scroll${edges.start ? ' has-start' : ''}${edges.end ? ' has-end' : ''}`}>
        <Tabs value={value} tabs={tabs} onChange={onChange} />
      </div>
    </div>
  )
}

/* ---------- Пустое состояние с чертежом ---------- */

/* Чертёж, а не картинка: линии по модулю сетки, чернила и одна деталь
   вермильоном - то, чего пока нет и что появится после «Создать». */
function ArtGrid() {
  const vertical = Array.from({ length: 11 }, (_, index) => 16 + index * 16)
  const horizontal = Array.from({ length: 7 }, (_, index) => 16 + index * 16)
  return (
    <g className="art-grid">
      {vertical.map((x) => <line key={`v${x}`} x1={x} y1={8} x2={x} y2={120} />)}
      {horizontal.map((y) => <line key={`h${y}`} x1={8} y1={y} x2={184} y2={y} />)}
    </g>
  )
}

const ticketPath = 'M38 32H154A6 6 0 0 1 160 38V56A8 8 0 0 0 160 72V90A6 6 0 0 1 154 96H38A6 6 0 0 1 32 90V72A8 8 0 0 0 32 56V38A6 6 0 0 1 38 32Z'

export function EmptyArt({ kind }: { kind: 'plans' | 'promo' }) {
  return (
    <svg className="set-art" viewBox="0 0 192 128" aria-hidden="true" focusable="false">
      <ArtGrid />
      {kind === 'promo' ? (
        <>
          <path className="art-paper" d={ticketPath} />
          <path className="art-line" d={ticketPath} />
          <line className="art-thin art-dash" x1={120} y1={40} x2={120} y2={88} />
          <line className="art-line" x1={46} y1={52} x2={100} y2={52} />
          <line className="art-thin" x1={46} y1={64} x2={88} y2={64} />
          <line className="art-thin" x1={46} y1={76} x2={96} y2={76} />
          <circle className="art-accent" cx={140} cy={64} r={10} />
          <path className="art-accent" d="M140 58.5v11M134.5 64h11" />
          <path className="art-thin" d="M32 106v8M160 106v8M32 110h128" />
          <path className="art-thin" d="M168 32h8M168 96h8M172 32v64" />
        </>
      ) : (
        <>
          <path className="art-line" d="M20 104H172" />
          <rect className="art-block" x={32} y={64} width={36} height={40} />
          <path className="art-thin" d="M32 76h36M32 88h36" />
          <rect className="art-thin art-dash" x={80} y={48} width={36} height={56} />
          <rect className="art-thin art-dash" x={128} y={32} width={36} height={72} />
          <circle className="art-accent" cx={98} cy={76} r={10} />
          <path className="art-accent" d="M98 70.5v11M92.5 76h11" />
          <path className="art-thin" d="M176 32v72M172 32h8M172 104h8" />
          <path className="art-thin" d="M50 110v6M98 110v6M146 110v6" />
        </>
      )}
    </svg>
  )
}

export function SettingsEmpty({ art, title, children, actions }: { art: 'plans' | 'promo'; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="set-empty">
      <EmptyArt kind={art} />
      <div className="set-empty-copy">
        <h3>{title}</h3>
        <p>{children}</p>
        {actions && <div className="set-empty-actions">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------- Разница строк ---------- */

export function DiffView({ lines }: { lines: readonly { type: 'same' | 'add' | 'del'; text: string; id: number }[] }) {
  return (
    <pre className="set-diff">
      {lines.map((line) => (
        <span key={line.id} className={`is-${line.type}`}>{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.text || ' '}</span>
      ))}
    </pre>
  )
}

/* ---------- История изменений по сущности ---------- */

export type HistoryScope = 'plans' | 'promo' | 'prompts' | 'subjects' | 'flags' | 'site' | 'admins'

// Событие, с которым открывается «весь журнал»: главное для раздела.
const journalEvent: Record<HistoryScope, string> = {
  plans: 'plan_saved',
  promo: 'promo_saved',
  prompts: 'prompt_saved',
  subjects: 'subjects_saved',
  flags: 'flag_saved',
  site: 'setting_saved',
  admins: 'admin_role_changed',
}

const eventLabels: Record<string, string> = {
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
  admin_role_changed: 'Изменена роль',
}

const fieldNames: Record<string, string> = {
  enabled: 'включён',
  rollout_percent: 'раскатка, %',
  description: 'описание',
  title: 'название',
  price_kopecks: 'цена, коп.',
  period_days: 'срок, дн.',
  daily_solve_limit: 'решений в сутки',
  features: 'состав',
  is_default: 'по умолчанию',
  active: 'включён',
  sort: 'порядок',
  kind: 'тип',
  amount_kopecks: 'сумма, коп.',
  plan_id: 'тариф',
  plan_days: 'дней тарифа',
  starts_at: 'начало',
  expires_at: 'окончание',
  max_uses: 'лимит использований',
  note: 'заметка',
}

// Служебные поля меняются при каждом сохранении и заслоняют суть.
const noiseKeys = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'id', 'key', 'code', 'subject_id'])

const settingNames: Record<string, string> = {
  site_banner: 'баннер',
  support_sla_minutes: 'ответ в поддержке, мин',
  error_alert_users: 'алерт: затронуто людей',
  error_alert_window_minutes: 'окно подсчёта, мин',
  error_spike_hourly: 'всплеск: ошибок в час',
  notify_emails: 'адреса уведомлений',
  daily_summary_hour: 'час дневной сводки',
}

const roleNames: Record<string, string> = { owner: 'владелец', admin: 'администратор', support: 'поддержка' }

const subjectNames = new Map(solvableSubjects.map((subject) => [subject.id, subject.name]))

type HistoryItem = {
  id: string
  event: string
  actorEmail: string | null
  targetEmail: string | null
  payload: Row
  before: Row[string]
  after: Row[string]
  createdAt: string
}

function parseHistoryItem(row: Row): HistoryItem {
  return {
    id: String(row.id ?? ''),
    event: str(row.event),
    actorEmail: strOrNull(row.actorEmail),
    targetEmail: strOrNull(row.targetEmail),
    payload: obj(row.payload),
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: str(row.createdAt),
  }
}

function shortValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'пусто'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return String(value)
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

function objectChanges(before: Row[string], after: Row[string]): string[] {
  const left = isRecord(before) ? before : null
  const right = isRecord(after) ? after : null
  if (!left && right) return ['создан']
  if (left && !right) return ['удалён']
  if (!left || !right) return []
  const lines: string[] = []
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (noiseKeys.has(key)) continue
    const a = left[key] ?? null
    const b = right[key] ?? null
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    lines.push(`${fieldNames[key] ?? key}: ${shortValue(a)} → ${shortValue(b)}`)
  }
  return lines.length > 0 ? lines : ['без изменений']
}

function subjectChanges(before: Row[string], after: Row[string]): string[] {
  const list = (value: Row[string]) => rows(value).map((item) => ({ id: str(item.id), enabled: item.enabled === true, sort: num(item.sort) }))
  const left = list(before)
  const right = list(after)
  const lines: string[] = []
  for (const item of right) {
    const previous = left.find((entry) => entry.id === item.id)
    if (previous && previous.enabled !== item.enabled) lines.push(`${subjectNames.get(item.id) ?? item.id}: ${item.enabled ? 'включён' : 'выключен'}`)
  }
  const order = (items: typeof left) => [...items].sort((a, b) => a.sort - b.sort).map((item) => item.id).join(',')
  if (left.length > 0 && order(left) !== order(right)) lines.push('порядок изменён')
  return lines.length > 0 ? lines : ['без изменений']
}

function bannerText(value: Row[string]) {
  const banner = obj(value)
  if (banner.enabled !== true) return 'выключен'
  return `«${shortValue(str(banner.text))}»`
}

function historySummary(item: HistoryItem): string[] {
  const payload = item.payload
  const before = obj(item.before)
  const after = obj(item.after)
  switch (item.event) {
    case 'prompt_previewed':
      return [
        `${str(payload.grade, 'класс не указан')}, прогонов: ${num(payload.runs, 1)}`,
        `промпт ${num(payload.promptChars)} симв., задача ${num(payload.conditionChars)} симв.`,
      ]
    case 'prompt_saved':
      return [`версия ${shortValue(before.version)} → ${shortValue(after.version)}`, `символов: ${shortValue(before.chars)} → ${shortValue(after.chars)}`]
    case 'prompt_rolled_back':
      return [`версия ${shortValue(before.version)} → ${shortValue(after.version)}`]
    case 'prompt_disabled':
      return [`выключена версия ${shortValue(before.version)}`]
    case 'plan_disabled':
      return ['выключен, действующие выдачи отозваны']
    case 'plan_deleted':
      return ['удалён']
    case 'subjects_saved':
      return subjectChanges(item.before, item.after)
    case 'setting_saved': {
      const key = str(payload.key)
      if (key === 'site_banner') return [`баннер: ${bannerText(before.value)} → ${bannerText(after.value)}`]
      return [`${settingNames[key] ?? key}: ${shortValue(before.value)} → ${shortValue(after.value)}`]
    }
    case 'admin_role_changed': {
      const role = (value: Row[string]) => (typeof value === 'string' ? roleNames[value] ?? value : 'нет доступа')
      return [`роль: ${role(before.role)} → ${role(after.role)}`]
    }
    default:
      return objectChanges(item.before, item.after).slice(0, 4)
  }
}

function historyEntity(item: HistoryItem, scope: HistoryScope) {
  const payload = item.payload
  if (scope === 'prompts') return subjectNames.get(str(payload.subjectId)) ?? str(payload.subjectId)
  if (scope === 'admins') return item.targetEmail ?? str(payload.email)
  if (scope === 'site' || scope === 'subjects') return ''
  return str(payload.key) || str(payload.code) || str(payload.planId)
}

export function SettingsHistory({ scope, entityKey = null, refreshKey = 0, title = 'История изменений', limit = 6 }: {
  scope: HistoryScope
  entityKey?: string | null
  refreshKey?: number
  title?: string
  limit?: number
}) {
  const { openSection } = useAdmin()
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_settings_history', { p_scope: scope, p_key: entityKey, p_limit: limit }),
    [scope, entityKey, limit, refreshKey],
  )
  const items = rows(obj(data).items).map(parseHistoryItem)
  const total = num(obj(data).total)

  return (
    <Panel
      title={title}
      description="Последние записи журнала действий: кто, когда и что поменял."
      actions={(
        <Button size="sm" variant="ghost" icon={<ArrowSquareOut size={16} weight="bold" aria-hidden="true" />} onClick={() => openSection('audit', { a_event: journalEvent[scope] })}>
          Весь журнал
        </Button>
      )}
    >
      {error && <ErrorState message={error} onRetry={reload} />}
      {!error && !data && loading && (
        <div className="set-skeleton">
          <span /><span /><span />
          <span className="sr-only" role="status">Загружаем историю…</span>
        </div>
      )}
      {!error && data !== null && items.length === 0 && (
        <p className="set-history-empty">Изменений пока не было. Первое сохранение появится здесь и в журнале действий.</p>
      )}
      {!error && items.length > 0 && (
        <ol className={`set-history${loading ? ' is-stale' : ''}`}>
          {items.map((item) => {
            const entity = entityKey ? '' : historyEntity(item, scope)
            const bulk = str(item.payload.bulk)
            return (
              <li key={item.id}>
                <div className="set-history-head">
                  <strong>{eventLabels[item.event] ?? item.event}</strong>
                  {entity && <span className="adm-mono">{entity}</span>}
                  {bulk && <span className="set-history-tag">массово</span>}
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                </div>
                <span className="set-history-who">{item.actorEmail ?? 'система'}</span>
                <ul className="set-history-changes">
                  {historySummary(item).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </li>
            )
          })}
        </ol>
      )}
      {!error && total > items.length && items.length > 0 && (
        <p className="set-note set-history-more">Показаны последние {items.length} из {total}.</p>
      )}
    </Panel>
  )
}
