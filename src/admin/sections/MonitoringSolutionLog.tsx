/* Полный лог решения: условие, запрос к модели, ответ, замечания проверки.
   Открывается из логов и из подробностей ошибки (по request id). */

import type { Json } from '../../lib/database.types'
import { adminRpc, arr, bool, formatDateTime, formatKopecks, formatNumber, num, numOrNull, obj, str, strOrNull } from '../api'
import { Badge, Drawer, ErrorState, JsonView, LoadingState, useAsync } from '../ui'
import { useAdmin } from '../context'
import { outcomeLabels, outcomeTones } from './monitoringLabels'

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (!outcome) return <span className="adm-muted">-</span>
  return <Badge tone={outcomeTones[outcome] ?? 'neutral'}>{outcomeLabels[outcome] ?? outcome}</Badge>
}

export function SolutionLogDrawer({ logId, onClose }: { logId: string; onClose: () => void }) {
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
            <dt>Источник</dt><dd>{str(data.source) || '-'}{str(data.task) ? `, ${str(data.task)}` : ''}</dd>
            <dt>Итог</dt>
            <dd className="mon-inline">
              <OutcomeBadge outcome={str(data.outcome)} />
              {numOrNull(data.status) !== null && <span className="adm-mono">HTTP {num(data.status)}</span>}
              {bool(data.truncated) && <Badge tone="warning">ответ обрезан</Badge>}
            </dd>
            <dt>Модели</dt><dd className="adm-mono">{str(data.models) || '-'}</dd>
            <dt>Время решения</dt><dd>{formatNumber(num(data.seconds))} с</dd>
            <dt>Цена ученику</dt><dd>{formatKopecks(num(data.price_kopecks))}</dd>
            <dt>Себестоимость</dt><dd>{numOrNull(data.cost_kopecks) === null ? '-' : formatKopecks(num(data.cost_kopecks))}</dd>
            <dt>Ответ</dt><dd>{formatNumber(num(data.answer_chars))} знаков, шагов {formatNumber(num(data.steps_count))}{bool(data.has_diagram) ? ', с чертежом' : ''}</dd>
            <dt>Request id</dt><dd className="adm-mono">{str(data.request_id) || '-'}</dd>
            <dt>Ключ задачи</dt><dd className="adm-mono">{str(data.idempotency_key) || '-'}</dd>
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
