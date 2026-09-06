import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { homeworkSolutionEngineVersion, maxConditionLength } from '../src/lib/homeworkContract.ts'
import type { HomeworkSolution, HomeworkTaskType, SolveHomeworkRequest } from '../src/lib/homeworkContract.ts'
import type { Database, Json } from '../src/lib/database.types.ts'
import { formatRubles } from '../src/lib/currency.ts'
import { getSolutionPrice, kieCreditKopecks } from '../src/lib/solutionPricing.ts'
import { isSolvableSubject } from '../src/lib/subjects.ts'
import { findVerifiedTextbookTask, geometryTextbookIdentity, normalizeTaskCondition } from '../src/textbooks/taskCatalog.ts'
import {
  defaultHomeworkModel,
  GeometrySolutionEngineError,
  isCurrentReviewedSolution,
  providerUnavailableMessage,
  solveHomeworkWithReview,
  validateSolutionQuality,
} from './geometrySolutionEngine.ts'
import type { HomeworkModelCall, HomeworkSolveStage } from './geometrySolutionEngine.ts'

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
  onStage?: (stage: HomeworkSolveStage) => void,
  onCost?: (call: HomeworkModelCall) => void,
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
      explanation: [...verifiedTask.explanation],
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
      ...(onStage ? { onStage } : {}),
      ...(onCost ? { onCost } : {}),
    }, ownerId)
  } catch (error) {
    if (!(error instanceof GeometrySolutionEngineError)) throw error
    if (/перегружена/u.test(error.message)) throw new HomeworkSolverError(429, error.message)
    if (/не успела/u.test(error.message)) throw new HomeworkSolverError(504, error.message)
    if (error.message === providerUnavailableMessage) {
      throw new HomeworkSolverError(503, `${providerUnavailableMessage}. Деньги остались на балансе — попробуй через минуту`)
    }
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

/* Пределы одного аккаунта за сутки.

   Неудача возвращает деньги ученику — так обещано на витрине, — но
   провайдеру за неё уже уплачено: один разбор это три-четыре вызова модели,
   примерно 18 копеек. Пока пределов не было, любой аккаунт с пятью рублями
   на счету мог гонять заведомо непроходные условия по кругу и тратить наши
   деньги без остановки: с него не списывалось ничего, с нас — за каждую
   попытку. Поэтому считаем не деньги ученика, а свои вызовы модели, и
   отдельно — неудачи, у которых цена та же, а выручки нет.

   Живому ученику эти числа не мешают: шестьдесят решений в сутки — это
   больше, чем домашка за неделю. */
const dailySolveAttempts = 60
const dailyFailedAttempts = 12
const dayMs = 24 * 60 * 60 * 1000

async function assertDailySolveLimits(account: AuthenticatedAccount) {
  const since = new Date(Date.now() - dayMs).toISOString()
  let entries: { kind: string; idempotency_key: string }[]
  try {
    const { data, error } = await account.client
      .from('wallet_entries')
      .select('kind,idempotency_key')
      .eq('user_id', account.userId)
      .gte('created_at', since)
      .limit(400)
    // Книга не прочиталась — это наша беда, а не ученика: решение идёт дальше.
    if (error || !data) {
      if (error) logSolverEvent('error', 'homework_solve_limit_unreadable', { message: error.message })
      return
    }
    entries = data
  } catch (error) {
    logSolverEvent('error', 'homework_solve_limit_unreadable', {
      message: error instanceof Error ? error.message : 'unknown',
    })
    return
  }

  const attempts = entries.filter((entry) => entry.kind === 'debit').length
  const failed = entries.filter((entry) => entry.idempotency_key.endsWith(':refund')).length

  if (failed >= dailyFailedAttempts) {
    throw new HomeworkSolverError(429, 'Сегодня слишком много задач не решилось. Проверь условие и вернись завтра')
  }
  if (attempts >= dailySolveAttempts) {
    throw new HomeworkSolverError(429, 'Сегодня решено ' + dailySolveAttempts + ' задач — это дневной предел. Продолжим завтра')
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
  // Предмет больше не подсказка, а ключ к правилам проверки: у каждого свои
  // требования к записи, и без предмета проверять решение нечем.
  if (!isSolvableSubject(text(candidate.subject))) {
    throw new HomeworkSolverError(400, 'Выбери предмет: от него зависят правила проверки решения')
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
  // Пометка к фотографии: короткая строка, условием не считается.
  const note = text(candidate.note).slice(0, 200)
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
  /* Верхняя граница условия — тоже граница задачи.

     Раньше условие молча резалось до 5000 знаков: вставленная простыня из
     сотен примеров доезжала до модели первой четвертью, а ученик получал
     разбор обрезанного задания и не знал об этом. Тетрадная страница держит
     четырнадцать строк решения, так что такой запрос всё равно не прошёл бы
     проверку — но три-четыре вызова модели за него мы бы уже оплатили.
     Теперь длинное условие отвергается сразу и с объяснением. */
  if (condition.length > maxConditionLength) {
    throw new HomeworkSolverError(400, 'Условие длиннее ' + maxConditionLength + ' знаков — это уже не одна задача. Раздели её и пришли по частям')
  }
  /* Указание на задачу — не задача.

     6 сентября на проде: условие целиком выглядело как «Решить задачу 1 про
     образование воды». Ни данных, ни вопроса, ни самой задачи - ученик
     сослался на учебник, который есть только у него. Модель сочинила общий
     текст, проверка увидела словесный абзац и пустое «Дано», ученик прочёл
     «Решение не дошло», как будто сломались мы. Двадцать две секунды и
     двадцать девять копеек за отказ, который был виден до вызова модели.

     Отвергаем только явную ссылку без содержания: короткая строка, которая
     отсылает к номеру, странице или фотографии. Настоящее короткое задание
     («Докажите, что диагонали прямоугольника равны») ссылок не содержит и
     проходит. */
  if (source === 'text' && conditionIsOnlyAReference(condition)) {
    throw new HomeworkSolverError(
      422,
      'В условии только ссылка на задачу. Пришли саму задачу текстом или сфотографируй её — учебника у нас нет',
    )
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
    ...(condition ? { condition: condition.slice(0, maxConditionLength) } : {}),
    ...(note ? { note: note.slice(0, 200) } : {}),
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

/* Подпись прокси на Supabase (supabase/functions/api).

   Из российских сетей запрос идёт не напрямую на Vercel, а через функцию
   на домене Supabase. Vercel переписывает `x-forwarded-for` адресом того,
   кто подключился, - то есть прокси, - и все гости сливались бы в один
   адрес, а предел бесплатных решений на адрес закрывал бы их третьим по
   счёту. Поэтому прокси присылает настоящий адрес в `x-client-ip` и
   подпись в `x-proxy-auth`: хэш служебного ключа, который есть у обеих
   сторон. Без верной подписи заголовок не читается - подставить чужой
   адрес прямым запросом на Vercel нельзя. */
export function proxyAuthDigest(serviceRoleKey: string) {
  return createHash('sha256').update(serviceRoleKey + ':homework-copilot-proxy').digest('hex')
}

function headerText(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value ?? '').trim()
}

export function trustedClientAddress(
  headers: Record<string, string | string[] | undefined>,
  serviceRoleKey: string | undefined,
): string | null {
  const proxied = headerText(headers['x-client-ip'])
  const auth = headerText(headers['x-proxy-auth'])
  if (!proxied || !auth || !serviceRoleKey) return null
  const expected = Buffer.from(proxyAuthDigest(serviceRoleKey))
  const matches = auth.split(',').some((candidate) => {
    const offered = Buffer.from(candidate.trim())
    return offered.length === expected.length && timingSafeEqual(offered, expected)
  })
  return matches ? proxied : null
}

export function requestCameThroughProxy(request: IncomingMessage, options: SolverOptions) {
  return trustedClientAddress(request.headers, options.serviceRoleKey) !== null
}

// Адрес не хранится: в базу уходит только необратимый хэш, и соль для него
// выводится из служебного ключа, а не задаётся отдельной переменной окружения.
function hashRequestAddress(request: IncomingMessage, options: SolverOptions): string | null {
  if (!options.serviceRoleKey) return null

  const forwarded = request.headers['x-forwarded-for']
  const raw = trustedClientAddress(request.headers, options.serviceRoleKey)
    ?? (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? request.socket?.remoteAddress ?? '')
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
    // Деньги по этому ключу уже вернулись ученику, и повторно снимать их молча
    // нельзя. Задача ставится заново — у неё будет свой ключ и своя оплата.
    if (error.message.includes('reservation refunded')) {
      throw new HomeworkSolverError(409, 'Оплата за эту задачу уже вернулась на баланс. Поставь её заново')
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

/* Стадии решения в строке очереди.

   Ученик видит не бегунок, изображающий занятость, а то, до чего работа
   действительно дошла. Записи идут цепочкой и не ждутся: очередь — это
   свидетельство о ходе работы, и задерживать ради него само решение нельзя.
   Терминальную запись перед ответом дожидаемся — по ней остальные устройства
   узнают, что задача закрыта. */
type JobStage = HomeworkSolveStage | 'reading' | 'writing' | 'done' | 'failed'

type JobReporter = {
  report: (stage: JobStage, extra?: { error?: string; task?: string }) => void
  flush: () => Promise<void>
}

function createJobReporter(
  options: SolverOptions,
  request: SolveHomeworkRequest,
  account: AuthenticatedAccount | null,
  guest: GuestIdentity | null,
): JobReporter {
  const admin = guestAdminClient(options)
  if (!admin || (!account && !guest)) return { report: () => {}, flush: async () => {} }

  let chain: Promise<unknown> = Promise.resolve()
  return {
    report(stage, extra) {
      chain = chain
        .then(() => admin.rpc('report_homework_job', {
          p_idempotency_key: request.idempotencyKey,
          p_stage: stage,
          p_user_id: account?.userId ?? null,
          p_guest_id: account ? null : guest?.guestId ?? null,
          p_error: extra?.error ? extra.error.slice(0, 400) : null,
          p_task: extra?.task ?? null,
        }))
        // Сорванная отметка стадии не должна ронять решение: она про показ.
        .catch(() => undefined)
    },
    async flush() {
      await chain.catch(() => undefined)
    },
  }
}

/* Решение гостя переживает перезаход.

   У ученика с аккаунтом решение лежит в базе и возвращается само. У гостя
   аккаунта нет, и решение жило только в ответе того запроса, который послала
   вкладка: перезагрузка на середине убивала вкладку вместе с ответом, очередь
   доходила до «Решение готово», а открывать было нечего.

   Хранение по метке браузера чинит заодно и повтор: тот же ключ больше не
   гоняет модель второй раз. */
async function restoreGuestSolution(
  guest: GuestIdentity,
  request: SolveHomeworkRequest,
  options: SolverOptions,
): Promise<HomeworkSolution | null> {
  const admin = guestAdminClient(options)
  if (!admin) return null

  try {
    const { data, error } = await admin.rpc('get_guest_homework_solution', {
      p_guest_id: guest.guestId,
      p_idempotency_key: request.idempotencyKey,
    })
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null
    return data as unknown as HomeworkSolution
  } catch {
    return null
  }
}

async function storeGuestSolution(
  guest: GuestIdentity,
  request: SolveHomeworkRequest,
  solution: HomeworkSolution,
  options: SolverOptions,
): Promise<void> {
  const admin = guestAdminClient(options)
  if (!admin) return

  try {
    await admin.rpc('store_guest_homework_solution', {
      p_guest_id: guest.guestId,
      p_idempotency_key: request.idempotencyKey,
      p_solution: solution as unknown as Json,
    })
  } catch {
    // Не сохранилось — решение всё равно уходит ученику этим же ответом.
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
    if (error.message.includes('insufficient balance')) {
      throw new HomeworkSolverError(402, 'На балансе меньше ' + formatRubles(price))
    }
    // Резерв вернулся раньше, чем решение дошло: выдать его сейчас — значит
    // отдать даром. Ученик остаётся при деньгах и ставит задачу заново.
    if (error.message.includes('reservation refunded')) {
      throw new HomeworkSolverError(409, 'Оплата за эту задачу уже вернулась на баланс. Поставь её заново')
    }
    throw new HomeworkSolverError(502, 'Не получилось безопасно сохранить готовое решение')
  }

  if (!data) return null
  if (typeof data !== 'object' || Array.isArray(data) || typeof data.condition !== 'string') {
    throw new HomeworkSolverError(502, 'База решений вернула некорректный ответ')
  }

  return data as unknown as HomeworkSolution
}

/* Сколько ждём решение, прежде чем признать неудачу. Потолок функции —
   300 секунд; оставляем запас на сохранение решения и возврат денег. */
const solveTimeBudgetMs = 230_000

function solveDeadline(): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new HomeworkSolverError(
        504,
        'Задача оказалась слишком долгой. Деньги вернулись на баланс — попробуй ещё раз или упрости условие',
      ))
    }, solveTimeBudgetMs)
    // Таймер не должен держать процесс, если решение пришло раньше.
    timer.unref?.()
  })
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

/* Себестоимость решения.

   Цена решения выведена из замера 30 августа: 18 копеек за выданный разбор
   при цене 5 ₽. Замер был ручной, на другом пуле и на восьми задачах - с тех
   пор сменились и пул, и устройство прохода. 6 сентября выяснилось, чего
   стоит такая слепота: один вызов gpt-5-6-sol на трудной комбинаторике
   обошёлся в 6,10 кредита - 3 ₽ из пяти, и это без починки.

   Поэтому расход считается сам, на каждой задаче: сколько было вызовов,
   какими моделями и во сколько они обошлись. Кредиты приходят от шлюза в
   теле ответа; молчит шлюз - в журнале пусто, а не выдуманный ноль. */
type SolveCostSummary = {
  calls: number
  credits: number | null
  kopecks: number | null
  models: string
  modelSeconds: number
}

function summarizeSolveCost(calls: readonly HomeworkModelCall[]): SolveCostSummary {
  const known = calls.filter((call) => call.credits !== null)
  const credits = known.length > 0
    ? Number(known.reduce((total, call) => total + (call.credits ?? 0), 0).toFixed(4))
    : null
  const perModel = new Map<string, number>()
  for (const call of calls) perModel.set(call.model, (perModel.get(call.model) ?? 0) + 1)
  return {
    calls: calls.length,
    credits,
    kopecks: credits === null ? null : Math.round(credits * kieCreditKopecks),
    models: [...perModel].map(([model, count]) => (count > 1 ? `${model}×${count}` : model)).join(','),
    modelSeconds: Number(calls.reduce((total, call) => total + call.seconds, 0).toFixed(1)),
  }
}

/* Замер живёт дольше журнала. Логи Vercel хранятся считаные дни, а цену
   пересматривают по неделям наблюдений, поэтому расход ещё и записывается
   в базу - служебной ролью, мимо ученика. Не записалось - решение всё
   равно уходит: учёт не повод терять оплаченный разбор. */
async function recordSolveCost(
  options: SolverOptions,
  request: SolveHomeworkRequest,
  cost: SolveCostSummary,
  outcome: 'solved' | 'failed',
  seconds: number,
): Promise<void> {
  if (cost.calls === 0) return
  const admin = guestAdminClient(options)
  if (!admin) return

  try {
    await admin.rpc('record_solution_cost', {
      p_subject: request.subject,
      p_source: request.source,
      p_models: cost.models,
      p_calls: cost.calls,
      p_credits: cost.credits,
      p_cost_kopecks: cost.kopecks,
      p_price_kopecks: getSolutionPrice(),
      p_seconds: Number(seconds.toFixed(1)),
      p_outcome: outcome,
    })
  } catch {
    // Учёт себестоимости - не часть решения задачи.
  }
}

/* Ссылка на задание вместо задания.

   Короткая строка, которая отсылает к номеру, странице, фотографии или
   учебнику и ничего больше не сообщает. Порог в 90 знаков не строгий, а
   осторожный: чем длиннее строка, тем вероятнее, что ученик всё-таки
   переписал условие и просто упомянул номер. */
const referenceOnlyPattern = /задач[уиае]?\s*(?:№|номер)?\s*\d|упражнени[еяю]\s*(?:№|номер)?\s*\d|задани[еяю]\s*(?:№|номер)?\s*\d|пример\s*(?:№|номер)?\s*\d|номер\s*\d|стр\.?\s*\d|страниц[ыеу]\s*\d|сверху|снизу|на фото|с фото|по фото|на картинке|из учебника|в учебнике/giu

export function conditionIsOnlyAReference(condition: string) {
  const trimmed = condition.trim()
  if (trimmed.length === 0 || trimmed.length > 90) return false
  referenceOnlyPattern.lastIndex = 0
  if (!referenceOnlyPattern.test(trimmed)) return false
  /* Данные в строке - признак настоящей задачи: «В задаче 1 масса 200 г»
     решается и без учебника. Числа из самой ссылки («задачу 1») в счёт не
     идут, поэтому ссылки вырезаем перед проверкой. */
  const withoutReference = trimmed.replace(referenceOnlyPattern, ' ')
  return !/\d/u.test(withoutReference)
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
  let job: JobReporter = { report: () => {}, flush: async () => {} }
  // Во что обошлась задача: по строке на каждый вызов модели.
  const modelCalls: HomeworkModelCall[] = []
  let solveTask: SolveHomeworkRequest | null = null

  try {
    const task = await validateRequest(await readJsonBody(request), options)
    solveTask = task
    taskNumber = task.task
    source = task.source
    logSolverEvent('info', 'homework_solve_started', {
      requestId: solveRequestId,
      task: taskNumber,
      source,
      // По этому полю видно, что путь через Supabase работает и подпись сошлась.
      via: requestCameThroughProxy(request, options) ? 'supabase-proxy' : 'direct',
      // Дошла ли фотография. 6 сентября выяснять это пришлось по косвенным
      // признакам, потому что в журнале о снимке не было ни слова.
      photoBytes: task.imageDataUrl ? task.imageDataUrl.length : 0,
      conditionLength: task.condition ? task.condition.length : 0,
      noteLength: task.note ? task.note.length : 0,
      // Начала подписей - своей и присланной: по ним видно, чей ключ разошёлся.
      // Самих ключей в журнале нет.
      proxyAuthExpected: options.serviceRoleKey ? proxyAuthDigest(options.serviceRoleKey).slice(0, 8) : '',
      proxyAuthOffered: headerText(request.headers['x-proxy-auth']).split(',').map((entry) => entry.slice(0, 8)).join(','),
    })

    stage = 'authenticate'
    const guest = readGuestIdentity(request, options)
    const account = await authenticateAccount(request, options, guest)
    const guestSolving = account ? null : guest
    job = createJobReporter(options, task, account, guestSolving)
    job.report('reading')
    stage = 'restore'
    const existingSolution = guestSolving
      ? await restoreGuestSolution(guestSolving, task, options)
      : await completeStoredSolution(account, task)
    if (existingSolution && isCurrentReviewedSolution(existingSolution)) {
      logSolverEvent('info', 'homework_solve_reused', {
        requestId: solveRequestId,
        task: taskNumber,
        source,
        durationMs: Date.now() - startedAt,
      })
      job.report('done', { task: existingSolution.task })
      await job.flush()
      sendJson(response, 200, { solution: existingSolution })
      return
    }

    stage = 'balance'
    if (account && !existingSolution) await assertDailySolveLimits(account)
    const reserved = existingSolution
      ? false
      : guestSolving
        ? await claimGuestSolution(guestSolving, task, options)
        : await reserveSolutionCredit(account, task)
    try {
      stage = 'generate'
      // Собственный срок короче потолка функции.
      //
      // 31 августа задача по комбинаторике шла дольше трёхсот секунд, и
      // Vercel убил процесс. Вместе с процессом умер и `catch` ниже — тот
      // самый, что возвращает резерв. Ученик остался без решения и без
      // денег: списание в кошельке есть, возврата нет.
      //
      // Поэтому решение гоняется наперегонки со сроком. Проиграло — считаем
      // это обычной неудачей: возврат отрабатывает штатно, а ответ уходит
      // с понятной причиной, пока функция ещё жива.
      const solution = await Promise.race([
        solveWithKie(
          task,
          options,
          account?.userId,
          (modelStage) => job.report(modelStage),
          (call) => modelCalls.push(call),
        ),
        solveDeadline(),
      ])
      stage = 'persist'
      job.report('writing')
      const completedSolution = await completeStoredSolution(account, task, solution, options)
      if (!completedSolution || !isCurrentReviewedSolution(completedSolution)) {
        throw new HomeworkSolverError(502, 'Не получилось сохранить готовое решение')
      }
      // Гостю сохраняем по метке браузера: иначе решение существует только
      // в этом ответе и пропадает вместе с перезагруженной вкладкой.
      if (guestSolving) await storeGuestSolution(guestSolving, task, completedSolution, options)
      const cost = summarizeSolveCost(modelCalls)
      logSolverEvent('info', 'homework_solve_completed', {
        requestId: solveRequestId,
        task: taskNumber,
        source,
        durationMs: Date.now() - startedAt,
        modelCalls: cost.calls,
        models: cost.models,
        credits: cost.credits ?? undefined,
        costKopecks: cost.kopecks ?? undefined,
      })
      await recordSolveCost(options, task, cost, 'solved', (Date.now() - startedAt) / 1000)
      job.report('done', { task: completedSolution.task })
      await job.flush()
      sendJson(response, 200, { solution: completedSolution })
    } catch (error) {
      if (reserved && guestSolving) await releaseGuestSolution(guestSolving, task, options)
      else if (reserved) await refundSolutionCredit(account, task, 'Решение не удалось получить')
      throw error
    }
  } catch (error) {
    const status = error instanceof HomeworkSolverError ? error.status : 500
    job.report('failed', {
      error: error instanceof HomeworkSolverError ? error.message : 'Не получилось подготовить решение. Попробуй ещё раз',
    })
    await job.flush()
    /* Ожидаемый исход — не поломка.

       «Бесплатное решение уже использовано» и «на балансе недостаточно» — это
       нормальный ответ продукта, а не сбой. В журнале ошибок они лежали рядом
       с настоящими отказами и превращали разбор простоя в перебор шума. */
    const expectedOutcome = status === 402 || status === 400 || status === 422
    const failedCost = summarizeSolveCost(modelCalls)
    logSolverEvent(expectedOutcome ? 'info' : 'error', 'homework_solve_failed', {
      requestId: solveRequestId,
      task: taskNumber,
      source,
      stage,
      status,
      durationMs: Date.now() - startedAt,
      error: error instanceof HomeworkSolverError ? error.message : 'unexpected solver error',
      modelCalls: failedCost.calls,
      models: failedCost.models,
      credits: failedCost.credits ?? undefined,
      costKopecks: failedCost.kopecks ?? undefined,
    })
    // Неудача стоит нам столько же: за токены платят, а не за годность.
    if (solveTask) await recordSolveCost(options, solveTask, failedCost, 'failed', (Date.now() - startedAt) / 1000)
    if (error instanceof HomeworkSolverError) {
      sendJson(response, error.status, { error: error.message })
      return
    }
    sendJson(response, 500, { error: 'Не получилось подготовить решение. Попробуй ещё раз' })
  }
}
