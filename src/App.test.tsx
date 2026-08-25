import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

describe('Homework Copilot home', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light'
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('shows the textbook context, a truthful signed-out state and the shared solution base', () => {
    render(<App />)

    expect(window.location.pathname).toBe('/main')
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Войти' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Геометрия, 8 класс').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Геометрия\. 7-9 классы/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Твои решения появятся после входа' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Мои решения' })).not.toBeInTheDocument()
    expect(screen.queryByText('Вчера, 19:42')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'База решений' })).toBeInTheDocument()
    expect(screen.getByText('Общие готовые решения по всем добавленным учебникам. Их можно открыть сразу.')).toBeInTheDocument()
    expect(screen.queryByText(/МЭШ/i)).not.toBeInTheDocument()
  })

  it('uses the same action card for personal solutions and the shared base', () => {
    render(<App />)

    const guestCard = screen.getByRole('region', { name: 'Твои решения появятся после входа' })
    const baseCard = screen.getByRole('region', { name: 'База решений' })

    expect(guestCard).toHaveClass('home-action-card')
    expect(baseCard).toHaveClass('home-action-card')
    expect(guestCard.querySelector('.home-action-card-icon svg')).toHaveAttribute('width', '34')
    expect(baseCard.querySelector('.home-action-card-icon svg')).toHaveAttribute('width', '34')
  })

  it('opens the real account flow from the sidebar profile', async () => {
    render(<App />)

    const accountTrigger = screen.getAllByRole('button', { name: 'Войти или зарегистрироваться' })[0]
    accountTrigger.focus()
    fireEvent.click(accountTrigger)
    expect(await screen.findByRole('dialog', { name: 'Войди в аккаунт' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    expect(screen.getByRole('heading', { name: 'Создай аккаунт' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Имя' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Почта' })).toBeInTheDocument()
    expect(screen.getByLabelText('Класс')).toHaveValue('8')
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), { target: { value: 'Рома' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Почта' }), { target: { value: 'roma@example.com' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: '12' } })
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled()
    expect(screen.getByRole('meter', { name: 'Надёжность пароля' })).toHaveAttribute('aria-valuetext', 'Слабый')

    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: '12345678' } })
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled()
    expect(screen.getByText('Слишком предсказуемый')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Homework2026!' } })
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled()
    expect(screen.getByRole('meter', { name: 'Надёжность пароля' })).toHaveAttribute('aria-valuetext', 'Надёжный')
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'условия использования' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'политику конфиденциальности' })).toHaveAttribute('href', '/privacy')
    expect(screen.queryByText(/Аккаунт сохраняет решения/)).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(accountTrigger).toHaveFocus()
  })

  it('keeps the email-code confirmation flow on the current device after Google', async () => {
    window.sessionStorage.setItem('homework-copilot:google-verification-email', 'roma@example.com')
    window.sessionStorage.setItem('homework-copilot:verification-email', 'roma@example.com')
    window.sessionStorage.setItem('homework-copilot:verification-kind', 'google')
    window.sessionStorage.setItem('homework-copilot:verification-sent-at', String(Date.now()))
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Войти или зарегистрироваться' })[0])
    expect(await screen.findByRole('heading', { name: 'Введи код' })).toBeInTheDocument()
    expect(screen.getByText(/roma@example.com/)).toBeInTheDocument()
    const codeInput = screen.getByRole('textbox', { name: 'Код подтверждения' })
    fireEvent.change(codeInput, { target: { value: '12a34567' } })
    expect(codeInput).toHaveValue('123456')
    expect(screen.getByRole('button', { name: 'Подтвердить и войти' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Новый код через 01:00/ })).toBeDisabled()
    expect(screen.queryByText(/Supabase Auth/)).not.toBeInTheDocument()
  })

  it('changes the textbook without inventing a shared-base match', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('maxlength', '4')
    expect(screen.getByRole('button', { name: /^Списать/ })).toBeDisabled()

    fireEvent.click(screen.getByText('Сменить'))
    expect(screen.getByRole('dialog', { name: 'Выбери учебник' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Физика, 8 класс/ }))

    expect(screen.queryByRole('dialog', { name: 'Выбери учебник' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Физика, 8 класс').length).toBeGreaterThan(0)

    fireEvent.change(input, { target: { value: '39' } })
    expect(screen.getByText(/В базе пока нет/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Открыть готовое/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Сменить'))
    fireEvent.click(screen.getByRole('option', { name: /Геометрия, 8 класс/ }))
    fireEvent.change(input, { target: { value: '123' } })
    expect(screen.getByRole('button', { name: /Открыть готовое/ })).toBeInTheDocument()
  })

  it('adds textbooks from a link or file inside the picker dialog', () => {
    render(<App />)

    fireEvent.click(screen.getByText('Сменить'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Ссылка на учебник' }), { target: { value: 'https://example.com/geometry.pdf' } })
    fireEvent.click(screen.getByRole('button', { name: /Добавить по ссылке/ }))

    expect(screen.queryByRole('dialog', { name: 'Выбери учебник' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/example\.com/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Сменить'))
    fireEvent.click(screen.getByRole('tab', { name: /Файл/ }))
    const textbookFile = new File(['pdf'], 'algebra-notes.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(/Выбрать файл/), { target: { files: [textbookFile] } })

    expect(screen.queryByRole('dialog', { name: 'Выбери учебник' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/algebra-notes/).length).toBeGreaterThan(0)
  })

  it('validates a number and starts a new system-owned solution', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    fireEvent.change(input, { target: { value: 'задача' } })
    expect(screen.getByRole('alert')).toHaveTextContent('от 1 до 4 цифр')

    fireEvent.change(input, { target: { value: '12345' } })
    expect(input).toHaveValue('1234')
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(screen.getByRole('heading', { name: 'Готовим № 1234' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Решение' })).not.toBeInTheDocument()
  })

  it('accepts a task photo instead of a number', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    fireEvent.change(input, { target: { value: '123' } })

    const photo = new File(['photo'], 'task.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/Добавить фото/), { target: { files: [photo] } })

    expect(input).toHaveValue('')
    expect(screen.getByText('task.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Списать по фото/ }))
    expect(screen.getByRole('heading', { name: 'Готовим задачу с фото' })).toBeInTheDocument()
  })

  it('opens a ready shared solution without a waiting state', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: /Открыть готовое/ }))

    expect(screen.getByRole('heading', { name: '№ 123 уже готова' })).toBeInTheDocument()
    expect(screen.getByText(/Решение найдено в общей базе/)).toBeInTheDocument()
  })

  it('switches the whole shell theme from desktop and mobile controls', () => {
    render(<App />)

    const themeControls = screen.getAllByRole('button', { name: 'Включить тёмную тему' })
    expect(themeControls).toHaveLength(2)
    fireEvent.click(themeControls[0])
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('homework-copilot:theme')).toBe('dark')
    expect(screen.getAllByRole('button', { name: 'Включить светлую тему' })).toHaveLength(2)
  })

  it('opens the implemented solutions, base and textbook routes', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Мои решения' })[0])
    expect(window.location.pathname).toBe('/solutions')
    expect(screen.getByRole('heading', { name: 'Мои решения' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Твои решения появятся после входа' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Списать задачу' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'База решений' })[0])
    expect(window.location.pathname).toBe('/base')
    expect(screen.getByRole('heading', { name: 'База решений' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Найти в базе' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /№ 123/ })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    expect(window.location.pathname).toBe('/textbooks')
    expect(screen.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeInTheDocument()
    expect(screen.getByText(/Глава 01:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Решить выбранные/ })).toBeDisabled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Главная' })[0])
    expect(window.location.pathname).toBe('/main')
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  it('opens a section directly and keeps it after the app mounts again', () => {
    window.history.replaceState({}, '', '/textbooks')
    const firstRender = render(<App />)

    expect(screen.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/textbooks')

    firstRender.unmount()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/textbooks')
  })

  it('restores the matching section when browser history changes', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'База решений' })[0])
    expect(window.location.pathname).toBe('/base')

    window.history.replaceState({}, '', '/solutions')
    fireEvent(window, new PopStateEvent('popstate'))

    expect(screen.getByRole('heading', { name: 'Мои решения' })).toBeInTheDocument()
    expect(document.title).toBe('Мои решения — Homework Copilot')
  })

  it('opens the approved notebook directly from a shareable solution route', () => {
    window.history.replaceState({}, '', '/solutions/geometry/123')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Решение № 123' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/solutions/geometry/123')
    expect(document.title).toBe('Решение № 123 — Homework Copilot')

    fireEvent.click(screen.getByRole('button', { name: 'К учебникам' }))
    expect(window.location.pathname).toBe('/textbooks')
    expect(screen.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeInTheDocument()
  })

  it('selects several textbook tasks and queues them together', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 1 · 5 ₽' }))
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 2 · 5 ₽' }))

    const submit = screen.getByRole('button', { name: 'Решить выбранные · 2' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(await screen.findByText('В очередь добавлено: 2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Решить выбранные/ })).toBeDisabled()
  })

  it('keeps the chosen textbook after a reload', async () => {
    const firstRender = render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Физика.*Перышкин/ }))
    await waitFor(() => expect(window.localStorage.getItem('homework-copilot:selected-textbook')).toBe('physics'))

    firstRender.unmount()
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    expect(screen.getByRole('button', { name: /Физика.*Перышкин/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the supplied physics textbook from its preview', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Физика.*Перышкин/ }))
    expect(screen.getByRole('heading', { name: 'Тепловые явления' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть учебник' }))
    expect(screen.getByRole('region', { name: 'Учебник: Физика. 8 класс' })).toHaveAttribute('data-pdf-source', '/textbooks/physics-8-peryshkin-2026.pdf')
    expect(screen.getByRole('button', { name: 'Показать точный скан' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Показать читаемый текст' }))
    expect(screen.getByRole('button', { name: 'Показать читаемый текст' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
  })

  it('opens the supplied chemistry textbook from its preview', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Химия.*Габриелян/ }))
    expect(screen.getByRole('heading', { name: 'Вещество и язык химии' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть учебник' }))
    expect(screen.getByRole('region', { name: 'Учебник: Химия. 8 класс. Базовый уровень' })).toHaveAttribute('data-pdf-source', '/textbooks/chemistry-8-gabrielyan-2025.pdf')
  })

  it('shows only tasks from the chosen chapter', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Учебники' })[0])
    expect(screen.getByRole('button', { name: 'Задача № 1 · 5 ₽' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 61 · 5 ₽' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /02\s*Площадь/ }))

    expect(screen.getByRole('button', { name: 'Задача № 61 · 5 ₽' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 1 · 5 ₽' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Площадь' })).toBeInTheDocument()
    expect(screen.getByText('Глава 02 · Формула и разбиение')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть учебник' }))
    expect(screen.getByRole('region', { name: 'Учебник: Геометрия. 7-9 классы' })).toHaveAttribute('data-pdf-source', '/textbooks/geometry-7-9-atanasyan.pdf')
    expect(screen.getByRole('button', { name: 'Пополнить баланс' })).toBeInTheDocument()
  })

  it('opens an editable schedule and saves manual changes', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Расписание' })[0])
    expect(window.location.pathname).toBe('/schedule')
    expect(await screen.findByRole('heading', { name: 'Расписание' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Учебное расписание на неделю' })).toBeInTheDocument()

    const subjectInputs = screen.getAllByRole('textbox', { name: /Предмет, .*, урок/ })
    fireEvent.change(subjectInputs[0], { target: { value: 'Математика' } })
    expect(subjectInputs[0]).toHaveValue('Математика')
    expect(window.localStorage.getItem('homework-copilot:schedule-v1')).toContain('Математика')

    expect(screen.queryByRole('button', { name: 'Добавить урок' })).not.toBeInTheDocument()
    expect(screen.getByText('Сохраняется в этом браузере')).toBeInTheDocument()
    expect(screen.getByLabelText('Загрузить фото расписания')).toHaveAttribute('accept', 'image/*')
  })

  it('routes the rounded sidebar line around the active icon', () => {
    render(<App />)

    const path = document.querySelector('.navigation-route path')
    expect(path).toHaveAttribute('d', 'M-1 18 H24 C46 18 64 18 64 39 V39 C64 39 64 39 64 39 V87 C64 99 40 99 40 111 V340 C40 350 32 360 16 360 H-1')
    expect(document.querySelector('.product-seam span')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Мои решения' })[0])
    expect(path).toHaveAttribute('d', 'M-1 18 H24 C34 18 40 24 40 34 V77 C40 89 64 89 64 101 V149 C64 161 40 161 40 173 V340 C40 350 32 360 16 360 H-1')
  })

  it('publishes the privacy policy at its direct route', () => {
    window.history.replaceState({}, '', '/privacy')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Политика конфиденциальности' })).toBeInTheDocument()
    expect(screen.getByText(/Supabase для авторизации/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Условия использования/ })).toHaveAttribute('href', '/terms')
  })

  it('publishes the terms at its direct route', () => {
    window.history.replaceState({}, '', '/terms')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Условия использования' })).toBeInTheDocument()
    expect(screen.getByText(/20 ₽ промобаланса/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Политика конфиденциальности/ })).toHaveAttribute('href', '/privacy')
  })
})
