import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { homeworkSolutionEngineVersion } from '../src/lib/homeworkContract.ts'
import type { HomeworkSolution, HomeworkTaskType, SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import type { Database, Json } from '../src/lib/database.types.ts'
import { formatRubles } from '../src/lib/currency.ts'
import { getSolutionPrice } from '../src/lib/solutionPricing.ts'
import { findVerifiedTextbookTask, geometryTextbookIdentity, normalizeTaskCondition } from '../src/textbooks/taskCatalog.ts'
import {
  defaultHomeworkModel,
  GeometrySolutionEngineError,
  isCurrentReviewedSolution,
  solveHomeworkWithReview,
  validateSolutionQuality,
} from './geometrySolutionEngine.ts'

type SolverOptions = {
  apiKey?: string
  model?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  // Нужен, чтобы прочитать секрет подписи решений: без подписи база
  // отвергает любое сгенерированное решение по номеру задачи.
  serviceRoleKey?: string
  fetchImpl?: typeof fetch
  taskLookup?: (request: SolveHomeworkRequest) => Promise<VerifiedTaskRecord | null>
}
type GuestIdentity = {
  guestId: string
  ipHash: string | null
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
function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function trustedTaskType(goal: HomeworkSolution['goal']): HomeworkTaskType {
  if (goal.title === 'Построить') return 'construction'
  if (goal.title === 'Доказать') return 'proof'
  return 'mixed'
}

export async function solveWithKie(
  request: SolveHomeworkRequest,
  options: SolverOptions,
  ownerId?: string,
): Promise<HomeworkSolution> {
  const verifiedTask = request.source === 'number'
    ? findVerifiedTextbookTask(request.textbookId, request.edition, request.task)
    : null

  if (verifiedTask?.solution.length) {
    const taskType = trustedTaskType(verifiedTask.goal)
    const solution: HomeworkSolution = {
      engineVersion: homeworkSolutionEngineVersion,
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
      diagram: verifiedTask.diagram,
      sourceVerified: true,
      taskType,
      quality: {
        diagramRequired: verifiedTask.diagram.kind !== 'none',
        reviewPassed: true,
        symbolicShare: 1,
      },
      createdAt: new Date().toISOString(),
      ...(ownerId ? { ownerId } : {}),
    }
    if (validateSolutionQuality(solution).length === 0) return solution
  }

  if (!options.apiKey) {
    throw new HomeworkSolverError(503, 'Kie.ai не подключён: добавь KIE_API_KEY в .env.local и перезапусти сервер')
  }

  try {
    return await solveHomeworkWithReview(request, {
      apiKey: options.apiKey,
      model: options.model,
      fetchImpl: options.fetchImpl,
    }, ownerId)
  } catch (error) {
    if (!(error instanceof GeometrySolutionEngineError)) throw error
    if (/перегружена/u.test(error.message)) throw new HomeworkSolverError(429, error.message)
    if (/не успела/u.test(error.message)) throw new HomeworkSolverError(504, error.message)
    throw new HomeworkSolverError(502, error.message)
  }
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
  const source = candidate.source === 'photo'
    ? 'photo'
    : candidate.source === 'text'
      ? 'text'
      : candidate.source === 'number'
        ? 'number'
        : null
  const requiredFields = ['textbookId', 'task', 'subject', 'grade', 'textbookTitle', 'authors', 'edition', 'idempotencyKey']
  if (!source || requiredFields.some((field) => !text(candidate[field]))) {
    throw new HomeworkSolverError(400, 'Не хватает данных учебника или номера задачи')
  }
  // Адрес задачи — либо сквозной номер, либо составной «параграф.упражнение.
  // задание» для учебников без сквозной нумерации, вроде Пёрышкина.
  if (source === 'number' && !/^\d{1,4}(?:\.\d{1,3}){0,2}$/.test(text(candidate.task))) {
    throw new HomeworkSolverError(400, 'Укажи номер задачи или её адрес в учебнике')
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
  // Условие, вписанное вручную, — единственный источник для этого пути,
  // поэтому оно должно быть осмысленной длины, а не парой символов.
  if (source === 'text' && condition.trim().length < 15) {
    throw new HomeworkSolverError(400, 'Впиши условие задачи целиком — хотя бы одно предложение')
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
    // Скан учебника больше не хранится: условие берётся из нашего индекса,
    // а чертёж модель строит сама по тексту. Картинка перестала быть
    // обязательной — кроме одного случая.
    //
    // Если задача ссылается на печатный рисунок («какие точки на рисунке 43»),
    // без него она нерешаема в принципе: текста условия недостаточно, а
    // построить такой чертёж по описанию нельзя. Тогда честно просим фото.
    if (verifiedTask.hasDiagram && !imageDataUrl) {
      throw new HomeworkSolverError(
        400,
        'У этой задачи есть чертёж в учебнике. Сфотографируй фрагмент задачи вместе с рисунком',
      )
    }

    request.condition = verifiedTask.condition
    request.sourceUrl = verifiedTask.sourceUrl
    request.sourcePage = verifiedTask.sourcePage
  }

  return request
}

const guestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// Гость приходит без токена, но с меткой браузера. Метка сама по себе ничего
// не открывает: одно бесплатное решение на неё выдаёт база, и она же считает,
// что оно уже выдано.
function readGuestIdentity(request: IncomingMessage, options: SolverOptions): GuestIdentity | null {
  if (!options.supabaseUrl || !options.serviceRoleKey) return null

  const header = request.headers['x-guest-id']
  const value = (Array.isArray(header) ? header[0] : header ?? '').trim().toLowerCase()
  if (!guestIdPattern.test(value)) return null

  return { guestId: value, ipHash: hashRequestAddress(request, options) }
}

// Адрес не хранится: в базу уходит только необратимый хэш, и соль для него
// выводится из служебного ключа, а не задаётся отдельной переменной окружения.
function hashRequestAddress(request: IncomingMessage, options: SolverOptions): string | null {
  if (!options.serviceRoleKey) return null

  const forwarded = request.headers['x-forwarded-for']
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? request.socket?.remoteAddress ?? '')
    .split(',')[0]
    .trim()
  if (!raw) return null

  return createHmac('sha256', options.serviceRoleKey).update('guest-ip:' + raw).digest('hex')
}

async function authenticateAccount(
  request: IncomingMessage,
  options: SolverOptions,
  guest: GuestIdentity | null,
): Promise<AuthenticatedAccount | null> {
  if (!options.supabaseUrl || !options.supabasePublishableKey) return null

  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  // Без токена запрос ещё не отвергается: у гостя есть одно бесплатное решение.
  if (!token) {
    if (guest) return null
    throw new HomeworkSolverError(401, 'Войди в аккаунт, чтобы решить задачу')
  }

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

// Оплата резервируется ДО вызова платной модели. Проверка «хватает ли денег»
// без списания оставляла гонку: параллельные запросы с разными ключами
// идемпотентности проходили её одновременно и запускали модель несколько раз,
// а списывалось за один. Резерв идемпотентен по ключу запроса; если решение
// получить не удалось, он возвращается через refundSolutionCredit.
async function reserveSolutionCredit(
  account: AuthenticatedAccount | null,
  request: SolveHomeworkRequest,
): Promise<boolean> {
  if (!account) return false
  const price = getSolutionPrice()
  const { data, error } = await account.client.rpc('reserve_solution_credit', {
    p_idempotency_key: request.idempotencyKey,
    p_task_number: Number.isFinite(Number(request.task)) ? Number(request.task) : null,
    p_textbook_id: request.textbookId,
    p_source: request.source,
    p_description: 'Решение задачи ' + request.task,
  })

  if (error) {
    if (error.message.includes('insufficient balance')) {
      throw new HomeworkSolverError(402, 'На балансе меньше ' + formatRubles(price))
    }
    if (error.message.includes('account is blocked')) {
      throw new HomeworkSolverError(403, 'Аккаунт заблокирован')
    }
    throw new HomeworkSolverError(502, 'Не получилось зарезервировать оплату')
  }

  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.reserved === true)
}

// Гостевой резерв. Денег у гостя нет, поэтому «резервируется» единственная
// бесплатная попытка: база возвращает false, если она уже израсходована.
async function claimGuestSolution(
  guest: GuestIdentity,
  request: SolveHomeworkRequest,
  options: SolverOptions,
): Promise<boolean> {
  const admin = guestAdminClient(options)
  if (!admin) return false

  const { data, error } = await admin.rpc('claim_guest_solution', {
    p_guest_id: guest.guestId,
    p_idempotency_key: request.idempotencyKey,
    p_ip_hash: guest.ipHash,
  })

  if (error) throw new HomeworkSolverError(502, 'Не получилось выдать бесплатное решение')
  if (data !== true) {
    throw new HomeworkSolverError(
      402,
      'Бесплатное решение уже использовано. Зарегистрируйся — на счёт придут 20 ₽, это ещё четыре решения',
    )
  }

  return true
}

// Попытка возвращается, если решение так и не выдали: сгорать она не должна.
async function releaseGuestSolution(
  guest: GuestIdentity,
  request: SolveHomeworkRequest,
  options: SolverOptions,
): Promise<void> {
  const admin = guestAdminClient(options)
  if (!admin) return
  try {
    await admin.rpc('release_guest_solution', {
      p_guest_id: guest.guestId,
      p_idempotency_key: request.idempotencyKey,
    })
  } catch {
    // Исходную ошибку это скрывать не должно.
  }
}

function guestAdminClient(options: SolverOptions): SupabaseClient<Database> | null {
  if (!options.supabaseUrl || !options.serviceRoleKey) return null
  return createClient<Database>(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Компенсация резерва. Возврат проходит только если решение так и не выдано —
// это проверяет сама функция в базе, поэтому вызов безопасен и при гонках.
// Ошибку возврата глушим намеренно: она не должна подменять исходную причину сбоя.
async function refundSolutionCredit(
  account: AuthenticatedAccount | null,
  request: SolveHomeworkRequest,
  reason: string,
): Promise<void> {
  if (!account) return
  try {
    await account.client.rpc('refund_solution_credit', {
      p_idempotency_key: request.idempotencyKey,
      p_reason: reason.slice(0, 160),
    })
  } catch {
    // Резерв разгребёт ручная сверка; исходную ошибку это скрывать не должно.
  }
}

// Подпись ставит сама база: секрет не покидает её, а каноническая строка
// считается той же функцией, что и в проверяющем триггере, поэтому форматы
// не могут разъехаться. Право вызова есть только у service_role.
async function withServerProof(
  solution: HomeworkSolution,
  options: SolverOptions,
): Promise<HomeworkSolution> {
  if (!options.supabaseUrl || !options.serviceRoleKey) return solution

  const admin = createClient<Database>(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.rpc('sign_homework_solution', {
    p_solution: solution as unknown as Json,
  })
  if (error || typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) return solution

  return { ...solution, _serverProof: data } as HomeworkSolution
}

async function completeStoredSolution(
  account: AuthenticatedAccount | null,
  request: SolveHomeworkRequest,
  solution?: HomeworkSolution,
  options?: SolverOptions,
): Promise<HomeworkSolution | null> {
  if (!account) return solution ?? null
  const price = getSolutionPrice()
  const condition = request.condition ?? solution?.condition ?? ''
  const conditionNormalized = normalizeTaskCondition(condition)
  // Решение, сгенерированное движком, подписываем перед сохранением.
  // Триггер в базе пускает в общий каталог только эталонный payload либо
  // подписанный сервером — иначе любой клиент мог бы залить своё «решение».
  const signedSolution = solution && options ? await withServerProof(solution, options) : solution

  const { data, error } = await account.client.rpc('complete_homework_solution', {
    p_idempotency_key: request.idempotencyKey,
    ...(signedSolution ? { p_solution: signedSolution as unknown as Json } : {}),
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
        ? 'На балансе меньше ' + formatRubles(price)
        : 'Не получилось безопасно сохранить готовое решение',
    )
  }

  if (!data) return null
  if (typeof data !== 'object' || Array.isArray(data) || typeof data.condition !== 'string') {
    throw new HomeworkSolverError(502, 'База решений вернула некорректный ответ')
  }

  return data as unknown as HomeworkSolution
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

function requestId(request: IncomingMessage) {
  const value = request.headers['x-vercel-id']
  return Array.isArray(value) ? value[0] : value ?? 'local'
}

function logSolverEvent(
  level: 'info' | 'error',
  event: string,
  context: Record<string, string | number | boolean | undefined>,
) {
  const payload = JSON.stringify({ level, event, ...context })
  if (level === 'error') console.error(payload)
  else console.log(payload)
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
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Guest-Id')
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
  const startedAt = Date.now()
  const solveRequestId = requestId(request)

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
      model: options.model || defaultHomeworkModel,
      configured: Boolean(options.apiKey),
      engineVersion: homeworkSolutionEngineVersion,
    })
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, OPTIONS')
    sendJson(response, 405, { error: 'Допустимы только GET, POST и OPTIONS' })
    return
  }

  let taskNumber: string | undefined
  let source: SolveHomeworkRequest['source'] | undefined
  let stage = 'validate'

  try {
    const task = await validateRequest(await readJsonBody(request), options)
    taskNumber = task.task
    source = task.source
    logSolverEvent('info', 'homework_solve_started', {
      requestId: solveRequestId,
      task: taskNumber,
      source,
    })

    stage = 'authenticate'
    const guest = readGuestIdentity(request, options)
    const account = await authenticateAccount(request, options, guest)
    const guestSolving = account ? null : guest
    stage = 'restore'
    const existingSolution = await completeStoredSolution(account, task)
    if (existingSolution && isCurrentReviewedSolution(existingSolution)) {
      logSolverEvent('info', 'homework_solve_reused', {
        requestId: solveRequestId,
        task: taskNumber,
        source,
        durationMs: Date.now() - startedAt,
      })
      sendJson(response, 200, { solution: existingSolution })
      return
    }

    stage = 'balance'
    const reserved = existingSolution
      ? false
      : guestSolving
        ? await claimGuestSolution(guestSolving, task, options)
        : await reserveSolutionCredit(account, task)
    try {
      stage = 'generate'
      const solution = await solveWithKie(task, options, account?.userId)
      stage = 'persist'
      const completedSolution = await completeStoredSolution(account, task, solution, options)
      if (!completedSolution || !isCurrentReviewedSolution(completedSolution)) {
        throw new HomeworkSolverError(502, 'Не получилось сохранить готовое решение')
      }
      logSolverEvent('info', 'homework_solve_completed', {
        requestId: solveRequestId,
        task: taskNumber,
        source,
        durationMs: Date.now() - startedAt,
      })
      sendJson(response, 200, { solution: completedSolution })
    } catch (error) {
      if (reserved && guestSolving) await releaseGuestSolution(guestSolving, task, options)
      else if (reserved) await refundSolutionCredit(account, task, 'Решение не удалось получить')
      throw error
    }
  } catch (error) {
    const status = error instanceof HomeworkSolverError ? error.status : 500
    logSolverEvent('error', 'homework_solve_failed', {
      requestId: solveRequestId,
      task: taskNumber,
      source,
      stage,
      status,
      durationMs: Date.now() - startedAt,
      error: error instanceof HomeworkSolverError ? error.message : 'unexpected solver error',
    })
    if (error instanceof HomeworkSolverError) {
      sendJson(response, error.status, { error: error.message })
      return
    }
    sendJson(response, 500, { error: 'Не получилось подготовить решение. Попробуй ещё раз' })
  }
}
