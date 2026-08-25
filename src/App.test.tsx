import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const generatedSolution = {
  textbookId: 'geometry',
  task: '126',
  source: 'number',
  subject: 'Геометрия',
  textbookTitle: 'Геометрия. 7-9 классы',
  condition: 'В треугольнике ABC ∠A = 40°, ∠B = 50°. Найдите ∠C.',
  given: ['△ABC', '∠A = 40°', '∠B = 50°'],
  goal: { title: 'Найти', text: '∠C.' },
  steps: ['∠A + ∠B + ∠C = 180°.', '∠C = 90°.'],
  answer: '90°.',
  diagram: {
    kind: 'right-triangle',
    description: 'Прямоугольный треугольник ABC.',
    vertices: ['A', 'B', 'C'],
  },
  sourceVerified: true,
  createdAt: '2026-08-25T12:00:00.000Z',
} as const

describe('Homework Copilot home', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light'
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the textbook context, a truthful signed-out state and the shared solution base', () => {
    render(<App />)

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

  it('opens the real account flow from the sidebar profile', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Войти или зарегистрироваться' })[0])
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

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно аккаунта' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('changes the saved textbook and checks the matching shared base', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('maxlength', '4')
    expect(screen.getByRole('button', { name: /^Списать/ })).toBeDisabled()

    fireEvent.click(screen.getByText('Сменить'))
    expect(screen.getByRole('dialog', { name: 'Выбери учебник' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Русский язык, 8 класс/ }))

    expect(screen.queryByRole('dialog', { name: 'Выбери учебник' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Русский язык, 8 класс').length).toBeGreaterThan(0)

    fireEvent.change(input, { target: { value: '39' } })
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

  it('requests and opens a real generated geometry solution', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ solution: generatedSolution }),
    } as Response)
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(await screen.findByRole('heading', { name: 'Решение № 126' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скопировать решение' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [endpoint, options] = fetchMock.mock.calls[0]
    expect(endpoint).toBe('/api/solve')
    expect(JSON.parse(String(options?.body))).toMatchObject({
      textbookId: 'geometry',
      task: '126',
      source: 'number',
    })
    await waitFor(() => {
      expect(window.localStorage.getItem('homework-copilot:generated-solutions-v1')).toContain('∠C = 90°.')
    })

    fireEvent.click(screen.getByRole('button', { name: 'К задачам' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Мои решения' })[0])
    fireEvent.click(screen.getByRole('button', { name: /№ 126/ }))
    expect(screen.getByRole('heading', { name: 'Решение № 126' })).toBeInTheDocument()
  })

  it('sends the actual photograph and opens its generated solution', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        solution: { ...generatedSolution, task: 'photo-test', source: 'photo' },
      }),
    } as Response)
    render(<App />)

    const photo = new File(['actual-photo-bytes'], 'task.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/Добавить фото/), { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: /Списать по фото/ }))

    expect(await screen.findByRole('heading', { name: 'Решение № фото' })).toBeInTheDocument()
    await waitFor(() => {
      const requests = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as {
        source: string
        imageDataUrl?: string
      })
      expect(requests).toContainEqual(expect.objectContaining({
        source: 'photo',
        imageDataUrl: 'data:image/png;base64,YWN0dWFsLXBob3RvLWJ5dGVz',
      }))
    })
  })

  it('shows a provider error instead of an endless processing state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Добавь фотографию задания' }),
    } as Response)
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    fireEvent.click(screen.getByRole('button', { name: /^Списать/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Добавь фотографию задания')
    expect(screen.getByRole('heading', { name: 'Не получилось решить задачу' })).toBeInTheDocument()
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
    expect(screen.getAllByRole('button', { name: 'Включить светлую тему' })).toHaveLength(2)
  })

  it('shows a coming-soon placeholder for unfinished sidebar sections', () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Мои решения' })[0])
    expect(screen.getByRole('heading', { name: 'Скоро' })).toBeInTheDocument()
    expect(screen.getByText('Этот раздел появится позже.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Списать задачу' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Главная' })[0])
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  it('opens an editable schedule and saves manual changes', async () => {
    render(<App />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Расписание' })[0])
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
