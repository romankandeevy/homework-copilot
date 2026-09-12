/* Вкладка «Логи»: журнал запросов к функциям и полные логи решений.
   Первая страница без фильтров обновляется сама; дальше страницы стоят
   на месте, чтобы новые записи не сдвигали то, что читаешь. */

import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Json } from '../../lib/database.types'
import { adminRpc, downloadCsv, formatDateTime, formatKopecks, formatNumber, num, numOrNull, obj, rows, str, strOrNull } from '../api'
import type { CsvColumn, Row } from '../api'
import { Badge, Button, CopyButton, DataTable, ErrorState, ExportButton, Field, Pagination, Panel, Segmented, useQueryState } from '../ui'
import type { Column, Tone } from '../ui'
import { useAdmin } from '../context'
import { LiveStatus } from './monitoringShared'
import { useLiveQuery } from './useLiveQuery'
import { OutcomeBadge, SolutionLogDrawer } from './MonitoringSolutionLog'
import { describeAgent } from './monitoringFormat'

type LogKind = 'requests' | 'solutions'
const LOGS_PAGE_SIZE = 50
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  { header: 'User agent', value: (row) => str(row.userAgent) },
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

export function LogsTab() {
  const { openUser } = useAdmin()
  const [q, setQ] = useQueryState({ m_kind: 'requests', m_rq: '', m_request: '', m_user: '', m_lpage: '1' })
  const kind: LogKind = q.m_kind === 'solutions' ? 'solutions' : 'requests'
  const page = Math.max(1, Math.floor(Number(q.m_lpage)) || 1)
  const userValid = q.m_user === '' || uuidPattern.test(q.m_user)
  const [openLogId, setOpenLogId] = useState<string | null>(null)
  const filtered = Boolean(q.m_rq || q.m_request || q.m_user)
  const live = page === 1 && !filtered

  const logs = useLiveQuery(async () => {
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
  }, [kind, q.m_rq, q.m_request, q.m_user, page, userValid], { intervalMs: live ? 30_000 : null, onPulse: live })
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
    { key: 'time', header: 'Время, МСК', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> },
    { key: 'route', header: 'Запрос', render: (row) => <span className="adm-mono mon-route">{str(row.method)} {str(row.route)}</span> },
    { key: 'status', header: 'Ответ', render: (row) => <Badge tone={httpTone(num(row.status))}>{numOrNull(row.status) ?? '-'}</Badge> },
    { key: 'duration', header: 'Длительность', align: 'right', mobile: false, render: (row) => (numOrNull(row.durationMs) === null ? '-' : `${formatNumber(num(row.durationMs))} мс`) },
    { key: 'user', header: 'Кто', render: userCell },
    {
      key: 'client',
      header: 'IP и браузер',
      mobile: false,
      render: (row) => (
        <div className="adm-cell-main">
          <span className="adm-mono">{str(row.ip) || '-'}</span>
          {str(row.userAgent) && <small title={str(row.userAgent)}>{describeAgent(str(row.userAgent)) ?? 'браузер не распознан'}</small>}
        </div>
      ),
    },
    { key: 'request', header: 'Request id', mobile: false, render: requestIdCell },
    { key: 'error', header: 'Ошибка', mobile: false, render: (row) => (str(row.error) ? <span className="adm-clamp mon-bad">{str(row.error)}</span> : <span className="adm-muted">-</span>) },
  ]

  const solutionColumns: Column<Row>[] = [
    { key: 'time', header: 'Время, МСК', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> },
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
    { key: 'outcome', header: 'Итог', render: (row) => <OutcomeBadge outcome={str(row.outcome)} /> },
    { key: 'models', header: 'Модели', mobile: false, render: (row) => <span className="adm-mono mon-route">{str(row.models) || '-'}</span> },
    { key: 'seconds', header: 'Время решения', align: 'right', mobile: false, render: (row) => `${formatNumber(num(row.seconds))} с` },
    { key: 'cost', header: 'Себестоимость', align: 'right', mobile: false, render: (row) => (numOrNull(row.costKopecks) === null ? '-' : formatKopecks(num(row.costKopecks))) },
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

  const emptyText = filtered
    ? 'По этому запросу записей нет. Проверь request id или сбрось фильтры.'
    : kind === 'solutions' ? 'Логов решений за 90 дней нет: ученики ещё ничего не решали.' : 'Запросов к функциям за 30 дней нет.'

  return (
    <Panel
      title="Логи"
      description="Запросы к функциям и ошибки хранятся 30 дней, логи решений - 90 дней. Старше этого искать нечего."
      actions={(
        <>
          <LiveStatus
            updatedAt={logs.updatedAt}
            refreshing={logs.refreshing}
            error={logs.refreshError}
            note={live ? undefined : 'страница стоит на месте'}
          />
          <ExportButton onExport={() => downloadCsv(`logs-${kind}-page-${page}`, items, kind === 'solutions' ? solutionCsv : requestCsv)} />
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
          <input name="text" type="search" defaultValue={q.m_rq} placeholder={kind === 'solutions' ? 'Условие, задача, предмет, ошибка' : 'Маршрут, ошибка, IP или код ответа'} />
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

      {logs.error && !logs.data ? (
        <ErrorState message={logs.error} onRetry={userValid ? logs.reload : undefined} />
      ) : (
        <>
          <DataTable
            columns={kind === 'solutions' ? solutionColumns : requestColumns}
            rows={items}
            rowKey={(row) => `${kind}-${String(row.id)}`}
            loading={logs.loading}
            empty={emptyText}
            onRowClick={kind === 'solutions' ? (row) => setOpenLogId(str(row.id)) : undefined}
            rowClassName={(row) => (kind === 'requests' && num(row.status) >= 500 ? 'is-alert' : kind === 'solutions' ? 'mon-row' : '')}
          />
          {total > LOGS_PAGE_SIZE && <Pagination page={page} pageSize={LOGS_PAGE_SIZE} total={total} onPage={(next) => setQ({ m_lpage: String(next) })} />}
        </>
      )}

      {openLogId && <SolutionLogDrawer logId={openLogId} onClose={() => setOpenLogId(null)} />}
    </Panel>
  )
}
