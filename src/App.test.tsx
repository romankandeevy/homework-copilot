import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { HomeworkSolution, SolveHomeworkRequest } from './lib/homeworkContract'
import { normalizeTaskCondition } from './textbooks/taskCatalog'

function mockGeneratedSolution(request: SolveHomeworkRequest): HomeworkSolution {
  const condition = request.condition ?? 'По фотографии найдите угол треугольника.'
  return {
    textbookId: request.textbookId,
    task: request.task,
    source: request.source,
    textbookEdition: request.edition,
    sourceUrl: request.sourceUrl ?? '/photo',
    ...(request.sourcePage ? { sourcePage: request.sourcePage } : {}),
    conditionNormalized: normalizeTaskCondition(condition),
    subject: request.subject,
    textbookTitle: request.textbookTitle,
    condition,
    given: ['A, B, C — точки задачи.'],
    goal: { title: 'Найти', text: 'ответ.' },
    steps: ['Выполняем построение по условию.', 'Получаем ответ.'],
    answer: 'Готово.',
    diagram: { kind: 'three-point-lines', description: 'Точки A, B и C соединены прямыми.', vertices: ['A', 'B', 'C'] },
    sourceVerified: true,
    createdAt: '2026-08-25T12:00:00.000Z',
  }
}

function installSuccessfulSolver() {
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body)) as SolveHomeworkRequest
    return {
      ok: true,
      json: async () => ({ solution: mockGeneratedSolution(request) }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Homework Copilot task flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/main')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows task 2 exactly, then waits for confirmation before the request', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    expect(screen.getByText('Условие задачи № 2')).toBeInTheDocument()
    expect(screen.getByText('Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?')).toBeInTheDocument()
    expect(screen.getByText(/PDF учебника.*14-е издание, Просвещение, 2023, стр. 9/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    expect(screen.getByRole('button', { name: 'Да, это моя задача' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Да, это моя задача' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request).toMatchObject({
      task: '2',
      condition: 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
      sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
      sourcePage: 9,
    })
  })

  it('does not offer a generated condition for an unknown number', () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    expect(screen.queryByText(/Условие задачи №/)).not.toBeInTheDocument()
    expect(screen.getByText('Точного условия № 126 в выбранном издании пока нет. Решение не будет придумано по одному номеру.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить условие' })).toBeDisabled()
  })

  it('lets the student reject a found condition without creating a request', () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    fireEvent.click(screen.getByRole('button', { name: 'Условие неверное / выбрать другое' }))

    expect(screen.getByText('Выбери другой номер и сверь его с учебником.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not promote an unverified number as a textbook task', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Номер задачи' })

    fireEvent.change(input, { target: { value: '124' } })
    expect(screen.queryByText('Условие задачи № 124')).not.toBeInTheDocument()
    expect(screen.getByText('Точного условия № 124 в выбранном издании пока нет. Решение не будет придумано по одному номеру.')).toBeInTheDocument()
  })

  it('opens the approved notebook solution and returns to the home screen', async () => {
    installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, это моя задача' }))

    expect(await screen.findByRole('heading', { name: 'Решение № 2' })).toBeInTheDocument()
    expect(screen.getByText('№ 2', { selector: '.notebook-number' })).toBeInTheDocument()
    fireEvent.click(document.querySelector<HTMLButtonElement>('.route-secondary-action')!)
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  it('shows a no-charge error if a confirmed request is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Точное условие не прошло проверку' }),
    })))
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, это моя задача' }))

    expect(await screen.findByRole('heading', { name: 'Не получилось решить задачу' })).toBeInTheDocument()
    expect(screen.getByText('Точное условие не прошло проверку')).toBeInTheDocument()
    expect(screen.getByText('Деньги за неготовое решение не списаны.')).toBeInTheDocument()
  })

  it('sends selected textbook tasks to confirmation instead of charging a cart', () => {
    window.history.replaceState({}, '', '/cdz')
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Задача № 2 · 5 ₽' }))
    expect(screen.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))

    expect(window.location.pathname).toBe('/main')
    expect(screen.getByText('Условие задачи № 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Оплатить/ })).not.toBeInTheDocument()
  })

  it('keeps the task field numeric and limited to four digits', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    fireEvent.change(input, { target: { value: '99999' } })
    expect(input).toHaveValue('9999')
  })
})
