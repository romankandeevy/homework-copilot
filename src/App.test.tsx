import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { HomeworkSolution, SolveHomeworkRequest } from './lib/homeworkContract'
import { normalizeTaskCondition } from './textbooks/taskCatalog'


function mockGeneratedSolution(request: SolveHomeworkRequest): HomeworkSolution {
  const condition = request.condition ?? 'По фотографии найдите угол треугольника.'
  return {
    engineVersion: 2,
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
    taskType: 'mixed',
    quality: { diagramRequired: true, reviewPassed: true, symbolicShare: 0.8 },
    verification: {
      version: 1,
      author: {
        taskGoal: 'Получить ответ по условию.',
        diagramRequired: true,
        diagramReason: 'Условие содержит геометрическое построение.',
        requiredElements: ['точки A, B, C', 'прямые между точками'],
        notebookFormat: 'Чертёж и короткая символическая строка.',
        selfChecks: ['Условие совпадает.', 'Чертёж построен.', 'Ответ проверен.'],
      },
      authorIssues: [],
      reviewer: {
        taskGoal: 'Получить ответ по условию.',
        diagramRequired: true,
        diagramReason: 'Условие содержит геометрическое построение.',
        requiredElements: ['точки A, B, C', 'прямые между точками'],
        notebookFormat: 'Чертёж и короткая символическая строка.',
        selfChecks: ['Условие совпадает.', 'Чертёж построен.', 'Ответ проверен.'],
      },
      reviewerApproved: true,
      reviewerIssues: [],
      checks: [
        { label: 'Источник', passed: true, note: 'Условие совпадает' },
        { label: 'Независимый редактор', passed: true, note: 'Одобрено без замечаний' },
      ],
    },
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
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/main')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // Индекса задач больше нет: условие всегда даёт ученик. Проверяем главное
  // свойство — сервис никогда не придумывает условие сам.
  it('просит вписать условие вместо того, чтобы придумать его', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: /Номер задачи/ }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ввести условие' }))

    expect(await screen.findByRole('textbox', { name: /Условие задачи/ })).toBeInTheDocument()
    expect(screen.queryByText(/Отметьте три точки/)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отправляет вписанное условие и не выдумывает источник', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: /Номер задачи/ }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ввести условие' }))
    const field = await screen.findByRole('textbox', { name: /Условие задачи/ })
    fireEvent.change(field, { target: { value: 'Диагонали ромба равны 10 см и 24 см. Найдите сторону ромба.' } })
    fireEvent.click(screen.getByRole('button', { name: /Решить за/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request).toMatchObject({
      source: 'text',
      condition: 'Диагонали ромба равны 10 см и 24 см. Найдите сторону ромба.',
    })
    expect(request.sourceUrl).toBeUndefined()
    expect(request.imageDataUrl).toBeUndefined()
  })

  it('keeps unreleased CDZ content behind a coming-soon route', () => {
    window.history.replaceState({}, '', '/cdz')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Раздел пока закрыт' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 2 · 5 ₽' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться на главную' }))
    expect(window.location.pathname).toBe('/main')
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  it('keeps the task field numeric and limited to four digits', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: /Номер задачи/ })
    fireEvent.change(input, { target: { value: '99999' } })
    expect(input).toHaveValue('9999')
  })

  it('confirms the attached photo without browser OCR and sends only the image', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    const file = new File(['photo-bytes'], 'task.png', { type: 'image/png' })
    fireEvent.change(document.querySelector<HTMLInputElement>('#task-photo')!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить с фото' }))

    expect(await screen.findByRole('img', { name: 'Прикреплённое фото задачи' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /условие/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/распознал/i)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Решить по этому фото' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request.source).toBe('photo')
    expect(request.condition).toBeUndefined()
    expect(request.imageDataUrl).toMatch(/^data:image\/png;base64,/)
  })
})
