/* Диалоги действий над пользователем - общие для карточки и раздела
   «Пользователи». Проверки повторяют серверные, чтобы ошибка была видна до
   запроса; решает всё равно база. */

import { useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { formatKopecks, formatNumber, rublesInputToKopecks } from './api'
import { Button, Field, Modal } from './ui'

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

export function ConfirmDialog({ title, confirmLabel, tone = 'primary', pending, onClose, onConfirm, children }: {
  title: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  pending: boolean
  onClose: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant={tone} loading={pending} onClick={onConfirm} data-initial-focus>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  )
}

/* Блокировка одного аккаунта или выбранных строк (count > 1). */
export function BanDialog({ pending, onClose, onSubmit, target, count = 1 }: {
  pending: boolean
  onClose: () => void
  onSubmit: (reason: string, until: string | null) => void
  target?: string
  count?: number
}) {
  const formId = useId()
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const clean = reason.trim()
    if (clean.length < 3 || clean.length > 500) {
      setError('Причина блокировки - от 3 до 500 символов.')
      return
    }
    const untilIso = localInputToIso(until)
    if (until && (!untilIso || new Date(untilIso).getTime() <= Date.now())) {
      setError('Срок блокировки должен быть в будущем.')
      return
    }
    onSubmit(clean, untilIso)
  }

  const many = count > 1
  return (
    <Modal
      open
      title={many ? `Заблокировать: ${formatNumber(count)}` : 'Заблокировать'}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>Заблокировать</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form" onSubmit={submit}>
        {target && <p><strong>{target}</strong></p>}
        <p>
          {many ? 'Каждая блокировка с причиной попадёт в журнал.' : 'Блокировка и её причина попадут в журнал.'}
          {' '}Без срока - бессрочно, со сроком снимется сама.
        </p>
        <Field label="Причина">
          <textarea data-initial-focus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="До (необязательно)" hint="Время по часам этого компьютера.">
          <input type="datetime-local" value={until} min={nowLocalInput()} onChange={(event) => setUntil(event.target.value)} />
        </Field>
        {error && <p className="adm-card-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

/* Баланс: у одного аккаунта - плюс или минус (admin_adjust_balance), у
   выбранных строк - только начисление одной суммы каждому. */
export function BalanceDialog({ mode, pending, onClose, onSubmit, target, balance, count = 1 }: {
  mode: 'adjust' | 'credit'
  pending: boolean
  onClose: () => void
  onSubmit: (amount: number, reason: string) => void
  target?: string
  balance?: number
  count?: number
}) {
  const formId = useId()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const kopecks = rublesInputToKopecks(amount)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (kopecks === null || (mode === 'credit' ? kopecks <= 0 || kopecks > 10_000_000 : kopecks === 0 || Math.abs(kopecks) > 10_000_000)) {
      setError(mode === 'credit' ? 'Сумма - от 0,01 до 100 000 ₽.' : 'Сумма - ненулевая, не больше 100 000 ₽ по модулю.')
      return
    }
    const clean = reason.trim()
    if (clean.length < 3 || clean.length > 160) {
      setError('Причина - от 3 до 160 символов.')
      return
    }
    setError('')
    onSubmit(kopecks, clean)
  }

  const debit = kopecks !== null && kopecks < 0
  const label = mode === 'credit'
    ? (kopecks && kopecks > 0 ? `Начислить по ${formatKopecks(kopecks)}` : 'Начислить')
    : kopecks && kopecks > 0 ? `Начислить ${formatKopecks(kopecks)}` : debit ? `Списать ${formatKopecks(-kopecks)}` : 'Провести'

  return (
    <Modal
      open
      title={mode === 'credit' ? `Начислить: ${formatNumber(count)}` : 'Изменить баланс'}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant={debit ? 'danger' : 'primary'} loading={pending}>{label}</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form" onSubmit={submit}>
        {target && <p><strong>{target}</strong>{balance !== undefined && <> · сейчас {formatKopecks(balance)}</>}</p>}
        <p>
          {mode === 'credit'
            ? 'Каждому выбранному начислится одна и та же сумма. Операция попадёт в историю баланса и в журнал.'
            : 'Плюс - начислить, минус - списать. Уйти в минус баланс не может. Операция попадёт в историю баланса и в журнал.'}
        </p>
        <Field label={mode === 'credit' ? 'Сумма каждому, ₽' : 'Сумма, ₽'}>
          <input data-initial-focus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={mode === 'credit' ? 'например 100' : '150 или -40'} />
        </Field>
        <Field label="Причина">
          <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {mode === 'credit' && kopecks !== null && kopecks > 0 && count > 1 && <p className="adm-card-hint">Всего будет начислено {formatKopecks(kopecks * count)}.</p>}
        {error && <p className="adm-card-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
