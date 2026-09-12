/* Состояние: светофор сервисов (зелёный - работает, жёлтый - медленно,
   не настроен или проверка устарела, красный - не отвечает), база,
   хранилище, очередь решений и задания pg_cron. */

import { useState } from 'react'
import { Heartbeat, Queue } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import { adminAction, adminRpc, bool, formatDateTime, formatNumber, formatPercent, num, numOrNull, obj, relativeTime, rows, str, strOrNull } from '../api'
import type { Row } from '../api'
import { Badge, Button, DataTable, EmptyState, ErrorState, LoadingState, Modal, Panel, Stat, StatGrid, useAction } from '../ui'
import type { Column } from '../ui'
import { useAdmin } from '../context'
import { LiveStatus } from './monitoringShared'
import { serviceLabel } from './monitoringLabels'
import { useLiveQuery } from './useLiveQuery'
import { formatMinutes } from './monitoringFormat'

/* Проверка ждёт ответа до 10-15 секунд. Дольше трёх - сервис жив, но
   ученик уже заметит задержку: жёлтый. */
const SLOW_MS = 3000
/* Проверки идут раз в пять минут: без свежей дольше 15 минут светофор
   показывает прошлое, а не сейчас. */
const STALE_MINUTES = 15

type Light = 'ok' | 'warn' | 'down'

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

function lightOf(row: ServiceRow): { light: Light; label: string } {
  const minutesSinceCheck = row.checkedAt ? (Date.now() - Date.parse(row.checkedAt)) / 60_000 : Infinity
  if (!row.ok && row.status !== 'not_configured') {
    const since = row.downSince ? Math.max(0, Math.round((Date.now() - Date.parse(row.downSince)) / 60_000)) : null
    return { light: 'down', label: since !== null ? `Не отвечает ${formatMinutes(since)}` : 'Не отвечает' }
  }
  if (row.status === 'not_configured') return { light: 'warn', label: 'Не настроен' }
  if (minutesSinceCheck > STALE_MINUTES) return { light: 'warn', label: 'Давно не проверялся' }
  if (row.latencyMs !== null && row.latencyMs > SLOW_MS) return { light: 'warn', label: 'Отвечает медленно' }
  return { light: 'ok', label: 'Работает' }
}

const cronStatusLabels: Record<string, string> = { succeeded: 'успешно', failed: 'сбой', running: 'идёт', starting: 'запускается' }

export function HealthTab() {
  const { openUser } = useAdmin()
  const { pending, run } = useAction()
  const health = useLiveQuery(() => adminRpc<Json>('admin_health'), [], { intervalMs: 60_000, onPulse: false })
  const [confirmOpen, setConfirmOpen] = useState(false)

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
  const lights = services.map((row) => ({ row, ...lightOf(row) }))
  const counts = { ok: 0, warn: 0, down: 0 }
  lights.forEach((item) => { counts[item.light] += 1 })
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
      const down = list.filter((item) => !bool(item.ok) && str(item.status) !== 'not_configured').length
      return down ? `Проверено сервисов: ${list.length}, не отвечает: ${down}` : `Проверено сервисов: ${list.length}, все отвечают`
    })
    if (result) health.reload()
  }

  const expire = async () => {
    const result = await run('expire', () => adminRpc<Json>('admin_expire_stuck_jobs'), (payload) => `Закрыто задач: ${formatNumber(num(obj(payload).closed))}`)
    setConfirmOpen(false)
    if (result !== undefined) health.reload()
  }

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
    { key: 'updated', header: 'Последнее движение', mobile: false, render: (row) => <span className="adm-nowrap">{relativeTime(strOrNull(row.updatedAt))}</span> },
  ]

  const cronColumns: Column<Row>[] = [
    { key: 'job', header: 'Задание', render: (row) => <strong className="adm-mono">{str(row.job)}</strong> },
    { key: 'schedule', header: 'Расписание (cron)', mobile: false, render: (row) => <span className="adm-mono">{str(row.schedule)}</span> },
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
            <Badge tone={status === 'succeeded' ? 'success' : status === 'failed' ? 'danger' : 'info'}>{cronStatusLabels[status] ?? status}</Badge>
            <span className="adm-nowrap">{relativeTime(strOrNull(last.startedAt))}</span>
          </span>
        )
      },
    },
    { key: 'message', header: 'Ответ задания', mobile: false, render: (row) => <span className="adm-clamp adm-mono">{str(obj(row.lastRun).message) || '-'}</span> },
  ]

  if (health.error && !health.data) return <Panel><ErrorState message={health.error} onRetry={health.reload} /></Panel>
  if (!health.data) return <Panel><LoadingState label="Загружаем состояние сервисов…" /></Panel>

  return (
    <>
      <Panel
        title="Сервисы"
        description="Функция на Vercel проверяет каждый сервис раз в пять минут. Зелёный - работает, жёлтый - медленно, не настроен или давно не проверялся, красный - не отвечает."
        actions={(
          <>
            <LiveStatus updatedAt={health.updatedAt} refreshing={health.refreshing} error={health.refreshError} />
            <Button size="sm" variant="primary" icon={<Heartbeat size={16} weight="bold" aria-hidden="true" />} loading={pending === 'check'} onClick={() => { void checkNow() }}>Проверить сейчас</Button>
          </>
        )}
      >
        {services.length === 0 ? (
          <EmptyState>Проверок ещё не было. Нажми «Проверить сейчас» - первая проверка займёт до 15 секунд.</EmptyState>
        ) : (
          <>
            <p className="mon-lights-summary">
              Работают {formatNumber(counts.ok)} из {formatNumber(services.length)}
              {counts.warn > 0 && <>, требуют внимания {formatNumber(counts.warn)}</>}
              {counts.down > 0 && <>, <span className="mon-bad">не отвечают {formatNumber(counts.down)}</span></>}
            </p>
            <ul className="mon-lights">
              {lights.map(({ row, light, label }) => (
                <li key={row.service} className={`mon-light-row is-${light}`}>
                  <span className={`mon-light is-${light}`} aria-hidden="true" />
                  <div className="mon-light-main">
                    <strong>{serviceLabel(row.service)}</strong>
                    <span className="mon-light-state">{label}{row.detail ? `: ${row.detail}` : ''}</span>
                  </div>
                  <dl className="mon-light-facts">
                    <div><dt>Задержка</dt><dd>{row.latencyMs === null ? '-' : `${formatNumber(row.latencyMs)} мс`}</dd></div>
                    <div><dt>Проверен</dt><dd title={formatDateTime(row.checkedAt)}>{relativeTime(row.checkedAt)}</dd></div>
                    <div className="mon-light-uptime"><dt>Доступен за 24 ч</dt><dd>{formatPercent(row.uptime24h)}</dd></div>
                    <div className="mon-light-uptime"><dt>за 7 дней</dt><dd>{formatPercent(row.uptime7d)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* Это состояние интеграции, а не проверка: провайдера оплаты нет. */}
        <div className="mon-static-row">
          <Badge>Не подключена</Badge>
          <span><strong>Робокасса</strong> - не подключена, платежи идут ручным подтверждением.</span>
        </div>
      </Panel>

      <div className="adm-grid-2">
        <Panel title="База данных">
          <dl className="adm-kv">
            <dt>Состояние</dt><dd><Badge tone={bool(database.ok) ? 'success' : 'danger'}>{bool(database.ok) ? 'Отвечает' : 'Сбой'}</Badge></dd>
            <dt>Размер</dt><dd className="adm-mono">{formatBytes(num(database.sizeBytes))}</dd>
            <dt>Соединений сейчас</dt><dd className="adm-mono">{formatNumber(num(database.connections))}</dd>
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
        description="Зависшая - начатая задача без движения больше 5 минут. Застоявшаяся - ждёт в очереди больше 20 минут."
        actions={(
          <Button size="sm" variant="danger" icon={<Queue size={16} weight="bold" aria-hidden="true" />} disabled={stuck + staleQueued === 0} onClick={() => setConfirmOpen(true)}>
            Закрыть зависшие задачи
          </Button>
        )}
      >
        <StatGrid>
          <Stat label="Ждут в очереди" value={formatNumber(num(queue.queued))} />
          <Stat label="Решаются сейчас" value={formatNumber(num(queue.running))} />
          <Stat label="Зависли" value={formatNumber(stuck)} tone={stuck > 0 ? 'danger' : undefined} />
          <Stat label="Застоялись в очереди" value={formatNumber(staleQueued)} tone={staleQueued > 0 ? 'warning' : undefined} />
          <Stat label="Готово за последний час" value={formatNumber(num(queue.doneLastHour))} />
          <Stat label="Сбоев за последний час" value={formatNumber(num(queue.failedLastHour))} tone={num(queue.failedLastHour) > 0 ? 'warning' : undefined} />
          <Stat label="Ответов чата в работе" value={formatNumber(num(queue.chatReserved))} />
        </StatGrid>
        <div className="mon-gap-top">
          <DataTable columns={queueColumns} rows={queueItems} rowKey={(row) => str(row.key) || `${str(row.userId)}-${str(row.createdAt)}`} empty="Очередь пуста: сейчас ничего не решается и не ждёт." />
        </div>
      </Panel>

      <Panel title="Задания pg_cron" description="Фоновые задания базы и их последний запуск по журналу cron.">
        <DataTable columns={cronColumns} rows={cron} rowKey={(row) => str(row.job)} empty="Заданий pg_cron нет." rowClassName={(row) => (str(obj(row.lastRun).status) === 'failed' ? 'is-alert' : '')} />
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${formatNumber(Math.round((value / 1024 ** index) * 10) / 10)} ${units[index]}`
}
