import { ChatCircleText } from '@phosphor-icons/react'
import './SupportLauncher.css'

/* Вход в поддержку - на каждой странице и на одном месте, в правом нижнем
   углу. До 14 сентября кнопка была в решениях, чате и расписании, но не на
   витрине, не на главной приложения и не в документах; владелец: «она должна
   быть всегда, и желательно в одном и том же месте».

   Отдельный файл - чтобы витрине и документам ради кнопки не тянуть код окна
   поддержки. Там окна нет, и кнопка - ссылка на /support: приложение откроет
   то же окно. */
export function SupportLauncher({ onClick }: { onClick?: () => void }) {
  const content = (
    <>
      <ChatCircleText size={22} weight="duotone" aria-hidden="true" />
      <span>Поддержка</span>
    </>
  )

  if (onClick) {
    return <button className="support-launcher" type="button" onClick={onClick} aria-label="Открыть поддержку">{content}</button>
  }
  return <a className="support-launcher" href="/support" aria-label="Открыть поддержку">{content}</a>
}
