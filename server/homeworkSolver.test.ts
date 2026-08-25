import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import { findVerifiedTextbookTask } from '../src/textbooks/taskCatalog.ts'
import { handleHomeworkSolverRequest, normalizeKieSolution, solveWithKie } from './homeworkSolver.ts'

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>()
  return { ...actual, createClient: vi.fn(actual.createClient) }
})

const verifiedTask = findVerifiedTextbookTask('geometry', '14-е издание, Просвещение, 2023', '2')
if (!verifiedTask) throw new Error('Verified geometry task #2 is required for solver tests')

const task: SolveHomeworkRequest = {
  textbookId: 'geometry',
  task: '2',
  source: 'number',
  subject: 'Геометрия',
  grade: '8 класс',
  textbookTitle: 'Геометрия. 7-9 классы',
  authors: 'Л. С. Атанасян, В. Ф. Бутузов, С. Б. Кадомцев, Э. Г. Позняк, И. И. Юдина',
  edition: verifiedTask.edition,
  sourceUrl: verifiedTask.sourceUrl,
  sourcePage: verifiedTask.sourcePage,
  condition: verifiedTask.condition,
  idempotencyKey: 'solution-test-geometry-2',
}

const photoTask: SolveHomeworkRequest = {
  ...task,
  task: 'photo-example',
  source: 'photo',
  condition: undefined,
  sourcePage: undefined,
  idempotencyKey: 'solution-test-photo-example',
  imageDataUrl: 'data:image/png;base64,cGhvdG8=',
}

const providerSolution = {
  condition: 'В треугольнике ABC ∠A = 40°, ∠B = 50°. Найдите ∠C.',
  given: ['△ABC', '∠A = 40°', '∠B = 50°'],
  goal: { title: 'Найти', text: '∠C.' },
  steps: ['∠A + ∠B + ∠C = 180°.', '∠C = 90°.'],
  answer: '90°.',
  diagram: {
    kind: 'right-triangle',
    description: 'Прямоугольный треугольник ABC.',
    vertices: ['A', 'B', 'C'],
    rightAngleAt: 'C',
  },
  sourceVerified: true,
}

function providerResponse(content = providerSolution) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  } as Response
}

function createHttp(method: string, body?: unknown) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  request.method = method
  request.headers = {}
  const responseBody: { value?: string } = {}
  const headers = new Map<string, string>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name, value)
      return this
    },
    end(value?: string) {
      responseBody.value = value
      return this
    },
  } as unknown as ServerResponse

  return {
    request,
    response,
    headers,
    body: () => JSON.parse(responseBody.value ?? '{}') as Record<string, unknown>,
  }
}

describe('homework solver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps a verified photo answer grounded and adds its source identity', () => {
    expect(normalizeKieSolution(providerSolution, photoTask, 'student-1')).toMatchObject({
      textbookId: 'geometry',
      task: 'photo-example',
      sourceUrl: verifiedTask.sourceUrl,
      ownerId: 'student-1',
      answer: '90°.',
      diagram: { kind: 'right-triangle', vertices: ['A', 'B', 'C'] },
    })
    expect(() => normalizeKieSolution({ ...providerSolution, sourceVerified: false }, photoTask))
      .toThrow('Добавь фотографию задания')
    expect(() => normalizeKieSolution(providerSolution, { ...photoTask, condition: 'Другое условие.' }))
      .toThrow('Решение вернуло другое условие')
  })

  it('restores a semantic figure when a grounded photo response omits it', () => {
    const solution = normalizeKieSolution({
      ...providerSolution,
      condition: 'В равнобедренном треугольнике ABC найдите основание.',
      goal: { title: 'Найти', text: 'Найти AC.' },
      diagram: { kind: 'none', description: '', vertices: [] },
    }, photoTask)
    expect(solution.goal.text).toBe('AC.')
    expect(solution.diagram).toMatchObject({ kind: 'isosceles-triangle', vertices: ['A', 'B', 'C'] })

    const intersecting = normalizeKieSolution({
      ...providerSolution,
      condition: 'Отрезки AB и CD пересекаются в точке O.',
      diagram: { kind: 'none', description: '', vertices: [] },
    }, photoTask)
    expect(intersecting.diagram).toMatchObject({ kind: 'intersecting-segments', vertices: ['A', 'B', 'C', 'D', 'O'] })
  })

  it('returns the confirmed textbook task without asking a provider to invent it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await solveWithKie(task, { fetchImpl: fetchMock })
    expect(result).toMatchObject({
      task: '2',
      condition: verifiedTask.condition,
      answer: '3 прямые.',
      diagram: { kind: 'three-point-lines', vertices: ['A', 'B', 'C'] },
      sourceVerified: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps isosceles, right-triangle and parallel-line diagram cases tied to their confirmed conditions', () => {
    const cases = [
      ['isosceles', 'В равнобедренном треугольнике ABC проведена биссектриса.', { kind: 'median-triangle', description: 'Равнобедренный треугольник ABC с биссектрисой.', vertices: ['A', 'B', 'C'], auxiliaryKind: 'bisector', auxiliaryLabel: 'M' }],
      ['right', 'В прямоугольном треугольнике ABC угол C прямой.', { kind: 'right-triangle', description: 'Прямоугольный треугольник ABC.', vertices: ['A', 'B', 'C'], rightAngleAt: 'C' }],
      ['parallel', 'В треугольнике ABC прямая p параллельна AB.', { kind: 'parallel-line-triangle', description: 'Треугольник ABC и параллельная прямая p.', vertices: ['A', 'B', 'C'], parallelTo: 'AB' }],
    ] as const

    for (const [name, condition, diagram] of cases) {
      const solution = normalizeKieSolution({
        ...providerSolution,
        condition,
        diagram,
      }, {
        ...photoTask,
        task: `diagram-fixture-${name}`,
        condition,
      })
      expect(solution).toMatchObject({ condition, diagram: { kind: diagram.kind } })
    }
  })

  it('sends photo bytes to the multimodal provider with a strict answer schema', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse())
    await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })
    const [, options] = fetchMock.mock.calls[0]
    const payload = JSON.parse(String(options?.body)) as {
      messages: { content: unknown }[]
      response_format?: { type: string }
      tools?: unknown
    }
    expect(payload.messages[1].content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,cGhvdG8=' } },
    ]))
    expect(payload.response_format?.type).toBe('json_schema')
    expect(payload.tools).toBeUndefined()
  })

  it('reports unavailable and rejected provider keys without exposing a key', async () => {
    await expect(solveWithKie(photoTask, {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('KIE_API_KEY') })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(solveWithKie(photoTask, { apiKey: 'private-value', fetchImpl: fetchMock }))
      .rejects.toMatchObject({ status: 502, message: 'Kie.ai отклонил ключ API. Проверь KIE_API_KEY' })
  })

  it('publishes safe configuration status and CORS only for approved origins', async () => {
    const http = createHttp('GET')
    await handleHomeworkSolverRequest(http.request, http.response, { apiKey: 'private-value' })
    expect(http.response.statusCode).toBe(200)
    expect(http.body()).toEqual({ provider: 'kie.ai', model: 'gemini-2.5-flash', configured: true })
    expect(JSON.stringify(http.body())).not.toContain('private-value')

    const preflight = createHttp('OPTIONS')
    preflight.request.headers.origin = 'https://www.homeworkcopilot.ru'
    await handleHomeworkSolverRequest(preflight.request, preflight.response, { apiKey: 'private-value' })
    expect(preflight.response.statusCode).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://www.homeworkcopilot.ru')

    const untrusted = createHttp('OPTIONS')
    untrusted.request.headers.origin = 'https://untrusted.example'
    await handleHomeworkSolverRequest(untrusted.request, untrusted.response, { apiKey: 'private-value' })
    expect(untrusted.response.statusCode).toBe(403)
  })

  it('rejects malformed or unconfirmed numbered tasks before a provider or payment', async () => {
    const invalid = createHttp('POST', { ...task, task: '10000' })
    await handleHomeworkSolverRequest(invalid.request, invalid.response, { apiKey: 'test-key' })
    expect(invalid.response.statusCode).toBe(400)
    expect(invalid.body().error).toContain('от 1 до 4 цифр')

    const unconfirmed = createHttp('POST', { ...task, condition: 'Придуманное условие.' })
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(unconfirmed.request, unconfirmed.response, { apiKey: 'test-key', fetchImpl: fetchMock })
    expect(unconfirmed.response.statusCode).toBe(422)
    expect(unconfirmed.body().error).toContain('не найдено')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves task 2 with its exact condition when no provider key is configured', async () => {
    const http = createHttp('POST', task)
    await handleHomeworkSolverRequest(http.request, http.response, {})
    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({
      task: '2',
      condition: verifiedTask.condition,
      answer: '3 прямые.',
    })
  })

  it('stores a confirmed answer and payment atomically after balance validation', async () => {
    const saved = await solveWithKie(task, {}, 'student-1')
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: saved, error: null })
    const single = vi.fn().mockResolvedValue({ data: { balance: 20 }, error: null })
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(() => ({ select })),
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['complete_homework_solution', expect.objectContaining({
      p_idempotency_key: task.idempotencyKey,
      p_source: 'number',
      p_task: '2',
      p_textbook_id: 'geometry',
      p_edition: verifiedTask.edition,
      p_source_url: verifiedTask.sourceUrl,
      p_condition: verifiedTask.condition,
    })])
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_idempotency_key: task.idempotencyKey,
      p_solution: { ownerId: 'student-1', answer: '3 прямые.' },
    })
  })

  it('returns an existing paid answer without calling the provider again', async () => {
    const saved = await solveWithKie(task, {}, 'student-1')
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null })
    const from = vi.fn()
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from,
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
    })
    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({ task: '2', answer: '3 прямые.' })
    expect(rpc).toHaveBeenCalledOnce()
    expect(from).not.toHaveBeenCalled()
  })

  it('checks balance before processing a new confirmed solution', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const single = vi.fn().mockResolvedValue({ data: { balance: 3 }, error: null })
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(() => ({ select })),
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
    })
    expect(http.response.statusCode).toBe(402)
    expect(http.body().error).toBe('На балансе меньше 5 ₽')
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('returns an actionable 503 for a photo when the provider is not configured', async () => {
    const http = createHttp('POST', photoTask)
    await handleHomeworkSolverRequest(http.request, http.response, {})
    expect(http.response.statusCode).toBe(503)
    expect(http.body().error).toContain('KIE_API_KEY')
  })
})
