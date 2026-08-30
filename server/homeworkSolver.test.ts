import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import { findVerifiedTextbookTask, normalizeTaskCondition } from '../src/textbooks/taskCatalog.ts'
import { handleHomeworkSolverRequest, solveWithKie } from './homeworkSolver.ts'

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
  imageDataUrl: 'data:image/jpeg;base64,c291cmNl',
  idempotencyKey: 'solution-test-geometry-2',
}

const taskThreeCondition = 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'
const taskThree: SolveHomeworkRequest = {
  ...task,
  task: '3',
  condition: taskThreeCondition,
  sourcePage: 9,
  idempotencyKey: 'solution-test-geometry-3',
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

function providerResponse(content: unknown = providerSolution) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  } as Response
}

const emptyDiagramFields = {
  apexAngle: '',
  auxiliaryKind: '',
  auxiliaryLabel: '',
  rightAngleAt: '',
  parallelTo: '',
  exteriorAngle: '',
}

const taskThreeDecisions = {
  taskGoal: 'Показать все варианты числа точек пересечения трёх прямых.',
  diagramRequired: true,
  diagramReason: 'Нужно изобразить два возможных расположения прямых.',
  requiredElements: ['три попарно пересекающиеся прямые', 'три разные точки пересечения', 'одна общая точка'],
  notebookFormat: 'Два чертежа и две короткие символические строки.',
  selfChecks: ['Показаны оба случая.', 'Все прямые попарно пересекаются.', 'Ответ содержит 1 и 3 точки.'],
}

const photoDecisions = {
  taskGoal: 'Найти угол C.',
  diagramRequired: true,
  diagramReason: 'Условие относится к треугольнику ABC.',
  requiredElements: ['△ABC', '∠C = 90°'],
  notebookFormat: 'Краткая формула суммы углов и ответ.',
  selfChecks: ['Условие прочитано с изображения.', 'Сумма углов равна 180°.', 'Ответ содержит единицу измерения угла.'],
}

const taskThreeDraft = {
  condition: taskThreeCondition,
  taskType: 'mixed',
  diagramRequired: true,
  decisions: taskThreeDecisions,
  sourceVerified: true,
  given: ['a, b, c — прямые'],
  goal: { title: 'Найти', text: 'n(точек пересечения)' },
  steps: [
    'a ∩ b = A; b ∩ c = B; a ∩ c = C ⇒ n = 3.',
    'a ∩ b ∩ c = O ⇒ n = 1.',
  ],
  answer: '1 или 3 точки',
  diagram: {
    kind: 'construction',
    description: 'Три попарно пересекающиеся прямые.',
    vertices: ['A', 'B', 'C'],
    ...emptyDiagramFields,
    scene: {
      points: [
        { id: 'A', label: 'A', x: 20, y: 80, visible: true },
        { id: 'B', label: 'B', x: 50, y: 20, visible: true },
        { id: 'C', label: 'C', x: 80, y: 80, visible: true },
      ],
      objects: [
        { kind: 'line', points: ['A', 'B'], label: 'a', auxiliary: false },
        { kind: 'line', points: ['B', 'C'], label: 'b', auxiliary: false },
        { kind: 'line', points: ['C', 'A'], label: 'c', auxiliary: false },
      ],
      marks: [],
      constraints: [{ kind: 'not-collinear', points: ['A', 'B', 'C'] }],
    },
  },
}

const photoDraft = {
  condition: providerSolution.condition,
  taskType: 'calculation',
  diagramRequired: true,
  decisions: photoDecisions,
  sourceVerified: true,
  given: providerSolution.given,
  goal: { title: 'Найти', text: '∠C' },
  steps: providerSolution.steps,
  answer: providerSolution.answer,
  diagram: {
    kind: 'construction',
    description: 'Прямоугольный треугольник ABC.',
    vertices: ['A', 'B', 'C'],
    ...emptyDiagramFields,
    scene: {
      points: [
        { id: 'A', label: 'A', x: 15, y: 85, visible: true },
        { id: 'B', label: 'B', x: 85, y: 15, visible: true },
        { id: 'C', label: 'C', x: 85, y: 85, visible: true },
      ],
      objects: [{ kind: 'polygon', points: ['A', 'B', 'C'], label: '', auxiliary: false }],
      marks: [{ kind: 'right-angle', points: ['A', 'C', 'B'], label: '' }],
      constraints: [{ kind: 'perpendicular', points: ['A', 'C', 'B', 'C'] }],
    },
  },
}

function reviewedResponses(draft: unknown) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(providerResponse(draft))
    .mockResolvedValueOnce(providerResponse({ approved: true, issues: [], solution: draft }))
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

  it('returns the confirmed textbook task without asking a provider to invent it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await solveWithKie(task, { fetchImpl: fetchMock })
    expect(result).toMatchObject({
      task: '2',
      condition: verifiedTask.condition,
      conditionNormalized: 'отметьте три точки a,b и c,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?',
      answer: '3 прямые',
      diagram: { kind: 'three-point-extended-lines', vertices: ['A', 'B', 'C'] },
      sourceVerified: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('solves a database-indexed number from its confirmed condition without web search', async () => {
    const fetchMock = reviewedResponses(taskThreeDraft)
    const http = createHttp('POST', taskThree)
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      taskLookup: async () => ({
        condition: taskThreeCondition,
        conditionNormalized: normalizeTaskCondition(taskThreeCondition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 9,
        hasDiagram: false,
      }),
    })

    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({
      task: '3',
      condition: taskThreeCondition,
      answer: '1 или 3 точки',
      diagram: { kind: 'construction', vertices: ['A', 'B', 'C'] },
      verification: {
        author: taskThreeDecisions,
        reviewer: taskThreeDecisions,
        reviewerApproved: true,
        checks: expect.arrayContaining([
          expect.objectContaining({ label: 'Источник', passed: true }),
          expect.objectContaining({ label: 'Независимый редактор', passed: true }),
        ]),
      },
    })
    const requestPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: unknown; response_format?: { type: string } }
    expect(requestPayload.tools).toBeUndefined()
    expect(requestPayload.response_format?.type).toBe('json_schema')
  })

  it('requires the indexed source drawing when the task references a figure', async () => {
    const condition = 'На рисунке 43 изображены лучи с общим началом O.'
    const http = createHttp('POST', { ...task, task: '50', condition, sourcePage: 23, imageDataUrl: undefined })
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      taskLookup: async () => ({
        condition,
        conditionNormalized: normalizeTaskCondition(condition),
        sourceUrl: verifiedTask.sourceUrl,
        sourcePage: 23,
        hasDiagram: true,
      }),
    })

    expect(http.response.statusCode).toBe(400)
    expect(http.body().error).toContain('чертёж в учебнике')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the photo itself to the multimodal provider without an OCR condition', async () => {
    const fetchMock = reviewedResponses(photoDraft)
    await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })
    const [, options] = fetchMock.mock.calls[0]
    const payload = JSON.parse(String(options?.body)) as {
      messages: { content: unknown }[]
      response_format?: { type: string }
      tools?: unknown
    }
    expect(payload.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,cGhvdG8=' } },
    ])
    expect(payload.response_format?.type).toBe('json_schema')
    expect(payload.tools).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a reviewed answer for a different condition', async () => {
    const unrelated = {
      ...photoDraft,
      condition: 'Вычислите площадь круга радиуса 10 см.',
    }
    await expect(solveWithKie({ ...photoTask, condition: providerSolution.condition }, {
      apiKey: 'secret-test-key',
      fetchImpl: reviewedResponses(unrelated),
    })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('не совпадает с приложенным заданием'),
    })
  })

  it('does not abort a model stage with an application timeout', async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const responses = [photoDraft, { approved: true, issues: [], solution: photoDraft }]
    const fetchMock: typeof fetch = async (_input, init) => {
      signals.push(init?.signal)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await solveWithKie(photoTask, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(signals).toEqual([undefined, undefined])
  })

  it('normalizes provider point identifiers together with every reference', async () => {
    const scene = photoDraft.diagram.scene
    const lowercase = {
      ...photoDraft,
      diagram: {
        ...photoDraft.diagram,
        scene: {
          ...scene,
          points: scene.points.map((point) => ({ ...point, id: point.id.toLocaleLowerCase('ru-RU') })),
          objects: scene.objects.map((object) => ({ ...object, points: object.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
          marks: scene.marks.map((mark) => ({ ...mark, points: mark.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
          constraints: scene.constraints.map((constraint) => ({ ...constraint, points: constraint.points.map((id) => id.toLocaleLowerCase('ru-RU')) })),
        },
      },
    }
    const result = await solveWithKie(photoTask, {
      apiKey: 'secret-test-key',
      fetchImpl: reviewedResponses(lowercase),
    })
    expect(result.diagram.scene?.points.map((point) => point.id)).toEqual(['A', 'B', 'C'])
    expect(result.diagram.scene?.constraints).toContainEqual({ kind: 'perpendicular', points: ['A', 'C', 'B', 'C'] })
  })

  it('reports unavailable and rejected provider keys without exposing a key', async () => {
    await expect(solveWithKie(photoTask, {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining('KIE_API_KEY') })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(solveWithKie(photoTask, { apiKey: 'private-value', fetchImpl: fetchMock }))
      .rejects.toMatchObject({ status: 502, message: 'Провайдер отклонил ключ API' })
  })

  it('publishes safe configuration status and CORS only for approved origins', async () => {
    const http = createHttp('GET')
    await handleHomeworkSolverRequest(http.request, http.response, { apiKey: 'private-value' })
    expect(http.response.statusCode).toBe(200)
    expect(http.body()).toEqual({ provider: 'kie.ai', model: 'gemini-3-pro', configured: true, engineVersion: 2 })
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
      answer: '3 прямые',
    })
  })

  it('stores a confirmed answer and payment atomically after balance validation', async () => {
    const saved = await solveWithKie(task, {}, 'student-1')
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { reserved: true, balance: 15, price: 5 }, error: null })
      .mockResolvedValueOnce({ data: saved, error: null })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
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
    expect(rpc).toHaveBeenCalledTimes(3)
    // Резерв уходит ДО вызова модели, а не после него.
    expect(rpc.mock.calls[1]).toEqual(['reserve_solution_credit', expect.objectContaining({
      p_idempotency_key: task.idempotencyKey,
      p_task_number: 2,
      p_textbook_id: 'geometry',
      p_source: 'number',
    })])
    expect(rpc.mock.calls[0]).toEqual(['complete_homework_solution', expect.objectContaining({
      p_idempotency_key: task.idempotencyKey,
      p_source: 'number',
      p_task: '2',
      p_textbook_id: 'geometry',
      p_edition: verifiedTask.edition,
      p_source_url: verifiedTask.sourceUrl,
      p_condition: verifiedTask.condition,
    })])
    expect(rpc.mock.calls[2][1]).toMatchObject({
      p_idempotency_key: task.idempotencyKey,
      p_solution: { ownerId: 'student-1', answer: '3 прямые' },
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
    expect(http.body().solution).toMatchObject({
      task: '2',
      answer: '3 прямые',
      diagram: { kind: 'three-point-extended-lines', vertices: ['A', 'B', 'C'] },
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses to call the model when the reservation cannot be paid', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'insufficient balance' } })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
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
    expect(http.response.statusCode).toBe(402)
    expect(http.body().error).toBe('На балансе меньше 5 ₽')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][0]).toBe('reserve_solution_credit')
  })

  it('returns the reservation to the account when the model fails', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { reserved: true, balance: 15, price: 5 }, error: null })
      .mockResolvedValue({ data: { refunded: true, balance: 20 }, error: null })
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from: vi.fn(),
      rpc,
    } as never)

    // Провайдер не настроен: solveWithKie падает сразу после резерва.
    const http = createHttp('POST', photoTask)
    http.request.headers.authorization = 'Bearer test-session'
    await handleHomeworkSolverRequest(http.request, http.response, {
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
    })

    expect(http.response.statusCode).toBe(503)
    const refundCall = rpc.mock.calls.find((call) => call[0] === 'refund_solution_credit')
    expect(refundCall).toBeDefined()
    expect(refundCall?.[1]).toMatchObject({ p_idempotency_key: photoTask.idempotencyKey })
  })

  it('returns an actionable 503 for a photo when the provider is not configured', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const http = createHttp('POST', photoTask)
    await handleHomeworkSolverRequest(http.request, http.response, {})
    expect(http.response.statusCode).toBe(503)
    expect(http.body().error).toContain('KIE_API_KEY')

    const event = errorLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === 'homework_solve_failed')
    expect(event).toMatchObject({
      task: photoTask.task,
      source: 'photo',
      stage: 'generate',
      status: 503,
    })
    expect(JSON.stringify(event)).not.toContain(photoTask.condition)
    errorLog.mockRestore()
  })
})
