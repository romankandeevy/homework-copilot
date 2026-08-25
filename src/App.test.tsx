import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { SolveHomeworkRequest } from './lib/homeworkContract'

function mockGeneratedSolution(request: SolveHomeworkRequest) {
  return {
    textbookId: request.textbookId,
    task: request.task,
    source: request.source,
    subject: request.subject,
    textbookTitle: request.textbookTitle,
    condition: request.source === 'photo'
      ? 'По фотографии найдите угол треугольника.'
      : 'Проверенное условие задачи № ' + request.task + '.',
    given: ['△ABC', '∠A = 40°'],
    goal: { title: 'Найти', text: '∠B.' },
    steps: ['∠A + ∠B = 90°.', '∠B = 50°.'],
    answer: '50°.',
    diagram: {
      kind: request.textbookId === 'geometry' ? 'right-triangle' : 'none',
      description: 'Прямоугольный треугольник ABC.',
      vertices: ['A', 'B', 'C'],
    },
    sourceVerified: true,
    createdAt: '2026-08-25T12:00:00.000Z',
  }
}

function openTasks() {
  window.history.pushState({}, '', '/cdz')
  fireEvent(window, new PopStateEvent('popstate'))
}

describe('Homework Copilot home', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light'
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as SolveHomeworkRequest
      return {
        ok: true,
        status: 200,
        json: async () => ({ solution: mockGeneratedSolution(request) }),
      } as Response
    }))
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

  it('opens the real account flow from the top navigation profile', async () => {
    render(<App />)

    const accountTrigger = screen.getAllByRole('button', { name: 'Войти или зарегистрироваться' })[0]
    accountTrigger.focus()
    fireEvent.click(accountTrigger)
    expect(await screen.findByRole('dialog', { name: 'Войди в аккаунт' }, { timeout: 5000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    expect(screen.getByRole('heading', { name: 'Создай аккаунт' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Имя' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Почта' })).toBeInTheDocument()
    const grade = screen.getByRole('combobox', { name: 'Класс' })
    expect(grade).toHaveTextContent('8')
    fireEvent.click(grade)
    expect(screen.getByRole('listbox', { name: 'Выбрать класс' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: '9 класс' }))
    expect(grade).toHaveTextContent('9')
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

  it('generates a numbered geometry solution, opens the notebook, and keeps it after a reload', async () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(await screen.findByRole('heading', { name: 'Решение № 126' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/solutions/geometry/126')
    expect(screen.getByText('Проверенное условие задачи № 126.')).toBeInTheDocument()
    expect(screen.getByText('Ответ: 50°.')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem('homework-copilot:generated-solutions-v1')).toContain('"task":"126"'))

    const fetchMock = vi.mocked(fetch)
    const taskCalls = fetchMock.mock.calls.filter(([, options]) => {
      const payload = JSON.parse(String(options?.body ?? '{}')) as { task?: string }
      return payload.task === '126'
    })
    expect(taskCalls).toHaveLength(1)
    const [, init] = taskCalls[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      textbookId: 'geometry',
      task: '126',
      source: 'number',
      textbookTitle: 'Геометрия. 7-9 классы',
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Решения' })[0])
    expect(screen.getByRole('button', { name: /№ 126/ })).toBeInTheDocument()
  })

  it('sends the real photo contents and opens its finished solution', async () => {
    render(<App />)

    const photo = new File(['real image bytes'], 'task.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/Добавить фото/), { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: /Списать по фото/ }))

    expect(await screen.findByRole('heading', { name: 'Решение по фото' })).toBeInTheDocument()
    expect(window.location.pathname).toMatch(/^\/solutions\/geometry\/photo-/)
    expect(screen.getByText('По фотографии найдите угол треугольника.')).toBeInTheDocument()

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const payload = JSON.parse(String(init?.body)) as SolveHomeworkRequest
    expect(payload.source).toBe('photo')
    expect(payload.imageDataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('shows an actionable provider error and does not leave the task processing forever', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер' }),
    } as Response)
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(await screen.findByRole('heading', { name: 'Не получилось решить задачу' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('KIE_API_KEY')
    expect(screen.getByText('Деньги за неготовое решение не списаны.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Готовим № 126' })).not.toBeInTheDocument()
  })

  it('opens already approved geometry fixtures even before Kie.ai is configured', async () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '124' } })
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(await screen.findByRole('heading', { name: 'Решение № 124' })).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('switches the whole shell theme from the top navigation control', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('homework-copilot:theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Включить светлую тему' })).toBeInTheDocument()
  })

  it('combines personal and shared solutions on one route and keeps task selection separate', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Решения' }))
    expect(window.location.pathname).toBe('/solutions')
    expect(screen.getByRole('heading', { name: 'Решения', level: 1 })).toBeInTheDocument()
    const personalTab = screen.getByRole('tab', { name: 'Мои решения' })
    const sharedTab = screen.getByRole('tab', { name: 'База решений' })
    expect(screen.getByRole('tablist', { name: 'Раздел решений' })).toBeInTheDocument()
    expect(sharedTab).toHaveAttribute('aria-selected', 'true')
    expect(personalTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('heading', { name: 'Мои решения' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'База решений' })).toBeInTheDocument()

    fireEvent.click(personalTab)
    expect(screen.getByRole('heading', { name: 'Мои решения' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Твои решения появятся после входа' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'База решений' })).not.toBeInTheDocument()

    fireEvent.keyDown(personalTab, { key: 'ArrowRight' })
    expect(sharedTab).toHaveFocus()
    expect(sharedTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'База решений' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Найти решение' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /№ 123/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Списать задачу' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Найти решение' }), { target: { value: '999' } })
    expect(screen.getByRole('heading', { name: 'Совпадений нет' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти решение' }), { target: { value: '123' } })
    expect(screen.getByRole('button', { name: /№ 123/ })).toBeInTheDocument()

    openTasks()
    expect(window.location.pathname).toBe('/cdz')
    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть учебник' })).not.toBeInTheDocument()
    expect(screen.getByText(/Глава 01:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оплатить' })).toBeDisabled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Главная' })[0])
    expect(window.location.pathname).toBe('/main')
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  it('opens a section directly and keeps it after the app mounts again', () => {
    window.history.replaceState({}, '', '/cdz')
    const firstRender = render(<App />)

    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/cdz')

    firstRender.unmount()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/cdz')
  })

  it('redirects the old textbook route to tasks without opening a reader', () => {
    window.history.replaceState({}, '', '/textbooks')
    render(<App />)

    expect(window.location.pathname).toBe('/cdz')
    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть учебник' })).not.toBeInTheDocument()
  })

  it('redirects the former shared-base route to the combined solutions page', () => {
    window.history.replaceState({}, '', '/base')
    render(<App />)

    expect(window.location.pathname).toBe('/solutions')
    expect(screen.getByRole('tab', { name: 'Мои решения' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'База решений' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'База решений' })).toBeInTheDocument()
  })

  it('restores the matching section when browser history changes', () => {
    render(<App />)

    openTasks()
    expect(window.location.pathname).toBe('/cdz')

    window.history.replaceState({}, '', '/solutions')
    fireEvent(window, new PopStateEvent('popstate'))

    expect(screen.getByRole('heading', { name: 'Решения', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Мои решения' })).toBeInTheDocument()
    expect(document.title).toBe('Решения — Homework Copilot')
  })

  it('opens the approved notebook directly from a shareable solution route', () => {
    window.history.replaceState({}, '', '/solutions/geometry/123')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Решение № 123' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/solutions/geometry/123')
    expect(document.title).toBe('Решение № 123 — Homework Copilot')

    fireEvent.click(screen.getByRole('button', { name: 'К ЦДЗ' }))
    expect(window.location.pathname).toBe('/cdz')
    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
  })

  it('normalizes legacy /tasks URLs to /cdz on mount', () => {
    window.history.replaceState({}, '', '/tasks')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/cdz')
  })

  it('adds several textbook tasks to the cart and pays at checkout', async () => {
    render(<App />)

    openTasks()
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 1 · 5 ₽' }))
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 2 · 5 ₽' }))

    expect(screen.getByRole('complementary', { name: 'Корзина' })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Оплатить · 10 ₽' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(await screen.findByText('Оплачено: 2 задачи.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оплатить' })).toBeDisabled()
  })

  it('keeps tasks from different textbooks in one cart and removes them independently', async () => {
    render(<App />)

    openTasks()
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 1 · 5 ₽' }))
    fireEvent.click(screen.getByRole('button', { name: /Физика.*8 класс/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Задача № 2 · 5 ₽' }))

    expect(screen.getByRole('button', { name: 'Оплатить · 10 ₽' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Убрать из корзины: Геометрия, задача № 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать из корзины: Физика, задача № 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Убрать из корзины: Геометрия, задача № 1' }))
    expect(screen.getByRole('button', { name: 'Оплатить · 5 ₽' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Оплатить · 5 ₽' }))
    expect(await screen.findByText('Оплачено: 1 задача.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оплатить' })).toBeDisabled()
  })

  it('keeps the chosen textbook after a reload', async () => {
    const firstRender = render(<App />)

    openTasks()
    fireEvent.click(screen.getByRole('button', { name: /Физика.*8 класс/ }))
    await waitFor(() => expect(window.localStorage.getItem('homework-copilot:selected-textbook')).toBe('physics'))

    firstRender.unmount()
    render(<App />)
    openTasks()
    expect(screen.getByRole('button', { name: /Физика.*8 класс/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an authentic task condition and its diagram before solving', () => {
    render(<App />)

    expect(screen.queryByText(/Условие задачи №/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '123' } })

    expect(screen.getByText('Условие задачи № 123')).toBeInTheDocument()
    expect(screen.getByText('В равнобедренном треугольнике ABC AB = BC, ∠B = 40°. Найдите углы при основании.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Равнобедренный треугольник ABC/ })).toBeInTheDocument()
  })

  it('never invents a condition for a task missing from the source data', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })

    expect(screen.queryByText(/Условие задачи №/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Списать/ })).toBeEnabled()
  })

  it('shows only tasks from the chosen chapter', () => {
    render(<App />)

    openTasks()
    expect(screen.getByRole('button', { name: 'Задача № 1 · 5 ₽' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 61 · 5 ₽' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /02\s*Площадь/ }))

    expect(screen.getByRole('button', { name: 'Задача № 61 · 5 ₽' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 1 · 5 ₽' })).not.toBeInTheDocument()
    expect(screen.getByText('Глава 02: Площадь')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть учебник' })).not.toBeInTheDocument()
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

  it('shows all app routes in the top navigation and marks the active one', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(navigation.querySelectorAll('.navigation-item')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Главная' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Учебники' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задачи' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Мои решения' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'База решений' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ЦДЗ' })).toBeInTheDocument()
    expect(screen.getByText('Скоро')).toHaveClass('navigation-status')
    expect(document.querySelector('.product-sidebar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Решения' }))
    expect(screen.getByRole('button', { name: 'Решения' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'ЦДЗ' }))
    expect(window.location.pathname).toBe('/cdz')
    expect(screen.getByRole('heading', { name: 'Выбери задачи' })).toBeInTheDocument()
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
