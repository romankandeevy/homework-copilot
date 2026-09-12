/* Вкладка «Ошибки»: алерты, четыре карточки, график по времени и список
   групп - таблицей или хронологией событий. Всё обновляется само: по
   сигналу Realtime админки и тихим опросом. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretRight, Warning, WarningOctagon, X } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminRpc, arr, formatDateTime, formatNumber, num, numOrNull, obj, relativeTime, rows, shiftDate, str, strOrNull, todayMsk } from '../api'
import type { Row } from '../api'
import { Badge, Button, DataTable, ErrorState, Field, Pagination, Panel, Segmented, Stat, StatGrid, useAction, useQueryState } from '../ui'
import type { Column } from '../ui'
import { useAdmin } from '../context'
import { HeaderHint, LiveStatus } from './monitoringShared'
import { errorStatusLabels, errorStatusTones, kindLabels, kindOrder, oldest, pushParams, serviceLabel, severityLabels, severityTones } from './monitoringLabels'
import type { ErrorKind } from './monitoringLabels'
import { useLiveQuery } from './useLiveQuery'
import { errorsWord, formatClockMsk, formatDayHeading, formatExactMsk, formatMinutes, mskDayKey } from './monitoringFormat'
import { ErrorChart } from './MonitoringErrorChart'
import type { ErrorBucket } from './MonitoringErrorChart'
import { ErrorsEmpty } from './MonitoringEmpty'
import { ErrorDetailDrawer } from './MonitoringErrorDrawer'

const PAGE_SIZE = 50
const TIMELINE_PAGE = 50

const errorStatusOptions = [
  { value: 'open', label: 'Открытые' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решённые' },
  { value: 'ignored', label: 'Игнор' },
  { value: 'all', label: 'Все' },
]

type Period = 'day' | 'week' | 'month'
const periodOptions: { value: Period; label: string }[] = [
  { value: 'day', label: '24 ч' },
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
]
const periodWords: Record<Period, string> = { day: '24 часа', week: '7 дней', month: '30 дней' }

type View = 'table' | 'timeline'

const bulkActions = [
  { status: 'in_progress', label: 'В работу' },
  { status: 'resolved', label: 'Решено' },
  { status: 'ignored', label: 'Игнорировать' },
]

type ErrorGroup = {
  fingerprint: string
  kind: string
  severity: string
  route: string | null
  title: string
  status: string
  occurrences: number
  usersAffected: number
  firstSeenAt: string
  lastSeenAt: string
  last7Days: number
  lastHour: number
  periodCount: number | null
}

function parseErrorGroup(row: Row): ErrorGroup {
  return {
    fingerprint: str(row.fingerprint),
    kind: str(row.kind),
    severity: str(row.severity, 'error'),
    route: strOrNull(row.route),
    title: str(row.title, 'Без названия'),
    status: str(row.status, 'new'),
    occurrences: num(row.occurrences),
    usersAffected: num(row.usersAffected),
    firstSeenAt: str(row.firstSeenAt),
    lastSeenAt: str(row.lastSeenAt),
    last7Days: arr(row.trend).reduce<number>((sum, value) => sum + num(value), 0),
    lastHour: num(row.lastHour),
    periodCount: numOrNull(row.periodCount),
  }
}

/* День по Москве в границы для базы: [с 00:00, до 00:00 следующего дня). */
function mskStart(day: string) {
  return day ? `${day}T00:00:00+03:00` : null
}
function mskEnd(day: string) {
  return day ? `${shiftDate(day, 1)}T00:00:00+03:00` : null
}

/* ---------- Алерты ---------- */

type Alert = { id: string; level: 'danger' | 'warning'; title: string; detail: string; action?: { label: string; run: () => void } }

function buildAlerts(list: Row[]): Alert[] {
  return list.map((alert) => {
    const kind = str(alert.kind)
    const level = str(alert.level) === 'danger' ? 'danger' : 'warning'
    const id = str(alert.id, kind)
    const norm = numOrNull(alert.norm)
    const normText = norm === null || norm === 0 ? 'обычно за час ошибок почти нет' : `обычно ${formatNumber(norm)} в час по среднему за 7 дней`
    if (kind === 'errors_threshold') {
      return { id, level, title: `За последний час ${errorsWord(num(alert.value))}: больше порога ${formatNumber(num(alert.threshold))}`, detail: `Для сравнения: ${normText}. Порог - в «Настройки», строка «Всплеск: ошибок за час больше».` }
    }
    if (kind === 'errors_spike') {
      const ratio = numOrNull(alert.ratio)
      return { id, level, title: `Всплеск: ${errorsWord(num(alert.value))} за последний час`, detail: ratio ? `Это в ${formatNumber(ratio)} раза больше нормы: ${normText}.` : `Для сравнения: ${normText}.` }
    }
    if (kind === 'service_down') {
      const detail = str(alert.detail)
      return {
        id,
        level,
        title: `${serviceLabel(str(alert.service))} не отвечает ${formatMinutes(num(alert.minutes))}`,
        detail: `С ${formatDateTime(strOrNull(alert.since))}. Ответ проверки: ${str(alert.status) || 'нет'}${detail ? `, ${detail}` : ''}.`,
        action: { label: 'Открыть «Состояние»', run: () => pushParams({ m_tab: 'health', fingerprint: '', m_event: '' }) },
      }
    }
    if (kind === 'checks_stale') {
      return {
        id,
        level,
        title: `Проверки сервисов не приходили ${formatMinutes(num(alert.minutes))}`,
        detail: `Последняя - ${formatDateTime(strOrNull(alert.since))}. Похоже, встало задание admin-cron, и светофор показывает прошлое.`,
        action: { label: 'Открыть «Состояние»', run: () => pushParams({ m_tab: 'health', fingerprint: '', m_event: '' }) },
      }
    }
    if (kind === 'api_5xx') {
      const normShare = numOrNull(alert.norm)
      return {
        id,
        level,
        title: `API: ${formatNumber(num(alert.value))} % запросов за час закончились ошибкой 5xx`,
        detail: `${formatNumber(num(alert.failed))} из ${formatNumber(num(alert.total))} по журналу запросов. Обычно ${normShare === null ? 'таких нет' : `${formatNumber(normShare)} %`} по неделе.`,
      }
    }
    return { id, level, title: 'Тревога мониторинга', detail: kind }
  })
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null
  return (
    <ul className="mon-alerts" aria-label="Тревоги">
      {alerts.map((alert) => (
        <li key={alert.id} className={`mon-alert is-${alert.level}`}>
          {alert.level === 'danger'
            ? <WarningOctagon size={22} weight="fill" aria-hidden="true" />
            : <Warning size={22} weight="fill" aria-hidden="true" />}
          <div className="mon-alert-text">
            <strong>{alert.title}</strong>
            <span>{alert.detail}</span>
          </div>
          {alert.action && <Button size="sm" onClick={alert.action.run}>{alert.action.label}</Button>}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Маршрут с подсказками ---------- */

function RouteField({ value, onApply }: { value: string; onApply: (route: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [options, setOptions] = useState<{ route: string; errors: number; requests: number }[]>([])
  const listId = 'mon-route-options'

  useEffect(() => { setDraft(value) }, [value])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      adminRpc<Json>('admin_error_routes', { p_query: draft.trim(), p_limit: 20 })
        .then((result) => {
          if (!active) return
          setOptions(rows(result).map((row) => ({ route: str(row.route), errors: num(row.errors), requests: num(row.requests) })).filter((row) => row.route))
        })
        // Подсказки - помощь, а не работа: без них поле остаётся обычным вводом.
        .catch(() => undefined)
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [draft])

  const apply = (next: string) => {
    const route = next.trim()
    if (route !== value) onApply(route)
  }

  return (
    <Field label="Маршрут">
      <span className="mon-route-input">
        <input
          type="search"
          list={listId}
          value={draft}
          placeholder="Все маршруты"
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value)
            // Выбор из списка подсказок приходит одним событием с точным значением.
            if (options.some((option) => option.route === event.target.value)) apply(event.target.value)
            if (event.target.value === '') apply('')
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(draft) } }}
          onBlur={() => apply(draft)}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.route} value={option.route}>
              {option.errors ? `${errorsWord(option.errors)}` : 'ошибок нет'}{option.requests ? `, запросов за 7 дней: ${formatNumber(option.requests)}` : ''}
            </option>
          ))}
        </datalist>
      </span>
    </Field>
  )
}

/* ---------- Вкладка ---------- */

export function ErrorsTab({ onOpenLogs }: { onOpenLogs: (requestId: string) => void }) {
  const { refreshSignals } = useAdmin()
  const { pending, run } = useAction()
  const [q, setQ] = useQueryState({
    m_status: 'open', m_kind: '', m_severity: '', m_route: '', m_q: '', m_page: '1',
    m_efrom: '', m_eto: '', m_view: 'table', m_period: 'day', fingerprint: '', m_event: '',
  })
  const kind = Object.hasOwn(kindLabels, q.m_kind) ? q.m_kind : ''
  const severity = Object.hasOwn(severityLabels, q.m_severity) ? q.m_severity : ''
  const period: Period = periodOptions.some((option) => option.value === q.m_period) ? q.m_period as Period : 'day'
  const view: View = q.m_view === 'timeline' ? 'timeline' : 'table'
  const page = Math.max(1, Math.floor(Number(q.m_page)) || 1)
  const today = todayMsk()
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(q.m_efrom) ? q.m_efrom : ''
  const toDay = /^\d{4}-\d{2}-\d{2}$/.test(q.m_eto) ? q.m_eto : ''
  const ranged = Boolean(fromDay || toDay)
  const [search, setSearch] = useState(q.m_q)
  const filtered = q.m_status !== 'open' || Boolean(kind || severity || q.m_route || q.m_q || ranged)

  // Поиск применяется сам через паузу в наборе.
  const appliedSearch = useRef(q.m_q)
  appliedSearch.current = q.m_q
  useEffect(() => { setSearch(q.m_q) }, [q.m_q])
  useEffect(() => {
    if (search.trim() === appliedSearch.current) return
    const timer = window.setTimeout(() => setQ({ m_q: search.trim(), m_page: '1' }, { replace: true }), 350)
    return () => window.clearTimeout(timer)
  }, [search, setQ])

  const overview = useLiveQuery(() => adminRpc<Json>('admin_monitoring_overview', { p_period: period }), [period])
  const filters = {
    p_status: q.m_status,
    p_kind: kind || null,
    p_severity: severity || null,
    p_route: q.m_route || null,
    p_search: q.m_q,
    p_from: mskStart(fromDay),
    p_to: mskEnd(toDay),
  }
  const filterKey = JSON.stringify(filters)
  const list = useLiveQuery(
    () => (view === 'table'
      ? adminRpc<Json>('admin_errors_list', { ...filters, p_page: page, p_page_size: PAGE_SIZE })
      : Promise.resolve(null)),
    [filterKey, page, view],
  )
  const data = obj(list.data)
  const groups = rows(data.items).map(parseErrorGroup)
  const total = num(data.total)

  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  useEffect(() => { setSelected(new Set()) }, [filterKey, page, view])

  const ov = obj(overview.data)
  const cards = obj(ov.cards)
  const services = obj(ov.services)
  const alerts = buildAlerts(rows(ov.alerts))
  const buckets: ErrorBucket[] = rows(ov.series).map((row) => ({
    start: str(row.start),
    end: str(row.end),
    total: num(row.total),
    byKind: Object.fromEntries(kindOrder.map((item) => [item, num(row[item])])) as Record<ErrorKind, number>,
  }))

  const reloadAll = useCallback(() => {
    list.reload()
    overview.refresh()
  }, [list, overview])

  const resetFilters = () => {
    setSearch('')
    setQ({ m_status: 'open', m_kind: '', m_severity: '', m_route: '', m_q: '', m_efrom: '', m_eto: '', m_page: '1' })
  }

  const openGroup = (fingerprint: string, eventId = '') => setQ({ fingerprint, m_event: eventId })

  const applyBulk = async (status: string, label: string) => {
    const fingerprints = [...selected]
    if (!fingerprints.length || pending) return
    const result = await run(
      `bulk:${status}`,
      () => adminRpc<Json>('admin_errors_set_status_bulk', { p_fingerprints: fingerprints, p_status: status }),
      (payload) => {
        const summary = obj(payload)
        const unchanged = num(summary.unchanged)
        return `«${label}»: изменено групп ${formatNumber(num(summary.updated))}${unchanged ? `, уже были в этом статусе ${formatNumber(unchanged)}` : ''}`
      },
    )
    if (result === undefined) return
    setSelected(new Set())
    reloadAll()
    refreshSignals()
  }

  const columns: Column<ErrorGroup>[] = [
    {
      key: 'title',
      header: 'Ошибка',
      render: (group) => (
        <div className="adm-cell-main mon-error-cell">
          <strong className="mon-error-title">{group.title}</strong>
          <span className="mon-error-meta">
            <i className={`mon-swatch mon-kind-${group.kind}`} aria-hidden="true" />
            <span>{kindLabels[group.kind] ?? group.kind}</span>
            {group.route && <span className="adm-mono mon-route">{group.route}</span>}
            {group.severity === 'critical' && <Badge tone="danger">Критично</Badge>}
            <span className="mon-mobile-only"><Badge tone={errorStatusTones[group.status] ?? 'neutral'}>{errorStatusLabels[group.status] ?? group.status}</Badge></span>
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      mobile: false,
      render: (group) => <Badge tone={errorStatusTones[group.status] ?? 'neutral'}>{errorStatusLabels[group.status] ?? group.status}</Badge>,
    },
    {
      key: 'hour',
      header: <HeaderHint label="За последний час" hint="Сколько раз ошибка случилась за последние 60 минут. Больше нуля - она повторяется прямо сейчас." />,
      align: 'right',
      render: (group) => (group.lastHour > 0 ? <Badge tone="danger">{formatNumber(group.lastHour)}</Badge> : <span className="adm-muted">0</span>),
    },
    ranged
      ? {
          key: 'period',
          header: <HeaderHint label="За выбранные даты" hint="Повторов в выбранные дни по Москве, включая оба конца." />,
          align: 'right',
          mobile: false,
          render: (group) => formatNumber(group.periodCount ?? 0),
        }
      : {
          key: 'week',
          header: <HeaderHint label="За 7 дней" hint="Сумма повторов за последние 7 суток по Москве, сегодня включительно. По дням - в подробностях." />,
          align: 'right',
          mobile: false,
          render: (group) => formatNumber(group.last7Days),
        },
    {
      key: 'total',
      header: <HeaderHint label="Повторов всего" hint="С первого появления. Решённая ошибка, которая вернулась, снова становится новой и продолжает счёт." />,
      align: 'right',
      mobile: false,
      render: (group) => formatNumber(group.occurrences),
    },
    {
      key: 'last',
      header: 'Последний раз',
      mobile: false,
      render: (group) => <span className="adm-nowrap" title={formatExactMsk(group.lastSeenAt)}>{relativeTime(group.lastSeenAt)}</span>,
    },
    {
      key: 'more',
      header: <span className="mon-sr">Подробности</span>,
      align: 'right',
      className: 'mon-more-cell',
      render: (group) => (
        <button type="button" className="mon-more" onClick={() => openGroup(group.fingerprint)} aria-label={`Подробнее: ${group.title}`}>
          <span>Подробнее</span>
          <CaretRight size={14} weight="bold" aria-hidden="true" />
        </button>
      ),
    },
  ]

  const updatedAt = oldest(overview.updatedAt, view === 'table' ? list.updatedAt : overview.updatedAt)

  return (
    <div className="mon-errors">
      <div className="mon-errors-head">
        <LiveStatus
          updatedAt={updatedAt}
          refreshing={overview.refreshing || list.refreshing}
          error={overview.refreshError || list.refreshError}
          note={alerts.length === 0 && overview.data ? <span className="mon-ok-text">Тревог нет</span> : undefined}
        />
      </div>

      {overview.error && !overview.data ? (
        <Panel><ErrorState message={overview.error} onRetry={overview.reload} /></Panel>
      ) : (
        <>
          <AlertList alerts={alerts} />

          <section className="mon-cards" aria-label="Сводка ошибок">
            {!overview.data ? (
              <div className="mon-cards-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((index) => <span key={index} />)}</div>
            ) : (
              <StatGrid>
                <Stat label="Открытых ошибок" value={formatNumber(num(cards.open))} tone={num(cards.open) > 0 ? 'danger' : 'success'} hint="групп «Новая» и «В работе»" />
                <Stat label="Критических" value={formatNumber(num(cards.critical))} tone={num(cards.critical) > 0 ? 'danger' : undefined} hint="открытых с важностью «Критично»" />
                <Stat label="Новых за час" value={formatNumber(num(cards.newLastHour))} tone={num(cards.newLastHour) > 0 ? 'warning' : undefined} hint={`впервые за 60 минут, событий за час: ${formatNumber(num(cards.eventsLastHour))}`} />
                <Stat label="Решено за сутки" value={formatNumber(num(cards.resolvedLastDay))} tone={num(cards.resolvedLastDay) > 0 ? 'success' : undefined} hint="групп закрыто за 24 часа" />
              </StatGrid>
            )}
          </section>

          <Panel
            title="Ошибки по времени"
            description="Все события ошибок по Москве. Наведи на столбец или перейди на график с клавиатуры и листай стрелками. Виды включаются в легенде."
            actions={<Segmented label="Период графика" value={period} options={periodOptions} onChange={(next) => setQ({ m_period: next }, { replace: true })} />}
          >
            {!overview.data ? (
              <div className="mon-chart-skeleton" aria-hidden="true" />
            ) : (
              <ErrorChart buckets={buckets} bucketMinutes={num(ov.bucketMinutes, 60)} periodLabel={periodWords[period]} />
            )}
          </Panel>
        </>
      )}

      <Panel
        title="Группы ошибок"
        description="Одинаковые сбои собраны в группу: вид, маршрут и сообщение без чисел и идентификаторов. Нажми на строку, чтобы открыть подробности."
        actions={(
          <Segmented
            label="Вид списка"
            value={view}
            options={[{ value: 'table', label: 'Таблица' }, { value: 'timeline', label: 'Хронология' }]}
            onChange={(next) => setQ({ m_view: next, m_page: '1' })}
          />
        )}
      >
        <div className="adm-toolbar mon-filters">
          <Segmented label="Статус ошибок" value={q.m_status} options={errorStatusOptions} onChange={(value) => setQ({ m_status: value, m_page: '1' })} />
          <Field label="Вид">
            <select value={kind} onChange={(event) => setQ({ m_kind: event.target.value, m_page: '1' })}>
              <option value="">Все</option>
              {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Важность">
            <select value={severity} onChange={(event) => setQ({ m_severity: event.target.value, m_page: '1' })}>
              <option value="">Любая</option>
              {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <RouteField value={q.m_route} onApply={(route) => setQ({ m_route: route, m_page: '1' })} />
          <Field label="С даты">
            <input type="date" value={fromDay} max={toDay || today} onChange={(event) => setQ({ m_efrom: event.target.value, m_page: '1' })} />
          </Field>
          <Field label="По дату">
            <input type="date" value={toDay} min={fromDay || undefined} max={today} onChange={(event) => setQ({ m_eto: event.target.value, m_page: '1' })} />
          </Field>
          <Field label="Поиск" className="is-grow">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Текст ошибки, маршрут или отпечаток" />
          </Field>
          {filtered && (
            <Button variant="ghost" icon={<X size={15} weight="bold" aria-hidden="true" />} onClick={resetFilters}>Сбросить</Button>
          )}
        </div>

        {view === 'timeline' ? (
          <ErrorsTimeline
            filters={filters}
            filterKey={filterKey}
            filtered={filtered}
            servicesDown={num(services.down)}
            lastCheckAt={strOrNull(services.lastCheckAt)}
            onReset={resetFilters}
            onOpen={openGroup}
          />
        ) : list.error && !list.data ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <>
            {selected.size > 0 && (
              <div className="adm-bulkbar mon-bulkbar" role="region" aria-label="Действия с выбранными группами">
                <span className="mon-bulk-count">Выбрано групп: {formatNumber(selected.size)}</span>
                {bulkActions.map((action) => (
                  <Button
                    key={action.status}
                    size="sm"
                    loading={pending === `bulk:${action.status}`}
                    disabled={Boolean(pending) && pending !== `bulk:${action.status}`}
                    onClick={() => { void applyBulk(action.status, action.label) }}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => setSelected(new Set())}>Снять выбор</Button>
              </div>
            )}
            {!list.loading && groups.length === 0 ? (
              <ErrorsEmpty filtered={filtered} servicesDown={num(services.down)} lastCheckAt={strOrNull(services.lastCheckAt)} onReset={resetFilters} />
            ) : (
              <DataTable
                columns={columns}
                rows={groups}
                rowKey={(group) => group.fingerprint}
                loading={list.loading}
                selectable
                selected={selected}
                onSelectedChange={setSelected}
                onRowClick={(group) => openGroup(group.fingerprint)}
                rowClassName={(group) => `mon-row${group.lastHour > 0 && (group.status === 'new' || group.status === 'in_progress') ? ' is-alert' : ''}`}
              />
            )}
            {total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQ({ m_page: String(next) })} />}
          </>
        )}
      </Panel>

      {q.fingerprint && (
        <ErrorDetailDrawer
          fingerprint={q.fingerprint}
          eventId={q.m_event}
          onSelectEvent={(eventId) => setQ({ m_event: eventId }, { replace: true })}
          onClose={() => setQ({ fingerprint: '', m_event: '' })}
          onChanged={reloadAll}
          onOpenLogs={onOpenLogs}
        />
      )}
    </div>
  )
}

/* ---------- Хронология ---------- */

type TimelineEvent = {
  id: string
  fingerprint: string
  kind: string
  severity: string
  route: string | null
  message: string
  title: string
  status: string
  email: string | null
  userId: string | null
  guestId: string | null
  createdAt: string
}

function parseTimeline(row: Row): TimelineEvent {
  return {
    id: String(num(row.id)),
    fingerprint: str(row.fingerprint),
    kind: str(row.kind),
    severity: str(row.severity, 'error'),
    route: strOrNull(row.route),
    message: str(row.message),
    title: str(row.title, 'Без названия'),
    status: str(row.status, 'new'),
    email: strOrNull(row.email),
    userId: strOrNull(row.userId),
    guestId: strOrNull(row.guestId),
    createdAt: str(row.createdAt),
  }
}

function ErrorsTimeline({ filters, filterKey, filtered, servicesDown, lastCheckAt, onReset, onOpen }: {
  filters: Record<string, string | null>
  filterKey: string
  filtered: boolean
  servicesDown: number
  lastCheckAt: string | null
  onReset: () => void
  onOpen: (fingerprint: string, eventId: string) => void
}) {
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const first = useLiveQuery(() => adminRpc<Json>('admin_errors_timeline', { ...filtersRef.current, p_limit: TIMELINE_PAGE }), [filterKey])
  const [older, setOlder] = useState<TimelineEvent[]>([])
  const [cursor, setCursor] = useState<{ before: number | null; hasMore: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')

  useEffect(() => {
    setOlder([])
    setCursor(null)
    setMoreError('')
  }, [filterKey])

  const firstData = obj(first.data)
  const firstItems = rows(firstData.items).map(parseTimeline)
  const items = useMemo(() => {
    const seen = new Set<string>()
    return [...firstItems, ...older].filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
  }, [firstItems, older])
  const hasMore = cursor ? cursor.hasMore : firstData.hasMore === true
  const before = cursor ? cursor.before : numOrNull(firstData.nextBefore)

  const loadMore = async () => {
    if (!before || loadingMore) return
    setLoadingMore(true)
    setMoreError('')
    try {
      const result = obj(await adminRpc<Json>('admin_errors_timeline', { ...filtersRef.current, p_before_id: before, p_limit: TIMELINE_PAGE }))
      setOlder((current) => [...current, ...rows(result.items).map(parseTimeline)])
      setCursor({ before: numOrNull(result.nextBefore), hasMore: result.hasMore === true })
    } catch (error) {
      setMoreError(error instanceof Error ? error.message : 'Не получилось загрузить.')
    } finally {
      setLoadingMore(false)
    }
  }

  if (first.error && !first.data) return <ErrorState message={first.error} onRetry={first.reload} />
  if (!first.data) return <div className="mon-feed-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4].map((index) => <span key={index} />)}</div>
  if (items.length === 0) return <ErrorsEmpty filtered={filtered} servicesDown={servicesDown} lastCheckAt={lastCheckAt} onReset={onReset} />

  const days: { key: string; items: TimelineEvent[] }[] = []
  for (const item of items) {
    const key = mskDayKey(item.createdAt)
    const last = days[days.length - 1]
    if (last && last.key === key) last.items.push(item)
    else days.push({ key, items: [item] })
  }

  return (
    <div className={`mon-timeline${first.loading ? ' is-stale' : ''}`}>
      {days.map((day) => (
        <section key={day.key} className="mon-day" aria-label={formatDayHeading(day.items[0].createdAt)}>
          <h3 className="mon-day-head">{formatDayHeading(day.items[0].createdAt)}</h3>
          <ol className="mon-feed">
            {day.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="mon-feed-item" onClick={() => onOpen(item.fingerprint, item.id)}>
                  <time dateTime={item.createdAt} title={formatExactMsk(item.createdAt)}>{formatClockMsk(item.createdAt)}</time>
                  <i className={`mon-swatch mon-kind-${item.kind}`} aria-hidden="true" />
                  <span className="mon-feed-main">
                    <strong>{item.message || item.title}</strong>
                    <span className="mon-feed-meta">
                      {kindLabels[item.kind] ?? item.kind}
                      {item.route && <span className="adm-mono">{item.route}</span>}
                      <span>{item.userId ? item.email || 'ученик' : item.guestId ? 'гость' : 'пользователь не записан'}</span>
                    </span>
                  </span>
                  <span className="mon-feed-side">
                    {item.severity === 'critical' && <Badge tone={severityTones.critical}>Критично</Badge>}
                    <Badge tone={errorStatusTones[item.status] ?? 'neutral'}>{errorStatusLabels[item.status] ?? item.status}</Badge>
                    <CaretRight size={14} weight="bold" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {moreError && <ErrorState message={moreError} onRetry={() => { void loadMore() }} />}
      {hasMore ? (
        <div className="mon-feed-more">
          <Button loading={loadingMore} onClick={() => { void loadMore() }}>Показать ещё {TIMELINE_PAGE}</Button>
        </div>
      ) : (
        <p className="mon-feed-end">Это всё: события ошибок хранятся 30 дней.</p>
      )}
    </div>
  )
}
