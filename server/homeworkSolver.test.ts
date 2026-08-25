import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import { handleHomeworkSolverRequest, normalizeKieSolution, solveWithKie } from './homeworkSolver.ts'

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>()
  return { ...actual, createClient: vi.fn(actual.createClient) }
})

const task: SolveHomeworkRequest = {
  textbookId: 'geometry',
  task: '126',
  source: 'number',
  subject: 'Геометрия',
  grade: '8 класс',
  textbookTitle: 'Геометрия. 7-9 классы',
  authors: 'Л. С. Атанасян',
  edition: 'Просвещение',
  idempotencyKey: 'solution-test-126',
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
    apexAngle: '',
  },
  sourceVerified: true,
}

function providerResponse(content = providerSolution) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
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

describe('Kie.ai homework solver', () => {
  it('normalizes a complete verified answer and never accepts invented conditions', () => {
    expect(normalizeKieSolution(providerSolution, task, 'student-1')).toMatchObject({
      textbookId: 'geometry',
      task: '126',
      ownerId: 'student-1',
      answer: '90°.',
      diagram: { kind: 'right-triangle', vertices: ['A', 'B', 'C'] },
    })
    expect(() => normalizeKieSolution({ ...providerSolution, sourceVerified: false }, task))
      .toThrow('Добавь фотографию задания')
  })

  it('restores a meaningful semantic figure when a grounded response omits its diagram', () => {
    const solution = normalizeKieSolution({
      ...providerSolution,
      condition: 'В равнобедренном треугольнике ABC найдите основание.',
      goal: { title: 'Найти', text: 'Найти AC.' },
      diagram: { kind: 'none', description: '', vertices: [] },
    }, task)

    expect(solution.goal.text).toBe('AC.')
    expect(solution.diagram).toMatchObject({
      kind: 'isosceles-triangle',
      vertices: ['A', 'B', 'C'],
    })

    const intersecting = normalizeKieSolution({
      ...providerSolution,
      condition: 'Отрезки AB и CD пересекаются в точке O.',
      diagram: { kind: 'none', description: '', vertices: [] },
    }, task)
    expect(intersecting.diagram).toMatchObject({
      kind: 'intersecting-segments',
      vertices: ['A', 'B', 'C', 'D', 'O'],
    })
  })

  it('searches the exact textbook and number without combining tools with structured output', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse())
    const result = await solveWithKie(task, { apiKey: 'secret-test-key', fetchImpl: fetchMock })

    expect(result.answer).toBe('90°.')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.kie.ai/gemini-2.5-flash/v1/chat/completions')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer secret-test-key' })
    const payload = JSON.parse(String(options?.body)) as Record<string, unknown>
    expect(payload.tools).toEqual([{ type: 'function', function: { name: 'googleSearch' } }])
    expect(payload).not.toHaveProperty('response_format')
    expect(JSON.stringify(payload.messages)).toContain('Атанасян')
    expect(JSON.stringify(payload.messages)).toContain('п/у')
  })

  it('sends actual photo bytes to the multimodal model with a strict answer schema', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse())
    await solveWithKie(
      {
        ...task,
        task: 'photo-example',
        source: 'photo',
        imageDataUrl: 'data:image/png;base64,cGhvdG8=',
      },
      { apiKey: 'secret-test-key', fetchImpl: fetchMock },
    )

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

  it('reports missing and rejected provider keys without exposing credentials', async () => {
    await expect(solveWithKie(task, {})).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('KIE_API_KEY'),
    })

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(solveWithKie(task, { apiKey: 'private-value', fetchImpl: fetchMock }))
      .rejects.toMatchObject({ status: 502, message: 'Kie.ai отклонил ключ API. Проверь KIE_API_KEY' })
  })

  it('publishes safe configuration status without the API key', async () => {
    const http = createHttp('GET')
    await handleHomeworkSolverRequest(http.request, http.response, { apiKey: 'private-value' })

    expect(http.response.statusCode).toBe(200)
    expect(http.body()).toEqual({
      provider: 'kie.ai',
      model: 'gemini-2.5-flash',
      configured: true,
    })
    expect(JSON.stringify(http.body())).not.toContain('private-value')
    expect(http.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('allows production website requests and their authorization preflight', async () => {
    const preflight = createHttp('OPTIONS')
    preflight.request.headers.origin = 'https://www.homeworkcopilot.ru'
    await handleHomeworkSolverRequest(preflight.request, preflight.response, { apiKey: 'private-value' })

    expect(preflight.response.statusCode).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://www.homeworkcopilot.ru')
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')

    const publicStatus = createHttp('GET')
    publicStatus.request.headers.origin = 'https://homeworkcopilot.ru'
    await handleHomeworkSolverRequest(publicStatus.request, publicStatus.response, { apiKey: 'private-value' })
    expect(publicStatus.headers.get('Access-Control-Allow-Origin')).toBe('https://homeworkcopilot.ru')

    const untrusted = createHttp('OPTIONS')
    untrusted.request.headers.origin = 'https://untrusted.example'
    await handleHomeworkSolverRequest(untrusted.request, untrusted.response, { apiKey: 'private-value' })
    expect(untrusted.response.statusCode).toBe(403)
    expect(untrusted.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('rejects malformed tasks and returns a fully prepared answer from the API handler', async () => {
    const invalid = createHttp('POST', { ...task, task: '12345' })
    await handleHomeworkSolverRequest(invalid.request, invalid.response, { apiKey: 'test-key' })
    expect(invalid.response.statusCode).toBe(400)
    expect(invalid.body().error).toContain('от 1 до 4 цифр')

    const valid = createHttp('POST', task)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse())
    await handleHomeworkSolverRequest(valid.request, valid.response, {
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    })
    expect(valid.response.statusCode).toBe(200)
    expect(valid.body().solution).toMatchObject({ task: '126', answer: '90°.' })
  })

  it('requires a real signed-in account when production persistence is configured', async () => {
    const http = createHttp('POST', task)
    const fetchMock = vi.fn<typeof fetch>()

    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(401)
    expect(http.body().error).toBe('Войди в аккаунт, чтобы решить задачу')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores a generated answer and its payment together after the provider succeeds', async () => {
    const saved = normalizeKieSolution(providerSolution, task, 'student-1')
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: saved, error: null })
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse())
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['complete_homework_solution', {
      p_idempotency_key: 'solution-test-126',
      p_source: 'number',
      p_task: '126',
      p_textbook_id: 'geometry',
    }])
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_idempotency_key: 'solution-test-126',
      p_solution: { ownerId: 'student-1', answer: '90°.' },
    })
  })

  it('opens an existing shared answer without calling the provider again', async () => {
    const saved = normalizeKieSolution(providerSolution, task, 'student-1')
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null })
    const from = vi.fn()
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
      from,
      rpc,
    } as never)

    const http = createHttp('POST', task)
    http.request.headers.authorization = 'Bearer test-session'
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(200)
    expect(http.body().solution).toMatchObject({ task: '126', answer: '90°.' })
    expect(rpc).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects insufficient balance before spending provider credits', async () => {
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
    const fetchMock = vi.fn<typeof fetch>()
    await handleHomeworkSolverRequest(http.request, http.response, {
      apiKey: 'test-key',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable-test-key',
      fetchImpl: fetchMock,
    })

    expect(http.response.statusCode).toBe(402)
    expect(http.body().error).toBe('На балансе меньше 5 ₽')
    expect(rpc).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an actionable 503 before asking for payment when Kie.ai is not configured', async () => {
    const http = createHttp('POST', task)
    await handleHomeworkSolverRequest(http.request, http.response, {})

    expect(http.response.statusCode).toBe(503)
    expect(http.body().error).toContain('KIE_API_KEY')
  })
})
