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
    // Цена одна и берётся из solutionPricing: лестница 5/10/15 ₽ снята вместе
    // с номерами задач, а кошелёк ещё год назад обещал «зависит от сложности».
    expect(screen.getByText('одно решение, любой предмет')).toBeInTheDocument()
    expect(screen.getByText('5 ₽')).toBeInTheDocument()
    expect(screen.queryByText('Журнал нельзя изменить')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Профиль' }))
    expect(screen.queryByRole('heading', { name: 'Аватар' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Выбрать аватар/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Загрузить фото')).not.toBeInTheDocument()
    const grade = screen.getByRole('combobox', { name: 'Класс' })
    expect(grade).toHaveTextContent('8 класс')
    fireEvent.click(grade)
    expect(screen.getByRole('option', { name: '8 класс' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(grade, { key: 'ArrowDown' })
    fireEvent.keyDown(grade, { key: 'Enter' })
    expect(grade).toHaveTextContent('9 класс')
    expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Светлая' }))
    expect(toggleTheme).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'Конфиденциальность' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Правила сервиса' })).toHaveAttribute('href', '/terms')
  })

  // Согласия стоят под формой, вплотную к кнопке, которую они защищают,
  // а вход через Google не гаснет молча: он объясняет, чего не хватает.
  it('requires separate agreement and personal-data consent during registration', () => {
    render(<AccountDialog user={null} account={null} passwordRecovery={false} initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))

    const agreement = screen.getByRole('checkbox', { name: /пользовательское соглашение/ })
    const personalData = screen.getByRole('checkbox', { name: /отдельно даю/ })
    const google = screen.getByRole('button', { name: 'Продолжить с Google' })
    const submit = screen.getByRole('button', { name: /Создать аккаунт/ })

    expect(google).toBeEnabled()
    fireEvent.click(google)
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')
    expect(submit).toBeDisabled()

    fireEvent.click(agreement)
    fireEvent.click(personalData)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'согласие на обработку персональных данных' })).toHaveAttribute('href', '/consent')
  })
})
