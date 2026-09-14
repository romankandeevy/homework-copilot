import type { MouseEvent, ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowRight } from '@phosphor-icons/react'
import type { AccountData } from '../lib/supabase'
import { applicationPath } from '../lib/appPath'
import { formatRubles } from '../lib/currency'
import { formatPhoneForDisplay } from '../lib/phone'

/* Профиль и баланс - страницы, а не окно.

   До 14 сентября 2026 оба жили во вкладках диалога поверх любого раздела.
   Владелец: «я хочу с любого места за секунду перейти в свой профиль,
   сохранить ссылку на него». Теперь это `/profile` и `/balance` в той же
   оболочке, что разделы: своя шапка, общий подвал, прямой заход, история
   браузера. Шапка с именем и переключателем - общая у обеих страниц, как
   раньше у окна: без неё на телефоне, где кнопки баланса в шапке нет, до
   баланса было бы не добраться. */

export type AccountPageName = 'profile' | 'balance'

const accountPages: readonly { name: AccountPageName; label: string; path: string }[] = [
  { name: 'profile', label: 'Профиль', path: '/profile' },
  { name: 'balance', label: 'Баланс', path: '/balance' },
]

export function AccountPageHeader({ user, account, current, onNavigate, action }: {
  user: User
  account: AccountData | null
  current: AccountPageName
  onNavigate: (page: AccountPageName) => void
  /** Справа от имени: ссылка на админку у сотрудников. */
  action?: ReactNode
}) {
  // У аккаунта, вошедшего по телефону, почты нет: вместо неё - номер.
  const phoneLabel = formatPhoneForDisplay(user.phone)
  const displayName = account?.profile.full_name || user.email || phoneLabel || 'Ученик'

  const follow = (event: MouseEvent<HTMLAnchorElement>, page: AccountPageName) => {
    // Обычный клик уводит роутером, а Ctrl, Cmd, средняя кнопка и «открыть
    // в новой вкладке» работают как у любой ссылки.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onNavigate(page)
  }

  return (
    <>
      <header className="account-page-header">
        <div className="account-page-identity">
          <span>Аккаунт</span>
          <h1 id="account-page-title">{displayName}</h1>
          <p>{user.email || phoneLabel}</p>
        </div>
        {action}
      </header>

      <nav className="account-page-tabs" aria-label="Раздел аккаунта">
        {accountPages.map((page) => (
          <a
            key={page.name}
            href={applicationPath(page.path)}
            className={page.name === current ? 'is-active' : undefined}
            aria-current={page.name === current ? 'page' : undefined}
            onClick={(event) => follow(event, page.name)}
          >
            {page.label}
            {page.name === 'balance' && <strong>{account ? formatRubles(account.balance) : '…'}</strong>}
          </a>
        ))}
      </nav>
    </>
  )
}

/* Гость, открывший адрес напрямую. Окно входа приложение открывает само;
   закрыл его - здесь остаётся объяснение и кнопка, а не пустая страница. */
export function AccountGuest({ page, onSignIn }: { page: AccountPageName; onSignIn: () => void }) {
  return (
    <section className="route-page account-page" aria-labelledby="account-page-title">
      <header className="route-page-header">
        <h1 id="account-page-title">{page === 'profile' ? 'Профиль' : 'Баланс'}</h1>
        <p>{page === 'profile' ? 'Профиль открывается после входа в аккаунт.' : 'Баланс и история операций видны после входа в аккаунт.'}</p>
      </header>
      <button className="route-primary-action" type="button" onClick={onSignIn}>
        Войти <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </section>
  )
}
