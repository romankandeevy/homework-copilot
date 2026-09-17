import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import AccountDialog from './AccountDialog'
import type { AuthMethods } from './AccountDialog'

const { startYandexSignIn } = vi.hoisted(() => ({ startYandexSignIn: vi.fn(async (consents: boolean) => { void consents }) }))
vi.mock('../lib/yandexAuth', () => ({ startYandexSignIn }))

// Форма регистрации - десятки событий подряд: на загруженной машине тест
// шёл 10 секунд и падал по пятисекундному сроку, ничего не нарушив.
vi.setConfig({ testTimeout: 20_000 })

const user = { id: 'user-1', email: 'roman@example.com' } as User

/* С 14 сентября 2026 окно - только вход, согласие и новый пароль. Профиль
   и баланс проверяются на своих страницах (AccountPages.test.tsx). */
describe('AccountDialog', () => {
  // Согласия стоят под формой, вплотную к кнопке, которую они защищают.
  // Входа через Google нет: с 1 декабря 2023 года (406-ФЗ) российский сайт
  // не может авторизовать через иностранный сервис.
  it('requires separate agreement and personal-data consent during registration', () => {
    render(<AccountDialog user={null} passwordRecovery={false} onClose={() => undefined} />)
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))

    const agreement = screen.getByRole('checkbox', { name: /пользовательское соглашение/ })
    const personalData = screen.getByRole('checkbox', { name: /отдельно даю/ })
    // Аудитория — школьники, часть младше четырнадцати: документы за них
    // принимает законный представитель, и это фиксируется отметкой.
    const age = screen.getByRole('checkbox', { name: /14 лет/ })
    const submit = screen.getByRole('button', { name: /Создать аккаунт/ })

    expect(submit).toBeEnabled()
    fireEvent.click(agreement)
    fireEvent.click(personalData)
    fireEvent.click(age)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Документы живут под `/docs/` (14 сентября 2026); в окне они открываются
    // в новой вкладке, чтобы не потерять заполненную форму.
    expect(screen.getByRole('link', { name: 'пользовательское соглашение' })).toHaveAttribute('href', '/docs/terms')
    expect(screen.getByRole('link', { name: 'согласие на обработку персональных данных' })).toHaveAttribute('href', '/docs/consent')
    expect(screen.getByRole('link', { name: 'политику данных' })).toHaveAttribute('href', '/docs/privacy')
  })

  // Аудит 16 сентября, Г1: кнопка не гаснет. Нажатие на незаполненной форме
  // говорит, чего не хватает, и ставит курсор в первое такое поле.
  it('explains the first missing field instead of disabling Create account', () => {
    render(<AccountDialog user={null} passwordRecovery={false} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    const submit = screen.getByRole('button', { name: /Создать аккаунт/ })
    const name = screen.getByPlaceholderText('Как к тебе обращаться')
    const email = screen.getByPlaceholderText('name@example.com')
    const password = screen.getByPlaceholderText('Не меньше 8 символов')

    // Правило пароля целиком видно до набора.
    expect(screen.getByText(/Не меньше 8 символов, строчные и заглавные буквы, хотя бы одна цифра, хотя бы один спецсимвол/)).toBeInTheDocument()

    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Введи имя')
    expect(name).toHaveFocus()

    fireEvent.change(name, { target: { value: 'Иван' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Введи почту')
    expect(email).toHaveFocus()

    fireEvent.change(email, { target: { value: 'ivan@example.com' } })
    fireEvent.change(password, { target: { value: 'homework' } })
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('В пароле не хватает: строчные и заглавные буквы, хотя бы одна цифра, хотя бы один спецсимвол')
    expect(password).toHaveFocus()

    // Класс не выбран - это не помеха: дальше только согласия.
    fireEvent.change(password, { target: { value: 'Homework2026!' } })
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')
    expect(screen.getByRole('checkbox', { name: /пользовательское соглашение/ })).toHaveFocus()
    expect(submit).toBeEnabled()
  })

  it('keeps Sign in pressable and points at the empty field', () => {
    render(<AccountDialog user={null} passwordRecovery={false} onClose={() => undefined} />)
    const submit = screen.getByRole('button', { name: /^Войти$/ })
    expect(submit).toBeEnabled()

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'ivan@example.com' } })
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Введи пароль')
    expect(screen.getByPlaceholderText('Твой пароль')).toHaveFocus()
  })

  // Ссылка из письма о смене пароля открывает сессию: человек уже вошёл,
  // и форма нового пароля не должна прятаться за профилем.
  it('shows the new-password form to a user signed in by the recovery link', () => {
    render(<AccountDialog user={user} passwordRecovery onClose={() => undefined} />)

    expect(screen.getByRole('heading', { name: 'Новый пароль' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сохранить пароль/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Раздел аккаунта' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Вернуться ко входу' })).not.toBeInTheDocument()
  })

  // Новый аккаунт через Google с вкладки «Вход» создавался без отметки о
  // согласии. Без отметки окно не закрывается: принять документы или выйти.
  it('keeps a signed-in account without legal acceptance on the consent screen', () => {
    render(<AccountDialog user={user} passwordRecovery={false} legalAcceptanceRequired onClose={() => undefined} />)

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

/* 406-ФЗ: кроме почты - Яндекс ID и номер телефона. Оба способа видны,
   только когда их включили флагом в админке. */
describe('AccountDialog sign-in methods', () => {
  beforeEach(() => {
    startYandexSignIn.mockClear()
    window.sessionStorage.clear()
  })

  const renderAuth = (authMethods?: AuthMethods) => render(
    <AccountDialog user={null} passwordRecovery={false} onClose={() => undefined} authMethods={authMethods} />,
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
    fireEvent.click(screen.getByRole('button', { name: /Получить код/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Нужен российский мобильный номер')
    expect(phone).toHaveFocus()

    // Обратно к почте - пароль и восстановление на месте.
    fireEvent.click(screen.getByRole('button', { name: 'По почте и паролю' }))
    expect(screen.getByPlaceholderText('Твой пароль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Не помню пароль' })).toBeInTheDocument()
  })

  it('requires name and the three consents, but not grade, before sending a code on sign-up', () => {
    renderAuth({ yandex: false, phone: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    fireEvent.click(screen.getByRole('button', { name: 'По номеру телефона' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Номер телефона/ }), { target: { value: '9123456789' } })

    const submit = screen.getByRole('button', { name: /Получить код/ })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Введи имя')

    fireEvent.change(screen.getByPlaceholderText('Как к тебе обращаться'), { target: { value: 'Иван' } })
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Прими соглашение')

    fireEvent.click(screen.getByRole('checkbox', { name: /пользовательское соглашение/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /отдельно даю/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /14 лет/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
  })
})
