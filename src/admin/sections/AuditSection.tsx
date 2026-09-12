/* Журнал действий администраторов: кто, когда, с какого адреса, что
   поменял (было → стало). Вторая вкладка - все обращения к админ-API,
   её видит только владелец.

   Фильтры и агрегаты считает база: admin_audit_log_v2,
   admin_request_log_v2, admin_request_log_summary. Названия и группы
   событий, разница полей и порог частого опроса - в auditModel.ts. */

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { CaretDown, MagnifyingGlass, Warning, X } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminRpc, downloadCsv, formatDate, formatDateTime, formatNumber, num, obj, rows, str, strOrNull, todayMsk, type CsvColumn, type Row } from '../api'
import { Badge, Button, DataTable, Drawer, ErrorState, ExportButton, Field, JsonView, PageHeader, Pagination, Panel, Segmented, Tabs, useAsync, useQueryState, useToast, type Column } from '../ui'
import { useAdmin } from '../context'
import {
  POLL_PER_MINUTE,
  POLL_SUSTAINED_MINUTES,
  addDays,
  changeSummary,
  changeText,
  eventLabel,
  fieldRows,
  formatValue,
  groupedEventOptions,
  linkKind,
  parsePeriod,
  periodLabels,
  periodRange,
  pollLevel,
  type EventOption,
  type PeriodKey,
  type PollLevel,
} from './auditModel'
import './audit.css'

const roleNames: Record<string, string> = { owner: 'владелец', admin: 'админ', support: 'поддержка' }

type AuditEntry = {
  id: string
  event: string
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  actorIp: string | null
  targetUserId: string | null
  targetEmail: string | null
  targetName: string | null
  payload: Record<string, unknown>
  before: unknown
  after: unknown
  dangerous: boolean
  createdAt: string
}

function parseEntry(row: Row): AuditEntry {
  return {
    id: String(row.id ?? ''),
    event: str(row.event),
    actorId: strOrNull(row.actorId),
    actorEmail: strOrNull(row.actorEmail),
    actorRole: strOrNull(row.actorRole),
    actorIp: strOrNull(row.actorIp),
    targetUserId: strOrNull(row.targetUserId),
    targetEmail: strOrNull(row.targetEmail),
    targetName: strOrNull(row.targetName),
    payload: obj(row.payload) as Record<string, unknown>,
    before: row.before ?? null,
    after: row.after ?? null,
    dangerous: row.dangerous === true,
    createdAt: str(row.createdAt),
  }
}

type Actor = { id: string; email: string | null; role: string | null; current: boolean }

function parseActors(value: Json | undefined): Actor[] {
  return rows(value)
    .map((row) => ({ id: str(row.id), email: strOrNull(row.email), role: strOrNull(row.role), current: row.current !== false }))
    .filter((actor) => actor.id)
}

function actorName(actor: { id: string; email: string | null; role: string | null }) {
  const role = actor.role ? roleNames[actor.role] ?? actor.role : ''
  return `${actor.email ?? actor.id}${role ? ` - ${role}` : ''}`
}

function countsOf(value: Json | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(obj(value)).map(([key, count]) => [key, num(count)]))
}

function stringList(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/* ---------- Раздел ---------- */

type AuditTab = 'log' | 'requests'

export default function AuditSection() {
  const { access } = useAdmin()
  const [query, setQuery] = useQueryState({ a_tab: 'log' })
  const canSeeRequests = access.permissions.admins
  const tab: AuditTab = query.a_tab === 'requests' && canSeeRequests ? 'requests' : 'log'
  const tabs: { value: AuditTab; label: string }[] = [{ value: 'log', label: 'Действия' }]
  if (canSeeRequests) tabs.push({ value: 'requests', label: 'Обращения к админ-API' })

  return (
    <div className="aud-stack">
      <PageHeader title="Журнал" description="Каждое изменение из админки: кто, когда, с какого адреса и что было до и после." />
      {tabs.length > 1 && <Tabs value={tab} tabs={tabs} onChange={(value) => setQuery({ a_tab: value })} />}
      {tab === 'log' ? <AuditLog /> : <RequestLog />}
    </div>
  )
}

/* ---------- Общие детали ---------- */

function PeriodControl({ period, from, to, options, onChange }: {
  period: PeriodKey
  from: string
  to: string
  options: readonly PeriodKey[]
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void
}) {
  const today = todayMsk()
  return (
    <div className="aud-period">
      <span className="adm-field-label" aria-hidden="true">Период</span>
      <div className="aud-period-row">
        <Segmented
          label="Период"
          value={period}
          options={options.map((key) => ({ value: key, label: periodLabels[key] }))}
          onChange={(next) => onChange(next === 'custom'
            ? { period: next, from: from || addDays(today, -6), to: to || today }
            : { period: next, from: '', to: '' })}
        />
        {period === 'custom' && (
          <div className="adm-range-custom">
            <input type="date" value={from} max={to || today} onChange={(event) => event.target.value && onChange({ period, from: event.target.value, to })} aria-label="Начало периода" />
            <span aria-hidden="true">-</span>
            <input type="date" value={to} min={from || undefined} max={today} onChange={(event) => event.target.value && onChange({ period, from, to: event.target.value })} aria-label="Конец периода" />
          </div>
        )}
      </div>
    </div>
  )
}

function UserRef({ id, email, name }: { id: string; email: string | null; name?: string | null }) {
  const { openUser } = useAdmin()
  return (
    <span className="aud-user">
      <button type="button" className="aud-link" onClick={() => openUser(id)}>{name || email || id}</button>
      {name && email && <small>{email}</small>}
    </span>
  )
}

function ActorCell({ entry }: { entry: AuditEntry }) {
  const { openUser } = useAdmin()
  return (
    <span className="aud-actor">
      {entry.actorId
        ? <button type="button" className="aud-link" onClick={() => openUser(entry.actorId!)}>{entry.actorEmail ?? entry.actorId}</button>
        : <span>система</span>}
      {(entry.actorRole || entry.actorIp) && (
        <span className="aud-actor-meta">
          {entry.actorRole && <Badge tone={entry.actorRole === 'owner' ? 'accent' : 'neutral'}>{roleNames[entry.actorRole] ?? entry.actorRole}</Badge>}
          {entry.actorIp && <span className="adm-mono">{entry.actorIp}</span>}
        </span>
      )}
    </span>
  )
}

/* Значение из «было → стало» или подробностей. id пользователя открывает
   его карточку, id обращения - обращение в поддержке. */
function ValueView({ field, value, known }: { field: string | null; value: unknown; known: readonly string[] }) {
  const { openUser, openSection } = useAdmin()
  if (Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    return (
      <span className="aud-value-list">
        {Array.from(new Set(value)).map((item) => <ValueView key={String(item)} field={field} value={item} known={known} />)}
      </span>
    )
  }
  const kind = linkKind(field, value, known)
  if (kind === 'user') {
    return <button type="button" className="aud-link is-mono" title="Открыть карточку пользователя" onClick={() => openUser(value as string)}>{value as string}</button>
  }
  if (kind === 'conversation') {
    return <button type="button" className="aud-link is-mono" title="Открыть обращение в поддержке" onClick={() => openSection('support', { conversation: value as string })}>{value as string}</button>
  }
  const empty = value === null || value === undefined || value === ''
  return <span className={`aud-value${empty ? ' is-empty' : ''}`}>{formatValue(value, 4000)}</span>
}

/* ---------- Выбор события: поиск и группы ---------- */

function EventPicker({ value, counts, onChange }: { value: string; counts: Record<string, number>; onChange: (event: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-opt-${index}`
  const searching = search.trim() !== ''
  const groups = useMemo(() => groupedEventOptions(counts, search), [counts, search])
  const options = useMemo<EventOption[]>(() => {
    const all = groups.flatMap((group) => group.options)
    return searching ? all : [{ key: '', label: 'Все события', count: 0 }, ...all]
  }, [groups, searching])

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, baseId])

  const show = () => {
    const all = groupedEventOptions(counts).flatMap((group) => group.options)
    setSearch('')
    setActive(value ? all.findIndex((option) => option.key === value) + 1 : 0)
    setOpen(true)
  }

  const close = (focusTrigger: boolean) => {
    setOpen(false)
    setSearch('')
    if (focusTrigger) triggerRef.current?.focus()
  }

  const choose = (key: string) => {
    onChange(key)
    close(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option) choose(option.key)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  let index = -1
  const renderOption = (option: EventOption) => {
    index += 1
    const current = index
    return (
      <li
        key={option.key || 'all'}
        id={optionId(current)}
        role="option"
        aria-selected={option.key === value}
        className={`aud-combo-option${current === active ? ' is-active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => { if (current !== active) setActive(current) }}
        onClick={() => choose(option.key)}
      >
        <span className="aud-combo-label">{option.label}</span>
        {option.count > 0 && <span className="aud-combo-count" title="Записей в журнале">{formatNumber(option.count)}</span>}
        {option.key && <span className="aud-combo-key">{option.key}</span>}
      </li>
    )
  }

  return (
    <div className="aud-combo" ref={rootRef}>
      <span className="adm-field-label" id={`${baseId}-caption`}>Событие</span>
      <button
        ref={triggerRef}
        type="button"
        className="aud-combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${baseId}-caption ${baseId}-value`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            show()
          }
        }}
      >
        <span className="aud-combo-value" id={`${baseId}-value`}>
          <span>{value ? eventLabel(value) : 'Все события'}</span>
          {value && <small>{value}</small>}
        </span>
        <CaretDown className="aud-combo-caret" size={16} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div className="aud-combo-pop">
          <div className="aud-combo-search">
            <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
              aria-label="Найти событие"
              placeholder="Название или ключ события"
              autoComplete="off"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="События" className="aud-combo-list">
            {!searching && renderOption(options[0])}
            {groups.map((group, groupIndex) => (
              <li key={group.title} role="presentation">
                <div className="aud-combo-group" id={`${baseId}-group-${groupIndex}`}>{group.title}</div>
                <ul role="group" aria-labelledby={`${baseId}-group-${groupIndex}`}>
                  {group.options.map(renderOption)}
                </ul>
              </li>
            ))}
            {options.length === 0 && <li className="aud-combo-empty" role="presentation">Такого события нет. Попробуй часть названия или ключ.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------- Действия ---------- */

const PAGE_SIZE = 50
// База отдаёт не больше 200 строк за раз, выгрузка собирает страницы.
const EXPORT_CHUNK = 200
const EXPORT_LIMIT = 1000

const AUDIT_PERIODS: readonly PeriodKey[] = ['all', 'today', '7d', '30d', 'custom']
const AUDIT_DEFAULTS = { a_event: '', a_actor: '', a_user: '', a_period: 'all', a_from: '', a_to: '', a_danger: '', a_page: '1' }

function AuditLog() {
  const toast = useToast()
  const [query, setQuery] = useQueryState(AUDIT_DEFAULTS)
  const page = Math.max(1, Number.parseInt(query.a_page, 10) || 1)
  const [exporting, setExporting] = useState(false)
  const [openEntry, setOpenEntry] = useState<AuditEntry | null>(null)

  const period = parsePeriod(query.a_period, AUDIT_PERIODS, 'all')
  const range = periodRange(period, { from: query.a_from, to: query.a_to }, todayMsk())
  const dangerous = query.a_danger === '1'
  const filters = {
    p_event: query.a_event || null,
    p_actor: query.a_actor || null,
    p_user: query.a_user || null,
    p_from: range.from,
    p_to: range.to,
    p_dangerous: dangerous,
  }
  const filtered = Boolean(query.a_event || query.a_actor || query.a_user || dangerous || period !== 'all')

  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_audit_log_v2', { ...filters, p_page: page, p_page_size: PAGE_SIZE }),
    [query.a_event, query.a_actor, query.a_user, range.from, range.to, dangerous, page],
  )
  const payload = obj(data)
  const items = useMemo(() => rows(obj(data).items).map(parseEntry), [data])
  const actors = useMemo(() => parseActors(obj(data).actors), [data])
  const counts = useMemo(() => countsOf(obj(data).eventCounts), [data])
  const dangerLabels = useMemo(() => stringList(obj(data).dangerEvents).map((key) => eventLabel(key).toLowerCase()), [data])
  const total = num(payload.total)
  const hasSystem = payload.hasSystem === true
  const oldestAt = strOrNull(payload.oldestAt)

  const currentActors = actors.filter((actor) => actor.current)
  const formerActors = actors.filter((actor) => !actor.current)
  const actorKnown = !query.a_actor || query.a_actor === 'system' || actors.some((actor) => actor.id === query.a_actor)
  const todayOnly = period === 'today' && !query.a_event && !query.a_actor && !query.a_user && !dangerous

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('user') ?? '').trim()
    setQuery({ a_user: value, a_page: '1' })
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const collected: AuditEntry[] = []
      let expected = Infinity
      for (let chunk = 1; collected.length < Math.min(expected, EXPORT_LIMIT); chunk += 1) {
        // Страницы по очереди: следующая нужна, только если предыдущая была полной.
        // eslint-disable-next-line no-await-in-loop
        const result = obj(await adminRpc('admin_audit_log_v2', { ...filters, p_page: chunk, p_page_size: EXPORT_CHUNK }))
        expected = num(result.total)
        const part = rows(result.items).map(parseEntry)
        collected.push(...part)
        if (part.length < EXPORT_CHUNK) break
      }
      const exported = collected.slice(0, EXPORT_LIMIT)
      const columns: CsvColumn<AuditEntry>[] = [
        { header: 'Дата', value: (entry) => entry.createdAt },
        { header: 'Событие', value: (entry) => eventLabel(entry.event) },
        { header: 'Код события', value: (entry) => entry.event },
        { header: 'Опасное', value: (entry) => (entry.dangerous ? 'да' : '') },
        { header: 'Кто', value: (entry) => entry.actorEmail ?? (entry.actorId ? entry.actorId : 'система') },
        { header: 'Роль', value: (entry) => (entry.actorRole ? roleNames[entry.actorRole] ?? entry.actorRole : '') },
        { header: 'IP', value: (entry) => entry.actorIp },
        { header: 'Пользователь', value: (entry) => entry.targetEmail },
        { header: 'Имя', value: (entry) => entry.targetName },
        { header: 'ID пользователя', value: (entry) => entry.targetUserId },
        { header: 'Изменения', value: (entry) => changeText(entry.before, entry.after) },
        { header: 'Подробности', value: (entry) => (Object.keys(entry.payload).length ? JSON.stringify(entry.payload) : '') },
      ]
      downloadCsv(`audit-${query.a_event || 'all'}-${todayMsk()}`, exported, columns)
      if (expected > exported.length) toast.info(`В файл попали последние ${formatNumber(exported.length)} из ${formatNumber(expected)} записей. Уточни фильтр.`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Не получилось выгрузить журнал.')
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'Когда', render: (entry) => <span className="adm-nowrap">{formatDateTime(entry.createdAt)}</span> },
    { key: 'actor', header: 'Кто', render: (entry) => <ActorCell entry={entry} /> },
    {
      key: 'event',
      header: 'Событие',
      render: (entry) => (
        <span className="aud-event">
          <span className="aud-event-title">
            {eventLabel(entry.event)}
            {entry.dangerous && <Badge tone="danger">опасное</Badge>}
          </span>
          <span className="aud-event-key">{entry.event}</span>
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Пользователь',
      render: (entry) => (entry.targetUserId
        ? <UserRef id={entry.targetUserId} email={entry.targetEmail} name={entry.targetName} />
        : <span className="adm-muted">-</span>),
    },
    {
      key: 'change',
      header: 'Было → стало',
      render: (entry) => {
        const text = changeSummary(entry.before, entry.after, entry.payload)
        return (
          <button type="button" className="aud-link aud-summary" title={text || undefined} onClick={() => setOpenEntry(entry)}>
            {text || 'Подробности'}
          </button>
        )
      },
    },
  ]

  return (
    <Panel
      title="Действия администраторов"
      description="Хранится без срока: плановая уборка базы этот журнал не чистит."
      actions={<ExportButton onExport={() => void exportCsv()} loading={exporting} />}
    >
      <div className="aud-filters">
        <div className="aud-presets">
          <div className="adm-segmented" role="group" aria-label="Быстрые фильтры">
            <button
              type="button"
              className={todayOnly ? 'is-selected' : ''}
              aria-pressed={todayOnly}
              onClick={() => setQuery(todayOnly ? AUDIT_DEFAULTS : { ...AUDIT_DEFAULTS, a_period: 'today' })}
            >
              Только сегодня
            </button>
            <button
              type="button"
              className={dangerous ? 'is-selected' : ''}
              aria-pressed={dangerous}
              onClick={() => setQuery({ a_danger: dangerous ? '' : '1', a_page: '1' })}
            >
              <Warning size={14} weight="bold" aria-hidden="true" />
              Опасные действия
            </button>
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" icon={<X size={14} weight="bold" aria-hidden="true" />} onClick={() => setQuery(AUDIT_DEFAULTS)}>
              Сбросить фильтры
            </Button>
          )}
        </div>
        {dangerous && dangerLabels.length > 0 && (
          <p className="aud-note">
            Опасными считаются: {dangerLabels.join(', ')}, а также списание с баланса и выравнивание баланса вниз.
          </p>
        )}
        <div className="aud-filters-row">
          <EventPicker value={query.a_event} counts={counts} onChange={(event) => setQuery({ a_event: event, a_page: '1' })} />
          <Field label="Кто">
            <select value={query.a_actor} onChange={(event) => setQuery({ a_actor: event.target.value, a_page: '1' })}>
              <option value="">Все</option>
              {(hasSystem || query.a_actor === 'system') && <option value="system">Система, по расписанию</option>}
              {currentActors.length > 0 && (
                <optgroup label="Администраторы">
                  {currentActors.map((actor) => <option key={actor.id} value={actor.id}>{actorName(actor)}</option>)}
                </optgroup>
              )}
              {formerActors.length > 0 && (
                <optgroup label="Бывшие администраторы">
                  {formerActors.map((actor) => <option key={actor.id} value={actor.id}>{actorName(actor)}</option>)}
                </optgroup>
              )}
              {!actorKnown && <option value={query.a_actor}>{query.a_actor}</option>}
            </select>
          </Field>
          <form className="aud-search" role="search" onSubmit={onSearch}>
            <Field label="Ученик">
              <input key={query.a_user} name="user" type="search" defaultValue={query.a_user} placeholder="Почта, имя или id" autoComplete="off" />
            </Field>
            <Button type="submit" icon={<MagnifyingGlass size={16} weight="bold" aria-hidden="true" />}>Найти</Button>
          </form>
        </div>
        <PeriodControl
          period={period}
          from={query.a_from}
          to={query.a_to}
          options={AUDIT_PERIODS}
          onChange={(next) => setQuery({ a_period: next.period, a_from: next.from, a_to: next.to, a_page: '1' })}
        />
      </div>

      {error
        ? <ErrorState message={error} onRetry={reload} />
        : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(entry) => entry.id}
            loading={loading}
            onRowClick={(entry) => setOpenEntry(entry)}
            empty={filtered ? 'По этим фильтрам записей нет. Сбрось фильтры или расширь период.' : 'Записей пока нет: здесь появится первое изменение из админки.'}
          />
        )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ a_page: String(next) })} />
      <p className="aud-note">
        Записи удаляются только вместе с аккаунтом их автора. Если удалён пользователь, над которым совершено действие, запись остаётся, но без ссылки на него.
        {oldestAt ? ` Самая ранняя запись в журнале: ${formatDate(oldestAt)}` : ''}
      </p>

      {openEntry && (
        <EntryDrawer
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
          onFilterUser={(userId) => {
            setOpenEntry(null)
            setQuery({ ...AUDIT_DEFAULTS, a_user: userId })
          }}
        />
      )}
    </Panel>
  )
}

function EntryDrawer({ entry, onClose, onFilterUser }: { entry: AuditEntry; onClose: () => void; onFilterUser: (userId: string) => void }) {
  const known = [entry.targetUserId, entry.actorId].filter((id): id is string => Boolean(id))
  const fields = fieldRows(entry.before, entry.after)
  const changedCount = fields.filter((row) => row.changed).length
  const created = entry.before === null && entry.after !== null
  const removed = entry.before !== null && entry.after === null
  const payloadKeys = Object.keys(entry.payload)
  const hint = created ? 'запись создана' : removed ? 'запись удалена' : `изменено полей: ${changedCount} из ${fields.length}`
  const full = {
    id: entry.id,
    event: entry.event,
    createdAt: entry.createdAt,
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    actorIp: entry.actorIp,
    targetUserId: entry.targetUserId,
    targetEmail: entry.targetEmail,
    dangerous: entry.dangerous,
    payload: entry.payload,
    before: entry.before,
    after: entry.after,
  }

  return (
    <Drawer open wide title={eventLabel(entry.event)} subtitle={<span className="adm-mono">{entry.event}</span>} onClose={onClose}>
      <dl className="adm-kv">
        <dt>Когда</dt>
        <dd>{formatDateTime(entry.createdAt)}, время московское</dd>
        <dt>Кто</dt>
        <dd><ActorCell entry={entry} /></dd>
        <dt>Пользователь</dt>
        <dd>{entry.targetUserId ? <UserRef id={entry.targetUserId} email={entry.targetEmail} name={entry.targetName} /> : <span className="adm-muted">не указан</span>}</dd>
        {entry.dangerous && (
          <>
            <dt>Отметка</dt>
            <dd><Badge tone="danger">опасное действие</Badge></dd>
          </>
        )}
      </dl>
      {entry.targetUserId && (
        <div className="aud-drawer-actions">
          <Button size="sm" onClick={() => onFilterUser(entry.targetUserId!)}>Вся история действий над пользователем</Button>
        </div>
      )}

      <section className="aud-section">
        <div className="aud-section-head">
          <h3 className="aud-subhead">Было → стало</h3>
          {fields.length > 0 && <span className="aud-section-hint">{hint}</span>}
        </div>
        {fields.length === 0
          ? <p className="aud-section-hint">Это событие не хранит состояние до и после. Всё, что записано, - в подробностях ниже.</p>
          : (
            <div className="aud-diff-wrap">
              <table className="aud-diff-table">
                <thead>
                  <tr>
                    <th scope="col">Поле</th>
                    {!created && <th scope="col">Было</th>}
                    {!removed && <th scope="col">Стало</th>}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((row) => (
                    <tr key={row.key} className={row.changed ? 'is-changed' : 'is-same'}>
                      <td>{row.key}</td>
                      {!created && <td className="aud-cell-before"><ValueView field={row.key} value={row.before} known={known} /></td>}
                      {!removed && <td className="aud-cell-after"><ValueView field={row.key} value={row.after} known={known} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {payloadKeys.length > 0 && (
        <section className="aud-section">
          <h3 className="aud-subhead">Подробности</h3>
          <dl className="adm-kv">
            {payloadKeys.map((key) => (
              <Fragment key={key}>
                <dt className="adm-mono">{key}</dt>
                <dd><ValueView field={key} value={entry.payload[key]} known={known} /></dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}

      <section className="aud-section">
        <h3 className="aud-subhead">Полный JSON</h3>
        <JsonView value={full} maxHeight={360} />
      </section>
    </Drawer>
  )
}

/* ---------- Обращения к админ-API ---------- */

const REQUEST_PAGE_SIZE = 100
const SUMMARY_LIMIT = 50
const REQUEST_PERIODS: readonly PeriodKey[] = ['today', '7d', '30d', '90d', 'custom']
const REQUEST_DEFAULTS = { a_rview: 'list', a_rpath: '', a_rperiod: '7d', a_rfrom: '', a_rto: '', a_ractor: '', a_rip: '', a_rpage: '1' }

type RequestView = 'list' | 'summary'

type PathSummary = {
  path: string
  calls: number
  share: number
  peakPerMinute: number
  peakAt: string | null
  activeMinutes: number
  hotMinutes: number
  lastAt: string | null
  level: PollLevel
}

function parseSummary(row: Row): PathSummary {
  const peakPerMinute = num(row.peakPerMinute)
  const hotMinutes = num(row.hotMinutes)
  return {
    path: str(row.path),
    calls: num(row.calls),
    share: num(row.share),
    peakPerMinute,
    peakAt: strOrNull(row.peakAt),
    activeMinutes: num(row.activeMinutes),
    hotMinutes,
    lastAt: strOrNull(row.lastAt),
    level: pollLevel(peakPerMinute, hotMinutes),
  }
}

function PathText({ path }: { path: string }) {
  return path ? <span className="adm-mono">{path}</span> : <span className="adm-muted">без пути</span>
}

function PollNote({ item }: { item: PathSummary }) {
  if (item.level === 'ok') return null
  const text = item.level === 'danger'
    ? `Похоже на частый опрос: чаще ${POLL_PER_MINUTE} в минуту на протяжении ${formatNumber(item.hotMinutes)} мин. из ${formatNumber(item.activeMinutes)}.`
    : `Похоже на частый опрос: в пике ${formatNumber(item.peakPerMinute)} в минуту при пороге ${POLL_PER_MINUTE}.`
  return (
    <span className={`aud-poll is-${item.level}`}>
      <Warning size={14} weight="fill" aria-hidden="true" />
      <span>{text}</span>
    </span>
  )
}

function RequestLog() {
  const [query, setQuery] = useQueryState(REQUEST_DEFAULTS)
  const view: RequestView = query.a_rview === 'summary' ? 'summary' : 'list'
  const page = Math.max(1, Number.parseInt(query.a_rpage, 10) || 1)
  const period = parsePeriod(query.a_rperiod, REQUEST_PERIODS, '7d')
  const range = periodRange(period, { from: query.a_rfrom, to: query.a_rto }, todayMsk())
  const filters = { p_path: query.a_rpath || null, p_from: range.from, p_to: range.to, p_actor_id: query.a_ractor || null, p_ip: query.a_rip || null }
  const filtered = Boolean(query.a_rpath || query.a_ractor || query.a_rip)
  const pathsId = useId()
  const ipsId = useId()
  const listPage = view === 'list' ? page : 1

  // Список нужен и в сводке: из него подсказки путей, адресов и администраторов.
  const list = useAsync(
    () => adminRpc('admin_request_log_v2', { ...filters, p_page: listPage, p_page_size: view === 'list' ? REQUEST_PAGE_SIZE : 1 }),
    [query.a_rpath, range.from, range.to, query.a_ractor, query.a_rip, view, listPage],
  )
  const summary = useAsync(
    () => (view === 'summary'
      ? adminRpc('admin_request_log_summary', { ...filters, p_threshold: POLL_PER_MINUTE, p_limit: SUMMARY_LIMIT })
      : Promise.resolve(null)),
    [query.a_rpath, range.from, range.to, query.a_ractor, query.a_rip, view],
  )

  const listData = obj(list.data)
  const summaryData = obj(summary.data)
  const items = rows(listData.items)
  const total = num(listData.total)
  const myIp = strOrNull(listData.myIp)
  const paths = rows(listData.paths).filter((row) => str(row.path))
  const ips = rows(listData.ips)
  const actors = rows(listData.actors)
  const summaryItems = useMemo(() => rows(obj(summary.data).items).map(parseSummary), [summary.data])
  const hotCount = summaryItems.filter((item) => item.level !== 'ok').length

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setQuery({ a_rpath: String(form.get('path') ?? '').trim(), a_rip: String(form.get('ip') ?? '').trim(), a_rpage: '1' })
  }

  const listColumns: Column<Row>[] = [
    { key: 'when', header: 'Когда', render: (row) => <span className="adm-nowrap">{formatDateTime(str(row.createdAt))}</span> },
    { key: 'who', header: 'Кто', render: (row) => str(row.actorEmail, str(row.actorId)) },
    { key: 'role', header: 'Роль', mobile: false, render: (row) => <Badge>{roleNames[str(row.role)] ?? str(row.role)}</Badge> },
    {
      key: 'path',
      header: 'Путь',
      render: (row) => (str(row.path)
        ? <button type="button" className="aud-link is-mono" title="Показать только этот путь" onClick={() => setQuery({ a_rpath: str(row.path), a_rpage: '1' })}>{str(row.path)}</button>
        : <PathText path="" />),
    },
    {
      key: 'ip',
      header: 'IP',
      render: (row) => {
        const ip = str(row.ip)
        if (!ip) return <span className="adm-muted">-</span>
        return (
          <span className="aud-ip">
            <button type="button" className="aud-link is-mono" title="Показать только этот адрес" onClick={() => setQuery({ a_rip: ip, a_rpage: '1' })}>{ip}</button>
            {myIp && ip === myIp && <Badge tone="accent" title="Этот адрес у текущей сессии">это вы</Badge>}
          </span>
        )
      },
    },
  ]

  const summaryColumns: Column<PathSummary>[] = [
    {
      key: 'path',
      header: 'Путь',
      render: (item) => (
        <span className="aud-event">
          <PathText path={item.path} />
          <PollNote item={item} />
        </span>
      ),
    },
    { key: 'calls', header: 'Вызовов', align: 'right', render: (item) => <span className="aud-num">{formatNumber(item.calls)}</span> },
    {
      key: 'share',
      header: 'Доля',
      render: (item) => (
        <span className="aud-share">
          <span className="aud-num">{formatNumber(item.share)} %</span>
          <span className="aud-share-bar" style={{ width: `${Math.min(100, Math.max(0, item.share))}%` }} aria-hidden="true" />
        </span>
      ),
    },
    {
      key: 'peak',
      header: 'В пике, в минуту',
      align: 'right',
      render: (item) => (
        <span className="aud-event">
          <span className="aud-num">{formatNumber(item.peakPerMinute)}</span>
          {item.peakAt && <span className="aud-event-key">{formatDateTime(item.peakAt)}</span>}
        </span>
      ),
    },
    {
      key: 'hot',
      header: `Минут чаще ${POLL_PER_MINUTE}`,
      align: 'right',
      mobile: false,
      render: (item) => <span className="aud-num">{formatNumber(item.hotMinutes)} из {formatNumber(item.activeMinutes)}</span>,
    },
    { key: 'last', header: 'Последний вызов', mobile: false, render: (item) => <span className="adm-nowrap">{item.lastAt ? formatDateTime(item.lastAt) : '-'}</span> },
  ]

  return (
    <Panel
      title="Обращения к админ-API"
      description="Каждый вызов функции админки после проверки роли и второго фактора. Хранится 90 дней: более старые записи удаляет ежедневная уборка базы."
    >
      <div className="aud-filters">
        <div className="aud-presets">
          <Segmented
            label="Вид"
            value={view}
            options={[{ value: 'list', label: 'Список' }, { value: 'summary', label: 'Сводка' }]}
            onChange={(next) => setQuery({ a_rview: next, a_rpage: '1' })}
          />
          {filtered && (
            <Button size="sm" variant="ghost" icon={<X size={14} weight="bold" aria-hidden="true" />} onClick={() => setQuery({ a_rpath: '', a_ractor: '', a_rip: '', a_rpage: '1' })}>
              Сбросить фильтры
            </Button>
          )}
        </div>
        <form className="aud-filters-row" role="search" onSubmit={apply}>
          <Field label="Путь" className="is-grow">
            <input key={query.a_rpath} name="path" type="search" list={pathsId} defaultValue={query.a_rpath} placeholder="Например, admin_users_list" autoComplete="off" />
          </Field>
          <Field label="IP">
            <input key={query.a_rip} name="ip" type="search" list={ipsId} defaultValue={query.a_rip} placeholder="Начало адреса" autoComplete="off" />
          </Field>
          <Field label="Администратор">
            <select value={query.a_ractor} onChange={(event) => setQuery({ a_ractor: event.target.value, a_rpage: '1' })}>
              <option value="">Все</option>
              {actors.map((row) => (
                <option key={str(row.id)} value={str(row.id)}>{actorName({ id: str(row.id), email: strOrNull(row.email), role: strOrNull(row.role) })}</option>
              ))}
            </select>
          </Field>
          <Button type="submit" icon={<MagnifyingGlass size={16} weight="bold" aria-hidden="true" />}>Найти</Button>
          <datalist id={pathsId}>
            {paths.map((row) => <option key={str(row.path)} value={str(row.path)}>{`${formatNumber(num(row.calls))} вызовов`}</option>)}
          </datalist>
          <datalist id={ipsId}>
            {ips.map((row) => <option key={str(row.ip)} value={str(row.ip)}>{`${formatNumber(num(row.calls))} вызовов${myIp && str(row.ip) === myIp ? ', это вы' : ''}`}</option>)}
          </datalist>
        </form>
        <PeriodControl
          period={period}
          from={query.a_rfrom}
          to={query.a_rto}
          options={REQUEST_PERIODS}
          onChange={(next) => setQuery({ a_rperiod: next.period, a_rfrom: next.from, a_rto: next.to, a_rpage: '1' })}
        />
      </div>

      {list.data !== null && (
        <dl className="aud-meta">
          <div><dt>Вызовов</dt><dd>{formatNumber(total)}</dd></div>
          <div><dt>Разных IP</dt><dd>{formatNumber(num(listData.distinctIps))}</dd></div>
          {view === 'summary' && summary.data !== null && <div><dt>Разных путей</dt><dd>{formatNumber(num(summaryData.distinctPaths))}</dd></div>}
          <div>
            <dt>IP этой сессии</dt>
            <dd>{myIp ? <span className="adm-mono">{myIp}</span> : <span className="aud-value is-empty">база его не получила</span>}</dd>
          </div>
        </dl>
      )}

      {view === 'list'
        ? (
          <>
            {list.error
              ? <ErrorState message={list.error} onRetry={list.reload} />
              : (
                <DataTable
                  columns={listColumns}
                  rows={items}
                  rowKey={(row) => String(row.id ?? '')}
                  loading={list.loading}
                  empty={filtered ? 'По этим фильтрам вызовов нет. Сбрось фильтры или расширь период.' : 'За период вызовов нет.'}
                />
              )}
            <Pagination page={page} pageSize={REQUEST_PAGE_SIZE} total={total} onPage={(next) => setQuery({ a_rpage: String(next) })} />
          </>
        )
        : (
          <>
            {summary.error
              ? <ErrorState message={summary.error} onRetry={summary.reload} />
              : (
                <DataTable
                  columns={summaryColumns}
                  rows={summaryItems}
                  rowKey={(item) => item.path || 'без пути'}
                  loading={summary.loading}
                  onRowClick={(item) => setQuery({ a_rview: 'list', a_rpath: item.path, a_rpage: '1' })}
                  rowClassName={(item) => (item.level === 'danger' ? 'aud-poll-danger' : item.level === 'warning' ? 'aud-poll-warning' : '')}
                  empty={filtered ? 'По этим фильтрам вызовов нет.' : 'За период вызовов нет.'}
                />
              )}
            <p className="aud-note">
              Порог - {POLL_PER_MINUTE} вызова одного пути в минуту: чаще живой администратор одну функцию не зовёт.
              Жёлтым отмечен путь, у которого порог превышен в пике; красным - превышен в {POLL_SUSTAINED_MINUTES} и больше разных минутах периода.
              {hotCount > 0 ? ` Таких путей сейчас: ${formatNumber(hotCount)}.` : ''}
              {` Показаны до ${SUMMARY_LIMIT} самых частых путей. Нажми на строку, чтобы открыть вызовы этого пути списком.`}
            </p>
          </>
        )}
    </Panel>
  )
}
