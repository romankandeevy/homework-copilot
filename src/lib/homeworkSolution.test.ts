import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generatedSolutionsStorageKey,
  heicUnsupportedMessage,
  isSolverConnectionLoss,
  loadGeneratedSolutions,
  parseStoredHomeworkSolution,
  prepareTaskPhoto,
  requestHomeworkSolution,
  saveGeneratedSolutions,
  serverAcceptLimitFor,
  serverAcceptLimitMs,
  SolutionConnectionLostError,
  SolutionInProgressError,
} from './homeworkSolution'
import type { HomeworkSolution, SolveHomeworkRequest } from './homeworkContract'

const solution: HomeworkSolution = {
  textbookId: 'geometry',
  task: 'photo-test',
  source: 'photo',
  textbookEdition: '14-е издание, Просвещение, 2023',
  sourceUrl: 'photo',
  conditionNormalized: 'найдите стороны подобного треугольника.',
  subject: 'Геометрия',
  textbookTitle: 'Геометрия. 7-9 классы',
  condition: 'Найдите стороны подобного треугольника.',
  given: ['△ABC'],
  goal: { title: 'Найти', text: 'Стороны.' },
  steps: ['k = 1/2.'],
  answer: '4 см, 8 см, 10 см.',
  diagram: { kind: 'triangle', description: 'Треугольник ABC.', vertices: ['A', 'B', 'C'] },
  sourceVerified: true,
  createdAt: '2026-08-25T18:00:00.000Z',
}

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('stored homework solutions', () => {
  it('restores a purchased answer for its current account on another device', () => {
    expect(parseStoredHomeworkSolution({ ...solution, ownerId: 'creator' }, 'buyer')).toEqual({
      ...solution,
      ownerId: 'buyer',
    })
  })

  it('rejects incomplete and malformed stored answers', () => {
    expect(parseStoredHomeworkSolution(null)).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, condition: 42 })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, steps: 'answer' })).toBeNull()
  })

  /* Б11. Лист тетради читает эти поля без защиты: битая запись роняла всё
     приложение. Теперь она просто не показывается. */
  it('не пропускает решение с битыми полями листа', () => {
    expect(parseStoredHomeworkSolution({ ...solution, given: 'AB = 5' })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, given: [1, 2] })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, goal: null })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, goal: { title: 'Найти' } })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, diagram: 'none' })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, diagram: { description: 'без вида' } })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, answer: { text: '5' } })).toBeNull()
    expect(parseStoredHomeworkSolution({ ...solution, steps: ['шаг', 7] })).toBeNull()
  })

  it('дополняет старое решение без ответа и «Дано», а не выбрасывает его', () => {
    const { given: _given, answer: _answer, ...old } = solution
    expect(parseStoredHomeworkSolution(old)).toMatchObject({ given: [], answer: '' })
  })

  /* В11. Решение гостя в браузере живёт не дольше недели. */
  it('забывает решения гостя старше недели, но не решения аккаунта', () => {
    const old = { ...solution, task: 'photo-old', createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }
    const owned = { ...old, task: 'photo-owned', ownerId: 'student-1' }
    const fresh = { ...solution, task: 'photo-fresh', createdAt: new Date().toISOString() }
    window.localStorage.setItem(generatedSolutionsStorageKey, JSON.stringify([old, owned, fresh]))
    expect(loadGeneratedSolutions().map((entry) => entry.task)).toEqual(['photo-owned', 'photo-fresh'])
  })

  it('keeps the browser cache as a fallback without treating corrupt entries as answers', () => {
    // Свежее решение: гостевые старше недели браузер забывает.
    const recent = { ...solution, createdAt: new Date().toISOString() }
    saveGeneratedSolutions([recent])
    expect(loadGeneratedSolutions()).toEqual([recent])

    window.localStorage.setItem(generatedSolutionsStorageKey, JSON.stringify([recent, { task: '999' }]))
    expect(loadGeneratedSolutions()).toEqual([recent])
  })
})

/* Б5. Ответ без метки решателя - не его отказ. */
describe('обрыв связи и отказ решателя', () => {
  const request: SolveHomeworkRequest = {
    textbookId: 'algebra',
    task: 'text-1',
    source: 'text',
    subject: 'Алгебра',
    grade: '8 класс',
    textbookTitle: 'Любой учебник',
    authors: '-',
    edition: 'по фото или тексту',
    condition: 'Решите уравнение 5x = 20.',
    idempotencyKey: 'solution-test-1',
  }

  function response(status: number, body: unknown, solverHeader: boolean) {
    const headers = new Headers(solverHeader ? { 'x-homework-solver': '1' } : {})
    return new Response(JSON.stringify(body), { status, headers })
  }

  it('различает 5xx решателя и 5xx прокси', () => {
    expect(isSolverConnectionLoss({ status: 502, headers: new Headers() })).toBe(true)
    expect(isSolverConnectionLoss({ status: 504, headers: new Headers() })).toBe(true)
    expect(isSolverConnectionLoss({ status: 546, headers: new Headers() })).toBe(true)
    expect(isSolverConnectionLoss({ status: 502, headers: new Headers({ 'x-homework-solver': '1' }) })).toBe(false)
    expect(isSolverConnectionLoss({ status: 409, headers: new Headers() })).toBe(false)
    expect(isSolverConnectionLoss({ status: 200 })).toBe(false)
  })

  it('JSON 502 прокси без метки - обрыв, а не окончательный отказ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(502, { error: 'Сервер решений не ответил' }, false)))
    await expect(requestHomeworkSolution('/api/solve', request)).rejects.toBeInstanceOf(SolutionConnectionLostError)
  })

  it('отказ самого решателя остаётся отказом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(502, { error: 'Решение не прошло проверку' }, true)))
    const failure = requestHomeworkSolution('/api/solve', request)
    await expect(failure).rejects.not.toBeInstanceOf(SolutionConnectionLostError)
    await expect(requestHomeworkSolution('/api/solve', request)).rejects.toThrow('Решение не прошло проверку')
  })

  it('409 «уже решается» - ждать, а не хоронить', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(409, { error: 'Эта задача уже решается', inProgress: true }, true)))
    await expect(requestHomeworkSolution('/api/solve', request)).rejects.toBeInstanceOf(SolutionInProgressError)
  })
})

/* Б6. Сторож приёма растёт с телом запроса. */
describe('срок расписки сервера', () => {
  it('текстовой задаче - полминуты, тяжёлому фото - дольше, но не больше двух минут', () => {
    expect(serverAcceptLimitFor(2_000)).toBeGreaterThanOrEqual(serverAcceptLimitMs)
    expect(serverAcceptLimitFor(2_000)).toBeLessThan(serverAcceptLimitMs + 1_000)
    expect(serverAcceptLimitFor(700_000)).toBe(58_000)
    expect(serverAcceptLimitFor(3_700_000)).toBe(120_000)
  })
})

/* Б11. HEIC, который браузер не читает, не уходит на сервер. */
describe('фото в HEIC', () => {
  it('честно отказывает до отправки, если браузер не декодирует HEIC', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('unsupported') }))
    const file = new File(['heic-bytes'], 'IMG_0001.HEIC', { type: 'image/heic' })
    await expect(prepareTaskPhoto(file)).rejects.toThrow(heicUnsupportedMessage)
  })

  it('без createImageBitmap тоже отказывает, даже маленькому файлу', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const file = new File(['heic-bytes'], 'photo.heif', { type: '' })
    await expect(prepareTaskPhoto(file)).rejects.toThrow(heicUnsupportedMessage)
  })
})
