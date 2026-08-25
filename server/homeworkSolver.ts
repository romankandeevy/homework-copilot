import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { homeworkDiagramKinds } from '../src/lib/homeworkContract.ts'
import type { HomeworkDiagram, HomeworkSolution, SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import type { Database } from '../src/lib/database.types.ts'
import { getSolutionPrice } from '../src/lib/solutionPricing.ts'

type SolverOptions = {
  apiKey?: string
  model?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  fetchImpl?: typeof fetch
}

type AuthenticatedAccount = {
  client: SupabaseClient<Database>
  userId: string
}

export class HomeworkSolverError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['condition', 'given', 'goal', 'steps', 'answer', 'diagram', 'sourceVerified'],
  properties: {
    condition: { type: 'string' },
    given: { type: 'array', items: { type: 'string' } },
    goal: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'text'],
      properties: {
        title: { type: 'string', enum: ['Найти', 'Доказать'] },
        text: { type: 'string' },
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    answer: { type: 'string' },
    diagram: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'description', 'vertices', 'apexAngle'],
      properties: {
        kind: { type: 'string', enum: [...homeworkDiagramKinds] },
        description: { type: 'string' },
        vertices: { type: 'array', items: { type: 'string' } },
        apexAngle: { type: 'string' },
      },
    },
    sourceVerified: { type: 'boolean' },
  },
} as const

const solutionInstructions = [
  'Ты решаешь школьные задачи по российской программе 8 класса.',
  'Верни только корректный JSON без Markdown, вступлений и пояснений вне JSON.',
  'Никогда не придумывай условие задачи: по номеру сначала найди именно указанный учебник, авторов и номер через поиск.',
  'Если точное условие не найдено или фотография не читается, верни sourceVerified=false и не придумывай решение.',
  'Сохраняй точное найденное или считанное условие в condition.',
  'Решение должно быть готовым для переписывания в школьную тетрадь: дано, найти или доказать, последовательные вычисления, ответ.',
  'Для геометрии допустимы только сокращения: п/у = прямоугольный, р/б = равнобедренный, св-во = свойство.',
  'Теорему обозначай кириллическим символом т в кружке: т⃝. Всё остальное пиши полными словами.',
  'Используй математические символы △, ∠, °, ∥, ⟂, =, ∼, ⇒; не используй LaTeX, Markdown или выдуманные сокращения.',
  'Каждый элемент given и steps — отдельная короткая строка, которую можно переписать в тетрадь.',
  'В given передай не больше трёх строк; goal.text и каждая строка steps должны быть компактными.',
  'diagram описывает только смысл фигуры и подписи вершин, никогда координаты, SVG, HTML или CSS.',
  'Для геометрии выбери подходящий kind из triangle, isosceles-triangle, median-triangle, right-triangle, intersecting-segments, parallelogram, rectangle, rhombus, square, trapezoid, circle; иначе используй none.',
  'Для физики обязательно укажи единицы измерения и переводы в СИ; для химии уравняй реакции и покажи расчёт.',
].join(' ')

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function lines(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => text(entry)).filter(Boolean).slice(0, limit)
}

function normalizeDiagram(value: unknown, request: SolveHomeworkRequest, condition: string): HomeworkDiagram {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rawKind = text(candidate.kind)
  let kind = homeworkDiagramKinds.find((entry) => entry === rawKind) ?? 'none'
  if (kind === 'none' && /геометр/i.test(request.subject)) {
    if (/отрезк.{0,80}пересека/i.test(condition)) kind = 'intersecting-segments'
    else if (/равнобедрен/i.test(condition)) kind = 'isosceles-triangle'
    else if (/прямоугольн.{0,20}треугольник/i.test(condition)) kind = 'right-triangle'
    else if (/медиан/i.test(condition)) kind = 'median-triangle'
    else if (/параллелограмм/i.test(condition)) kind = 'parallelogram'
    else if (/прямоугольник/i.test(condition)) kind = 'rectangle'
    else if (/ромб/i.test(condition)) kind = 'rhombus'
    else if (/квадрат/i.test(condition)) kind = 'square'
    else if (/трапец/i.test(condition)) kind = 'trapezoid'
    else if (/окружност|круг/i.test(condition)) kind = 'circle'
    else if (/треугольник/i.test(condition)) kind = 'triangle'
  }
  const intersectingVertices = kind === 'intersecting-segments'
    ? [...condition.matchAll(/\b([A-ZА-ЯЁ]{2})\b/gu)].slice(0, 2).flatMap((match) => match[1].split(''))
    : []
  const inferredVertices = intersectingVertices.length === 4
    ? [...intersectingVertices, 'O']
    : condition.match(/\b([A-ZА-ЯЁ]{3,4})\b/u)?.[1]?.split('') ?? []
  const vertices = lines(candidate.vertices, 8)

  return {
    kind,
    description: text(candidate.description, condition.slice(0, 180) || 'Чертёж к задаче'),
    vertices: vertices.length > 0 ? vertices : inferredVertices,
    ...(text(candidate.apexAngle) ? { apexAngle: text(candidate.apexAngle) } : {}),
  }
}

export function normalizeKieSolution(raw: unknown, request: SolveHomeworkRequest, ownerId?: string): HomeworkSolution {
  const content = typeof raw === 'string'
    ? raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : raw
  let parsed: unknown

  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    throw new HomeworkSolverError(502, 'Kie.ai вернул решение в непонятном формате. Попробуй ещё раз')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new HomeworkSolverError(502, 'Kie.ai не вернул содержимое решения')
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.sourceVerified !== true) {
    throw new HomeworkSolverError(422, 'Не удалось найти точное условие этой задачи. Добавь фотографию задания')
  }

  const condition = text(candidate.condition)
  const steps = lines(candidate.steps, 40)
  if (!condition || steps.length === 0) {
    throw new HomeworkSolverError(502, 'Kie.ai вернул неполное решение. Попробуй ещё раз')
  }

  const goalValue = candidate.goal && typeof candidate.goal === 'object' ? candidate.goal as Record<string, unknown> : {}
  const goalTitle = text(goalValue.title) === 'Доказать' ? 'Доказать' : 'Найти'
  const goalText = text(goalValue.text, 'Ответ.').replace(/^(найти|доказать)\s*:?\s*/i, '')

  return {
    textbookId: request.textbookId,
    task: request.task,
    source: request.source,
    subject: request.subject,
    textbookTitle: request.textbookTitle,
    condition,
    given: lines(candidate.given, 3),
    goal: { title: goalTitle, text: goalText },
    steps,
    answer: text(candidate.answer),
    diagram: normalizeDiagram(candidate.diagram, request, condition),
    sourceVerified: true,
    createdAt: new Date().toISOString(),
    ...(ownerId ? { ownerId } : {}),
  }
}

function providerMessage(request: SolveHomeworkRequest) {
  const taskDescription = [
    'Предмет: ' + request.subject + '.',
    'Класс: ' + request.grade + '.',
    'Учебник: ' + request.textbookTitle + '.',
    'Авторы: ' + request.authors + '.',
    'Издательство или выпуск: ' + request.edition + '.',
    request.source === 'number' ? 'Точный номер задачи: ' + request.task + '.' : 'Прочитай условие с приложенной фотографии.',
    request.condition ? 'Проверенное условие задачи: ' + request.condition : 'Проверенного текста условия нет.',
    'Верни JSON с полями condition, given, goal, steps, answer, diagram, sourceVerified.',
  ].join('\n')

  if (request.imageDataUrl) {
    return {
      role: 'user',
      content: [
        { type: 'text', text: taskDescription },
        { type: 'image_url', image_url: { url: request.imageDataUrl } },
      ],
    }
  }

  return { role: 'user', content: taskDescription }
}

export async function solveWithKie(
  request: SolveHomeworkRequest,
  options: SolverOptions,
  ownerId?: string,
): Promise<HomeworkSolution> {
  if (!options.apiKey) {
    throw new HomeworkSolverError(503, 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер')
  }

  const model = options.model || 'gemini-2.5-flash'
  const needsSourceSearch = request.source === 'number' && !request.condition
  const payload = {
    model,
    messages: [
      { role: 'system', content: solutionInstructions },
      providerMessage(request),
    ],
    temperature: 0.2,
    ...(needsSourceSearch
      ? { tools: [{ type: 'function', function: { name: 'googleSearch' } }] }
      : {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'homework_solution', strict: true, schema: responseSchema },
          },
        }),
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      'https://api.kie.ai/' + model + '/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + options.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      },
    )
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new HomeworkSolverError(504, 'Kie.ai отвечает слишком долго. Попробуй ещё раз')
    }
    throw new HomeworkSolverError(502, 'Не получилось подключиться к Kie.ai. Попробуй ещё раз')
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HomeworkSolverError(502, 'Kie.ai отклонил ключ API. Проверь KIE_API_KEY')
    }
    if (response.status === 429) {
      throw new HomeworkSolverError(429, 'Kie.ai временно ограничил запросы. Попробуй чуть позже')
    }
    throw new HomeworkSolverError(502, 'Kie.ai не смог подготовить решение. Попробуй ещё раз')
  }

  let payloadResponse: unknown
  try {
    payloadResponse = await response.json()
  } catch {
    throw new HomeworkSolverError(502, 'Kie.ai вернул некорректный ответ')
  }

  const root = payloadResponse && typeof payloadResponse === 'object' ? payloadResponse as Record<string, unknown> : {}
  const choices = Array.isArray(root.choices) ? root.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {}
  const content = Array.isArray(message.content)
    ? message.content.map((part) => part && typeof part === 'object' ? text((part as Record<string, unknown>).text) : '').join('\n')
    : message.content

  return normalizeKieSolution(content, request, ownerId)
}

function validateRequest(value: unknown): SolveHomeworkRequest {
  if (!value || typeof value !== 'object') {
    throw new HomeworkSolverError(400, 'Передай учебник и задачу для решения')
  }

  const candidate = value as Record<string, unknown>
  const source = candidate.source === 'photo' ? 'photo' : candidate.source === 'number' ? 'number' : null
  const requiredFields = ['textbookId', 'task', 'subject', 'grade', 'textbookTitle', 'authors', 'edition', 'idempotencyKey']
  if (!source || requiredFields.some((field) => !text(candidate[field]))) {
    throw new HomeworkSolverError(400, 'Не хватает данных учебника или номера задачи')
  }
  if (source === 'number' && !/^\d{1,4}$/.test(text(candidate.task))) {
    throw new HomeworkSolverError(400, 'Номер задачи должен содержать от 1 до 4 цифр')
  }
  const imageDataUrl = text(candidate.imageDataUrl)
  if (source === 'photo' && !/^data:image\/(?:jpeg|png|webp|heic|heif);base64,/i.test(imageDataUrl)) {
    throw new HomeworkSolverError(400, 'Добавь фотографию задачи в формате JPEG, PNG или WebP')
  }
  if (imageDataUrl.length > 4_000_000) {
    throw new HomeworkSolverError(413, 'Фотография задачи слишком большая')
  }

  return {
    textbookId: text(candidate.textbookId).slice(0, 150),
    task: text(candidate.task).slice(0, 120),
    source,
    subject: text(candidate.subject).slice(0, 150),
    grade: text(candidate.grade).slice(0, 40),
    textbookTitle: text(candidate.textbookTitle).slice(0, 300),
    authors: text(candidate.authors).slice(0, 300),
    edition: text(candidate.edition).slice(0, 150),
    idempotencyKey: text(candidate.idempotencyKey).slice(0, 150),
    ...(text(candidate.condition) ? { condition: text(candidate.condition).slice(0, 5000) } : {}),
    ...(imageDataUrl ? { imageDataUrl } : {}),
  }
}

async function authenticateAccount(request: IncomingMessage, options: SolverOptions): Promise<AuthenticatedAccount | null> {
  if (!options.supabaseUrl || !options.supabasePublishableKey) return null

  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) throw new HomeworkSolverError(401, 'Войди в аккаунт, чтобы решить задачу')

  const client = createClient<Database>(options.supabaseUrl, options.supabasePublishableKey, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) {
    throw new HomeworkSolverError(401, 'Сессия закончилась. Войди в аккаунт ещё раз')
  }

  return { client, userId: data.user.id }
}

async function ensureAccountBalance(account: AuthenticatedAccount | null) {
  if (!account) return
  const { data, error } = await account.client
    .from('wallet_accounts')
    .select('balance')
    .eq('user_id', account.userId)
    .single()

  if (error) throw new HomeworkSolverError(502, 'Не получилось проверить баланс')
  if (data.balance <= 0) throw new HomeworkSolverError(402, 'На балансе недостаточно средств для решения задачи')
}

async function chargeCompletedSolution(account: AuthenticatedAccount | null, request: SolveHomeworkRequest) {
  if (!account) return
  const price = getSolutionPrice(request.textbookId, request.task, request.source)
  const description = request.source === 'photo'
    ? 'Решение задачи по фото · ' + price + ' ₽'
    : 'Решение задачи № ' + request.task + ' · ' + price + ' ₽'
  let { error } = await account.client.rpc('spend_solution_credit', {
    p_description: description,
    p_idempotency_key: request.idempotencyKey,
    p_source: request.source,
    p_task_number: request.source === 'number' ? Number(request.task) : null,
    p_textbook_id: request.textbookId,
  })

  if (error?.code === 'PGRST202') {
    ;({ error } = await account.client.rpc('spend_solution_credit', {
      p_description: request.source === 'photo'
        ? 'Решение задачи по фото'
        : 'Решение задачи № ' + request.task,
      p_idempotency_key: request.idempotencyKey,
    }))
  }

  if (error) {
    throw new HomeworkSolverError(
      error.message.includes('insufficient balance') ? 402 : 502,
      error.message.includes('insufficient balance')
        ? 'На балансе меньше ' + price + ' ₽'
        : 'Не получилось списать ' + price + ' ₽ с баланса',
    )
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = (request as IncomingMessage & { body?: unknown }).body
  if (body !== undefined) {
    if (typeof body === 'string') {
      try {
        return JSON.parse(body)
      } catch {
        throw new HomeworkSolverError(400, 'Запрос задачи содержит некорректный JSON')
      }
    }
    return body
  }

  const parts: Buffer[] = []
  let size = 0
  for await (const part of request) {
    const buffer = typeof part === 'string' ? Buffer.from(part) : part as Buffer
    size += buffer.length
    if (size > 4_200_000) throw new HomeworkSolverError(413, 'Фотография задачи слишком большая')
    parts.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch {
    throw new HomeworkSolverError(400, 'Запрос задачи содержит некорректный JSON')
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  response.end(JSON.stringify(payload))
}

const allowedBrowserOrigins = new Set([
  'https://www.homeworkcopilot.ru',
  'https://homeworkcopilot.ru',
])

function allowProductionBrowser(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (!origin || !allowedBrowserOrigins.has(origin)) return false

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Max-Age', '86400')
  response.setHeader('Vary', 'Origin')
  return true
}

export async function handleHomeworkSolverRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SolverOptions,
) {
  const browserAllowed = allowProductionBrowser(request, response)

  if (request.method === 'OPTIONS') {
    if (!browserAllowed) {
      sendJson(response, 403, { error: 'Источник запроса не разрешён' })
      return
    }

    response.statusCode = 204
    response.end()
    return
  }

  if (request.method === 'GET') {
    sendJson(response, 200, {
      provider: 'kie.ai',
      model: options.model || 'gemini-2.5-flash',
      configured: Boolean(options.apiKey),
    })
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, OPTIONS')
    sendJson(response, 405, { error: 'Допустимы только GET, POST и OPTIONS' })
    return
  }

  try {
    if (!options.apiKey) {
      throw new HomeworkSolverError(503, 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер')
    }
    const task = validateRequest(await readJsonBody(request))
    const account = await authenticateAccount(request, options)
    await ensureAccountBalance(account)
    const solution = await solveWithKie(task, options, account?.userId)
    await chargeCompletedSolution(account, task)
    sendJson(response, 200, { solution })
  } catch (error) {
    if (error instanceof HomeworkSolverError) {
      sendJson(response, error.status, { error: error.message })
      return
    }
    sendJson(response, 500, { error: 'Не получилось подготовить решение. Попробуй ещё раз' })
  }
}
