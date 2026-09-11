/* Раздел «Пользователи»: таблица с серверной пагинацией, поиском, фильтрами
   и массовыми действиями. Поиск, фильтры, сортировка и страница живут в
   адресе с приставкой u_, чтобы отфильтрованный вид можно было переслать. */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, InputHTMLAttributes } from 'react'
import { X } from '@phosphor-icons/react'
import type { Json } from '../../lib/database.types'
import {
  adminErrorMessage,
  adminRpc,
  bool,
  downloadCsv,
  formatDate,
  formatDateTime,
  formatKopecks,
  formatNumber,
  num,
  numOrNull,
  obj,
  relativeTime,
  rows,
  rublesInputToKopecks,
  str,
  todayMsk,
} from '../api'
import type { CsvColumn, Row } from '../api'
import { useAdmin } from '../context'
import { Badge, Button, DataTable, ErrorState, ExportButton, Field, Modal, PageHeader, Pagination, Panel, useAction, useAsync, useQueryState, useToast } from '../ui'
import type { Column, Tone } from '../ui'
import './users.css'

const PAGE_SIZE = 50
const EXPORT_LIMIT = 5000
const BULK_LIMIT = 500

const QUERY_DEFAULTS = {
  u_q: '',
  u_plan: '',
  u_from: '',
  u_to: '',
  u_bmin: '',
  u_bmax: '',
  u_fraud: '',
  u_banned: '',
  u_paid: '',
  u_sort: 'last_seen',
  u_dir: 'desc',
  u_page: '1',
}

type UsersQuery = typeof QUERY_DEFAULTS
type BulkAction = 'ban' | 'unban' | 'credit'
type BulkFailure = { userId: string; email: string; error: string }
type BulkResult = { action: BulkAction; done: number; failed: BulkFailure[] }

const FILTER_KEYS = ['u_q', 'u_plan', 'u_from', 'u_to', 'u_bmin', 'u_bmax', 'u_fraud', 'u_banned', 'u_paid'] as const

const BULK_TITLE: Record<BulkAction, string> = { ban: 'Блокировка', unban: 'Разблокировка', credit: 'Начисление' }

const RISK_LABEL: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  return 'neutral'
}

function buildFilters(query: UsersQuery) {
  const filters: Record<string, string | number> = {}
  if (query.u_plan) filters.plan = query.u_plan
  if (query.u_from) filters.registeredFrom = query.u_from
  if (query.u_to) filters.registeredTo = query.u_to
  const min = query.u_bmin ? rublesInputToKopecks(query.u_bmin) : null
  if (min !== null) filters.balanceMin = min
  const max = query.u_bmax ? rublesInputToKopecks(query.u_bmax) : null
  if (max !== null) filters.balanceMax = max
  if (query.u_fraud === '1') filters.fraud = 'true'
  if (query.u_banned === 'yes') filters.banned = 'true'
  if (query.u_banned === 'no') filters.banned = 'false'
  if (query.u_paid === 'yes' || query.u_paid === 'no') filters.paid = query.u_paid
  return filters
}

// datetime-local отдаёт время без пояса, Date читает его как местное.
function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nowLocalInput() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function kopecksToCsv(value: number) {
  return (value / 100).toFixed(2).replace('.', ',')
}

function statusText(row: Row) {
  if (bool(row.isBanned)) return 'забанен'
  if (num(row.openFlags) > 0) return 'флаг фрода'
  return 'активен'
}

const CSV_COLUMNS: CsvColumn<Row>[] = [
  { header: 'id', value: (row) => str(row.id) },
  { header: 'Почта', value: (row) => str(row.email) },
  { header: 'Имя', value: (row) => str(row.fullName) },
  { header: 'Класс', value: (row) => numOrNull(row.grade) },
  { header: 'Тариф', value: (row) => str(row.planTitle) },
  { header: 'Баланс, ₽', value: (row) => kopecksToCsv(num(row.balance)) },
  { header: 'Задач', value: (row) => num(row.tasks) },
  { header: 'Оплачено, ₽', value: (row) => kopecksToCsv(num(row.paidTotal)) },
  { header: 'Регистрация', value: (row) => str(row.createdAt) },
  { header: 'Последняя активность', value: (row) => str(row.lastSeenAt) },
  { header: 'Статус', value: statusText },
  { header: 'Бан до', value: (row) => str(row.bannedUntil) },
  { header: 'Открытых флагов', value: (row) => num(row.openFlags) },
  { header: 'Риск', value: (row) => RISK_LABEL[str(row.maxRisk)] ?? '' },
]

function StatusBadges({ row }: { row: Row }) {
  const banned = bool(row.isBanned)
  const flags = num(row.openFlags)
  const risk = str(row.maxRisk)
  const until = str(row.bannedUntil)
  return (
    <div className="adm-users-badges">
      {banned && <Badge tone="danger">{until ? `бан до ${formatDateTime(until)}` : 'бан'}</Badge>}
      {!banned && flags === 0 && <Badge tone="success">активен</Badge>}
      {flags > 0 && (
        <Badge tone={riskTone(risk)} title={`Открытых флагов: ${flags}`}>
          фрод: {RISK_LABEL[risk] ?? risk}{flags > 1 ? ` · ${flags}` : ''}
        </Badge>
      )}
    </div>
  )
}

const COLUMNS: Column<Row>[] = [
  {
    key: 'user',
    header: 'Пользователь',
    sortKey: 'email',
    render: (row) => {
      const name = str(row.fullName).trim()
      const email = str(row.email)
      return (
        <div className="adm-cell-main">
          <strong>{name || email || 'Без имени'}</strong>
          {name && <small>{email}</small>}
          <small className="adm-mono">{str(row.id).slice(0, 8)}</small>
        </div>
      )
    },
  },
  { key: 'plan', header: 'Тариф', mobile: false, render: (row) => str(row.planTitle) || '-' },
  { key: 'balance', header: 'Баланс', sortKey: 'balance', align: 'right', render: (row) => <span className="adm-nowrap">{formatKopecks(num(row.balance))}</span> },
  { key: 'tasks', header: 'Задач', sortKey: 'tasks', align: 'right', render: (row) => formatNumber(num(row.tasks)) },
  { key: 'paid', header: 'Оплачено', sortKey: 'paid', align: 'right', mobile: false, render: (row) => <span className="adm-nowrap">{num(row.paidTotal) ? formatKopecks(num(row.paidTotal)) : '-'}</span> },
  { key: 'created', header: 'Регистрация', sortKey: 'created', mobile: false, render: (row) => <span className="adm-nowrap">{str(row.createdAt) ? formatDate(str(row.createdAt)) : '-'}</span> },
  { key: 'seen', header: 'Был в сети', sortKey: 'last_seen', render: (row) => <span className="adm-nowrap">{str(row.lastSeenAt) ? relativeTime(str(row.lastSeenAt)) : 'не заходил'}</span> },
  { key: 'status', header: 'Статус', render: (row) => <StatusBadges row={row} /> },
  { key: 'grade', header: 'Класс', align: 'right', mobile: false, render: (row) => { const grade = numOrNull(row.grade); return grade === null ? '-' : grade } },
]

/* Поле, которое пишет в адрес не на каждое нажатие, а после паузы: иначе
   каждая буква - запрос к базе и запись в историю браузера. */
function DebouncedInput({ value, onCommit, delay = 250, ...rest }: { value: string; onCommit: (value: string) => void; delay?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  // Значение поменялось снаружи (кнопка «назад», сброс фильтров) - показываем его.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setDraft(value)
    }
  }, [value])

  useEffect(() => {
    if (draft === committed.current) return
    const timer = window.setTimeout(() => {
      committed.current = draft
      commitRef.current(draft)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [draft, delay])

  return <input {...rest} value={draft} onChange={(event) => setDraft(event.target.value)} />
}

function BulkDialog({ action, count, pending, onClose, onSubmit }: {
  action: BulkAction
  count: number
  pending: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const formId = useId()
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const kopecks = rublesInputToKopecks(amount)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (action === 'unban') {
      onSubmit({})
      return
    }
    const cleanReason = reason.trim()
    if (action === 'ban') {
      if (cleanReason.length < 3 || cleanReason.length > 500) {
        setError('Причина блокировки - от 3 до 500 символов.')
        return
      }
      const untilIso = localInputToIso(until)
      if (until && (!untilIso || new Date(untilIso).getTime() <= Date.now())) {
        setError('Срок блокировки должен быть в будущем.')
        return
      }
      onSubmit({ reason: cleanReason, until: untilIso })
      return
    }
    if (kopecks === null || kopecks <= 0 || kopecks > 10_000_000) {
      setError('Сумма - от 0,01 до 100 000 ₽.')
      return
    }
    if (cleanReason.length < 3 || cleanReason.length > 160) {
      setError('Причина начисления - от 3 до 160 символов.')
      return
    }
    onSubmit({ amount: kopecks, reason: cleanReason })
  }

  const title = action === 'ban' ? `Заблокировать: ${formatNumber(count)}` : action === 'unban' ? `Разблокировать: ${formatNumber(count)}` : `Начислить: ${formatNumber(count)}`
  const submitLabel = action === 'ban' ? 'Заблокировать' : action === 'unban' ? 'Разблокировать' : kopecks && kopecks > 0 ? `Начислить по ${formatKopecks(kopecks)}` : 'Начислить'

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant={action === 'ban' ? 'danger' : 'primary'} loading={pending}>{submitLabel}</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form" onSubmit={submit}>
        {action === 'unban' && <p>С выбранных аккаунтов снимется блокировка. Каждое снятие попадёт в журнал.</p>}
        {action === 'ban' && (
          <>
            <p>Каждая блокировка с причиной попадёт в журнал. Без срока - бессрочно, со сроком снимется сама.</p>
            <Field label="Причина">
              <textarea data-initial-focus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <Field label="До (необязательно)" hint="Время по часам этого компьютера.">
              <input type="datetime-local" value={until} min={nowLocalInput()} onChange={(event) => setUntil(event.target.value)} />
            </Field>
          </>
        )}
        {action === 'credit' && (
          <>
            <p>Каждому выбранному пользователю начислится одна и та же сумма. Операция попадёт в историю баланса и в журнал.</p>
            <Field label="Сумма каждому, ₽">
              <input data-initial-focus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="например 100" />
            </Field>
            <Field label="Причина">
              <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} />
            </Field>
            {kopecks !== null && kopecks > 0 && <p className="adm-card-hint">Всего будет начислено {formatKopecks(kopecks * count)}.</p>}
          </>
        )}
        {error && <p className="adm-card-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default function UsersSection() {
  const { access, openUser } = useAdmin()
  const toast = useToast()
  const { pending, run } = useAction()
  const [query, setQuery] = useQueryState(QUERY_DEFAULTS)
  const page = Math.max(1, Number.parseInt(query.u_page, 10) || 1)
  const filters = useMemo(() => buildFilters(query), [query])
  const filtersKey = JSON.stringify(filters)
  const search = query.u_q.trim()
  const sort = query.u_sort
  const direction = query.u_dir === 'asc' ? 'asc' : 'desc'

  const listArgs = { p_search: search, p_filters: filters, p_sort: sort, p_dir: direction }
  const list = useAsync(
    () => adminRpc<Json>('admin_users_list', { ...listArgs, p_page: page, p_page_size: PAGE_SIZE }),
    [search, filtersKey, sort, direction, page],
  )
  const result = obj(list.data)
  const items = rows(result.items)
  const total = num(result.total)
  const plans = rows(result.plans)

  const [selectedRows, setSelectedRows] = useState<Map<string, Row>>(() => new Map())
  const selected = useMemo(() => new Set(selectedRows.keys()), [selectedRows])
  const [bulk, setBulk] = useState<BulkAction | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)

  const canBan = access.permissions.moderate
  const canCredit = access.permissions.money
  const hasFilters = FILTER_KEYS.some((key) => query[key] !== '')
  const bminInvalid = query.u_bmin !== '' && rublesInputToKopecks(query.u_bmin) === null
  const bmaxInvalid = query.u_bmax !== '' && rublesInputToKopecks(query.u_bmax) === null

  // Любая смена фильтра возвращает на первую страницу.
  const patch = (next: Partial<UsersQuery>) => setQuery({ ...next, u_page: '1' })

  const resetFilters = () => setQuery({ u_q: '', u_plan: '', u_from: '', u_to: '', u_bmin: '', u_bmax: '', u_fraud: '', u_banned: '', u_paid: '', u_page: '1' })

  // Выделение переживает смену страницы: храним строки, а не только id.
  const onSelectedChange = (next: Set<string>) => {
    setSelectedRows((current) => {
      const map = new Map<string, Row>()
      for (const id of next) {
        const row = current.get(id) ?? items.find((item) => str(item.id) === id)
        if (row) map.set(id, row)
      }
      return map
    })
  }

  const exportAll = async () => {
    const response = await run('export', () => adminRpc<Json>('admin_users_list', { ...listArgs, p_page: 1, p_page_size: EXPORT_LIMIT }))
    if (response === undefined) return
    const data = obj(response)
    const all = rows(data.items)
    downloadCsv(`users-${todayMsk()}`, all, CSV_COLUMNS)
    const found = num(data.total)
    if (found > all.length) toast.info(`Выгружены первые ${formatNumber(all.length)} из ${formatNumber(found)}. Сузь фильтр, чтобы выгрузить остальных.`)
    else toast.success(`Выгружено: ${formatNumber(all.length)}`)
  }

  const exportSelected = () => {
    const chosen = [...selectedRows.values()]
    downloadCsv(`users-selected-${todayMsk()}`, chosen, CSV_COLUMNS)
  }

  const submitBulk = async (payload: Record<string, unknown>) => {
    if (!bulk) return
    const action = bulk
    const ids = [...selectedRows.keys()]
    if (ids.length > BULK_LIMIT) {
      toast.error(`За раз - не больше ${BULK_LIMIT} пользователей.`)
      return
    }
    const response = await run('bulk', () => adminRpc<Json>('admin_users_bulk', { p_user_ids: ids, p_action: action, p_payload: payload }))
    if (response === undefined) return
    const data = obj(response)
    const failed = rows(data.failed).map((item) => {
      const userId = str(item.userId)
      return { userId, email: str(selectedRows.get(userId)?.email), error: adminErrorMessage({ message: str(item.error) }) }
    })
    const done = num(data.done)
    setBulkResult({ action, done, failed })
    const summary = `${BULK_TITLE[action]}: выполнено ${formatNumber(done)}, не вышло ${formatNumber(failed.length)}`
    if (failed.length) toast.info(summary)
    else toast.success(summary)
    setBulk(null)
    // Неудачные остаются выбранными - их можно сразу повторить.
    setSelectedRows((current) => {
      const map = new Map<string, Row>()
      for (const failure of failed) {
        const row = current.get(failure.userId)
        if (row) map.set(failure.userId, row)
      }
      return map
    })
    list.reload()
  }

  return (
    <div className="adm-users">
      <PageHeader
        title="Пользователи"
        description={list.data ? `Найдено: ${formatNumber(total)}` : undefined}
        actions={<ExportButton onExport={() => void exportAll()} loading={pending === 'export'} />}
      />

      <Panel>
        <div className="adm-toolbar">
          <Field label="Поиск" className="is-grow">
            <DebouncedInput type="search" value={query.u_q} onCommit={(value) => patch({ u_q: value })} placeholder="Почта, имя или id" />
          </Field>
          <Field label="Тариф">
            <select value={query.u_plan} onChange={(event) => patch({ u_plan: event.target.value })}>
              <option value="">Любой</option>
              {plans.map((plan) => <option key={str(plan.id)} value={str(plan.id)}>{str(plan.title, str(plan.id))}</option>)}
            </select>
          </Field>
          <Field label="Регистрация с">
            <input type="date" value={query.u_from} max={query.u_to || undefined} onChange={(event) => patch({ u_from: event.target.value })} />
          </Field>
          <Field label="Регистрация по">
            <input type="date" value={query.u_to} min={query.u_from || undefined} onChange={(event) => patch({ u_to: event.target.value })} />
          </Field>
          <Field label="Баланс от, ₽" hint={bminInvalid ? 'Не число - фильтр не применён' : undefined}>
            <DebouncedInput inputMode="decimal" delay={400} value={query.u_bmin} onCommit={(value) => patch({ u_bmin: value.trim() })} placeholder="0" />
          </Field>
          <Field label="Баланс до, ₽" hint={bmaxInvalid ? 'Не число - фильтр не применён' : undefined}>
            <DebouncedInput inputMode="decimal" delay={400} value={query.u_bmax} onCommit={(value) => patch({ u_bmax: value.trim() })} placeholder="без предела" />
          </Field>
          <Field label="Бан">
            <select value={query.u_banned} onChange={(event) => patch({ u_banned: event.target.value })}>
              <option value="">Любые</option>
              <option value="yes">Забанены</option>
              <option value="no">Не забанены</option>
            </select>
          </Field>
          <Field label="Оплаты">
            <select value={query.u_paid} onChange={(event) => patch({ u_paid: event.target.value })}>
              <option value="">Любые</option>
              <option value="yes">Платили</option>
              <option value="no">Не платили</option>
            </select>
          </Field>
          <label className="adm-users-check">
            <input type="checkbox" checked={query.u_fraud === '1'} onChange={(event) => patch({ u_fraud: event.target.checked ? '1' : '' })} />
            Есть флаг фрода
          </label>
          {hasFilters && <Button size="sm" variant="ghost" onClick={resetFilters}>Сбросить</Button>}
        </div>

        {selected.size > 0 && (
          <div className="adm-bulkbar" role="region" aria-label="Действия с выбранными">
            <span className="adm-users-bulk-count">Выбрано: {formatNumber(selected.size)}</span>
            {canBan && <Button size="sm" variant="danger" onClick={() => setBulk('ban')}>Забанить</Button>}
            {canBan && <Button size="sm" onClick={() => setBulk('unban')}>Разбанить</Button>}
            {canCredit && <Button size="sm" onClick={() => setBulk('credit')}>Начислить</Button>}
            <Button size="sm" onClick={exportSelected}>CSV выбранных</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Map())}>Снять выделение</Button>
          </div>
        )}

        {bulkResult && (
          <div className={`adm-users-result${bulkResult.failed.length ? ' is-warning' : ''}`} role="status">
            <div className="adm-users-result-head">
              <strong>{BULK_TITLE[bulkResult.action]}: выполнено {formatNumber(bulkResult.done)}, не вышло {formatNumber(bulkResult.failed.length)}</strong>
              <button type="button" className="adm-icon-button is-small" aria-label="Скрыть итог" onClick={() => setBulkResult(null)}>
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
            {bulkResult.failed.length > 0 && (
              <ul>
                {bulkResult.failed.map((failure) => (
                  <li key={failure.userId}>
                    <button type="button" className="adm-users-link" onClick={() => openUser(failure.userId)}>{failure.email || failure.userId}</button>
                    {': '}{failure.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {list.error && <ErrorState message={list.error} onRetry={list.reload} />}

        {(!list.error || list.data) && (
          <DataTable
            columns={COLUMNS}
            rows={items}
            rowKey={(row) => str(row.id)}
            sort={sort}
            direction={direction}
            onSort={(key, dir) => patch({ u_sort: key, u_dir: dir })}
            loading={list.loading}
            empty={hasFilters ? 'По этим условиям никого нет.' : 'Пользователей пока нет.'}
            selectable
            selected={selected}
            onSelectedChange={onSelectedChange}
            onRowClick={(row) => openUser(str(row.id))}
            rowClassName={(row) => (num(row.openFlags) > 0 && str(row.maxRisk) === 'high' ? 'is-alert' : '')}
          />
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ u_page: String(next) })} />
      </Panel>

      {bulk && (
        <BulkDialog
          action={bulk}
          count={selected.size}
          pending={pending === 'bulk'}
          onClose={() => setBulk(null)}
          onSubmit={(payload) => void submitBulk(payload)}
        />
      )}
    </div>
  )
}
