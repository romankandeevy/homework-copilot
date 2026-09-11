/* Финансы. Платёжного провайдера нет: «платёж» здесь - пополнение
   кошелька, подтверждённое вручную, возврат по нему или отказ оплаты
   решения (402), когда не хватило баланса. Все суммы в копейках. */

import { useMemo, useState, type FormEvent } from 'react'
import { ArrowClockwise, CheckCircle } from '@phosphor-icons/react'
import {
  adminRpc, downloadCsv, formatDate, formatDateTime, formatKopecks, formatNumber, num, obj, rows,
  rublesInputToKopecks, shiftDate, str, strOrNull, todayMsk, type CsvColumn, type Row,
} from '../api'
import {
  Badge, Button, DataTable, DateRangePicker, EmptyState, ErrorState, ExportButton, Field, HorizontalBars,
  LineChart, LoadingState, Modal, PageHeader, Pagination, Panel, Segmented, Stat, StatGrid, Tabs,
  useAction, useAsync, useQueryState, useToast, type Column, type Tone,
} from '../ui'
import { useAdmin } from '../context'
import { solvableSubjects } from '../../lib/subjects'
import './finance.css'

type FinTab = 'payments' | 'reconciliation' | 'report' | 'llm' | 'unit'

const finTabs: { value: FinTab; label: string }[] = [
  { value: 'payments', label: 'Платежи' },
  { value: 'reconciliation', label: 'Сверка' },
  { value: 'report', label: 'Отчёт по выручке' },
  { value: 'llm', label: 'Расход на LLM' },
  { value: 'unit', label: 'Юнит-экономика' },
]

const roleNames: Record<string, string> = { owner: 'владелец', admin: 'администратор', support: 'поддержка' }

function isFinTab(value: string): value is FinTab {
  return finTabs.some((tab) => tab.value === value)
}

export default function FinanceSection() {
  const { access } = useAdmin()
  const [query, setQuery] = useQueryState({ fin_tab: 'payments' })
  const tab: FinTab = isFinTab(query.fin_tab) ? query.fin_tab : 'payments'

  if (!access.permissions.money) {
    return (
      <div className="fin-stack">
        <PageHeader title="Финансы" />
        <Panel>
          <EmptyState>Финансы открыты ролям «администратор» и «владелец». Твоя роль - {roleNames[access.role] ?? access.role}.</EmptyState>
        </Panel>
      </div>
    )
  }

  return (
    <div className="fin-stack">
      <PageHeader
        title="Финансы"
        description="Платёжного провайдера пока нет: деньги здесь - пополнения кошелька, подтверждённые вручную, возвраты по ним и отказы оплаты решения, когда не хватило баланса."
      />
      <Tabs value={tab} tabs={finTabs} onChange={(value) => setQuery({ fin_tab: value })} />
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'reconciliation' && <ReconciliationTab />}
      {(tab === 'report' || tab === 'llm' || tab === 'unit') && <ReportArea tab={tab} />}
    </div>
  )
}

/* ---------- Общее ---------- */

const subjectNames = new Map(solvableSubjects.map((subject) => [subject.id, subject.name]))

function subjectLabel(value: string) {
  return subjectNames.get(value) ?? value
}

// Excel с русской локалью ждёт запятую в дробной части.
function rublesCsv(kopecks: number) {
  return (kopecks / 100).toFixed(2).replace('.', ',')
}

function kopecksToInput(kopecks: number) {
  return kopecks % 100 === 0 ? String(kopecks / 100) : (kopecks / 100).toFixed(2).replace('.', ',')
}

function errorText(failure: unknown) {
  return failure instanceof Error ? failure.message : 'Операция не выполнилась.'
}

function UserLink({ userId, email }: { userId: string | null; email: string | null }) {
  const { openUser } = useAdmin()
  if (!userId) return <span className="adm-muted">{email ?? 'гость'}</span>
  return <button type="button" className="fin-link" onClick={() => openUser(userId)}>{email ?? userId}</button>
}

function Clean() {
  return <p className="fin-clean"><CheckCircle size={18} weight="fill" aria-hidden="true" /> Расхождений нет</p>
}

/* ---------- Платежи ---------- */

type Payment = {
  id: string
  type: string
  userId: string | null
  email: string | null
  amount: number
  status: string
  method: string
  reference: string | null
  reason: string | null
  refunded: number
  createdAt: string
}

function parsePayment(row: Row): Payment {
  return {
    id: str(row.id),
    type: str(row.type),
    userId: strOrNull(row.userId),
    email: strOrNull(row.email),
    amount: num(row.amount),
    status: str(row.status),
    method: str(row.method),
    reference: strOrNull(row.reference),
    reason: strOrNull(row.reason),
    refunded: num(row.refunded),
    createdAt: str(row.createdAt),
  }
}

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  succeeded: { label: 'Успешно', tone: 'success' },
  partially_refunded: { label: 'Частичный возврат', tone: 'warning' },
  refunded: { label: 'Возвращено', tone: 'neutral' },
  refund: { label: 'Возврат', tone: 'info' },
  failed: { label: 'Отказ оплаты', tone: 'danger' },
}

const typeNames: Record<string, string> = { top_up: 'Пополнение', refund: 'Возврат', rejection: 'Отказ оплаты' }

const statusOptions = [
  { value: 'all', label: 'Все' },
  { value: 'succeeded', label: 'Успешные пополнения' },
  { value: 'partially_refunded', label: 'С частичным возвратом' },
  { value: 'refunded', label: 'Возвращённые полностью' },
  { value: 'refund', label: 'Возвраты' },
  { value: 'failed', label: 'Отказы оплаты (402)' },
]

const PAGE_SIZE = 50

const paymentCsv: CsvColumn<Payment>[] = [
  { header: 'Дата', value: (p) => p.createdAt },
  { header: 'Тип', value: (p) => typeNames[p.type] ?? p.type },
  { header: 'Статус', value: (p) => statusMeta[p.status]?.label ?? p.status },
  { header: 'Сумма, ₽', value: (p) => rublesCsv(p.type === 'refund' ? -p.amount : p.amount) },
  { header: 'Возвращено, ₽', value: (p) => (p.type === 'top_up' ? rublesCsv(p.refunded) : '') },
  { header: 'Email', value: (p) => p.email },
  { header: 'ID пользователя', value: (p) => p.userId },
  { header: 'Способ', value: (p) => p.method },
  { header: 'ID транзакции', value: (p) => p.reference },
  { header: 'Причина', value: (p) => p.reason },
]

function AmountCell({ payment }: { payment: Payment }) {
  if (payment.type === 'rejection') return <span className="adm-muted">-</span>
  if (payment.type === 'refund') return <span className="adm-mono fin-amount-neg adm-nowrap">-{formatKopecks(payment.amount)}</span>
  return (
    <span className="adm-cell-main">
      <strong className="adm-mono adm-nowrap">{formatKopecks(payment.amount)}</strong>
      {payment.refunded > 0 && <small className="adm-nowrap">возвращено {formatKopecks(payment.refunded)}</small>}
    </span>
  )
}

function PaymentsTab() {
  const { access } = useAdmin()
  const toast = useToast()
  const today = todayMsk()
  const [query, setQuery] = useQueryState({ fin_status: 'all', fin_from: shiftDate(today, -29), fin_to: today, fin_q: '', fin_page: '1' })
  const page = Math.max(1, Number.parseInt(query.fin_page, 10) || 1)
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null)
  const [exporting, setExporting] = useState(false)

  const filters = { p_status: query.fin_status, p_from: query.fin_from, p_to: query.fin_to, p_search: query.fin_q }
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_finance_payments', { ...filters, p_page: page, p_page_size: PAGE_SIZE }),
    [query.fin_status, query.fin_from, query.fin_to, query.fin_q, page],
  )
  const items = useMemo(() => rows(obj(data).items).map(parsePayment), [data])
  const total = num(obj(data).total)

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('q') ?? '').trim()
    setQuery({ fin_q: value, fin_page: '1' })
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const result = obj(await adminRpc('admin_finance_payments', { ...filters, p_page: 1, p_page_size: 5000 }))
      const all = rows(result.items).map(parsePayment)
      downloadCsv(`payments-${query.fin_from}-${query.fin_to}`, all, paymentCsv)
      if (num(result.total) > all.length) {
        toast.info(`В файл попали первые ${formatNumber(all.length)} из ${formatNumber(num(result.total))} строк. Сузь период.`)
      }
    } catch (failure) {
      toast.error(errorText(failure))
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<Payment>[] = [
    { key: 'amount', header: 'Сумма', align: 'right', render: (p) => <AmountCell payment={p} /> },
    { key: 'user', header: 'Пользователь', render: (p) => <UserLink userId={p.userId} email={p.email} /> },
    {
      key: 'status',
      header: 'Статус',
      render: (p) => {
        const meta = statusMeta[p.status]
        return <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? p.status}</Badge>
      },
    },
    { key: 'method', header: 'Способ', mobile: false, render: (p) => (p.type === 'rejection' ? <span className="adm-mono">{p.method}</span> : p.method) },
    { key: 'reference', header: 'ID транзакции', mobile: false, render: (p) => (p.reference ? <span className="adm-mono">{p.reference}</span> : <span className="adm-muted">-</span>) },
    { key: 'reason', header: 'Причина', mobile: false, render: (p) => (p.reason ? <span className="adm-clamp" title={p.reason}>{p.reason}</span> : <span className="adm-muted">-</span>) },
    { key: 'date', header: 'Дата', render: (p) => <span className="adm-nowrap">{formatDateTime(p.createdAt)}</span> },
  ]
  if (access.permissions.payouts) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (p.type === 'top_up' && p.amount - p.refunded > 0
        ? <Button size="sm" onClick={() => setRefundTarget(p)}>Возврат</Button>
        : null),
    })
  }

  return (
    <Panel
      title="Лента платежей"
      description="Отказ оплаты - запрос решения или чата, отклонённый с ответом 402: на балансе не хватило денег."
      actions={<ExportButton onExport={() => void exportCsv()} loading={exporting} />}
    >
      <div className="adm-toolbar">
        <Field label="Статус">
          <select value={query.fin_status} onChange={(event) => setQuery({ fin_status: event.target.value, fin_page: '1' })}>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <div className="adm-field">
          <span className="adm-field-label">Период</span>
          <DateRangePicker
            value={{ from: query.fin_from, to: query.fin_to }}
            onChange={(range) => setQuery({ fin_from: range.from, fin_to: range.to, fin_page: '1' })}
          />
        </div>
        <form className="fin-toolbar-search" role="search" onSubmit={onSearch}>
          <Field label="Email или ID транзакции">
            <input key={query.fin_q} name="q" type="search" defaultValue={query.fin_q} autoComplete="off" />
          </Field>
          <Button type="submit">Найти</Button>
        </form>
      </div>
      {error
        ? <ErrorState message={error} onRetry={reload} />
        : <DataTable columns={columns} rows={items} rowKey={(p) => `${p.type}:${p.id}`} loading={loading} empty="За период платежей нет." />}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(next) => setQuery({ fin_page: String(next) })} />
      {refundTarget && (
        <RefundModal
          payment={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => {
            setRefundTarget(null)
            reload()
          }}
        />
      )}
    </Panel>
  )
}

function RefundModal({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const rest = payment.amount - payment.refunded
  const [amount, setAmount] = useState(kopecksToInput(rest))
  const [reason, setReason] = useState('')
  const { pending, run } = useAction()
  const kopecks = rublesInputToKopecks(amount)
  const amountError = kopecks === null
    ? 'Сумма в рублях, например 150 или 150,50.'
    : kopecks < 1
      ? 'Сумма должна быть больше нуля.'
      : kopecks > rest ? `Вернуть можно не больше ${formatKopecks(rest)}.` : ''
  const trimmedReason = reason.trim()
  const reasonOk = trimmedReason.length >= 3 && trimmedReason.length <= 300

  const submit = async () => {
    if (amountError || !reasonOk || kopecks === null) return
    const result = await run(
      'refund',
      () => adminRpc('admin_finance_refund', { p_top_up_id: payment.id, p_amount: kopecks, p_reason: trimmedReason }),
      (response) => `Возврат ${formatKopecks(num(obj(response).amount, kopecks))} оформлен.`,
    )
    if (result !== undefined) onDone()
  }

  return (
    <Modal
      open
      title="Возврат пополнения"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="danger" loading={pending === 'refund'} disabled={Boolean(amountError) || !reasonOk} onClick={() => void submit()}>
            Вернуть{kopecks && !amountError ? ` ${formatKopecks(kopecks)}` : ''}
          </Button>
        </>
      )}
    >
      <div className="fin-refund-summary">
        <span>Пополнение<b>{formatKopecks(payment.amount)}</b></span>
        <span>Уже возвращено<b>{formatKopecks(payment.refunded)}</b></span>
        <span>Можно вернуть<b>{formatKopecks(rest)}</b></span>
      </div>
      <p className="fin-note">
        {payment.email ?? payment.userId} · {formatDateTime(payment.createdAt)}. Деньги ученику переводятся вне сервиса, а здесь с его кошелька снимается та же сумма. Если на балансе меньше, возврат не пройдёт.
      </p>
      <Field label="Сумма, ₽" hint={amountError || undefined}>
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} data-initial-focus />
      </Field>
      <Field label="Причина" hint="От 3 до 300 символов. Попадёт в журнал действий и уведомление.">
        <textarea value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </Modal>
  )
}

/* ---------- Сверка ---------- */

const jobStatusNames: Record<string, string> = {
  failed: 'задача не решена',
  done: 'задача готова',
  queued: 'в очереди',
  running: 'решается',
}

function ReconciliationTab() {
  const toast = useToast()
  const { pending, run } = useAction()
  const { data, error, loading, reload } = useAsync(() => adminRpc('admin_finance_reconciliation'), [])

  const recheck = async (row: Row) => {
    const userId = str(row.userId)
    const key = str(row.key)
    const result = await run(`recheck:${userId}:${key}`, () => adminRpc('admin_finance_recheck_reservation', { p_user_id: userId, p_idempotency_key: key }))
    if (result === undefined) return
    const payload = obj(result)
    switch (str(payload.result)) {
      case 'refunded':
        toast.success(`Резерв вернули ученику: ${formatKopecks(num(payload.amount))}. Баланс теперь ${formatKopecks(num(payload.balance))}.`)
        break
      case 'delivered':
        toast.info('Решение выдано - списание правильное, возврат не нужен.')
        break
      case 'already_refunded':
        toast.info('Возврат по этому резерву уже был.')
        break
      case 'still_running':
        toast.info('Задача ещё решается. Перепроверь через несколько минут.')
        break
      case 'no_reservation':
        toast.error('Списание не найдено: возможно, его уже обработали.')
        break
      default:
        toast.info('Проверка выполнена.')
    }
    reload()
  }

  if (error) return <Panel><ErrorState message={error} onRetry={reload} /></Panel>
  if (!data) return <Panel><LoadingState label="Сверяем кошельки…" /></Panel>

  const report = obj(data)
  const topUps = rows(report.topUpsWithoutEntry)
  const entries = rows(report.entriesWithoutTopUp)
  const wallets = rows(report.walletMismatches)
  const stuck = rows(report.stuckReservations)

  const userColumn: Column<Row> = { key: 'user', header: 'Пользователь', render: (row) => <UserLink userId={strOrNull(row.userId)} email={strOrNull(row.email)} /> }
  const dateColumn: Column<Row> = { key: 'date', header: 'Дата', render: (row) => <span className="adm-nowrap">{formatDateTime(strOrNull(row.createdAt))}</span> }
  const amountColumn: Column<Row> = { key: 'amount', header: 'Сумма', align: 'right', render: (row) => <span className="adm-mono adm-nowrap">{formatKopecks(num(row.amount))}</span> }
  const keyColumn: Column<Row> = { key: 'key', header: 'Ключ операции', mobile: false, render: (row) => <span className="adm-mono">{str(row.key)}</span> }
  const topUpColumns: Column<Row>[] = [userColumn, amountColumn, { key: 'reference', header: 'ID транзакции', render: (row) => <span className="adm-mono">{str(row.reference, '-')}</span> }, dateColumn]
  const entryColumns: Column<Row>[] = [userColumn, amountColumn, keyColumn, dateColumn]
  const walletColumns: Column<Row>[] = [
    userColumn,
    { key: 'balance', header: 'Баланс', align: 'right', render: (row) => <span className="adm-mono adm-nowrap">{formatKopecks(num(row.balance))}</span> },
    { key: 'ledger', header: 'Сумма операций', align: 'right', render: (row) => <span className="adm-mono adm-nowrap">{formatKopecks(num(row.ledger))}</span> },
    {
      key: 'difference',
      header: 'Разница',
      align: 'right',
      render: (row) => {
        const difference = num(row.difference)
        return <span className={`adm-mono adm-nowrap ${difference > 0 ? 'fin-amount-pos' : 'fin-amount-neg'}`}>{difference > 0 ? '+' : '-'}{formatKopecks(Math.abs(difference))}</span>
      },
    },
  ]
  const stuckColumns: Column<Row>[] = [
    userColumn,
    amountColumn,
    { key: 'job', header: 'Задача', render: (row) => { const status = strOrNull(row.jobStatus); return status ? jobStatusNames[status] ?? status : 'записи о задаче нет' } },
    keyColumn,
    dateColumn,
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (row) => (
        <Button size="sm" loading={pending === `recheck:${str(row.userId)}:${str(row.key)}`} disabled={pending !== null} onClick={() => void recheck(row)}>
          Перепроверить
        </Button>
      ),
    },
  ]

  return (
    <div className="fin-stack">
      <Panel
        title="Сверка кошельков"
        description={`Проверено в ${formatDateTime(strOrNull(report.checkedAt))}`}
        actions={<Button size="sm" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} loading={loading} onClick={reload}>Проверить снова</Button>}
      >
        <p className="fin-note">
          Каждое пополнение должно иметь зачисление в кошелёк на ту же сумму, баланс - совпадать с суммой операций, а каждое списание за решение - закончиться решением или возвратом.
        </p>
      </Panel>

      <Panel title="Пополнения без зачисления" description="Пополнение подтверждено, а операции в кошельке нет, либо сумма или владелец другие.">
        {topUps.length === 0 ? <Clean /> : (
          <DataTable columns={topUpColumns} rows={topUps} rowKey={(row) => str(row.id)} />
        )}
      </Panel>

      <Panel title="Зачисления без пополнения" description="В кошельке есть зачисление с ключом пополнения, а самого подтверждённого пополнения нет.">
        {entries.length === 0 ? <Clean /> : (
          <DataTable columns={entryColumns} rows={entries} rowKey={(row) => str(row.id)} />
        )}
      </Panel>

      <Panel title="Баланс не сходится с операциями" description="Баланс кошелька отличается от суммы всех его операций.">
        {wallets.length === 0 ? <Clean /> : (
          <DataTable columns={walletColumns} rows={wallets} rowKey={(row) => str(row.userId)} />
        )}
      </Panel>

      <Panel
        title="Зависшие резервы решений"
        description="Деньги за решение списаны больше 10 минут назад, решения нет, возврата нет. «Перепроверить» вернёт деньги, если решение так и не выдано."
      >
        {stuck.length === 0 ? <Clean /> : (
          <DataTable
            columns={stuckColumns}
            rows={stuck}
            rowKey={(row) => `${str(row.userId)}:${str(row.key)}`}
          />
        )}
      </Panel>
    </div>
  )
}

/* ---------- Отчёт, расход на LLM, юнит-экономика ---------- */

type ReportTab = 'report' | 'llm' | 'unit'
type Group = 'day' | 'week' | 'month'

type ReportRow = {
  period: string
  revenue: number
  refunds: number
  topUps: number
  consumption: number
  solutionCost: number
  chatCost: number
  margin: number
}

type Report = {
  rows: ReportRow[]
  byPlan: { planId: string; planTitle: string; revenue: number; payers: number }[]
  llmByDay: { date: string; solutions: number; chat: number }[]
  llmByModel: { model: string; kind: string; calls: number; cost: number }[]
  llmBySubject: { subject: string; cost: number; solved: number; failed: number }[]
  unit: Row
}

function parseReport(data: unknown): Report {
  const report = obj(data as Row)
  return {
    rows: rows(report.rows).map((row) => ({
      period: str(row.period),
      revenue: num(row.revenue),
      refunds: num(row.refunds),
      topUps: num(row.topUps),
      consumption: num(row.consumption),
      solutionCost: num(row.solutionCost),
      chatCost: num(row.chatCost),
      margin: num(row.margin),
    })),
    byPlan: rows(report.byPlan).map((row) => ({ planId: str(row.planId), planTitle: str(row.planTitle, str(row.planId)), revenue: num(row.revenue), payers: num(row.payers) })),
    llmByDay: rows(report.llmByDay).map((row) => ({ date: str(row.date), solutions: num(row.solutions), chat: num(row.chat) })),
    llmByModel: rows(report.llmByModel).map((row) => ({ model: str(row.model, 'неизвестно'), kind: str(row.kind), calls: num(row.calls), cost: num(row.costKopecks) })),
    llmBySubject: rows(report.llmBySubject).map((row) => ({ subject: str(row.subject), cost: num(row.costKopecks), solved: num(row.solved), failed: num(row.failed) })),
    unit: obj(report.unitEconomics),
  }
}

const groupOptions: { value: Group; label: string }[] = [
  { value: 'day', label: 'По дням' },
  { value: 'week', label: 'По неделям' },
  { value: 'month', label: 'По месяцам' },
]

function periodLabel(period: string, group: Group) {
  if (group === 'month') {
    return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`))
  }
  if (group === 'week') return `неделя с ${formatDate(period)}`
  return formatDate(period)
}

function ReportArea({ tab }: { tab: ReportTab }) {
  const today = todayMsk()
  const [query, setQuery] = useQueryState({ fin_rfrom: shiftDate(today, -29), fin_rto: today, fin_group: 'day' })
  const group: Group = query.fin_group === 'week' || query.fin_group === 'month' ? query.fin_group : 'day'
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_finance_report', { p_from: query.fin_rfrom, p_to: query.fin_rto, p_group: group }),
    [query.fin_rfrom, query.fin_rto, group],
  )
  const report = useMemo(() => parseReport(data), [data])

  let body
  if (error) body = <Panel><ErrorState message={error} onRetry={reload} /></Panel>
  else if (!data) body = <Panel><LoadingState /></Panel>
  else if (tab === 'report') body = <RevenueReport report={report} group={group} from={query.fin_rfrom} to={query.fin_rto} />
  else if (tab === 'llm') body = <LlmReport report={report} />
  else body = <UnitEconomics report={report} />

  return (
    <div className="fin-stack">
      <div className="fin-report-bar">
        <DateRangePicker value={{ from: query.fin_rfrom, to: query.fin_rto }} onChange={(range) => setQuery({ fin_rfrom: range.from, fin_rto: range.to })} />
        {tab === 'report' && <Segmented label="Группировка" value={group} options={groupOptions} onChange={(value) => setQuery({ fin_group: value })} />}
      </div>
      {loading && data ? <p className="fin-note" role="status">Обновляем…</p> : null}
      {body}
    </div>
  )
}

function RevenueReport({ report, group, from, to }: { report: Report; group: Group; from: string; to: string }) {
  const refunds = report.rows.reduce((sum, row) => sum + row.refunds, 0)
  const margin = num(report.unit.margin)
  const reportCsv: CsvColumn<ReportRow>[] = [
    { header: 'Период', value: (row) => row.period },
    { header: 'Пополнения, ₽', value: (row) => rublesCsv(row.revenue) },
    { header: 'Число пополнений', value: (row) => row.topUps },
    { header: 'Возвраты, ₽', value: (row) => rublesCsv(row.refunds) },
    { header: 'Чистая выручка, ₽', value: (row) => rublesCsv(row.revenue - row.refunds) },
    { header: 'Потрачено учениками, ₽', value: (row) => rublesCsv(row.consumption) },
    { header: 'LLM решения, ₽', value: (row) => rublesCsv(row.solutionCost) },
    { header: 'LLM чат, ₽', value: (row) => rublesCsv(row.chatCost) },
    { header: 'Маржа, ₽', value: (row) => rublesCsv(row.margin) },
  ]

  return (
    <>
      <StatGrid>
        <Stat label="Чистая выручка" value={formatKopecks(num(report.unit.revenue))} hint="пополнения минус возвраты" />
        <Stat label="Возвраты" value={formatKopecks(refunds)} />
        <Stat label="Расход на LLM" value={formatKopecks(num(report.unit.llmCost))} />
        <Stat label="Маржа" value={formatKopecks(margin)} tone={margin < 0 ? 'danger' : undefined} hint="выручка минус LLM" />
      </StatGrid>

      <Panel title="Выручка и расход на LLM">
        <LineChart
          labels={report.rows.map((row) => row.period)}
          series={[
            { name: 'Чистая выручка', values: report.rows.map((row) => row.revenue - row.refunds), tone: 1 },
            { name: 'Расход на LLM', values: report.rows.map((row) => row.solutionCost + row.chatCost), tone: 2 },
          ]}
          format={formatKopecks}
        />
      </Panel>

      <Panel
        title="По периодам"
        description="«Потрачено учениками» - списания с кошельков за решения и чат за вычетом возвратов резервов."
        actions={<ExportButton onExport={() => downloadCsv(`revenue-${group}-${from}-${to}`, report.rows, reportCsv)} />}
      >
        <DataTable
          columns={periodColumns(group)}
          rows={report.rows}
          rowKey={(row) => row.period}
          empty="За период данных нет."
        />
      </Panel>

      <Panel title="По тарифам" description="Тариф плательщика - действующий сейчас, а не на момент пополнения.">
        <DataTable
          columns={planColumns}
          rows={report.byPlan}
          rowKey={(row) => row.planId}
          empty="Пополнений за период нет."
        />
      </Panel>
    </>
  )
}

const kindNames: Record<string, string> = { solution: 'Решения', chat: 'Чат' }

function LlmReport({ report }: { report: Report }) {
  const solutions = report.llmByDay.reduce((sum, row) => sum + row.solutions, 0)
  const chat = report.llmByDay.reduce((sum, row) => sum + row.chat, 0)
  return (
    <>
      <StatGrid>
        <Stat label="Всего на LLM" value={formatKopecks(solutions + chat)} />
        <Stat label="Решения" value={formatKopecks(solutions)} />
        <Stat label="Чат" value={formatKopecks(chat)} />
        <Stat label="Себестоимость решённой задачи" value={formatKopecks(num(report.unit.costPerSolved))} />
      </StatGrid>

      <Panel title="По дням">
        <LineChart
          kind="bar"
          labels={report.llmByDay.map((row) => row.date)}
          series={[
            { name: 'Решения', values: report.llmByDay.map((row) => row.solutions), tone: 1 },
            { name: 'Чат', values: report.llmByDay.map((row) => row.chat), tone: 2 },
          ]}
          format={formatKopecks}
        />
      </Panel>

      <Panel title="По моделям" description="Для решений стоимость по моделям - оценка по кредитам шлюза (кредит = 0,43 ₽), для чата - фактическая цена запросов.">
        <DataTable
          columns={modelColumns}
          rows={report.llmByModel}
          rowKey={(row) => `${row.kind}:${row.model}`}
          empty="Вызовов моделей за период нет."
        />
      </Panel>

      <Panel title="По предметам" description="Только решения: чат к предмету не привязан.">
        <HorizontalBars
          items={report.llmBySubject.map((row) => ({ label: subjectLabel(row.subject), value: row.cost, hint: `${formatNumber(row.solved)} решено` }))}
          format={formatKopecks}
        />
        <DataTable
          columns={subjectColumns}
          rows={report.llmBySubject}
          rowKey={(row) => row.subject}
          empty="Решений за период нет."
        />
      </Panel>
    </>
  )
}

function periodColumns(group: Group): Column<ReportRow>[] {
  return [
    { key: 'period', header: 'Период', render: (row) => <span className="adm-nowrap">{periodLabel(row.period, group)}</span> },
    { key: 'revenue', header: 'Пополнения', align: 'right', render: (row) => <span className="adm-cell-main"><strong className="adm-mono">{formatKopecks(row.revenue)}</strong><small>{formatNumber(row.topUps)} шт.</small></span> },
    { key: 'refunds', header: 'Возвраты', align: 'right', mobile: false, render: (row) => <span className="adm-mono">{formatKopecks(row.refunds)}</span> },
    { key: 'consumption', header: 'Потрачено учениками', align: 'right', mobile: false, render: (row) => <span className="adm-mono">{formatKopecks(row.consumption)}</span> },
    { key: 'llm', header: 'LLM решения / чат', align: 'right', mobile: false, render: (row) => <span className="adm-mono adm-nowrap">{formatKopecks(row.solutionCost)} / {formatKopecks(row.chatCost)}</span> },
    { key: 'margin', header: 'Маржа', align: 'right', render: (row) => <span className={`adm-mono ${row.margin < 0 ? 'fin-amount-neg' : ''}`}>{formatKopecks(row.margin)}</span> },
  ]
}

const planColumns: Column<Report['byPlan'][number]>[] = [
  { key: 'plan', header: 'Тариф', render: (row) => <span className="adm-cell-main"><strong>{row.planTitle}</strong><small className="adm-mono">{row.planId}</small></span> },
  { key: 'revenue', header: 'Пополнения', align: 'right', render: (row) => <span className="adm-mono">{formatKopecks(row.revenue)}</span> },
  { key: 'payers', header: 'Плательщиков', align: 'right', render: (row) => formatNumber(row.payers) },
]

const modelColumns: Column<Report['llmByModel'][number]>[] = [
  { key: 'model', header: 'Модель', render: (row) => <span className="adm-mono">{row.model}</span> },
  { key: 'kind', header: 'Где', render: (row) => kindNames[row.kind] ?? row.kind },
  { key: 'calls', header: 'Вызовов', align: 'right', render: (row) => formatNumber(row.calls) },
  { key: 'cost', header: 'Стоимость', align: 'right', render: (row) => <span className="adm-mono">{formatKopecks(row.cost)}</span> },
]

const subjectColumns: Column<Report['llmBySubject'][number]>[] = [
  { key: 'subject', header: 'Предмет', render: (row) => subjectLabel(row.subject) },
  { key: 'cost', header: 'Расход', align: 'right', render: (row) => <span className="adm-mono">{formatKopecks(row.cost)}</span> },
  { key: 'solved', header: 'Решено', align: 'right', render: (row) => formatNumber(row.solved) },
  { key: 'failed', header: 'Не решено', align: 'right', render: (row) => formatNumber(row.failed) },
  { key: 'per', header: 'На решённую', align: 'right', mobile: false, render: (row) => (row.solved > 0 ? <span className="adm-mono">{formatKopecks(Math.round(row.cost / row.solved))}</span> : <span className="adm-muted">-</span>) },
]

function UnitEconomics({ report }: { report: Report }) {
  const unit = report.unit
  const margin = num(unit.margin)
  const items: { label: string; value: string; hint: string; tone?: Tone }[] = [
    { label: 'Выручка', value: formatKopecks(num(unit.revenue)), hint: 'Подтверждённые пополнения за период минус возвраты.' },
    { label: 'Расход на LLM', value: formatKopecks(num(unit.llmCost)), hint: 'Решения и чат по цене шлюза моделей.' },
    { label: 'Маржа', value: formatKopecks(margin), hint: 'Выручка минус расход на LLM. Налоги, хостинг и комиссии не учтены.', tone: margin < 0 ? 'danger' : 'success' },
    { label: 'Платящие', value: formatNumber(num(unit.payingUsers)), hint: 'Пополнили баланс хотя бы раз за период.' },
    { label: 'Активные', value: formatNumber(num(unit.activeUsers)), hint: 'Заходили или ставили задачу хотя бы раз за период.' },
    { label: 'Выручка на платящего', value: formatKopecks(num(unit.revenuePerPayer)), hint: 'Выручка, делённая на платящих.' },
    { label: 'LLM на активного', value: formatKopecks(num(unit.llmCostPerActive)), hint: 'Весь расход на LLM, делённый на активных.' },
    { label: 'LLM на платящего', value: formatKopecks(num(unit.llmCostPerPayer)), hint: 'Расход на решения платящих, делённый на их число. Чат не входит.' },
    { label: 'ARPU', value: formatKopecks(num(unit.arpu)), hint: 'Выручка, делённая на всех активных.' },
    { label: 'Себестоимость решённой задачи', value: formatKopecks(num(unit.costPerSolved)), hint: 'Расход на решения, делённый на число решённых задач.' },
  ]
  return (
    <Panel title="Юнит-экономика за период" description="Считается по тем же дневным агрегатам, что и дашборд: сегодняшний день может отставать до 10 минут.">
      <StatGrid>
        {items.map((item) => <Stat key={item.label} label={item.label} value={item.value} hint={item.hint} tone={item.tone} />)}
      </StatGrid>
    </Panel>
  )
}
