import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { HomeworkSolution, SolveHomeworkRequest } from './lib/homeworkContract'
import { normalizeTaskCondition } from './textbooks/taskCatalog'
import { renderTextbookTaskEvidenceImage } from './textbooks/textbookTaskSource'

vi.mock('./textbooks/textbookTaskSource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./textbooks/textbookTaskSource')>()
  return {
    ...actual,
    renderTextbookTaskEvidenceImage: vi.fn(async () => 'data:image/jpeg;base64,c291cmNl'),
  }
})

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

  it('shows task 2 exactly, then waits for confirmation before the request', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    expect(screen.queryByText('Условие задачи № 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    expect(await screen.findByText('Условие задачи № 2')).toBeInTheDocument()
    expect(screen.getByText('Отметьте три точки A, B и C, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?')).toBeInTheDocument()
    expect(screen.getByText(/Источник: PDF учебника.*стр. 9\. Издание учебника: 14-е издание, Просвещение, 2023/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Три точки A, B и C/ })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Условие верное' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выбрать другой номер' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Проверить условие' })).not.toBeInTheDocument()
    expect(screen.queryByText('Нашли задачу № 2')).not.toBeInTheDocument()
    expect(screen.getAllByText('Отметьте три точки A, B и C, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Условие верное' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(request).toMatchObject({
      task: '2',
      condition: 'Отметьте три точки A, B и C, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
      sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
      sourcePage: 9,
      imageDataUrl: 'data:image/jpeg;base64,c291cmNl',
    })
  })

  it('does not offer a generated condition for an unknown number', async () => {
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '126' } })
    expect(screen.queryByText(/Условие задачи №/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    expect(await screen.findByText('Такого номера нет в выбранном издании. Проверь номер или добавь фото задачи.')).toBeInTheDocument()
  })

  it('lets the student reject a found condition without creating a request', async () => {
    const fetchMock = installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    await screen.findByText('Условие задачи № 2')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другой номер' }))

    expect(screen.getByText('Выбери другой номер и сверь его с учебником.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not promote an unverified number as a textbook task', async () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Номер задачи' })

    fireEvent.change(input, { target: { value: '124' } })
    expect(screen.queryByText('Условие задачи № 124')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    expect(await screen.findByText('Такого номера нет в выбранном издании. Проверь номер или добавь фото задачи.')).toBeInTheDocument()
  })

  it('opens the approved notebook solution and returns to the home screen', async () => {
    installSuccessfulSolver()
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    await screen.findByText('Условие задачи № 2')
    fireEvent.click(screen.getByRole('button', { name: 'Условие верное' }))

    expect(await screen.findByRole('heading', { name: 'Решение № 2' })).toBeInTheDocument()
    expect(screen.getByText('№ 2', { selector: '.notebook-number' })).toBeInTheDocument()
    expect(screen.getByText('Итоговые ответы движка')).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
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
    await screen.findByText('Условие задачи № 2')
    fireEvent.click(screen.getByRole('button', { name: 'Условие верное' }))

    expect(await screen.findByRole('heading', { name: 'Не получилось решить задачу' })).toBeInTheDocument()
    expect(screen.getByText('Точное условие не прошло проверку')).toBeInTheDocument()
    expect(screen.getByText('Деньги за неготовое решение не списаны.')).toBeInTheDocument()
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

  it('hides stale asset filenames behind a recovery message', async () => {
    vi.mocked(renderTextbookTaskEvidenceImage).mockRejectedValueOnce(
      new TypeError('Failed to fetch dynamically imported module: /assets/pdf-old.js'),
    )
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Номер задачи' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить условие' }))
    await screen.findByText('Условие задачи № 2')
    fireEvent.click(screen.getByRole('button', { name: 'Условие верное' }))

    expect(await screen.findByText('Сайт обновился. Перезагрузи страницу и попробуй ещё раз.')).toBeInTheDocument()
    expect(screen.queryByText(/pdf-old\.js/)).not.toBeInTheDocument()
  })

  it('keeps the task field numeric and limited to four digits', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Номер задачи' })
    fireEvent.change(input, { target: { value: '99999' } })
    expect(input).toHaveValue('9999')
  })
})
