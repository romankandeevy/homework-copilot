/* Служебный аккаунт: свой аккаунт владельца, тестовый, демо.

   До 15 сентября 2026 такая пометка вычёркивала аккаунт из всей
   статистики. Владелец решил иначе: статистика - только реальные данные,
   без исключений, и его собственные задачи считаются наравне со всеми.
   Пометка осталась правом, а не фильтром: служебный аккаунт может
   провести тестовый платёж Робокассы (база у превью и прода одна).
   Пометку хранит база (private.internal_accounts), смена пишется в журнал. */

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
        p_reason: internal ? 'сняли пометку служебного' : 'служебный аккаунт',
      }),
      internal ? 'Пометка снята: тестовые платежи этому аккаунту закрыты' : 'Аккаунт помечен служебным: ему открыты тестовые платежи',
    )
    if (result !== undefined) status.reload()
  }

  return (
    <div className="adm-card-internal">
      {internal && (
        <Badge tone="info" title={[str(data.reason), str(data.markedBy) ? `пометил ${str(data.markedBy)}` : ''].filter(Boolean).join(', ')}>
          Служебный аккаунт
        </Badge>
      )}
      <Button
        size="sm"
        variant="ghost"
        loading={pending === 'internal'}
        icon={internal ? <UserMinus size={16} weight="bold" aria-hidden="true" /> : <UserPlus size={16} weight="bold" aria-hidden="true" />}
        title={internal
          ? 'Снять пометку: аккаунт больше не сможет проводить тестовые платежи Робокассы. В статистике он считается в любом случае.'
          : 'Свой, тестовый или демо-аккаунт: разрешить ему тестовые платежи Робокассы. В статистике он считается в любом случае.'}
        onClick={() => void toggle()}
      >
        {internal ? 'Снять пометку служебного' : 'Сделать служебным'}
      </Button>
    </div>
  )
}
