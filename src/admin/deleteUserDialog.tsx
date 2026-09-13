/* Удаление аккаунта - одного из карточки или выбранных строк раздела
   «Пользователи». Один аккаунт подтверждают его почтой или номером,
   несколько - словом «УДАЛИТЬ»: случайный клик ничего не сотрёт. Проверку
   повторяют сервер админки и база (admin_delete_user). */

import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { formatNumber } from './api'
import { deleteConfirmMatches, deleteConfirmWord } from './deleteConfirm'
import { Button, Field, Modal } from './ui'

export function DeleteUserDialog({ pending, onClose, onSubmit, target, expected, count = 1 }: {
  pending: boolean
  onClose: () => void
  onSubmit: (confirm: string, reason: string) => void
  target?: string
  /** Почта или номер аккаунта; для нескольких - слово «УДАЛИТЬ». */
  expected: string
  count?: number
}) {
  const formId = useId()
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const matches = deleteConfirmMatches(confirm, expected)
  const many = count > 1
  const byWord = expected === deleteConfirmWord

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (matches) onSubmit(confirm.trim(), reason.trim())
  }

  return (
    <Modal
      open
      title={many ? `Удалить аккаунты: ${formatNumber(count)}` : 'Удалить аккаунт'}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant="danger" loading={pending} disabled={!matches}>Удалить навсегда</Button>
        </>
      )}
    >
      <form id={formId} className="adm-card-form" onSubmit={submit}>
        {target && <p><strong>{target}</strong></p>}
        <p>
          {many ? 'Аккаунты удалятся' : 'Аккаунт удалится'} безвозвратно: профиль, баланс с историей, решения, чат с файлами и обращения.
          {' '}Вернуть нельзя. Запись об удалении останется в журнале.
        </p>
        <Field label={byWord ? `Впиши «${deleteConfirmWord}»` : `Впиши ${expected.includes('@') ? 'почту' : 'номер'} аккаунта: ${expected}`}>
          <input data-initial-focus value={confirm} autoComplete="off" onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        <Field label="Причина (необязательно)">
          <textarea value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
