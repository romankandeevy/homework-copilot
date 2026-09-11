/* Мониторинг: ошибки по отпечаткам, качество решений, поиск по логам и
   состояние зависимостей. Раздел открыт ролям с правом settings (admin и
   owner); у поддержки его нет - RPC всё равно ответят отказом. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowClockwise, Heartbeat, ListMagnifyingGlass, Queue } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import {
  adminAction,
  adminRpc,
  arr,
  bool,
  downloadCsv,
  formatDateTime,
  formatKopecks,
  formatNumber,
  formatPercent,
  num,
  numOrNull,
  obj,
  relativeTime,
  rows,
  shiftDate,
  str,
  strOrNull,
  todayMsk,
} from '../api'
import type { CsvColumn, Row } from '../api'
import {
  Badge,
  Button,
  CopyButton,
  DataTable,
  DateRangePicker,
  Drawer,
  EmptyState,
  ErrorState,
  ExportButton,
  Field,
  HorizontalBars,
  JsonView,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  Segmented,
  Sparkline,
  Stat,
  StatGrid,
  Tabs,
  useAction,
  useAsync,
  useQueryState,
} from '../ui'
import type { Column, Tone } from '../ui'
import { useAdmin } from '../context'
import './monitoring.css'

type MonitoringTab = 'errors' | 'quality' | 'logs' | 'health'
const tabValues: MonitoringTab[] = ['errors', 'quality', 'logs', 'health']

const ERRORS_PAGE_SIZE = 50
const LOGS_PAGE_SIZE = 50
const HEALTH_REFRESH_MS = 60_000
const PRIORITY_SUBJECTS = ['Химия', 'Литература', 'Английский язык', 'История']
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const errorStatusOptions = [
  { value: 'open', label: 'Открытые' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решённые' },
  { value: 'ignored', label: 'Игнор' },
  { value: 'all', label: 'Все' },
]
const errorStatusLabels: Record<string, string> = { new: 'Новая', in_progress: 'В работе', resolved: 'Решена', ignored: 'Игнор' }
const errorStatusTones: Record<string, Tone> = { new: 'danger', in_progress: 'warning', resolved: 'success', ignored: 'neutral' }
const kindLabels: Record<string, string> = { frontend: 'Фронтенд', api: 'API', llm: 'Модель', payments: 'Платежи', db: 'База' }
const severityLabels: Record<string, string> = { critical: 'Критично', error: 'Ошибка', warning: 'Предупреждение', info: 'Инфо' }
const severityTones: Record<string, Tone> = { critical: 'danger', error: 'danger', warning: 'warning', info: 'info' }

/* Переход между вкладками с фильтрами: пишем адрес одним шагом и будим
   все useQueryState раздела тем же событием, что и кнопка «назад». */
function pushParams(patch: Record<string, string>) {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  window.history.pushState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${formatNumber(Math.round((value / 1024 ** index) * 10) / 10)} ${units[index]}`
}

function formatSeconds(value: number | null) {
  return value === null ? '-' : `${formatNumber(value)} с`
}

function useDebouncedSearch(applied: string, apply: (value: string) => void) {
  const [draft, setDraft] = useState(applied)
  const appliedRef = useRef(applied)
  appliedRef.current = applied
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => {
    if (draft.trim() === appliedRef.current) return
    const timer = window.setTimeout(() => applyRef.current(draft.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [draft])
  return [draft, setDraft] as const
}

/* ---------- Раздел ---------- */

export default function MonitoringSection() {
  const { access, signals } = useAdmin()
  const [state, setState] = useQueryState({ m_tab: 'errors', m_kind: '' })
  const tab: MonitoringTab = tabValues.find((value) => value === state.m_tab) ?? 'errors'

  const openLogs = useCallback((requestId: string) => {
    pushParams({ m_tab: 'logs', m_kind: '', m_request: requestId, m_rq: '', m_user: '', m_lpage: '', fingerprint: '' })
  }, [])

  if (!access.permissions.settings) {
    return (
      <>
        <PageHeader title="Мониторинг" />
        <Panel>
          <EmptyState>
            Мониторинг открыт ролям admin и owner: ошибки, логи запросов и состояние сервисов содержат данные всех учеников. Для роли поддержки есть раздел «Поддержка» и карточка пользователя.
          </EmptyState>
        </Panel>
      </>
    )
  }

  if (!supabase) {
    return (
      <>
        <PageHeader title="Мониторинг" />
        <ErrorState message="Подключение к базе не настроено." />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Мониторинг" description="Ошибки, качество решений, логи запросов и состояние сервисов." />
      <Tabs
        value={tab}
        tabs={[
          { value: 'errors', label: 'Ошибки', badge: signals.openErrors },
          { value: 'quality', label: 'Качество' },
          { value: 'logs', label: 'Логи' },
          { value: 'health', label: 'Состояние' },
        ]}
        // m_kind у ошибок и логов значит разное, при смене вкладки его сбрасываем.
        onChange={(next) => setState({ m_tab: next, m_kind: '' })}
      />
      {tab === 'errors' && <ErrorsTab onOpenLogs={openLogs} />}
      {tab === 'quality' && <QualityTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'health' && <HealthTab />}
    </>
  )
}

/* ---------- Ошибки ---------- */

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
  trend: number[]
  lastHour: number
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
    trend: arr(row.trend).map((value) => num(value)),
    lastHour: num(row.lastHour),
  }
}

function ErrorsTab({ onOpenLogs }: { onOpenLogs: (requestId: string) => void }) {
  const { signals } = useAdmin()
  const [q, setQ] = useQueryState({ m_status: 'open', m_kind: '', m_severity: '', m_route: '', m_q: '', m_page: '1', fingerprint: '' })
  const kind = Object.hasOwn(kindLabels, q.m_kind) ? q.m_kind : ''
  const severity = Object.hasOwn(severityLabels, q.m_severity) ? q.m_severity : ''
  const page = Math.max(1, Math.floor(Number(q.m_page)) || 1)
  const [search, setSearch] = useDebouncedSearch(q.m_q, (value) => setQ({ m_q: value, m_page: '1' }, { replace: true }))

  const list = useAsync(() => adminRpc<Json>('admin_errors_list', {
    p_status: q.m_status,
    p_kind: kind || null,
    p_severity: severity || null,
    p_route: q.m_route || null,
    p_search: q.m_q,
    p_page: page,
    p_page_size: ERRORS_PAGE_SIZE,
  }), [q.m_status, kind, severity, q.m_route, q.m_q, page])
  const reload = list.reload
  const data = obj(list.data)
  const groups = rows(data.items).map(parseErrorGroup)
  const routes = arr(data.routes).filter((route): route is string => typeof route === 'string').sort()

  // Лента живая: колокольчик admin_signals и общий счётчик событий админки.
  const timer = useRef(0)
  const scheduleReload = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(reload, 800)
  }, [reload])
  const scheduleRef = useRef(scheduleReload)
  scheduleRef.current = scheduleReload

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel(`admin-monitoring-errors-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_signals' }, () => scheduleRef.current())
      .subscribe()
    return () => {
      window.clearTimeout(timer.current)
      void client.removeChannel(channel)
    }
  }, [])

  const pulseRef = useRef(signals.pulse)
  useEffect(() => {
    if (pulseRef.current === signals.pulse) return
    pulseRef.current = signals.pulse
    scheduleReload()
  }, [signals.pulse, scheduleReload])

  const columns: Column<ErrorGroup>[] = [
    {
      key: 'title',
      header: 'Ошибка',
      render: (group) => (
        <div className="adm-cell-main">
          <strong className="mon-error-title">{group.title}</strong>
          <small className="adm-mono">{group.fingerprint.slice(0, 16)}</small>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Вид',
      render: (group) => (
        <span className="mon-badges">
          <Badge tone="accent">{kindLabels[group.kind] ?? group.kind}</Badge>
          <Badge tone={severityTones[group.severity] ?? 'neutral'}>{severityLabels[group.severity] ?? group.severity}</Badge>
        </span>
      ),
    },
    { key: 'route', header: 'Маршрут', mobile: false, render: (group) => <span className="adm-mono">{group.route ?? '-'}</span> },
    { key: 'occurrences', header: 'Раз', align: 'right', render: (group) => formatNumber(group.occurrences) },
    { key: 'users', header: 'Учеников', align: 'right', mobile: false, render: (group) => formatNumber(group.usersAffected) },
    {
      key: 'seen',
      header: 'Впервые / последний раз',
      mobile: false,
      render: (group) => (
        <div className="adm-cell-main">
          <small>{formatDateTime(group.firstSeenAt)}</small>
          <strong>{relativeTime(group.lastSeenAt)}</strong>
        </div>
      ),
    },
    { key: 'trend', header: '7 дней', mobile: false, render: (group) => <Sparkline values={group.trend} label={`По дням: ${group.trend.join(', ')}`} /> },
    {
      key: 'hour',
      header: 'За час',
      align: 'right',
      render: (group) => (group.lastHour > 0 ? <Badge tone="danger">{formatNumber(group.lastHour)}</Badge> : <span className="adm-muted">0</span>),
    },
    { key: 'status', header: 'Статус', render: (group) => <Badge tone={errorStatusTones[group.status] ?? 'neutral'}>{errorStatusLabels[group.status] ?? group.status}</Badge> },
  ]

  return (
    <Panel
      title="Ошибки по отпечаткам"
      description="Одинаковые сбои собраны в группу: вид, маршрут и сообщение без чисел и идентификаторов. Список обновляется сам при новой ошибке."
      actions={<Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} onClick={reload}>Обновить</Button>}
    >
      <div className="adm-toolbar">
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
        <Field label="Маршрут">
          <select value={q.m_route} onChange={(event) => setQ({ m_route: event.target.value, m_page: '1' })}>
            <option value="">Все</option>
            {q.m_route && !routes.includes(q.m_route) && <option value={q.m_route}>{q.m_route}</option>}
            {routes.map((route) => <option key={route} value={route}>{route}</option>)}
          </select>
        </Field>
        <Field label="Поиск" className="is-grow">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Текст ошибки или отпечаток" />
        </Field>
      </div>

      {list.error ? (
        <ErrorState message={list.error} onRetry={reload} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={groups}
            rowKey={(group) => group.fingerprint}
            loading={list.loading}
            empty={q.m_status === 'open' && !kind && !severity && !q.m_route && !q.m_q ? 'Открытых ошибок нет.' : 'Под эти фильтры ошибок нет.'}
            onRowClick={(group) => setQ({ fingerprint: group.fingerprint })}
            rowClassName={(group) => (group.lastHour > 0 && (group.status === 'new' || group.status === 'in_progress') ? 'is-alert' : '')}
          />
          {num(data.total) > ERRORS_PAGE_SIZE && <Pagination page={page} pageSize={ERRORS_PAGE_SIZE} total={num(data.total)} onPage={(next) => setQ({ m_page: String(next) })} />}
        </>
      )}

      {q.fingerprint && (
        <ErrorDetailDrawer
          fingerprint={q.fingerprint}
          onClose={() => setQ({ fingerprint: '' })}
          onChanged={reload}
          onOpenLogs={onOpenLogs}
        />
      )}
    </Panel>
  )
}

function ErrorDetailDrawer({ fingerprint, onClose, onChanged, onOpenLogs }: {
  fingerprint: string
  onClose: () => void
  onChanged: () => void
  onOpenLogs: (requestId: string) => void
}) {
  const { openUser, refreshSignals } = useAdmin()
  const { pending, run } = useAction()
  const detail = useAsync(() => adminRpc<Json>('admin_error_detail', { p_fingerprint: fingerprint }), [fingerprint])
  const data = obj(detail.data)
  // group - это to_jsonb строки, поэтому ключи в snake_case.
  const group = obj(data.group)
  const events = rows(data.events)
  const status = str(group.status, 'new')

  const setStatus = async (next: string) => {
    if (next === status || pending) return
    const result = await run(`status:${next}`, () => adminRpc('admin_error_set_status', { p_fingerprint: fingerprint, p_status: next }), `Статус группы: ${(errorStatusLabels[next] ?? next).toLowerCase()}`)
    if (result === undefined) return
    detail.reload()
    onChanged()
    refreshSignals()
  }

  return (
    <Drawer
      open
      wide
      title={str(group.title) || 'Группа ошибок'}
      subtitle={<span className="adm-mono">{fingerprint}</span>}
      onClose={onClose}
    >
      {detail.loading && !detail.data ? (
        <LoadingState />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : !str(group.fingerprint) ? (
        <EmptyState>Группа не найдена: возможно, её уже удалил срок хранения.</EmptyState>
      ) : (
        <>
          <div className="mon-badges">
            <Badge tone="accent">{kindLabels[str(group.kind)] ?? str(group.kind)}</Badge>
            <Badge tone={severityTones[str(group.severity)] ?? 'neutral'}>{severityLabels[str(group.severity)] ?? str(group.severity)}</Badge>
            {str(group.route) && <Badge>{str(group.route)}</Badge>}
          </div>
          <StatGrid>
            <Stat label="Повторов" value={formatNumber(num(group.occurrences))} />
            <Stat label="Учеников задело" value={formatNumber(num(group.users_affected))} />
            <Stat label="Впервые" value={formatDateTime(strOrNull(group.first_seen_at))} />
            <Stat label="Последний раз" value={relativeTime(strOrNull(group.last_seen_at))} />
          </StatGrid>
          <div className="mon-status-row">
            <span className="adm-field-label">Статус группы</span>
            <Segmented
              label="Статус группы"
              value={status}
              options={['new', 'in_progress', 'resolved', 'ignored'].map((value) => ({ value, label: errorStatusLabels[value] }))}
              onChange={(next) => { void setStatus(next) }}
            />
            {strOrNull(group.resolved_at) && <small className="adm-muted">Решена {formatDateTime(strOrNull(group.resolved_at))}</small>}
          </div>

          <h3 className="mon-subhead">События{events.length >= 50 ? ' - последние 50' : ` - ${events.length}`}</h3>
          {events.length === 0 ? <EmptyState>Событий нет.</EmptyState> : (
            <ol className="mon-events">
              {events.map((event, index) => {
                const requestId = str(event.requestId)
                const userId = str(event.userId)
                const stack = str(event.stack)
                return (
                  <li key={String(num(event.id))}>
                    <details open={index === 0} className="mon-event">
                      <summary>
                        <time dateTime={str(event.createdAt)}>{formatDateTime(strOrNull(event.createdAt))}</time>
                        <span>{str(event.message) || 'Без сообщения'}</span>
                      </summary>
                      <div className="mon-event-body">
                        <dl className="adm-kv">
                          <dt>Маршрут</dt>
                          <dd className="adm-mono">{str(event.route) || '-'}</dd>
                          <dt>Request id</dt>
                          <dd>
                            {requestId ? (
                              <span className="mon-inline">
                                <code className="adm-mono">{requestId}</code>
                                <CopyButton value={requestId} label="Скопировать request id" />
                                <Button size="sm" variant="ghost" icon={<ListMagnifyingGlass size={15} weight="bold" aria-hidden="true" />} onClick={() => onOpenLogs(requestId)}>В логах</Button>
                              </span>
                            ) : '-'}
                          </dd>
                          <dt>Кто</dt>
                          <dd>
                            {userId ? (
                              <button type="button" className="mon-link" onClick={() => openUser(userId)}>{str(event.email) || userId}</button>
                            ) : str(event.guestId) ? `Гость ${str(event.guestId)}` : 'Не указан'}
                            {str(event.ip) && <small className="adm-muted"> · {str(event.ip)}</small>}
                          </dd>
                        </dl>
                        {stack && (
                          <>
                            <h4 className="mon-subhead">Стек</h4>
                            <pre className="mon-stack">{stack}</pre>
                          </>
                        )}
                        {event.input !== undefined && event.input !== null && (
                          <>
                            <h4 className="mon-subhead">Входные данные</h4>
                            <JsonView value={event.input} maxHeight={260} />
                          </>
                        )}
                        {event.environment !== undefined && event.environment !== null && (
                          <>
                            <h4 className="mon-subhead">Окружение</h4>
                            <JsonView value={event.environment} maxHeight={260} />
                          </>
                        )}
                      </div>
                    </details>
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </Drawer>
  )
}

/* ---------- Качество ---------- */

type SubjectQuality = {
  subject: string
  total: number
  failed: number
  truncated: number
  truncatedShare: number
  failedShare: number
  share: number | null
  helpful: number
  notHelpful: number
  helpfulShare: number | null
  p50: number | null
  p95: number | null
}

function QualityTab() {
  const today = todayMsk()
  const [q, setQ] = useQueryState({ m_from: shiftDate(today, -29), m_to: today })
  const quality = useAsync(() => adminRpc<Json>('admin_quality', { p_from: q.m_from, p_to: q.m_to }), [q.m_from, q.m_to])
  const data = obj(quality.data)

  const subjects: SubjectQuality[] = rows(data.bySubject).map((row) => ({
    subject: str(row.subject, 'Без предмета'),
    total: num(row.total),
    failed: num(row.failed),
    truncated: num(row.truncated),
    truncatedShare: num(row.truncatedShare),
    failedShare: num(row.failedShare),
    share: numOrNull(row.share),
    helpful: num(row.helpful),
    notHelpful: num(row.notHelpful),
    helpfulShare: numOrNull(row.helpfulShare),
    p50: numOrNull(row.p50),
    p95: numOrNull(row.p95),
  }))
  const latency = obj(data.latency)
  const chatLatency = obj(data.chatLatency)
  const diagrams = obj(data.diagrams)
  const rateLimit = obj(data.rateLimit)
  const chat = obj(data.chatTruncated)
  const lengthBars = rows(data.answerLength).map((row) => {
    const bucket = num(row.bucket)
    return { label: bucket >= 6000 ? 'от 6000 знаков' : `${formatNumber(bucket)}-${formatNumber(bucket + 499)} знаков`, value: num(row.count) }
  })
  const routeBars = Object.entries(obj(rateLimit.byRoute))
    .map(([route, value]) => ({ label: route, value: num(value) }))
    .sort((a, b) => b.value - a.value)
  const diagramTotal = num(diagrams.total)

  const columns: Column<SubjectQuality>[] = [
    {
      key: 'subject',
      header: 'Предмет',
      render: (row) => (
        <span className="mon-subject">
          {row.subject}
          {PRIORITY_SUBJECTS.includes(row.subject) && <Badge tone="accent">в фокусе</Badge>}
        </span>
      ),
    },
    { key: 'total', header: 'Задач', align: 'right', render: (row) => formatNumber(row.total) },
    { key: 'share', header: 'Доля', align: 'right', mobile: false, render: (row) => formatPercent(row.share) },
    { key: 'failed', header: 'Сбои', align: 'right', render: (row) => <span className={row.failedShare >= 10 ? 'mon-bad' : ''}>{formatPercent(row.failedShare)}</span> },
    { key: 'truncated', header: 'Обрезано', align: 'right', render: (row) => <span className={row.truncatedShare >= 5 ? 'mon-bad' : ''}>{formatPercent(row.truncatedShare)}</span> },
    {
      key: 'helpful',
      header: 'Полезно',
      align: 'right',
      mobile: false,
      render: (row) => (row.helpfulShare === null ? <span className="adm-muted">нет оценок</span> : <span title={`Полезно ${row.helpful}, нет ${row.notHelpful}`}>{formatPercent(row.helpfulShare)}</span>),
    },
    { key: 'latency', header: 'p50 / p95', align: 'right', mobile: false, render: (row) => `${formatSeconds(row.p50)} / ${formatSeconds(row.p95)}` },
  ]

  return (
    <>
      <Panel
        title="Качество решений"
        description="Сбои и обрезанные ответы по предметам, длина ответа, чертежи, жалобы и задержка."
        actions={(
          <>
            <DateRangePicker value={{ from: q.m_from, to: q.m_to }} onChange={(range) => setQ({ m_from: range.from, m_to: range.to })} />
            <Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} onClick={quality.reload}>Обновить</Button>
          </>
        )}
      >
        {quality.error ? (
          <ErrorState message={quality.error} onRetry={quality.reload} />
        ) : quality.loading && !quality.data ? (
          <LoadingState />
        ) : (
          <div className="mon-stack-gap">
            <section aria-label="Приоритетные предметы">
              <h3 className="mon-subhead">Предметы в фокусе</h3>
              <StatGrid>
                {PRIORITY_SUBJECTS.map((subject) => {
                  const row = subjects.find((item) => item.subject === subject)
                  if (!row || row.total === 0) return <Stat key={subject} label={subject} value="-" hint="задач за период нет" />
                  const tone: Tone | undefined = row.failedShare >= 10 || row.truncatedShare >= 5 ? 'danger' : undefined
                  return (
                    <Stat
                      key={subject}
                      label={subject}
                      value={`${formatPercent(row.failedShare)} сбоев`}
                      hint={`обрезано ${formatPercent(row.truncatedShare)} · ${formatNumber(row.total)} задач`}
                      tone={tone}
                    />
                  )
                })}
              </StatGrid>
            </section>

            <DataTable
              columns={columns}
              rows={subjects}
              rowKey={(row) => row.subject}
              loading={quality.loading}
              empty="За период решений нет."
              rowClassName={(row) => (PRIORITY_SUBJECTS.includes(row.subject) ? 'mon-priority-row' : '')}
            />
          </div>
        )}
      </Panel>

      {quality.data && !quality.error && (
        <>
          <div className="adm-grid-2">
            <Panel title="Задержка" description="Перцентили времени до готового ответа.">
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr><th>Где</th><th className="is-right">p50</th><th className="is-right">p95</th><th className="is-right">p99</th><th className="is-right">Выборка</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Решения</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p50))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p95))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p99))}</td>
                      <td className="is-right">{formatNumber(num(latency.count))}</td>
                    </tr>
                    <tr>
                      <td>ИИ-чат</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p50))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p95))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p99))}</td>
                      <td className="is-right">{formatNumber(num(chatLatency.count))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mon-note">
                Чат за период: {formatNumber(num(chat.total))} ответов, из них со сбоем {formatNumber(num(chat.failed))}
                {num(chat.total) > 0 ? ` (${formatPercent((100 * num(chat.failed)) / num(chat.total))})` : ''}.
              </p>
            </Panel>

            <Panel title="Чертежи и жалобы" description="Жалобы - обращения «Неверное решение» за период.">
              <StatGrid>
                <Stat label="С чертежом" value={diagramTotal > 0 ? formatPercent((100 * num(diagrams.withDiagram)) / diagramTotal) : '-'} hint={`${formatNumber(num(diagrams.withDiagram))} из ${formatNumber(diagramTotal)}`} />
                <Stat label="Жалобы на решение" value={formatNumber(num(diagrams.complaints))} tone={num(diagrams.complaints) > 0 ? 'warning' : undefined} />
                <Stat label="Оценки «не помогло»" value={formatNumber(num(diagrams.notHelpful))} tone={num(diagrams.notHelpful) > 0 ? 'warning' : undefined} />
              </StatGrid>
            </Panel>
          </div>

          <div className="adm-grid-2">
            <Panel title="Длина ответа" description="Решённые задачи по числу знаков в ответе, шаг 500.">
              <HorizontalBars items={lengthBars} />
            </Panel>

            <Panel title="Предел частоты" description="Ответы 429: сколько раз и у скольких учеников сработал предел.">
              <StatGrid>
                <Stat label="Срабатываний" value={formatNumber(num(rateLimit.hits))} tone={num(rateLimit.hits) > 0 ? 'warning' : undefined} />
                <Stat label="Учеников и гостей" value={formatNumber(num(rateLimit.users))} />
              </StatGrid>
              <div className="mon-gap-top">
                {routeBars.length ? <HorizontalBars items={routeBars} /> : <EmptyState>Предел за период не срабатывал.</EmptyState>}
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  )
}

/* ---------- Логи ---------- */

type LogKind = 'requests' | 'solutions'

const requestCsv: CsvColumn<Row>[] = [
  { header: 'Время', value: (row) => str(row.createdAt) },
  { header: 'Метод', value: (row) => str(row.method) },
  { header: 'Маршрут', value: (row) => str(row.route) },
  { header: 'Статус', value: (row) => numOrNull(row.status) },
  { header: 'Длительность, мс', value: (row) => numOrNull(row.durationMs) },
  { header: 'Почта', value: (row) => str(row.email) },
  { header: 'User id', value: (row) => str(row.userId) },
  { header: 'Guest id', value: (row) => str(row.guestId) },
  { header: 'IP', value: (row) => str(row.ip) },
  { header: 'Request id', value: (row) => str(row.requestId) },
  { header: 'Ошибка', value: (row) => str(row.error) },
]

const solutionCsv: CsvColumn<Row>[] = [
  { header: 'Время', value: (row) => str(row.createdAt) },
  { header: 'Предмет', value: (row) => str(row.subject) },
  { header: 'Задача', value: (row) => str(row.task) },
  { header: 'Итог', value: (row) => str(row.outcome) },
  { header: 'HTTP', value: (row) => numOrNull(row.status) },
  { header: 'Модели', value: (row) => str(row.models) },
  { header: 'Секунды', value: (row) => numOrNull(row.seconds) },
  { header: 'Себестоимость, коп.', value: (row) => numOrNull(row.costKopecks) },
  { header: 'Почта', value: (row) => str(row.email) },
  { header: 'User id', value: (row) => str(row.userId) },
  { header: 'Request id', value: (row) => str(row.requestId) },
  { header: 'Ключ', value: (row) => str(row.key) },
  { header: 'Ошибка', value: (row) => str(row.error) },
  { header: 'Условие', value: (row) => str(row.preview) },
]

function httpTone(status: number): Tone {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  if (status >= 200 && status < 400) return 'success'
  return 'neutral'
}

function LogsTab() {
  const { openUser } = useAdmin()
  const [q, setQ] = useQueryState({ m_kind: 'requests', m_rq: '', m_request: '', m_user: '', m_lpage: '1' })
  const kind: LogKind = q.m_kind === 'solutions' ? 'solutions' : 'requests'
  const page = Math.max(1, Math.floor(Number(q.m_lpage)) || 1)
  const userValid = q.m_user === '' || uuidPattern.test(q.m_user)
  const [openLogId, setOpenLogId] = useState<string | null>(null)

  const logs = useAsync(async () => {
    if (!userValid) throw new Error('User id - это UUID вида xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.')
    return adminRpc<Json>('admin_logs_search', {
      p_kind: kind,
      p_query: q.m_rq,
      p_request_id: q.m_request || null,
      p_user_id: q.m_user || null,
      // Без начала периода база ищет за 30 дней; логи решений живут 90.
      p_from: kind === 'solutions' ? new Date(Date.now() - 90 * 86_400_000).toISOString() : null,
      p_to: null,
      p_page: page,
      p_page_size: LOGS_PAGE_SIZE,
    })
  }, [kind, q.m_rq, q.m_request, q.m_user, page, userValid])
  const data = obj(logs.data)
  const items = rows(data.items)
  const total = num(data.total)

  const userCell = (row: Row) => {
    const userId = str(row.userId)
    if (userId) return <button type="button" className="mon-link" onClick={() => openUser(userId)}>{str(row.email) || userId.slice(0, 8)}</button>
    if (str(row.guestId)) return <span className="adm-muted">гость</span>
    return <span className="adm-muted">-</span>
  }

  const requestIdCell = (row: Row) => {
    const requestId = str(row.requestId)
    if (!requestId) return <span className="adm-muted">-</span>
    return (
      <span className="mon-inline">
        <button type="button" className="mon-link adm-mono" title="Показать только этот запрос" onClick={() => setQ({ m_request: requestId, m_lpage: '1' })}>{requestId.slice(0, 12)}</button>
        <CopyButton value={requestId} label="Скопировать request id" />
      </span>
    )
  }

  const requestColumns: Column<Row>[] = [
    { key: 'time', header: 'Время', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> },
    { key: 'route', header: 'Запрос', render: (row) => <span className="adm-mono mon-route">{str(row.method)} {str(row.route)}</span> },
    { key: 'status', header: 'Статус', render: (row) => <Badge tone={httpTone(num(row.status))}>{numOrNull(row.status) ?? '-'}</Badge> },
    { key: 'duration', header: 'мс', align: 'right', mobile: false, render: (row) => (numOrNull(row.durationMs) === null ? '-' : formatNumber(num(row.durationMs))) },
    { key: 'user', header: 'Кто', render: userCell },
    { key: 'ip', header: 'IP', mobile: false, render: (row) => <span className="adm-mono">{str(row.ip) || '-'}</span> },
    { key: 'request', header: 'Request id', mobile: false, render: requestIdCell },
    { key: 'error', header: 'Ошибка', mobile: false, render: (row) => (str(row.error) ? <span className="adm-clamp mon-bad">{str(row.error)}</span> : <span className="adm-muted">-</span>) },
  ]

  const solutionColumns: Column<Row>[] = [
    { key: 'time', header: 'Время', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> },
    {
      key: 'task',
      header: 'Задача',
      render: (row) => (
        <div className="adm-cell-main">
          <strong>{str(row.subject) || 'Без предмета'}</strong>
          <small className="adm-clamp">{str(row.preview) || str(row.task) || '-'}</small>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: 'Итог',
      render: (row) => <Badge tone={str(row.outcome) === 'solved' ? 'success' : str(row.outcome) === 'failed' ? 'danger' : 'neutral'}>{str(row.outcome) || '-'}</Badge>,
    },
    { key: 'models', header: 'Модели', mobile: false, render: (row) => <span className="adm-mono mon-route">{str(row.models) || '-'}</span> },
    { key: 'seconds', header: 'с', align: 'right', mobile: false, render: (row) => formatNumber(num(row.seconds)) },
    { key: 'cost', header: 'Себест.', align: 'right', mobile: false, render: (row) => (numOrNull(row.costKopecks) === null ? '-' : formatKopecks(num(row.costKopecks))) },
    { key: 'user', header: 'Кто', render: userCell },
    { key: 'request', header: 'Request id', mobile: false, render: requestIdCell },
  ]

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setQ({
      m_rq: String(form.get('text') ?? '').trim(),
      m_request: String(form.get('request') ?? '').trim(),
      m_user: String(form.get('user') ?? '').trim(),
      m_lpage: '1',
    })
  }

  const filtered = Boolean(q.m_rq || q.m_request || q.m_user)

  return (
    <Panel
      title="Логи"
      description="Запросы к функциям и ошибки хранятся 30 дней, логи решений - 90 дней. Старше этого искать нечего."
      actions={(
        <>
          <ExportButton onExport={() => downloadCsv(`logs-${kind}-page-${page}`, items, kind === 'solutions' ? solutionCsv : requestCsv)} />
          <Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} onClick={logs.reload}>Обновить</Button>
        </>
      )}
    >
      <form key={`${q.m_rq}|${q.m_request}|${q.m_user}`} className="adm-toolbar" onSubmit={applyFilters}>
        <Segmented
          label="Какие логи"
          value={kind}
          options={[{ value: 'requests', label: 'Запросы' }, { value: 'solutions', label: 'Решения' }]}
          onChange={(value) => setQ({ m_kind: value, m_lpage: '1' })}
        />
        <Field label="Текст" className="is-grow">
          <input name="text" type="search" defaultValue={q.m_rq} placeholder={kind === 'solutions' ? 'Условие, задача, предмет, ошибка' : 'Маршрут, ошибка, IP или код'} />
        </Field>
        <Field label="Request id">
          <input name="request" defaultValue={q.m_request} className="adm-mono" placeholder="req-…" />
        </Field>
        <Field label="User id" hint={!userValid ? 'Нужен UUID' : undefined}>
          <input name="user" defaultValue={q.m_user} className="adm-mono" placeholder="UUID ученика" aria-invalid={!userValid || undefined} />
        </Field>
        <Button type="submit" variant="primary">Найти</Button>
        {filtered && <Button variant="ghost" onClick={() => setQ({ m_rq: '', m_request: '', m_user: '', m_lpage: '1' })}>Сбросить</Button>}
      </form>

      {logs.error ? (
        <ErrorState message={logs.error} onRetry={userValid ? logs.reload : undefined} />
      ) : (
        <>
          <DataTable
            columns={kind === 'solutions' ? solutionColumns : requestColumns}
            rows={items}
            rowKey={(row) => `${kind}-${String(row.id)}`}
            loading={logs.loading}
            empty={filtered ? 'По этому запросу записей нет.' : 'Записей за период нет.'}
            onRowClick={kind === 'solutions' ? (row) => setOpenLogId(str(row.id)) : undefined}
            rowClassName={(row) => (kind === 'requests' && num(row.status) >= 500 ? 'is-alert' : '')}
          />
          {total > LOGS_PAGE_SIZE && <Pagination page={page} pageSize={LOGS_PAGE_SIZE} total={total} onPage={(next) => setQ({ m_lpage: String(next) })} />}
        </>
      )}

      {openLogId && <SolutionLogDrawer logId={openLogId} onClose={() => setOpenLogId(null)} />}
    </Panel>
  )
}

function SolutionLogDrawer({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { openUser } = useAdmin()
  const log = useAsync(() => adminRpc<Json>('admin_solution_log', { p_log_id: logId }), [logId])
  const data = obj(log.data)
  const userId = str(data.user_id)
  const issues = arr(data.issues)
  const calls = arr(data.calls)
  return (
    <Drawer open wide title="Лог решения" subtitle={<span className="adm-mono">{logId}</span>} onClose={onClose}>
      {log.loading && !log.data ? (
        <LoadingState />
      ) : log.error ? (
        <ErrorState message={log.error} onRetry={log.reload} />
      ) : (
        <>
          <dl className="adm-kv">
            <dt>Ученик</dt>
            <dd>{userId ? <button type="button" className="mon-link" onClick={() => openUser(userId)}>{str(data.email) || userId}</button> : str(data.guest_id) ? `Гость ${str(data.guest_id)}` : '-'}</dd>
            <dt>Предмет и класс</dt><dd>{[str(data.subject), str(data.grade) && `${str(data.grade)} класс`].filter(Boolean).join(', ') || '-'}</dd>
            <dt>Источник</dt><dd>{str(data.source) || '-'}{str(data.task) ? ` · ${str(data.task)}` : ''}</dd>
            <dt>Итог</dt><dd>{str(data.outcome) || '-'}{numOrNull(data.status) !== null ? ` · HTTP ${num(data.status)}` : ''}{bool(data.truncated) ? ' · ответ обрезан' : ''}</dd>
            <dt>Модели</dt><dd className="adm-mono">{str(data.models) || '-'}</dd>
            <dt>Время</dt><dd>{formatNumber(num(data.seconds))} с</dd>
            <dt>Цена ученику</dt><dd>{formatKopecks(num(data.price_kopecks))}</dd>
            <dt>Себестоимость</dt><dd>{numOrNull(data.cost_kopecks) === null ? '-' : formatKopecks(num(data.cost_kopecks))}</dd>
            <dt>Ответ</dt><dd>{formatNumber(num(data.answer_chars))} знаков, шагов {formatNumber(num(data.steps_count))}{bool(data.has_diagram) ? ', с чертежом' : ''}</dd>
            <dt>Request id</dt><dd className="adm-mono">{str(data.request_id) || '-'}</dd>
            <dt>Ключ</dt><dd className="adm-mono">{str(data.idempotency_key) || '-'}</dd>
            <dt>Создан</dt><dd>{formatDateTime(strOrNull(data.created_at))}</dd>
          </dl>
          {str(data.error) && <p className="mon-bad">{str(data.error)}</p>}
          {str(data.condition) && (
            <>
              <h3 className="mon-subhead">Условие</h3>
              <p className="mon-prewrap">{str(data.condition)}</p>
            </>
          )}
          <h3 className="mon-subhead">Запрос к модели</h3>
          <JsonView value={data.request ?? null} maxHeight={480} />
          <h3 className="mon-subhead">Ответ модели</h3>
          <JsonView value={data.response ?? null} maxHeight={480} />
          {issues.length > 0 && (
            <>
              <h3 className="mon-subhead">Замечания проверки</h3>
              <JsonView value={issues} maxHeight={320} />
            </>
          )}
          {calls.length > 0 && (
            <>
              <h3 className="mon-subhead">Вызовы модели</h3>
              <JsonView value={calls} maxHeight={320} />
            </>
          )}
        </>
      )}
    </Drawer>
  )
}

/* ---------- Состояние ---------- */

type ServiceRow = {
  service: string
  ok: boolean
  status: string
  latencyMs: number | null
  detail: string
  checkedAt: string | null
  downSince: string | null
  uptime24h: number | null
  uptime7d: number | null
}

function HealthTab() {
  const { openUser } = useAdmin()
  const { pending, run } = useAction()
  const health = useAsync(() => adminRpc<Json>('admin_health'), [])
  const reload = health.reload
  const [manual, setManual] = useState<{ at: string; results: Row[] } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Пока вкладка открыта, данные сами обновляются раз в минуту.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, HEALTH_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  const data = obj(health.data)
  const services: ServiceRow[] = rows(data.services).map((row) => ({
    service: str(row.service),
    ok: bool(row.ok),
    status: str(row.status),
    latencyMs: numOrNull(row.latencyMs),
    detail: str(row.detail),
    checkedAt: strOrNull(row.checkedAt),
    downSince: strOrNull(row.downSince),
    uptime24h: numOrNull(row.uptime24h),
    uptime7d: numOrNull(row.uptime7d),
  }))
  const database = obj(data.database)
  const storage = obj(data.storage)
  const queue = obj(data.queue)
  const queueItems = rows(queue.items)
  const cron = rows(data.cron)
  const stuck = num(queue.stuck)
  const staleQueued = num(queue.staleQueued)

  const checkNow = async () => {
    const result = await run('check', () => adminAction<{ results?: Json }>('health_now'), (payload) => {
      const list = rows(payload.results)
      const down = list.filter((item) => !bool(item.ok)).length
      return `Проверено сервисов: ${list.length}, недоступно: ${down}`
    })
    if (!result) return
    setManual({ at: new Date().toISOString(), results: rows(result.results) })
    reload()
  }

  const expire = async () => {
    const result = await run('expire', () => adminRpc<Json>('admin_expire_stuck_jobs'), (payload) => `Закрыто задач: ${formatNumber(num(obj(payload).closed))}`)
    setConfirmOpen(false)
    if (result !== undefined) reload()
  }

  const serviceColumns: Column<ServiceRow>[] = [
    { key: 'service', header: 'Сервис', render: (row) => <strong>{row.service}</strong> },
    { key: 'ok', header: 'Состояние', render: (row) => <Badge tone={row.ok ? 'success' : 'danger'}>{row.ok ? 'Работает' : 'Недоступен'}</Badge> },
    { key: 'status', header: 'Ответ', mobile: false, render: (row) => <span className="adm-mono">{row.status || '-'}</span> },
    { key: 'latency', header: 'мс', align: 'right', render: (row) => (row.latencyMs === null ? '-' : formatNumber(row.latencyMs)) },
    { key: 'uptime', header: 'Доступность 24 ч / 7 дн', align: 'right', mobile: false, render: (row) => `${formatPercent(row.uptime24h)} / ${formatPercent(row.uptime7d)}` },
    {
      key: 'detail',
      header: 'Подробности',
      mobile: false,
      render: (row) => (
        <div className="adm-cell-main">
          {row.detail ? <span className="adm-clamp">{row.detail}</span> : <span className="adm-muted">-</span>}
          {!row.ok && row.downSince && <small className="mon-bad">Лежит с {formatDateTime(row.downSince)}</small>}
        </div>
      ),
    },
    { key: 'checked', header: 'Проверен', mobile: false, render: (row) => <span className="adm-nowrap">{relativeTime(row.checkedAt)}</span> },
  ]

  const queueColumns: Column<Row>[] = [
    { key: 'key', header: 'Задача', render: (row) => <span className="adm-mono">{str(row.key).slice(0, 18)}</span> },
    {
      key: 'user',
      header: 'Ученик',
      render: (row) => {
        const userId = str(row.userId)
        return userId ? <button type="button" className="mon-link" onClick={() => openUser(userId)}>{str(row.email) || userId.slice(0, 8)}</button> : <span className="adm-muted">гость</span>
      },
    },
    { key: 'subject', header: 'Предмет', mobile: false, render: (row) => str(row.subject) || '-' },
    { key: 'status', header: 'Статус', render: (row) => <Badge tone={str(row.status) === 'running' ? 'info' : 'neutral'}>{str(row.status) === 'running' ? 'решается' : 'в очереди'}</Badge> },
    { key: 'stage', header: 'Стадия', mobile: false, render: (row) => str(row.stage) || '-' },
    { key: 'created', header: 'Заведена', render: (row) => <span className="adm-nowrap">{relativeTime(strOrNull(row.createdAt))}</span> },
    { key: 'updated', header: 'Двигалась', mobile: false, render: (row) => <span className="adm-nowrap">{relativeTime(strOrNull(row.updatedAt))}</span> },
  ]

  const cronColumns: Column<Row>[] = [
    { key: 'job', header: 'Задание', render: (row) => <strong className="adm-mono">{str(row.job)}</strong> },
    { key: 'schedule', header: 'Расписание', render: (row) => <span className="adm-mono">{str(row.schedule)}</span> },
    { key: 'active', header: 'Включено', render: (row) => <Badge tone={bool(row.active) ? 'success' : 'neutral'}>{bool(row.active) ? 'да' : 'нет'}</Badge> },
    {
      key: 'last',
      header: 'Последний запуск',
      render: (row) => {
        const last = obj(row.lastRun)
        const status = str(last.status)
        if (!status) return <span className="adm-muted">не запускалось</span>
        return (
          <span className="mon-inline">
            <Badge tone={status === 'succeeded' ? 'success' : status === 'failed' ? 'danger' : 'info'}>{status}</Badge>
            <span className="adm-nowrap">{relativeTime(strOrNull(last.startedAt))}</span>
          </span>
        )
      },
    },
    { key: 'message', header: 'Сообщение', mobile: false, render: (row) => <span className="adm-clamp adm-mono">{str(obj(row.lastRun).message) || '-'}</span> },
  ]

  if (health.error && !health.data) return <Panel><ErrorState message={health.error} onRetry={reload} /></Panel>
  if (!health.data) return <Panel><LoadingState /></Panel>

  return (
    <>
      <Panel
        title="Сервисы"
        description={`Обновлено ${formatDateTime(strOrNull(database.now))}, дальше раз в минуту, пока вкладка открыта.`}
        actions={(
          <>
            <Button size="sm" variant="primary" icon={<Heartbeat size={16} weight="bold" aria-hidden="true" />} loading={pending === 'check'} onClick={() => { void checkNow() }}>Проверить сейчас</Button>
            <Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} onClick={reload}>Обновить</Button>
          </>
        )}
      >
        <DataTable
          columns={serviceColumns}
          rows={services}
          rowKey={(row) => row.service}
          loading={health.loading}
          empty="Проверок ещё не было. Нажми «Проверить сейчас»."
          rowClassName={(row) => (row.ok ? '' : 'is-alert')}
        />
        {/* Это состояние интеграции, а не проверка: провайдера оплаты нет. */}
        <div className="mon-static-row">
          <Badge>Не подключена</Badge>
          <span><strong>Робокасса</strong> - не подключена, платежи идут ручным подтверждением.</span>
        </div>
        {manual && (
          <div className="mon-manual">
            <h3 className="mon-subhead">Ручная проверка, {formatDateTime(manual.at)}</h3>
            <ul className="mon-manual-list">
              {manual.results.map((item) => (
                <li key={str(item.service)}>
                  <Badge tone={bool(item.ok) ? 'success' : 'danger'}>{bool(item.ok) ? 'ok' : 'сбой'}</Badge>
                  <strong>{str(item.service)}</strong>
                  <span className="adm-mono">{str(item.status)}</span>
                  {numOrNull(item.latencyMs) !== null && <span className="adm-muted">{formatNumber(num(item.latencyMs))} мс</span>}
                  {str(item.detail) && <small className="adm-muted mon-manual-detail">{str(item.detail)}</small>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="adm-grid-2">
        <Panel title="База данных">
          <dl className="adm-kv">
            <dt>Состояние</dt><dd><Badge tone={bool(database.ok) ? 'success' : 'danger'}>{bool(database.ok) ? 'Отвечает' : 'Сбой'}</Badge></dd>
            <dt>Размер</dt><dd className="adm-mono">{formatBytes(num(database.sizeBytes))}</dd>
            <dt>Соединений</dt><dd className="adm-mono">{formatNumber(num(database.connections))}</dd>
          </dl>
        </Panel>
        <Panel title="Хранилище файлов">
          <dl className="adm-kv">
            <dt>Корзин</dt><dd className="adm-mono">{formatNumber(num(storage.buckets))}</dd>
            <dt>Файлов</dt><dd className="adm-mono">{formatNumber(num(storage.objects))}</dd>
            <dt>Объём</dt><dd className="adm-mono">{formatBytes(num(storage.bytes))}</dd>
          </dl>
        </Panel>
      </div>

      <Panel
        title="Очередь решений"
        description="Зависшая - начатая задача без движения больше 5 минут, застоявшаяся - ждёт в очереди больше 20."
        actions={(
          <Button size="sm" variant="danger" icon={<Queue size={16} weight="bold" aria-hidden="true" />} disabled={stuck + staleQueued === 0} onClick={() => setConfirmOpen(true)}>
            Закрыть зависшие задачи
          </Button>
        )}
      >
        <StatGrid>
          <Stat label="В очереди" value={formatNumber(num(queue.queued))} />
          <Stat label="Решается" value={formatNumber(num(queue.running))} />
          <Stat label="Зависли" value={formatNumber(stuck)} tone={stuck > 0 ? 'danger' : undefined} />
          <Stat label="Застоялись в очереди" value={formatNumber(staleQueued)} tone={staleQueued > 0 ? 'warning' : undefined} />
          <Stat label="Готово за час" value={formatNumber(num(queue.doneLastHour))} />
          <Stat label="Сбоев за час" value={formatNumber(num(queue.failedLastHour))} tone={num(queue.failedLastHour) > 0 ? 'warning' : undefined} />
          <Stat label="Резервы чата" value={formatNumber(num(queue.chatReserved))} hint="ответы чата в процессе" />
        </StatGrid>
        <div className="mon-gap-top">
          <DataTable columns={queueColumns} rows={queueItems} rowKey={(row) => str(row.key) || `${str(row.userId)}-${str(row.createdAt)}`} empty="Активных задач нет." />
        </div>
      </Panel>

      <Panel title="Задания pg_cron" description="Последний запуск каждого задания по журналу cron.">
        <DataTable columns={cronColumns} rows={cron} rowKey={(row) => str(row.job)} empty="Заданий нет." rowClassName={(row) => (str(obj(row.lastRun).status) === 'failed' ? 'is-alert' : '')} />
      </Panel>

      <Modal
        open={confirmOpen}
        title="Закрыть зависшие задачи?"
        onClose={() => setConfirmOpen(false)}
        footer={(
          <>
            <Button onClick={() => setConfirmOpen(false)}>Отмена</Button>
            <Button variant="danger" loading={pending === 'expire'} onClick={() => { void expire() }}>Закрыть</Button>
          </>
        )}
      >
        <p>
          Задачи, у которых вышел срок (начатые без движения 5 минут, ждущие 20), закроются со сбоем. Сейчас таких:
          зависших {formatNumber(stuck)}, застоявшихся {formatNumber(staleQueued)}. Резерв за задачу возвращает вкладка ученика при следующем открытии.
        </p>
      </Modal>
    </>
  )
}
