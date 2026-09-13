import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import AccountDialog from './AccountDialog'
import type { AuthMethods } from './AccountDialog'
import type { AccountData } from '../lib/supabase'

const { startYandexSignIn } = vi.hoisted(() => ({ startYandexSignIn: vi.fn(async (consents: boolean) => { void consents }) }))
vi.mock('../lib/yandexAuth', () => ({ startYandexSignIn }))

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

  // Согласия стоят под формой, вплотную к кнопке, которую они защищают.
  // Входа через Google нет: с 1 декабря 2023 года (406-ФЗ) российский сайт
  // не может авторизовать через иностранный сервис.
  it('requires separate agreement and personal-data consent during registration', () => {
    render(<AccountDialog user={null} account={null} passwordRecovery={false} initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))

    const agreement = screen.getByRole('checkbox', { name: /пользовательское соглашение/ })
    const personalData = screen.getByRole('checkbox', { name: /отдельно даю/ })
    // Аудитория — школьники, часть младше четырнадцати: документы за них
    // принимает законный представитель, и это фиксируется отметкой.
    const age = screen.getByRole('checkbox', { name: /14 лет/ })
    const submit = screen.getByRole('button', { name: /Создать аккаунт/ })

    expect(submit).toBeDisabled()
    fireEvent.click(agreement)
    fireEvent.click(personalData)
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

  // У аккаунта, вошедшего по телефону, почты нет: в шапке и профиле - номер.
  it('shows the phone instead of an email for an account that signs in by phone', () => {
    const phoneUser = { id: 'user-2', email: '', phone: '79123456789', app_metadata: { provider: 'phone' } } as unknown as User
    render(<AccountDialog user={phoneUser} account={account} passwordRecovery={false} initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} />)

    expect(screen.getByText('+7 912 345-67-89')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+7 912 345-67-89')).toBeInTheDocument()
    expect(screen.queryByText('Почта')).not.toBeInTheDocument()
  })
})

/* 406-ФЗ: кроме почты - Яндекс ID и номер телефона. Оба способа видны,
   только когда их включили флагом в админке. */
describe('AccountDialog sign-in methods', () => {
  beforeEach(() => {
    startYandexSignIn.mockClear()
    window.sessionStorage.clear()
  })

  const renderAuth = (authMethods?: AuthMethods) => render(
    <AccountDialog user={null} account={null} passwordRecovery={false} initialView="profile" theme="light" onToggleTheme={() => undefined} onClose={() => undefined} onReloadAccount={async () => undefined} authMethods={authMethods} />,
  )

  it('shows neither Yandex ID nor phone until the admin turns them on', () => {
    renderAuth()
    expect(screen.queryByRole('button', { name: /Яндекс ID/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'По номеру телефона' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    expect(screen.queryByRole('button', { name: /Яндекс ID/ })).not.toBeInTheDocument()
  })

  it('goes to Yandex ID from the sign-in tab without recording consent', () => {
    renderAuth({ yandex: true, phone: false })
    fireEvent.click(screen.getByRole('button', { name: 'Войти с Яндекс ID' }))
    expect(startYandexSignIn).toHaveBeenCalledWith(false)
    expect(window.sessionStorage.getItem('homework-copilot:legal-acceptance-pending')).toBeNull()
  })

  it('asks for the three consents before leaving for Yandex ID from the sign-up tab', () => {
    renderAuth({ yandex: true, phone: false })
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    const yandex = screen.getByRole('button', { name: 'Войти с Яндекс ID' })

    fireEvent.click(yandex)
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')
    expect(startYandexSignIn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: /пользовательское соглашение/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /отдельно даю/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /14 лет/ }))
    fireEvent.click(yandex)
    expect(startYandexSignIn).toHaveBeenCalledWith(true)
    expect(JSON.parse(window.sessionStorage.getItem('homework-copilot:legal-acceptance-pending') ?? '{}')).toMatchObject({ source: 'yandex' })
  })

  it('takes only a Russian mobile number and hides the password recovery', () => {
    renderAuth({ yandex: false, phone: true })
    fireEvent.click(screen.getByRole('button', { name: 'По номеру телефона' }))

    const phone = screen.getByRole('textbox', { name: /Номер телефона/ })
    expect(screen.queryByPlaceholderText('Твой пароль')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Не помню пароль' })).not.toBeInTheDocument()

    fireEvent.change(phone, { target: { value: '8 912 345 67 89' } })
    expect(phone).toHaveValue('912 345-67-89')
    expect(screen.getByRole('button', { name: /Получить код/ })).toBeEnabled()

    fireEvent.change(phone, { target: { value: '495 123 45 67' } })
    expect(screen.getByRole('button', { name: /Получить код/ })).toBeDisabled()

    // Обратно к почте - пароль и восстановление на месте.
    fireEvent.click(screen.getByRole('button', { name: 'По почте и паролю' }))
    expect(screen.getByPlaceholderText('Твой пароль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Не помню пароль' })).toBeInTheDocument()
  })

  it('requires name, grade and the three consents before sending a code on sign-up', () => {
    renderAuth({ yandex: false, phone: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    fireEvent.click(screen.getByRole('button', { name: 'По номеру телефона' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Номер телефона/ }), { target: { value: '9123456789' } })

    const submit = screen.getByRole('button', { name: /Получить код/ })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Как к тебе обращаться'), { target: { value: 'Иван' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Класс' }))
    fireEvent.click(screen.getByRole('option', { name: '8 класс' }))
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /пользовательское соглашение/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /отдельно даю/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /14 лет/ }))
    expect(submit).toBeEnabled()
  })
})
