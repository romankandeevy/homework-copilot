/* История баланса ученика по дням: восстановлена из книги операций
   (admin_user_balance_history), день - по Москве. Отдельный файл, чтобы
   карточка пользователя получала график одной строкой. */

import { useState } from 'react'
import { adminRpc, formatDate, formatKopecks, num, obj, rows, str } from './api'
import { EmptyState, ErrorState, LineChart, Panel, Segmented, useAsync } from './ui'
import './sections/finance.css'

type Span = '30' | '90' | '365'

const spanOptions: { value: Span; label: string }[] = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' },
]

type Point = { date: string; balance: number; credit: number; debit: number; operations: number }

export default function BalanceHistoryChart({ userId }: { userId: string }) {
  const [span, setSpan] = useState<Span>('90')
  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_user_balance_history', { p_user_id: userId, p_days: Number(span) }),
    [userId, span],
  )
  const report = obj(data)
  const points: Point[] = rows(report.points).map((row) => ({
    date: str(row.date),
    balance: num(row.balance),
    credit: num(row.credit),
    debit: num(row.debit),
    operations: num(row.operations),
  }))
  const balance = num(report.balance)
  const ledger = num(report.ledger)
  const drift = data !== null && data !== undefined && balance !== ledger

  let body
  if (error) body = <ErrorState message={error} onRetry={reload} />
  else if (!data) body = <div className="fin-history-skeleton" role="status" aria-label="Загружаем историю баланса" />
  else if (points.length === 0) body = <EmptyState>Операций по кошельку ещё не было - графику не из чего строиться.</EmptyState>
  else {
    const credit = points.reduce((sum, point) => sum + point.credit, 0)
    const debit = points.reduce((sum, point) => sum + point.debit, 0)
    body = (
      <>
        <LineChart
          labels={points.map((point) => point.date)}
          series={[{ name: 'Баланс на конец дня', values: points.map((point) => point.balance), tone: 1 }]}
          format={formatKopecks}
          height={180}
        />
        <p className="fin-history-meta">
          <span>С {formatDate(str(report.from))}: начислено <b className="fin-amount-pos">+{formatKopecks(credit)}</b></span>
          <span>списано <b className="fin-amount-neg">-{formatKopecks(debit)}</b></span>
        </p>
      </>
    )
  }

  return (
    <Panel
      title="История баланса"
      description="Сумма операций кошелька на конец каждого дня по Москве. Наведи на график, чтобы увидеть дату и баланс."
      actions={<Segmented label="Период графика" value={span} options={spanOptions} onChange={setSpan} />}
    >
      {loading && data ? <p className="fin-note" role="status">Обновляем…</p> : null}
      {body}
      {drift && (
        <p className="fin-history-drift" role="note">
          Баланс кошелька {formatKopecks(balance)}, а сумма операций {formatKopecks(ledger)}: график построен по операциям. Разбор - в «Финансы → Сверка».
        </p>
      )}
    </Panel>
  )
}
