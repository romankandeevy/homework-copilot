/* Подробности группы ошибок: статус, счётчики, одно событие целиком
   (стек, браузер, IP, время, маршрут, кто, вход, лог решения) и честная
   «попытка воспроизвести»: шаги из записанного и копирование контекста.
   Ничего никуда не отправляется. */

import { useState } from 'react'
import { ArrowSquareOut, Copy, ListMagnifyingGlass } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminRpc, formatDateTime, formatNumber, formatShortDate, num, numOrNull, obj, rows, str, strOrNull } from '../api'
import type { Row } from '../api'
import {
  Badge,
  Button,
  CopyButton,
  Drawer,
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  Segmented,
  Stat,
  StatGrid,
  useAction,
  useAsync,
} from '../ui'
import { useAdmin } from '../context'
import { errorStatusLabels, errorStatusTones, kindLabels, severityLabels, severityTones } from './monitoringLabels'
import { useLiveQuery } from './useLiveQuery'
import { describeAgent, formatExactMsk, reproContext, reproSteps } from './monitoringFormat'
import type { ReproEvent } from './monitoringFormat'
import { OutcomeBadge, SolutionLogDrawer } from './MonitoringSolutionLog'

type ErrorEvent = {
  id: string
  kind: string
  severity: string
  route: string | null
  message: string
  stack: string | null
  requestId: string | null
  userId: string | null
  email: string | null
  guestId: string | null
  ip: string | null
  input: Json | undefined
  environment: Json | undefined
  createdAt: string | null
  userAgent: string | null
  request: Row | null
  solutionLog: Row | null
}

function parseEvent(row: Row): ErrorEvent {
  const request = obj(row.request)
  const solutionLog = obj(row.solutionLog)
  return {
    id: String(num(row.id)),
    kind: str(row.kind),
    severity: str(row.severity, 'error'),
    route: strOrNull(row.route),
    message: str(row.message, 'Без сообщения'),
    stack: strOrNull(row.stack),
    requestId: strOrNull(row.requestId),
    userId: strOrNull(row.userId),
    email: strOrNull(row.email),
    guestId: strOrNull(row.guestId),
    ip: strOrNull(row.ip),
    input: row.input ?? undefined,
    environment: row.environment ?? undefined,
    createdAt: strOrNull(row.createdAt),
    userAgent: strOrNull(row.userAgent),
    request: Object.keys(request).length ? request : null,
    solutionLog: Object.keys(solutionLog).length ? solutionLog : null,
  }
}

function hasValue(value: Json | undefined) {
  if (value === undefined || value === null) return false
  if (typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length > 0
  return true
}

function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<Copy size={16} weight="bold" aria-hidden="true" />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? 'Скопировано' : label}
    </Button>
  )
}

export function ErrorDetailDrawer({ fingerprint, eventId, onSelectEvent, onClose, onChanged, onOpenLogs }: {
  fingerprint: string
  eventId: string
  onSelectEvent: (eventId: string) => void
  onClose: () => void
  onChanged: () => void
  onOpenLogs: (requestId: string) => void
}) {
  const { openUser, refreshSignals } = useAdmin()
  const { pending, run } = useAction()
  const [logId, setLogId] = useState<string | null>(null)
  const detail = useLiveQuery(() => adminRpc<Json>('admin_error_detail', { p_fingerprint: fingerprint }), [fingerprint], { intervalMs: 60_000 })
  const data = obj(detail.data)
  // group - это to_jsonb строки, поэтому ключи в snake_case.
  const group = obj(data.group)
  const stats = obj(data.stats)
  const events = rows(data.events).map(parseEvent)
  const status = str(group.status, 'new')

  // Событие из хронологии бывает старше пятидесяти последних - догружаем его.
  const missing = Boolean(eventId) && detail.data !== null && !events.some((event) => event.id === eventId)
  const extra = useAsync(async () => (missing ? adminRpc<Json>('admin_error_event', { p_event_id: Number(eventId) }) : null), [missing, eventId])
  const extraEvent = missing && extra.data && str(obj(extra.data).fingerprint) === fingerprint ? parseEvent(obj(extra.data)) : null
  const allEvents = extraEvent ? [extraEvent, ...events] : events
  const selected = allEvents.find((event) => event.id === eventId) ?? allEvents[0] ?? null

  const setStatus = async (next: string) => {
    if (next === status || pending) return
    const result = await run(`status:${next}`, () => adminRpc('admin_error_set_status', { p_fingerprint: fingerprint, p_status: next }), `Статус группы: ${(errorStatusLabels[next] ?? next).toLowerCase()}`)
    if (result === undefined) return
    detail.reload()
    onChanged()
    refreshSignals()
  }

  const who = (event: ErrorEvent) => (event.userId ? `ученик ${event.email || event.userId}` : event.guestId ? `гость ${event.guestId}` : 'пользователь не записан')
  const repro: ReproEvent | null = selected ? {
    title: str(group.title) || selected.message,
    fingerprint,
    kind: selected.kind,
    severity: selected.severity,
    message: selected.message,
    route: selected.route,
    createdAt: selected.createdAt,
    who: who(selected),
    ip: selected.ip,
    userAgent: selected.userAgent,
    requestId: selected.requestId,
    request: selected.request ? {
      method: str(selected.request.method, 'POST'),
      route: str(selected.request.route),
      status: numOrNull(selected.request.status),
      durationMs: numOrNull(selected.request.durationMs),
    } : null,
    environment: selected.environment ?? null,
    input: selected.input ?? null,
    stack: selected.stack,
  } : null
  const trend = rows(stats.trend)

  return (
    <Drawer
      open
      wide
      title={str(group.title) || 'Группа ошибок'}
      subtitle={str(group.fingerprint) ? `${kindLabels[str(group.kind)] ?? str(group.kind)}, маршрут ${str(group.route) || 'не записан'}` : undefined}
      onClose={onClose}
    >
      {detail.loading && !detail.data ? (
        <LoadingState />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : !str(group.fingerprint) ? (
        <EmptyState>Группа не найдена: возможно, её уже удалил срок хранения (события ошибок живут 30 дней).</EmptyState>
      ) : (
        <>
          <div className="mon-drawer-top">
            <span className="mon-badges">
              <Badge tone="accent">{kindLabels[str(group.kind)] ?? str(group.kind)}</Badge>
              <Badge tone={severityTones[str(group.severity)] ?? 'neutral'}>{severityLabels[str(group.severity)] ?? str(group.severity)}</Badge>
              <Badge tone={errorStatusTones[status] ?? 'neutral'}>{errorStatusLabels[status] ?? status}</Badge>
            </span>
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
          </div>

          <StatGrid>
            <Stat label="Повторов всего" value={formatNumber(num(group.occurrences))} />
            <Stat label="За последний час" value={formatNumber(num(stats.lastHour))} tone={num(stats.lastHour) > 0 ? 'danger' : undefined} />
            <Stat label="За 24 часа" value={formatNumber(num(stats.last24h))} />
            <Stat label="Учеников и гостей задело" value={formatNumber(num(group.users_affected))} />
          </StatGrid>

          <dl className="adm-kv">
            <dt>Впервые</dt><dd>{formatExactMsk(strOrNull(group.first_seen_at))}</dd>
            <dt>Последний раз</dt><dd>{formatExactMsk(strOrNull(group.last_seen_at))}</dd>
            <dt>Отпечаток</dt>
            <dd className="mon-inline"><code className="adm-mono">{str(group.fingerprint)}</code><CopyButton value={str(group.fingerprint)} label="Скопировать отпечаток" /></dd>
            {trend.length > 0 && (
              <>
                <dt>За 7 дней</dt>
                <dd>
                  <ol className="mon-days" aria-label="Повторов по дням за 7 дней">
                    {trend.map((day) => (
                      <li key={str(day.date)} className={num(day.count) > 0 ? 'has-value' : undefined}>
                        <span>{formatShortDate(str(day.date))}</span>
                        <b>{formatNumber(num(day.count))}</b>
                      </li>
                    ))}
                  </ol>
                </dd>
              </>
            )}
          </dl>

          {!selected ? (
            <EmptyState>Событий этой группы больше нет: они хранятся 30 дней.</EmptyState>
          ) : (
            <section className="mon-event-card" aria-label="Событие">
              <header className="mon-event-head">
                <h3>Событие {formatExactMsk(selected.createdAt)}</h3>
                {allEvents.length > 1 && (
                  <label className="adm-field mon-event-pick">
                    <span className="adm-field-label">Другое событие ({formatNumber(allEvents.length)}{allEvents.length >= 50 ? ', последние' : ''})</span>
                    <select value={selected.id} onChange={(event) => onSelectEvent(event.target.value)}>
                      {allEvents.map((event, index) => (
                        <option key={event.id} value={event.id}>{formatExactMsk(event.createdAt)}{index === 0 && !extraEvent ? ' - последнее' : ''}</option>
                      ))}
                    </select>
                  </label>
                )}
              </header>

              <p className="mon-message">{selected.message}</p>

              <dl className="adm-kv">
                <dt>Точное время</dt><dd>{formatExactMsk(selected.createdAt)}</dd>
                <dt>Маршрут</dt><dd className="adm-mono">{selected.route || '-'}</dd>
                <dt>Кто</dt>
                <dd>
                  {selected.userId ? (
                    <button type="button" className="mon-link" onClick={() => openUser(selected.userId ?? '')}>
                      {selected.email || selected.userId}
                      <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
                      <span className="mon-sr"> - открыть карточку ученика</span>
                    </button>
                  ) : selected.guestId ? (
                    <span>Гость <code className="adm-mono">{selected.guestId}</code></span>
                  ) : <span className="adm-muted">Не записан</span>}
                </dd>
                <dt>IP</dt><dd className="adm-mono">{selected.ip || '-'}</dd>
                <dt>Браузер</dt>
                <dd>
                  {selected.userAgent ? (
                    <span className="mon-agent">
                      <span>{describeAgent(selected.userAgent) ?? 'Не распознан'}</span>
                      <small className="adm-mono">{selected.userAgent}</small>
                    </span>
                  ) : <span className="adm-muted">Не записан{selected.kind !== 'frontend' ? ': ошибка на сервере' : ''}</span>}
                </dd>
                <dt>Request id</dt>
                <dd>
                  {selected.requestId ? (
                    <span className="mon-inline">
                      <code className="adm-mono">{selected.requestId}</code>
                      <CopyButton value={selected.requestId} label="Скопировать request id" />
                      <Button size="sm" variant="ghost" icon={<ListMagnifyingGlass size={15} weight="bold" aria-hidden="true" />} onClick={() => onOpenLogs(selected.requestId ?? '')}>В логах</Button>
                    </span>
                  ) : <span className="adm-muted">-</span>}
                </dd>
                {selected.request && (
                  <>
                    <dt>Запрос</dt>
                    <dd className="adm-mono">
                      {str(selected.request.method)} {str(selected.request.route)}, статус {numOrNull(selected.request.status) ?? '-'}
                      {numOrNull(selected.request.durationMs) !== null ? `, ${formatNumber(num(selected.request.durationMs))} мс` : ''}
                    </dd>
                  </>
                )}
                <dt>Лог решения</dt>
                <dd>
                  {selected.solutionLog ? (
                    <span className="mon-inline">
                      <OutcomeBadge outcome={str(selected.solutionLog.outcome)} />
                      <span>{str(selected.solutionLog.subject) || 'Без предмета'}{numOrNull(selected.solutionLog.status) !== null ? `, HTTP ${num(selected.solutionLog.status)}` : ''}</span>
                      <Button size="sm" variant="ghost" onClick={() => setLogId(str(selected.solutionLog?.id))}>Открыть лог</Button>
                    </span>
                  ) : <span className="adm-muted">{selected.requestId ? 'По этому request id лога решения нет' : 'Нет: у события нет request id'}</span>}
                </dd>
              </dl>

              <div className="mon-block">
                <div className="mon-block-head">
                  <h4 className="mon-subhead">Стек-трейс</h4>
                  {selected.stack && <CopyButton value={selected.stack} label="Скопировать стек" />}
                </div>
                {selected.stack ? <pre className="mon-stack">{selected.stack}</pre> : <p className="adm-muted">Стек не записан.</p>}
              </div>

              <div className="mon-block">
                <h4 className="mon-subhead">Входные данные запроса</h4>
                {hasValue(selected.input) ? <JsonView value={selected.input} maxHeight={260} /> : <p className="adm-muted">Не записаны.</p>}
              </div>

              {hasValue(selected.environment) && (
                <details className="mon-block mon-disclosure">
                  <summary>Окружение целиком</summary>
                  <JsonView value={selected.environment} maxHeight={260} />
                </details>
              )}

              {repro && (
                <div className="mon-repro">
                  <h4 className="mon-subhead">Как воспроизвести</h4>
                  <ol>
                    {reproSteps(repro).map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  <div className="mon-repro-actions">
                    <CopyTextButton text={reproContext(repro)} label="Скопировать весь контекст" />
                    <small className="adm-muted">Текст только копируется в буфер обмена, никуда не отправляется.</small>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {logId && <SolutionLogDrawer logId={logId} onClose={() => setLogId(null)} />}
    </Drawer>
  )
}
