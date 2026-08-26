import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { homeworkDiagramKinds } from '../src/lib/homeworkContract.ts'
import type { HomeworkDiagram, HomeworkSolution, SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import type { Database, Json } from '../src/lib/database.types.ts'
import { getSolutionPrice } from '../src/lib/solutionPricing.ts'
import { getVerifiedNumberedGeometrySolution } from '../src/lib/verifiedNumberedSolutions.ts'
import { findVerifiedTextbookTask, geometryTextbookIdentity, normalizeTaskCondition } from '../src/textbooks/taskCatalog.ts'

type SolverOptions = {
  apiKey?: string
  model?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  fetchImpl?: typeof fetch
  taskLookup?: (request: SolveHomeworkRequest) => Promise<VerifiedTaskRecord | null>
}

type VerifiedTaskRecord = {
  condition: string
  conditionNormalized: string
  sourceUrl: string
  sourcePage: number
  hasDiagram: boolean
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
      required: ['kind', 'description', 'vertices'],
      properties: {
        kind: { type: 'string', enum: [...homeworkDiagramKinds] },
        description: { type: 'string' },
        vertices: { type: 'array', items: { type: 'string' } },
        apexAngle: { type: 'string' },
        auxiliaryKind: { type: 'string', enum: ['median', 'bisector', 'height'] },
        auxiliaryLabel: { type: 'string' },
        rightAngleAt: { type: 'string' },
        parallelTo: { type: 'string' },
        exteriorAngle: { type: 'string' },
      },
    },
    sourceVerified: { type: 'boolean' },
  },
} as const

const solutionInstructions = [
  'Ты решаешь школьные задачи по российской программе 8 класса.',
  'Верни только корректный JSON без Markdown, вступлений и пояснений вне JSON.',
  'Никогда не ищи и не придумывай условие задачи: используй только проверенное условие и приложенный фрагмент учебника.',
  'Если фотография не читается, верни sourceVerified=false и не придумывай решение.',
  'Сохраняй проверенное или считанное условие в condition.',
  'Решение должно быть готовым для переписывания в школьную тетрадь: дано, найти или доказать, последовательные вычисления, ответ.',
  'Пиши в первую очередь математическими обозначениями, а не пересказывай условие словами: A∈a, D∉a, ∠ABC, AB=BC, a∥b, a⟂b, a∩b=O, ⇒.',
  'Словесные пояснения оставляй только там, где без них нельзя указать теорему или обоснование.',
  'Для геометрии допустимы только сокращения: п/у = прямоугольный, р/б = равнобедренный, св-во = свойство.',
  'Теорему обозначай кириллическим символом т в кружке: т⃝. Всё остальное пиши полными словами.',
  'Используй математические символы △, ∠, °, ∥, ⟂, =, ∼, ⇒; не используй LaTeX, Markdown или выдуманные сокращения.',
  'Каждый элемент given и steps — отдельная короткая строка, которую можно переписать в тетрадь.',
  'В given передай не больше трёх строк; goal.text и каждая строка steps должны быть компактными.',
  'diagram описывает только смысл фигуры и подписи вершин, никогда координаты, SVG, HTML или CSS.',
  'Для задачи по номеру не реконструируй рисунок: верни diagram.kind=none, потому что исходный чертёж приложение берёт из проверенного PDF.',
  'Для геометрии выбери подходящий kind из triangle, three-point-lines, isosceles-triangle, median-triangle, right-triangle, intersecting-segments, parallel-line-triangle, parallelogram, rectangle, rhombus, square, trapezoid, circle; иначе используй none.',
  'Для физики обязательно укажи единицы измерения и переводы в СИ; для химии уравняй реакции и покажи расчёт.',
].join(' ')

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function lines(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => text(entry)).filter(Boolean).slice(0, limit)
}

function emptyDiagram(): HomeworkDiagram {
  return { kind: 'none', description: '', vertices: [] }
}

function enforceVerifiedNumberDiagram(solution: HomeworkSolution, request: SolveHomeworkRequest): HomeworkSolution {
  if (request.source !== 'number') return solution
  return getVerifiedNumberedGeometrySolution(solution) ?? { ...solution, diagram: emptyDiagram() }
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
    ...(text(candidate.auxiliaryKind) && ['median', 'bisector', 'height'].includes(text(candidate.auxiliaryKind))
      ? { auxiliaryKind: text(candidate.auxiliaryKind) as HomeworkDiagram['auxiliaryKind'] }
      : {}),
    ...(text(candidate.auxiliaryLabel) ? { auxiliaryLabel: text(candidate.auxiliaryLabel) } : {}),
    ...(text(candidate.rightAngleAt) ? { rightAngleAt: text(candidate.rightAngleAt) } : {}),
    ...(text(candidate.parallelTo) ? { parallelTo: text(candidate.parallelTo) } : {}),
    ...(text(candidate.exteriorAngle) ? { exteriorAngle: text(candidate.exteriorAngle) } : {}),
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
  if (request.source === 'photo' && candidate.sourceVerified !== true) {
    throw new HomeworkSolverError(422, 'Не удалось найти точное условие этой задачи. Добавь фотографию задания')
  }

  const generatedCondition = text(candidate.condition)
  const condition = request.source === 'number' && request.condition ? request.condition : generatedCondition
  const steps = lines(candidate.steps, 40)
  if (!condition || steps.length === 0) {
    throw new HomeworkSolverError(502, 'Kie.ai вернул неполное решение. Попробуй ещё раз')
  }
  if (request.source === 'photo' && request.condition && normalizeTaskCondition(condition) !== normalizeTaskCondition(request.condition)) {
    throw new HomeworkSolverError(422, 'Решение вернуло другое условие. Решение не сохранено')
  }

  const goalValue = candidate.goal && typeof candidate.goal === 'object' ? candidate.goal as Record<string, unknown> : {}
  const goalTitle = text(goalValue.title) === 'Доказать' ? 'Доказать' : 'Найти'
  const goalText = text(goalValue.text, 'Ответ.').replace(/^(найти|доказать)\s*:?\s*/i, '')

  return enforceVerifiedNumberDiagram({
    textbookId: request.textbookId,
    task: request.task,
    source: request.source,
    textbookEdition: request.edition,
    sourceUrl: request.sourceUrl ?? '',
    ...(request.sourcePage ? { sourcePage: request.sourcePage } : {}),
    conditionNormalized: normalizeTaskCondition(condition),
    subject: request.subject,
    textbookTitle: request.textbookTitle,
    condition,
    given: lines(candidate.given, 3),
    goal: { title: goalTitle, text: goalText },
    steps,
    answer: text(candidate.answer),
    diagram: request.source === 'number' ? emptyDiagram() : normalizeDiagram(candidate.diagram, request, condition),
    sourceVerified: true,
    createdAt: new Date().toISOString(),
    ...(ownerId ? { ownerId } : {}),
  }, request)
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
  const verifiedTask = request.source === 'number'
    ? findVerifiedTextbookTask(request.textbookId, request.edition, request.task)
    : null
  if (verifiedTask?.solution) {
    return enforceVerifiedNumberDiagram({
      textbookId: request.textbookId,
      task: request.task,
      source: request.source,
      textbookEdition: verifiedTask.edition,
      sourceUrl: verifiedTask.sourceUrl,
      ...(verifiedTask.sourcePage ? { sourcePage: verifiedTask.sourcePage } : {}),
      conditionNormalized: normalizeTaskCondition(verifiedTask.condition),
      subject: request.subject,
      textbookTitle: request.textbookTitle,
      condition: verifiedTask.condition,
      given: [...verifiedTask.given],
      goal: verifiedTask.goal,
      steps: [...verifiedTask.solution],
      answer: verifiedTask.answer,
      diagram: emptyDiagram(),
      sourceVerified: true,
      createdAt: new Date().toISOString(),
      ...(ownerId ? { ownerId } : {}),
    }, request)
  }
  if (!options.apiKey) {
    throw new HomeworkSolverError(503, 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер')
  }

  const model = options.model || 'gemini-2.5-flash'
  const payload = {
    model,
    messages: [
      { role: 'system', content: solutionInstructions },
      providerMessage(request),
    ],
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'homework_solution', strict: true, schema: responseSchema },
    },
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

async function lookupVerifiedTask(request: SolveHomeworkRequest, options: SolverOptions): Promise<VerifiedTaskRecord | null> {
  const localTask = findVerifiedTextbookTask(request.textbookId, request.edition, request.task)
  if (localTask) {
    return {
      condition: localTask.condition,
      conditionNormalized: localTask.conditionNormalized,
      sourceUrl: localTask.sourceUrl,
      sourcePage: localTask.sourcePage ?? localTask.sourceRegion.page,
      hasDiagram: localTask.hasDiagram,
    }
  }
  if (options.taskLookup) return options.taskLookup(request)
  if (!options.supabaseUrl || !options.supabasePublishableKey) return null

  let response: Response
  try {
    response = await fetch(`${options.supabaseUrl}/rest/v1/rpc/get_verified_homework_task`, {
      method: 'POST',
      headers: {
        apikey: options.supabasePublishableKey,
        Authorization: `Bearer ${options.supabasePublishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_textbook_id: request.textbookId,
        p_edition: request.edition,
        p_source_url: request.sourceUrl,
        p_task: request.task,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new HomeworkSolverError(502, 'Не получилось проверить условие в базе учебника')
  }
  if (!response.ok) throw new HomeworkSolverError(502, 'База учебника временно недоступна')

  const payload = await response.json() as unknown
  const row = Array.isArray(payload) && payload[0] && typeof payload[0] === 'object'
    ? payload[0] as Record<string, unknown>
    : null
  if (!row) return null
  const sourcePage = Number(row.source_page)
  if (!text(row.condition) || !text(row.condition_normalized) || !Number.isInteger(sourcePage) || sourcePage < 1) return null
  return {
    condition: text(row.condition),
    conditionNormalized: text(row.condition_normalized),
    sourceUrl: text(row.source_url),
    sourcePage,
    hasDiagram: row.has_diagram === true,
  }
}

async function validateRequest(value: unknown, options: SolverOptions): Promise<SolveHomeworkRequest> {
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
  const condition = text(candidate.condition)
  const sourceUrl = text(candidate.sourceUrl)
  const sourcePageValue = Number(candidate.sourcePage)
  const sourcePage = Number.isInteger(sourcePageValue) && sourcePageValue > 0 ? sourcePageValue : undefined
  const imageDataUrl = text(candidate.imageDataUrl)
  if (imageDataUrl && !/^data:image\/(?:jpeg|png|webp|heic|heif);base64,/i.test(imageDataUrl)) {
    throw new HomeworkSolverError(400, 'Изображение задачи должно быть в формате JPEG, PNG или WebP')
  }
  if (source === 'photo' && !imageDataUrl) {
    throw new HomeworkSolverError(400, 'Добавь фотографию задачи в формате JPEG, PNG или WebP')
  }
  if (imageDataUrl.length > 4_000_000) {
    throw new HomeworkSolverError(413, 'Фотография задачи слишком большая')
  }

  const request: SolveHomeworkRequest = {
    textbookId: text(candidate.textbookId).slice(0, 150),
    task: text(candidate.task).slice(0, 120),
    source,
    subject: text(candidate.subject).slice(0, 150),
    grade: text(candidate.grade).slice(0, 40),
    textbookTitle: text(candidate.textbookTitle).slice(0, 300),
    authors: text(candidate.authors).slice(0, 300),
    edition: text(candidate.edition).slice(0, 150),
    idempotencyKey: text(candidate.idempotencyKey).slice(0, 150),
    ...(condition ? { condition: condition.slice(0, 5000) } : {}),
    ...(sourceUrl ? { sourceUrl: sourceUrl.slice(0, 500) } : {}),
    ...(sourcePage ? { sourcePage } : {}),
    ...(imageDataUrl ? { imageDataUrl } : {}),
  }

  if (source === 'number') {
    if (request.textbookId !== geometryTextbookIdentity.textbookId
      || request.subject !== geometryTextbookIdentity.subject
      || request.grade !== geometryTextbookIdentity.grade
      || request.textbookTitle !== geometryTextbookIdentity.textbookTitle
      || request.authors !== geometryTextbookIdentity.authors
      || request.edition !== geometryTextbookIdentity.edition
      || request.sourceUrl !== geometryTextbookIdentity.sourceUrl) {
      throw new HomeworkSolverError(422, 'Выбранное издание учебника не совпадает с индексом задач')
    }

    const verifiedTask = await lookupVerifiedTask(request, options)
    if (!verifiedTask
      || normalizeTaskCondition(condition) !== verifiedTask.conditionNormalized
      || sourceUrl !== verifiedTask.sourceUrl
      || sourcePage !== verifiedTask.sourcePage) {
      throw new HomeworkSolverError(422, 'Точное условие этой задачи в выбранном издании не найдено. Решение не запускается')
    }
    if (verifiedTask.hasDiagram && !imageDataUrl) {
      throw new HomeworkSolverError(400, 'Для этой задачи нужен исходный чертёж из учебника')
    }
    request.condition = verifiedTask.condition
    request.sourceUrl = verifiedTask.sourceUrl
    request.sourcePage = verifiedTask.sourcePage
  }

  return request
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

async function ensureAccountBalance(account: AuthenticatedAccount | null, request: SolveHomeworkRequest) {
  if (!account) return
  const { data, error } = await account.client
    .from('wallet_accounts')
    .select('balance')
    .eq('user_id', account.userId)
    .single()

  if (error) throw new HomeworkSolverError(502, 'Не получилось проверить баланс')
  const price = getSolutionPrice(request.textbookId, request.task, request.source)
  if (data.balance < price) throw new HomeworkSolverError(402, 'На балансе меньше ' + price + ' ₽')
}

async function completeStoredSolution(
  account: AuthenticatedAccount | null,
  request: SolveHomeworkRequest,
  solution?: HomeworkSolution,
): Promise<HomeworkSolution | null> {
  if (!account) return solution ? enforceVerifiedNumberDiagram(solution, request) : null
  const price = getSolutionPrice(request.textbookId, request.task, request.source)
  const condition = solution?.condition ?? request.condition ?? ''
  const conditionNormalized = solution?.conditionNormalized ?? normalizeTaskCondition(condition)
  const { data, error } = await account.client.rpc('complete_homework_solution', {
    p_idempotency_key: request.idempotencyKey,
    ...(solution ? { p_solution: solution as unknown as Json } : {}),
    p_condition: condition,
    p_condition_normalized: conditionNormalized,
    p_edition: request.edition,
    p_source: request.source,
    p_source_page: request.sourcePage ?? null,
    p_source_url: request.sourceUrl ?? '',
    p_task: request.task,
    p_textbook_id: request.textbookId,
  })

  if (error) {
    throw new HomeworkSolverError(
      error.message.includes('insufficient balance') ? 402 : 502,
      error.message.includes('insufficient balance')
        ? 'На балансе меньше ' + price + ' ₽'
        : 'Не получилось безопасно сохранить готовое решение',
    )
  }

  if (!data) return null
  if (typeof data !== 'object' || Array.isArray(data) || typeof data.condition !== 'string') {
    throw new HomeworkSolverError(502, 'База решений вернула некорректный ответ')
  }

  return enforceVerifiedNumberDiagram(data as unknown as HomeworkSolution, request)
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
    const task = await validateRequest(await readJsonBody(request), options)
    const account = await authenticateAccount(request, options)
    const existingSolution = await completeStoredSolution(account, task)
    if (existingSolution) {
      sendJson(response, 200, { solution: existingSolution })
      return
    }

    await ensureAccountBalance(account, task)
    if (!options.apiKey && task.source === 'photo') {
      throw new HomeworkSolverError(503, 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер')
    }
    const solution = await solveWithKie(task, options, account?.userId)
    const completedSolution = await completeStoredSolution(account, task, solution)
    if (!completedSolution) {
      throw new HomeworkSolverError(502, 'Не получилось сохранить готовое решение')
    }
    sendJson(response, 200, { solution: completedSolution })
  } catch (error) {
    if (error instanceof HomeworkSolverError) {
      sendJson(response, error.status, { error: error.message })
      return
    }
    sendJson(response, 500, { error: 'Не получилось подготовить решение. Попробуй ещё раз' })
  }
}
