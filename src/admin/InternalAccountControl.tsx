/* Служебный аккаунт: свой аккаунт владельца, тестовый, демо. Такой аккаунт
   не считается учеником - ни в регистрациях и активности, ни в решениях,
   выручке и деньгах на кошельках. Пометку хранит база
   (private.internal_accounts), смена пишется в журнал действий. */

import { UserMinus, UserPlus } from '@phosphor-icons/react'
import { adminRpc, obj, str } from './api'
import { Badge, Button, useAction, useAsync } from './ui'

export default function InternalAccountControl({ userId }: { userId: string }) {
  const status = useAsync(() => adminRpc('admin_internal_account', { p_user_id: userId }), [userId])
  const { pending, run } = useAction()
  const data = obj(status.data)

  if (!status.data || data.isAdmin === true) return null
  const internal = data.internal === true

  const toggle = async () => {
    const result = await run(
      'internal',
      () => adminRpc('admin_set_internal_account', {
        p_user_id: userId,
        p_internal: !internal,
        p_reason: internal ? 'вернули в статистику' : 'служебный аккаунт',
      }),
      internal ? 'Аккаунт снова считается учеником' : 'Аккаунт помечен служебным и не считается в статистике',
    )
    if (result !== undefined) status.reload()
  }

  return (
    <div className="adm-card-internal">
      {internal && (
        <Badge tone="info" title={[str(data.reason), str(data.markedBy) ? `пометил ${str(data.markedBy)}` : ''].filter(Boolean).join(', ')}>
          Служебный аккаунт - не в статистике
        </Badge>
      )}
      <Button
        size="sm"
        variant="ghost"
        loading={pending === 'internal'}
        icon={internal ? <UserPlus size={16} weight="bold" aria-hidden="true" /> : <UserMinus size={16} weight="bold" aria-hidden="true" />}
        title={internal
          ? 'Аккаунт снова будет считаться учеником: в регистрациях, активности, решениях, выручке и кошельках.'
          : 'Свой, тестовый или демо-аккаунт: не считать его учеником в статистике. Расход на модели по нему останется в расходах.'}
        onClick={() => void toggle()}
      >
        {internal ? 'Вернуть в статистику' : 'Сделать служебным'}
      </Button>
    </div>
  )
}
