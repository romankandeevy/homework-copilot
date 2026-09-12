/* Раздел «Пользователи»: полоса цифр, быстрый поиск с недавними карточками,
   три главных фильтра в строку и остальные в панели по кнопке, таблица с
   серверной пагинацией, меню действий в строке и панель массовых действий.

   Поиск, фильтры, сортировка и страница живут в адресе с приставкой u_ -
   отфильтрованный вид можно переслать. Фильтры и сортировка ещё и
   запоминаются в браузере: переход в раздел через меню или Ctrl+K собирает
   адрес заново, и раньше они терялись. */

import { useId, useMemo, useState } from 'react'
import { DownloadSimple, FunnelSimple, LockOpen, Prohibit, UserCircle, Wallet, X } from '@phosphor-icons/react'
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
  rows,
  str,
  todayMsk,
} from '../api'
import type { CsvColumn, Row } from '../api'
import { useAdmin } from '../context'
import { Button, DataTable, ErrorState, ExportButton, Field, PageHeader, Pagination, Panel, useAction, useAsync, useQueryState, useToast } from '../ui'
import type { Column } from '../ui'
import { BalanceDialog, BanDialog, ConfirmDialog } from '../userDialogs'
import { ActivityCell, BalanceRange, EmptyUsers, QuickSearch, RowMenu, StatusLegend, StatusPills, UsersStats } from './usersParts'
import type { RowMenuItem } from './usersParts'
import {
  ACTIVITY_SINCE,
  PAID_OPTIONS,
  SEEN_OPTIONS,
  STATUS_OPTIONS,
  USERS_PERSISTED_KEYS,
  USERS_QUERY_DEFAULTS,
  USERS_RESET,
  USERS_STORAGE_KEY,
  buildUsersFilters,
  countPanelFilters,
  hasUsersFilters,
  rubles,
} from './usersModel'
import type { UsersQuery } from './usersModel'
import './users.css'

const PAGE_SIZE = 50
const EXPORT_LIMIT = 5000
const BULK_LIMIT = 500
const SORT_KEYS = ['last_seen', 'email', 'balance', 'tasks', 'paid', 'created', 'grade']
const GRADES = Array.from({ length: 11 }, (_, index) => String(index + 1))
// «01.09.2026» вместо «01 сент. 2026 г.»: столбец уже, полная дата - в подсказке.
const COMPACT_DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' })

type BulkAction = 'ban' | 'unban' | 'credit'
type BulkFailure = { userId: string; email: string; error: string }
type BulkResult = { action: BulkAction; done: number; failed: BulkFailure[] }
type Dialog =
  | { kind: 'ban' | 'unban' | 'balance'; row: Row }
  | { kind: 'bulk'; action: BulkAction }

const BULK_TITLE: Record<BulkAction, string> = { ban: 'Блокировка', unban: 'Разблокировка', credit: 'Начисление' }

const RISK_LABEL: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }

function kopecksToCsv(value: number) {
  return (value / 100).toFixed(2).replace('.', ',')
}

function statusText(row: Row) {
  if (bool(row.isBanned)) return 'забанен'
  if (num(row.openFlags) > 0) return 'проверка антифрода'
  return 'активен'
}

function displayName(row: Row) {
  return str(row.fullName).trim() || str(row.email) || 'Без имени'
}

const CSV_COLUMNS: CsvColumn<Row>[] = [
  { header: 'id', value: (row) => str(row.id) },
  { header: 'Почта', value: (row) => str(row.email) },
  { header: 'Имя', value: (row) => str(row.fullName) },
  { header: 'Класс школы', value: (row) => numOrNull(row.grade) },
  { header: 'Тариф', value: (row) => str(row.planTitle) },
  { header: 'Баланс, ₽', value: (row) => kopecksToCsv(num(row.balance)) },
  { header: 'Задач', value: (row) => num(row.tasks) },
  { header: 'Оплачено, ₽', value: (row) => kopecksToCsv(num(row.paidTotal)) },
  { header: 'Регистрация', value: (row) => str(row.createdAt) },
  { header: 'Последняя активность', value: (row) => str(row.lastSeenAt) },
  { header: 'Статус аккаунта', value: statusText },
  { header: 'Бан до', value: (row) => str(row.bannedUntil) },
  { header: 'Открытых флагов', value: (row) => num(row.openFlags) },
  { header: 'Риск', value: (row) => RISK_LABEL[str(row.maxRisk)] ?? '' },
  { header: 'Администратор', value: (row) => (bool(row.isStaff) ? 'да' : 'нет') },
]

export default function UsersSection() {
  const { access, openUser } = useAdmin()
  const toast = useToast()
  const { pending, run } = useAction()
  const panelId = useId()
  const [query, setQuery] = useQueryState(USERS_QUERY_DEFAULTS, { storageKey: USERS_STORAGE_KEY, persist: USERS_PERSISTED_KEYS })
  const page = Math.max(1, Number.parseInt(query.u_page, 10) || 1)
  const filters = useMemo(() => buildUsersFilters(query), [query])
  const filtersKey = JSON.stringify(filters)
  const search = query.u_q.trim()
  const sort = SORT_KEYS.includes(query.u_sort) ? query.u_sort : 'last_seen'
  const direction = query.u_dir === 'asc' ? 'asc' : 'desc'

  const listArgs = { p_search: search, p_filters: filters, p_sort: sort, p_dir: direction }
  const list = useAsync(
    () => adminRpc<Json>('admin_users_list', { ...listArgs, p_page: page, p_page_size: PAGE_SIZE }),
    [search, filtersKey, sort, direction, page],
  )
  // Цифры над таблицей - отдельным запросом: они не зависят от фильтров.
  const stats = useAsync(() => adminRpc<Json>('admin_users_stats'), [])
  const result = obj(list.data)
  const items = rows(result.items)
  const total = num(result.total)
  const plans = rows(result.plans)
  const statsData = stats.data ? obj(stats.data) : null

  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Map<string, Row>>(() => new Map())
  const selected = useMemo(() => new Set(selectedRows.keys()), [selectedRows])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)

  const canBan = access.permissions.moderate
  const canMoney = access.permissions.money
  const hasFilters = hasUsersFilters(query)
  const panelCount = countPanelFilters(query)
  const now = Date.now()

  // Любая смена фильтра возвращает на первую страницу.
  const patch = (next: Partial<UsersQuery>) => setQuery({ ...next, u_page: '1' })
  const resetFilters = () => setQuery(USERS_RESET)
  const closeDialog = () => setDialog(null)

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
    toast.success(`Выгружено выбранных: ${formatNumber(chosen.length)}`)
  }

  const banOne = async (row: Row, reason: string, until: string | null) => {
    const done = await run(
      'row',
      () => adminRpc<Json>('admin_set_user_ban', { p_user_id: str(row.id), p_is_banned: true, p_reason: reason, p_until: until }),
      `${displayName(row)}: ${until ? `заблокирован до ${formatDateTime(until)}` : 'заблокирован бессрочно'}`,
    )
    if (done === undefined) return
    setDialog(null)
    list.reload()
  }

  const unbanOne = async (row: Row) => {
    const done = await run(
      'row',
      () => adminRpc<Json>('admin_set_user_ban', { p_user_id: str(row.id), p_is_banned: false, p_reason: null, p_until: null }),
      `${displayName(row)}: блокировка снята`,
    )
    if (done === undefined) return
    setDialog(null)
    list.reload()
  }

  const adjustOne = async (row: Row, amount: number, reason: string) => {
    const done = await run(
      'row',
      () => adminRpc<Json>('admin_adjust_balance', { p_user_id: str(row.id), p_amount: amount, p_reason: reason }),
      `${displayName(row)}: ${amount > 0 ? `начислено ${formatKopecks(amount)}` : `списано ${formatKopecks(-amount)}`}`,
    )
    if (done === undefined) return
    setDialog(null)
    list.reload()
    stats.reload()
  }

  /* Массовые действия - одной admin_users_bulk: она сама проходит по
     аккаунтам и возвращает, что не вышло. Вызовы по одному упёрлись бы в
     предел 240 запросов в минуту на администратора. */
  const submitBulk = async (action: BulkAction, payload: Record<string, unknown>) => {
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
    setDialog(null)
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
    if (action === 'credit') stats.reload()
  }

  const menuItems = (row: Row): RowMenuItem[] => {
    const id = str(row.id)
    const banned = bool(row.isBanned)
    const menu: RowMenuItem[] = [
      { key: 'open', label: 'Открыть карточку', icon: <UserCircle size={18} weight="bold" aria-hidden="true" />, onSelect: () => openUser(id) },
    ]
    if (canMoney) menu.push({ key: 'balance', label: 'Изменить баланс', icon: <Wallet size={18} weight="bold" aria-hidden="true" />, onSelect: () => setDialog({ kind: 'balance', row }) })
    if (canBan && banned) menu.push({ key: 'unban', label: 'Разбанить', icon: <LockOpen size={18} weight="bold" aria-hidden="true" />, onSelect: () => setDialog({ kind: 'unban', row }) })
    // Себя заблокировать база не даст - и пункт не предлагаем.
    if (canBan && !banned && id !== access.userId) menu.push({ key: 'ban', label: 'Забанить', tone: 'danger', icon: <Prohibit size={18} weight="bold" aria-hidden="true" />, onSelect: () => setDialog({ kind: 'ban', row }) })
    return menu
  }

  const columns: Column<Row>[] = [
    {
      key: 'user',
      header: 'Пользователь',
      sortKey: 'email',
      className: 'adm-users-col-user',
      render: (row) => {
        const name = str(row.fullName).trim()
        const email = str(row.email)
        return (
          <div className="adm-cell-main">
            <strong>{name || email || 'Без имени'}</strong>
            {name && email && <small title={email}>{email}</small>}
          </div>
        )
      },
    },
    { key: 'status', header: 'Статус аккаунта', render: (row) => <StatusPills row={row} /> },
    { key: 'seen', header: 'Активность', sortKey: 'last_seen', render: (row) => <ActivityCell lastSeenAt={str(row.lastSeenAt)} now={now} /> },
    { key: 'balance', header: 'Баланс', sortKey: 'balance', align: 'right', render: (row) => <span className="adm-nowrap">{formatKopecks(num(row.balance))}</span> },
    { key: 'tasks', header: 'Задачи', sortKey: 'tasks', align: 'right', mobile: false, className: 'adm-users-col-wide', render: (row) => formatNumber(num(row.tasks)) },
    { key: 'paid', header: 'Оплачено', sortKey: 'paid', align: 'right', mobile: false, render: (row) => <span className="adm-nowrap">{num(row.paidTotal) ? formatKopecks(num(row.paidTotal)) : '-'}</span> },
    {
      key: 'grade',
      header: 'Класс школы',
      sortKey: 'grade',
      mobile: false,
      render: (row) => {
        const grade = numOrNull(row.grade)
        return grade === null ? '-' : <span className="adm-nowrap">{grade} класс</span>
      },
    },
    { key: 'plan', header: 'Тариф', mobile: false, className: 'adm-users-col-wide', render: (row) => str(row.planTitle) || '-' },
    {
      key: 'created',
      header: 'Регистрация',
      sortKey: 'created',
      mobile: false,
      render: (row) => {
        const created = str(row.createdAt)
        const date = created ? new Date(created) : null
        if (!date || Number.isNaN(date.getTime())) return '-'
        return <span className="adm-nowrap" title={formatDate(created)}>{COMPACT_DATE.format(date)}</span>
      },
    },
    {
      key: 'menu',
      header: <span className="sr-only">Действия</span>,
      align: 'right',
      className: 'adm-users-col-menu',
      render: (row) => <RowMenu label={displayName(row)} items={menuItems(row)} />,
    },
  ]

  const bulkCount = formatNumber(selected.size)

  return (
    <div className="adm-users">
      <PageHeader
        title="Пользователи"
        description={list.data ? `Найдено: ${formatNumber(total)}${hasFilters ? ' по фильтрам' : ''}` : undefined}
        actions={<ExportButton label="Экспортировать CSV" variant="primary" size="md" onExport={() => void exportAll()} loading={pending === 'export'} />}
      />

      {/* До миграции v2 функции статистики нет - полосу просто не показываем. */}
      {!stats.error && <UsersStats data={statsData} loading={stats.loading} />}

      <Panel className="adm-users-main">
        <div className="adm-users-toolbar">
          <div className="adm-users-filters" role="search" aria-label="Поиск и фильтры">
            <QuickSearch value={query.u_q} onCommit={(value) => patch({ u_q: value })} onOpenUser={openUser} />
            <select aria-label="Активность" value={query.u_seen} onChange={(event) => patch({ u_seen: event.target.value })}>
              {SEEN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select aria-label="Статус аккаунта" value={query.u_status} onChange={(event) => patch({ u_status: event.target.value })}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select aria-label="Оплаты" value={query.u_paid} onChange={(event) => patch({ u_paid: event.target.value })}>
              {PAID_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="adm-users-filter-actions">
              <Button
                icon={<FunnelSimple size={16} weight="bold" aria-hidden="true" />}
                aria-expanded={panelOpen}
                aria-controls={panelId}
                onClick={() => setPanelOpen((open) => !open)}
              >
                {panelOpen ? 'Скрыть фильтры' : 'Показать фильтры'}
                {panelCount > 0 && <b className="adm-users-count"><span className="sr-only">, активно: </span>{panelCount}</b>}
              </Button>
              {hasFilters && <Button variant="ghost" icon={<X size={16} weight="bold" aria-hidden="true" />} onClick={resetFilters}>Сбросить</Button>}
            </div>
          </div>

          {query.u_seen && (
            <p className="adm-users-note">
              Активность пишется с {ACTIVITY_SINCE}. Кто не заходил после этого дня, попадает в «Давно не заходил».
            </p>
          )}

          <div id={panelId} className="adm-users-panel" hidden={!panelOpen}>
            <Field label="Тариф">
              <select value={query.u_plan} onChange={(event) => patch({ u_plan: event.target.value })}>
                <option value="">Любой</option>
                {plans.map((plan) => <option key={str(plan.id)} value={str(plan.id)}>{str(plan.title, str(plan.id))}</option>)}
              </select>
            </Field>
            <Field label="Класс школы" hint="Указывает сам ученик, по умолчанию - 8.">
              <select value={query.u_grade} onChange={(event) => patch({ u_grade: event.target.value })}>
                <option value="">Любой</option>
                {GRADES.map((grade) => <option key={grade} value={grade}>{grade} класс</option>)}
              </select>
            </Field>
            <Field label="Регистрация с">
              <input type="date" value={query.u_from} max={query.u_to || undefined} onChange={(event) => patch({ u_from: event.target.value })} />
            </Field>
            <Field label="Регистрация по">
              <input type="date" value={query.u_to} min={query.u_from || undefined} onChange={(event) => patch({ u_to: event.target.value })} />
            </Field>
            <div className="adm-field adm-users-range-field" role="group" aria-label="Баланс">
              <span className="adm-field-label">Баланс</span>
              <BalanceRange
                min={rubles(query.u_bmin)}
                max={rubles(query.u_bmax)}
                ceiling={num(statsData?.balanceCeiling)}
                onCommit={(min, max) => patch({ u_bmin: min === null ? '' : String(min), u_bmax: max === null ? '' : String(max) })}
              />
            </div>
          </div>
        </div>

        <div className="adm-users-tablehead">
          <StatusLegend />
        </div>

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
            columns={columns}
            rows={items}
            rowKey={(row) => str(row.id)}
            rowLabel={displayName}
            sort={sort}
            direction={direction}
            onSort={(key, dir) => patch({ u_sort: key, u_dir: dir })}
            loading={list.loading}
            empty={<EmptyUsers filtered={hasFilters} onReset={resetFilters} />}
            selectable
            selected={selected}
            onSelectedChange={onSelectedChange}
            onRowClick={(row) => openUser(str(row.id))}
            rowClassName={(row) => (num(row.openFlags) > 0 && str(row.maxRisk) === 'high' ? 'is-alert' : '')}
          />
        )}

        {selected.size > 0 && (
          <div className="adm-bulkbar adm-users-bulkbar" role="region" aria-label="Действия с выбранными">
            <span className="adm-users-bulk-count">Выбрано: {bulkCount}</span>
            {pending === 'bulk' && <span className="adm-users-bulk-progress" role="status">Выполняем для {bulkCount}…</span>}
            {canBan && <Button size="sm" variant="danger" icon={<Prohibit size={16} weight="bold" aria-hidden="true" />} disabled={pending === 'bulk'} onClick={() => setDialog({ kind: 'bulk', action: 'ban' })}>Забанить</Button>}
            {canBan && <Button size="sm" icon={<LockOpen size={16} weight="bold" aria-hidden="true" />} disabled={pending === 'bulk'} onClick={() => setDialog({ kind: 'bulk', action: 'unban' })}>Разбанить</Button>}
            {canMoney && <Button size="sm" icon={<Wallet size={16} weight="bold" aria-hidden="true" />} disabled={pending === 'bulk'} onClick={() => setDialog({ kind: 'bulk', action: 'credit' })}>Начислить</Button>}
            <Button size="sm" icon={<DownloadSimple size={16} weight="bold" aria-hidden="true" />} onClick={exportSelected}>Экспорт выбранных в CSV</Button>
            <Button size="sm" variant="ghost" icon={<X size={16} weight="bold" aria-hidden="true" />} onClick={() => setSelectedRows(new Map())}>Снять выбор</Button>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ u_page: String(next) })} />
      </Panel>

      {dialog?.kind === 'ban' && (
        <BanDialog target={displayName(dialog.row)} pending={pending === 'row'} onClose={closeDialog} onSubmit={(reason, until) => void banOne(dialog.row, reason, until)} />
      )}
      {dialog?.kind === 'unban' && (
        <ConfirmDialog title="Снять блокировку" confirmLabel="Разбанить" pending={pending === 'row'} onClose={closeDialog} onConfirm={() => void unbanOne(dialog.row)}>
          <p>{displayName(dialog.row)} снова сможет пользоваться аккаунтом. Снятие попадёт в журнал.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'balance' && (
        <BalanceDialog
          mode="adjust"
          target={displayName(dialog.row)}
          balance={num(dialog.row.balance)}
          pending={pending === 'row'}
          onClose={closeDialog}
          onSubmit={(amount, reason) => void adjustOne(dialog.row, amount, reason)}
        />
      )}
      {dialog?.kind === 'bulk' && dialog.action === 'ban' && (
        <BanDialog count={selected.size} pending={pending === 'bulk'} onClose={closeDialog} onSubmit={(reason, until) => void submitBulk('ban', { reason, until })} />
      )}
      {dialog?.kind === 'bulk' && dialog.action === 'unban' && (
        <ConfirmDialog title={`Разблокировать: ${bulkCount}`} confirmLabel="Разбанить" pending={pending === 'bulk'} onClose={closeDialog} onConfirm={() => void submitBulk('unban', {})}>
          <p>С выбранных аккаунтов снимется блокировка. Каждое снятие попадёт в журнал.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'bulk' && dialog.action === 'credit' && (
        <BalanceDialog mode="credit" count={selected.size} pending={pending === 'bulk'} onClose={closeDialog} onSubmit={(amount, reason) => void submitBulk('credit', { amount, reason })} />
      )}
    </div>
  )
}
