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

  // Подпись задачи из текста — срез условия. Сервер прогоняет её через trim,
  // и готовое состояние должно строиться из его ответа: клиентский срез,
  // кончавшийся пробелом, открывал заглушку вместо готового решения.
  it('открывает готовое решение с карточки, когда срез условия кончается пробелом', async () => {
    const condition = 'Турист прошёл в первый день 3/8 всего маршрута, а во второй — 40% оставшегося пути. Найди длину маршрута.'
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as SolveHomeworkRequest
      // Сервер триммит подпись задачи — повторяем это в заглушке.
      return {
        ok: true,
        json: async () => ({ solution: mockGeneratedSolution({ ...request, task: request.task.trim() }) }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), { target: { value: condition } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Предмет' }), { target: { value: 'Алгебра' } })
    fireEvent.click(screen.getByRole('button', { name: /Решить/ }))

    // Решение открывается страницей, а не заглушкой «Выбери учебник».
    expect(await screen.findByRole('heading', { name: 'Решение задачи' })).toBeInTheDocument()
    expect(screen.getByText('Готово.')).toBeInTheDocument()
    expect(screen.queryByText('Выбери учебник')).not.toBeInTheDocument()

    // Возврат на главную и открытие с карточки «Решение готово» — тот путь,
    // который был сломан.
    fireEvent.click(screen.getByRole('button', { name: /На главную/ }))
    fireEvent.click(screen.getByRole('button', { name: /Открыть решение/ }))
    expect(await screen.findByRole('heading', { name: 'Решение задачи' })).toBeInTheDocument()
    expect(screen.queryByText('Выбери учебник')).not.toBeInTheDocument()
  })

  // Перезагрузка страницы текстового решения не должна уводить на главную:
  // подпись задачи в адресе — срез условия, а не номер.
  it('восстанавливает текстовое решение по адресу после перезагрузки', async () => {
    const solution = mockGeneratedSolution({
      textbookId: 'algebra',
      task: 'Решите уравнение 5x = 20.',
      source: 'text',
      subject: 'Алгебра',
      grade: '8 класс',
      textbookTitle: 'Любой учебник',
      authors: '—',
      edition: 'по фото или тексту',
      condition: 'Решите уравнение 5x = 20.',
      idempotencyKey: 'restore-test',
    })
    window.localStorage.setItem('homework-copilot:generated-solutions-v1', JSON.stringify([solution]))
    window.history.replaceState({}, '', `/solutions/algebra/${encodeURIComponent(solution.task)}`)
    installSuccessfulSolver()
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Решение задачи' })).toBeInTheDocument()
    expect(screen.getByText('Готово.')).toBeInTheDocument()
  })

  /* Очередь.

     Раньше состояние было одно на всю вкладку: вторая задача затирала первую,
     и отправить её, пока идёт первая, было некуда. */
  it('держит несколько задач сразу: две в работе, третья ждёт очереди', async () => {
    // Решатель, который не отвечает: так задачи остаются в работе.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<App />)

    const conditions = [
      'Решите уравнение x² − 5x + 6 = 0 и укажите больший корень.',
      'Разберите слово «пришкольный» по составу и укажите способ образования.',
      'В треугольнике ABC угол C равен 90°, AC = 6, BC = 8. Найдите AB.',
    ]

    for (const condition of conditions) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), { target: { value: condition } })
      fireEvent.click(screen.getByRole('button', { name: /Решить/ }))
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Условие задачи' })).toHaveValue(''))
    }

    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Решаем задачу' })).toHaveLength(2))
    expect(await screen.findByText(/ждёт очереди/)).toBeInTheDocument()
    // Ни одно условие не потерялось.
    conditions.forEach((condition) => expect(screen.getByText(condition)).toBeInTheDocument())
  })

  /* Неудача.

     «Не получилось решить задачу» без выхода — тупик: условие набрано, фото
     приложено, а повторить нечем. */
  it('после сбоя предлагает повтор и отправляет то же условие заново', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: false,
      json: async () => ({ error: 'Модель перегружена. Попробуй ещё раз' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const condition = 'Найдите массовую долю кислорода в серной кислоте H2SO4.'
    fireEvent.change(screen.getByRole('textbox', { name: 'Условие задачи' }), { target: { value: condition } })
    fireEvent.click(screen.getByRole('button', { name: /Решить/ }))

    expect(await screen.findByRole('heading', { name: 'Решение не дошло' })).toBeInTheDocument()
    expect(screen.getByText('Модель перегружена. Попробуй ещё раз')).toBeInTheDocument()
    expect(screen.getByText('Деньги за неготовое решение не списаны')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Решить ещё раз/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const retried = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as SolveHomeworkRequest
    expect(retried.condition).toBe(condition)
    // Ключ идемпотентности новый: повтор — это новая попытка, а не тот же запрос.
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as SolveHomeworkRequest
    expect(retried.idempotencyKey).not.toBe(first.idempotencyKey)
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
