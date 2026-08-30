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
  // Условие всегда даёт ученик: сервис никогда не придумывает его сам.
  // Кнопка не гаснет на пустой форме: по погасшей всё равно жмут, ничего
  // не происходит и почему — не сказано. Вместо этого форма говорит, чего
  // не хватает, и возвращает курсор в поле.
  it('не отправляет задачу без условия и без фото, а объясняет причину', () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    const submit = screen.getByRole('button', { name: /Решить/ })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(screen.getByRole('alert')).toHaveTextContent('Впиши условие или приложи фото')
    expect(screen.getByRole('textbox', { name: 'Условие задачи' })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отправляет вписанное условие и не выдумывает источник', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
      target: { value: 'Диагонали ромба равны 10 см и 24 см. Найдите сторону ромба.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Решить/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request).toMatchObject({
      source: 'text',
      condition: 'Диагонали ромба равны 10 см и 24 см. Найдите сторону ромба.',
    })
    expect(request.sourceUrl).toBeUndefined()
    expect(request.imageDataUrl).toBeUndefined()
  })

  it('передаёт выбранные предмет и класс', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), {
      target: { value: 'Определите массовую долю кислорода в оксиде меди CuO.' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Химия' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Класс' }), { target: { value: '8 класс' } })
    fireEvent.click(screen.getByRole('button', { name: /Решить/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request).toMatchObject({ subject: 'Химия', grade: '8 класс' })
  })

  it('keeps unreleased CDZ content behind a coming-soon route', () => {
    window.history.replaceState({}, '', '/cdz')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Раздел пока закрыт' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Задача № 2 · 5 ₽' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться на главную' }))
    expect(window.location.pathname).toBe('/app')
    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
  })

  // Витрина и приложение — разные адреса. `/` встречает нового посетителя,
  // рабочая главная живёт на `/app`, а старый `/main` продолжает работать.
  it('показывает витрину на корне и уводит в приложение по `/app`', () => {
    window.history.replaceState({}, '', '/')
    render(<App />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Сфоткал.')
    expect(screen.queryByRole('heading', { name: 'Списать задачу' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Решить задачу/ })[0]).toHaveAttribute('href', '/app')
  })

  it('оставляет прежний адрес `/main` рабочим', () => {
    window.history.replaceState({}, '', '/main')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Списать задачу' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app')
  })

  it('отправляет фото без распознавания в браузере', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    const file = new File(['photo-bytes'], 'task.png', { type: 'image/png' })
    fireEvent.change(document.querySelector<HTMLInputElement>('#task-photo')!, { target: { files: [file] } })

    expect(await screen.findByRole('img', { name: 'Приложенное фото задачи' })).toBeInTheDocument()
    expect(screen.queryByText(/распознал/i)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Решить/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request.source).toBe('photo')
    expect(request.imageDataUrl).toMatch(/^data:image\/(?:png|jpeg);base64,/)
  })

})
