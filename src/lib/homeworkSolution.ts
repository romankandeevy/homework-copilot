import { homeworkSolutionEngineVersion } from './homeworkContract'
import type { HomeworkSolution, SolveHomeworkRequest, SolveReceipt } from './homeworkContract'
import type { Json } from './database.types'

export const generatedSolutionsStorageKey = 'homework-copilot:generated-solutions-v1'

/* Что показываем ученику.

   Версия движка здесь не при чём: за решение заплачено, и от того, что мы
   поменяли формат записи, оно не должно пропадать со страницы. Так и вышло
   4 сентября - подняли версию до 3, и оплаченное решение молча исчезло из
   «Моих решений», хотя лежало в базе. Лист рендерится и без новых полей:
   объяснение необязательно. */
export function isReviewedHomeworkSolution(solution: HomeworkSolution) {
  return solution.quality?.reviewPassed === true
}

/* Что можно отдать повторно вместо нового вызова модели.

   Здесь версия важна: повтор по той же задаче должен дать нынешний формат,
   а не запись, собранную прежним движком - без объяснения и с прежними
   правилами проверки. */
export function isCurrentEngineSolution(solution: HomeworkSolution) {
  return solution.engineVersion === homeworkSolutionEngineVersion
    && isReviewedHomeworkSolution(solution)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/* Разбор сохранённого решения.

   Лист тетради читает `given`, `goal`, `diagram` и `answer` без защиты: одно
   решение с битым полем в localStorage или в базе роняло всё приложение до
   корневой заглушки «Страница не открылась» (аудит 16 сентября, Б11).
   Поэтому форма проверяется здесь. Сломанная запись не показывается вовсе;
   старая, у которой нет необязательного по смыслу поля, - дополняется
   пустым значением, чтобы оплаченное решение не пропало. */
export function parseStoredHomeworkSolution(value: Json | unknown, ownerId?: string): HomeworkSolution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.textbookId !== 'string'
    || typeof candidate.task !== 'string'
    || typeof candidate.condition !== 'string'
    || typeof candidate.textbookEdition !== 'string'
    || typeof candidate.sourceUrl !== 'string'
    || typeof candidate.conditionNormalized !== 'string'
    || !isStringList(candidate.steps)
  ) return null

  if (candidate.given !== undefined && !isStringList(candidate.given)) return null
  if (candidate.answer !== undefined && typeof candidate.answer !== 'string') return null
  if (candidate.explanation !== undefined && !isStringList(candidate.explanation)) return null

  const goal = candidate.goal
  if (
    !goal || typeof goal !== 'object' || Array.isArray(goal)
    || typeof (goal as Record<string, unknown>).title !== 'string'
    || typeof (goal as Record<string, unknown>).text !== 'string'
  ) return null

  const diagram = candidate.diagram
  if (!diagram || typeof diagram !== 'object' || Array.isArray(diagram)) return null
  const diagramFields = diagram as Record<string, unknown>
  if (typeof diagramFields.kind !== 'string') return null
  if (diagramFields.vertices !== undefined && !isStringList(diagramFields.vertices)) return null

  const solution = {
    ...candidate,
    given: candidate.given ?? [],
    answer: candidate.answer ?? '',
    diagram: {
      ...diagramFields,
      description: typeof diagramFields.description === 'string' ? diagramFields.description : '',
      vertices: diagramFields.vertices ?? [],
    },
  } as HomeworkSolution
  return ownerId ? { ...solution, ownerId } : solution
}

/* Решение гостя лежит в этом браузере не дольше недели - столько же, сколько
   его хранит база (`private.guest_generated_solutions`). На общем компьютере
   следующий человек иначе видел бы чужие задачи бессрочно (аудит 16
   сентября, В11). У решения с аккаунтом есть `ownerId`, оно живёт в базе и
   возвращается оттуда. */
export const guestSolutionLifetimeMs = 7 * 24 * 60 * 60 * 1000

export function isExpiredGuestSolution(solution: HomeworkSolution, now = Date.now()) {
  if (solution.ownerId) return false
  const createdAt = Date.parse(solution.createdAt)
  return Number.isFinite(createdAt) && now - createdAt > guestSolutionLifetimeMs
}

export function loadGeneratedSolutions(): HomeworkSolution[] {
  try {
    const stored = window.localStorage.getItem(generatedSolutionsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((entry) => parseStoredHomeworkSolution(entry))
      .filter((entry): entry is HomeworkSolution => entry !== null && !isExpiredGuestSolution(entry))
  } catch {
    return []
  }
}

export function saveGeneratedSolutions(solutions: readonly HomeworkSolution[]) {
  try {
    window.localStorage.setItem(generatedSolutionsStorageKey, JSON.stringify(solutions.slice(0, 100)))
  } catch {
    // The active solution remains available when browser storage is blocked or full.
  }
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не получилось прочитать фотографию задачи'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Не получилось подготовить фотографию задачи'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/* Фото ужимается до отправки, а не только когда не влезает в предел.

   Аудит 5 сентября: за три дня девять гостей прислали задачу фотографией, и
   ни одна не дошла до функции на Vercel - в журнале функции нет ни вызова,
   строка очереди осталась без `started_at`. Текстовые задачи в те же часы
   доходили. Разница одна: тело запроса с фото - 3-4 МБ base64, а трафик к
   адресам Vercel из российских сетей после первых килобайт режется до
   килобайта в секунду (замер в AGENTS.md, «Хостинг»). Снимок учебника в
   1600 px и JPEG 0,8 весит 300-700 КБ - в пять-десять раз меньше; на цену
   это не влияет, картинка тарифицируется плоско (KIE_MODEL_MATRIX.md).

   Мелкий файл не трогаем: PNG со схемой или скриншот условия и так лёгкие,
   а перекодирование в JPEG только размыло бы тонкие линии. */
const photoPassThroughBytes = 600_000
const photoMaxBytes = 2_800_000
const photoMaxSide = 1600

async function shrinkPhoto(file: Blob, maxSide: number, quality: number): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return null
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/* HEIC - формат камеры iPhone. Браузер, который его не декодирует, не
   ужмёт снимок, а модель на той стороне его тоже не обязана читать: раньше
   такой файл до 2,8 МБ уходил как есть и падал уже после оплаты, больше -
   отказом «Не получилось уменьшить». Теперь HEIC всегда переводится в JPEG
   здесь, а не вышло - честный отказ до отправки (аудит 16 сентября, Б11). */
export const heicUnsupportedMessage = 'Этот браузер не открывает фото в формате HEIC. Сделай снимок экрана с задачей или сохрани фото как JPEG и приложи его'

export function isHeicPhoto(file: Pick<File, 'type' | 'name'>) {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '')
}

export async function prepareTaskPhoto(file: File): Promise<string> {
  const heic = isHeicPhoto(file)
  if (!heic && file.size <= photoPassThroughBytes) return readFileAsDataUrl(file)
  if (typeof createImageBitmap !== 'function') {
    if (heic) throw new Error(heicUnsupportedMessage)
    if (file.size <= photoMaxBytes) return readFileAsDataUrl(file)
    throw new Error('Фотография слишком большая. Выбери изображение до 2,8 МБ')
  }

  let compressed: Blob | null = null
  try {
    compressed = await shrinkPhoto(file, photoMaxSide, 0.8)
    // Всё ещё тяжёлая - значит снимок шумный; вторая попытка мельче и грубее.
    if (compressed && compressed.size > 1_200_000) compressed = await shrinkPhoto(file, 1280, 0.72)
  } catch {
    // Формат браузеру не по зубам.
    compressed = null
  }

  if (!compressed) {
    if (heic) throw new Error(heicUnsupportedMessage)
    if (file.size <= photoMaxBytes) return readFileAsDataUrl(file)
    throw new Error('Не получилось уменьшить фотографию задачи')
  }
  if (compressed.size > photoMaxBytes) {
    throw new Error('Фотография слишком большая. Сделай снимок ближе к условию')
  }
  return readFileAsDataUrl(compressed)
}

/* Обрыв связи — не отказ решателя.

   Мобильная сеть роняет долгий запрос сама по себе, а решатель об этом не
   знает: он доводит задачу до конца и сохраняет решение. Поэтому обрыв
   отличается от настоящей ошибки отдельным типом — по нему очередь ждёт
   сервер дальше, вместо того чтобы хоронить задачу, которая ещё решается. */
export class SolutionConnectionLostError extends Error {
  constructor() {
    super('Связь оборвалась, но решение продолжает готовиться')
    this.name = 'SolutionConnectionLostError'
  }
}

/* Задачу по этому ключу уже решает другой запрос: вторая вкладка или
   страница до перезагрузки (аудит 16 сентября, Б7). Сервер это видит по
   резерву и отвечает 409 с `inProgress`. Для вкладки это не отказ и не
   «не дошло»: строку ведёт работающий запрос, и закрывать её нельзя. */
export class SolutionInProgressError extends SolutionConnectionLostError {
  constructor() {
    super()
    this.name = 'SolutionInProgressError'
  }
}

/* Метка ответа решателя. Ставит её сам решатель на каждый свой ответ
   (`homeworkSolverHeader` в server/homeworkSolver.ts). */
export const homeworkSolverHeader = 'x-homework-solver'

/* Ответ, который решатель не давал (аудит 16 сентября, Б5).

   5xx может прийти не от решателя: прокси на Supabase отвечает JSON 502 на
   обрыв до Vercel и своё на истёкшие 150 секунд, Vercel - 504 на убитую по
   сроку функцию. Решатель в это время может досчитать и списать деньги.
   Раньше такой JSON читался окончательным отказом: вкладка закрывала задачу
   и просила возврат, а «Решить ещё раз» списывало второй раз. Теперь 5xx без
   метки решателя - обрыв связи, и очередь ждёт исхода из базы. */
export function isSolverConnectionLoss(response: { status?: number; headers?: { get?: (name: string) => string | null } }) {
  const status = typeof response.status === 'number' ? response.status : 0
  if (status < 500) return false
  return response.headers?.get?.(homeworkSolverHeader) !== '1'
}

/* Сколько ждём, пока сервер подтвердит, что задача до него дошла.

   Обрыв связи и запрос, который не дошёл вовсе, снаружи неразличимы: и там
   и там fetch молчит. Различает их сервер: получив задачу, он через секунду
   ставит ей стадию «reading» в очереди (`report_homework_job`), и вкладка
   видит это опросом. Нет отметки полминуты - задача до сервера не дошла, и
   ждать дальше нечего: решатель её не считает, денег не резервировал.

   5 сентября задача из текста дошла до функции через четыре с половиной
   минуты после постановки, задачи с фото не доходили вовсе, а вкладка всё
   это время показывала «Читаем» и закрывала строку только по сроку - через
   пять или двадцать минут. */
export const serverAcceptLimitMs = 30_000

/* Сторож считает от начала запроса, а расписку сервер даёт только прочитав
   тело целиком. Фото в 3-4 МБ на медленной сети грузится дольше тридцати
   секунд: вкладка обрывала запрос, который вот-вот дошёл бы (аудит 16
   сентября, Б6). Отправку тела fetch не показывает, поэтому срок растёт с
   размером тела: полминуты плюс секунда на каждые 25 КБ, но не больше двух
   минут. Текстовая задача ждёт те же тридцать секунд. */
const acceptUploadBytesPerSecond = 25_000
const serverAcceptCeilingMs = 120_000

export function serverAcceptLimitFor(bodyBytes: number) {
  const upload = Math.max(0, bodyBytes) / acceptUploadBytesPerSecond * 1000
  return Math.round(Math.min(serverAcceptCeilingMs, serverAcceptLimitMs + upload))
}

export class SolutionNotAcceptedError extends Error {
  constructor(limitMs = serverAcceptLimitMs) {
    super(`Сервер решений не принял задачу за ${Math.round(limitMs / 1000)} секунд: соединение до него не доходит. Попробуй ещё раз или смени сеть`)
    this.name = 'SolutionNotAcceptedError'
  }
}

export async function requestHomeworkSolution(
  endpoint: string,
  request: SolveHomeworkRequest,
  accessToken?: string,
  // Метка браузера. Нужна только гостю: по ней сервер выдаёт одно
  // бесплатное решение до регистрации.
  guestId?: string | null,
  // Обрыв по инициативе вкладки - когда сервер так и не подтвердил приём.
  signal?: AbortSignal,
  // Уже собранное тело: вкладка меряет его, чтобы выставить срок сторожа.
  body: string = JSON.stringify(request),
): Promise<{ solution: HomeworkSolution; receipt: SolveReceipt | null }> {
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...(!accessToken && guestId ? { 'X-Guest-Id': guestId } : {}),
      },
      body,
      ...(signal ? { signal } : {}),
    })
  } catch {
    if (signal?.aborted) {
      throw signal.reason instanceof SolutionNotAcceptedError ? signal.reason : new SolutionNotAcceptedError()
    }
    throw new SolutionConnectionLostError()
  }

  /* Шлюз перед сервером (функция на Supabase) живёт 150 секунд, Vercel -
     300; оба отвечают сами, без решателя. Решатель при этом может работать
     дальше и сохранить ответ в базу - для вкладки это обрыв связи, а не
     отказ: очередь дождётся и заберёт решение оттуда. */
  if (isSolverConnectionLoss(response)) throw new SolutionConnectionLostError()

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Сервер решений вернул некорректный ответ')
  }

  // Эту задачу уже решает другой запрос - ждать его исхода, а не хоронить.
  if (payload && typeof payload === 'object' && 'inProgress' in payload && payload.inProgress === true) {
    throw new SolutionInProgressError()
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'Не получилось подготовить решение'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object' || !('solution' in payload)) {
    throw new Error('Сервер не вернул готовое решение')
  }

  return { solution: payload.solution as HomeworkSolution, receipt: readReceipt(payload) }
}

// Старый сервер чека не присылает - тогда его просто нет, решение важнее.
function readReceipt(payload: object): SolveReceipt | null {
  const receipt = 'receipt' in payload ? payload.receipt : null
  if (!receipt || typeof receipt !== 'object') return null
  const { seconds, kopecks, reused } = receipt as Record<string, unknown>
  if (typeof seconds !== 'number' || typeof kopecks !== 'number') return null
  return { seconds, kopecks, ...(reused === true ? { reused: true } : {}) }
}
