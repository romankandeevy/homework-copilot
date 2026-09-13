import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import AccountDialog from './AccountDialog'
import type { AccountData } from '../lib/supabase'

const user = { id: 'user-1', email: 'roman@example.com' } as User
const account: AccountData = {
  profile: {
    id: user.id,
    full_name: 'Роман',
    grade: 8,
    avatar_path: 'preset:orbit',
    created_at: '2026-08-24T00:00:00.000Z',
    last_seen_at: null,
    updated_at: '2026-08-24T00:00:00.000Z',
  },
  balance: 2000,
  control: null,
  entries: [{
    id: 'entry-1',
    user_id: user.id,
    amount: 20,
    kind: 'credit',
    description: 'Стартовый баланс',
    idempotency_key: 'welcome-credit',
    created_at: '2026-08-24T00:00:00.000Z',
  }],
}

describe('AccountDialog profile', () => {
  it('opens balance separately and exposes the complete profile controls', () => {
    const toggleTheme = vi.fn()
    render(<AccountDialog user={user} account={account} passwordRecovery={false} initialView="wallet" theme="dark" onToggleTheme={toggleTheme} onClose={() => undefined} onReloadAccount={async () => undefined} />)

    expect(screen.getByRole('navigation', { name: 'Раздел аккаунта' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '20 ₽' })).toBeInTheDocument()
    /* Цена берётся из solutionPricing и с 6 сентября зависит от размера
       задачи: разброс себестоимости между короткой историей и трудной
       комбинаторикой почти десятикратный. Кошелёк обещает пол цены - то,
       что верно для любой задачи, - а точная сумма стоит в форме. */
    expect(screen.getByText('за решение, точная цена зависит от задачи')).toBeInTheDocument()
    expect(screen.getByText('от 4 ₽')).toBeInTheDocument()
    expect(screen.queryByText('Журнал нельзя изменить')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Профиль' }))
    expect(screen.queryByRole('heading', { name: 'Аватар' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Выбрать аватар/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Загрузить фото')).not.toBeInTheDocument()
    const grade = screen.getByRole('combobox', { name: 'Класс' })
    expect(grade).toHaveTextContent('8 класс')
    fireEvent.click(grade)
    expect(screen.getByRole('option', { name: '8 класс' })).toHaveAttribute('aria-selected', 'true')
    // Классы те же, что в форме задачи: с пятого по одиннадцатый.
    expect(screen.queryByRole('option', { name: '4 класс' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(7)
    fireEvent.keyDown(grade, { key: 'ArrowDown' })
    fireEvent.keyDown(grade, { key: 'Enter' })
    expect(grade).toHaveTextContent('9 класс')
    expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Светлая' }))
    expect(toggleTheme).toHaveBeenCalledOnce()
    // Названия документов те же, что в подвале сайта: два документа с тремя
    // именами читались как три разных.
    expect(screen.getByRole('link', { name: 'Политика данных' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute('href', '/terms')
    // Удаление аккаунта доступно из профиля и требует подтверждения словом.
    expect(screen.getByRole('button', { name: /Удалить аккаунт/ })).toBeEnabled()
  })

  // Согласия стоят под формой, вплотную к кнопке, которую они защищают,
  // а вход через Google не гаснет молча: он объясняет, чего не хватает.
  it('requires separate agreement and personal-data consent during registration', () => {
    render(<AccountDialog user={null} account={null} passwordRecovery={false} initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))

    const agreement = screen.getByRole('checkbox', { name: /пользовательское соглашение/ })
    const personalData = screen.getByRole('checkbox', { name: /отдельно даю/ })
    // Аудитория — школьники, часть младше четырнадцати: документы за них
    // принимает законный представитель, и это фиксируется отметкой.
    const age = screen.getByRole('checkbox', { name: /14 лет/ })
    const google = screen.getByRole('button', { name: 'Продолжить с Google' })
    const submit = screen.getByRole('button', { name: /Создать аккаунт/ })

    expect(google).toBeEnabled()
    fireEvent.click(google)
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')
    expect(submit).toBeDisabled()

    fireEvent.click(agreement)
    fireEvent.click(personalData)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(age)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'согласие на обработку персональных данных' })).toHaveAttribute('href', '/consent')
  })

  // Ссылка из письма о смене пароля открывает сессию: человек уже вошёл,
  // и форма нового пароля не должна прятаться за профилем.
  it('shows the new-password form to a user signed in by the recovery link', () => {
    render(<AccountDialog user={user} account={account} passwordRecovery initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)

    expect(screen.getByRole('heading', { name: 'Новый пароль' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сохранить пароль/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Раздел аккаунта' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Вернуться ко входу' })).not.toBeInTheDocument()
  })

  // Новый аккаунт через Google с вкладки «Вход» создавался без отметки о
  // согласии. Без отметки окно не закрывается: принять документы или выйти.
  it('keeps a signed-in account without legal acceptance on the consent screen', () => {
    render(<AccountDialog user={user} account={account} passwordRecovery={false} legalAcceptanceRequired initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)

    expect(screen.getByRole('heading', { name: 'Прими документы' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть окно аккаунта' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Раздел аккаунта' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти из аккаунта' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Принять и продолжить/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')

    fireEvent.click(screen.getByRole('checkbox', { name: /пользовательское соглашение/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /отдельно даю/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /14 лет/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
