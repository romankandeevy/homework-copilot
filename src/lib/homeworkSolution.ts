import { homeworkSolutionEngineVersion } from './homeworkContract'
import type { HomeworkSolution, SolveHomeworkRequest } from './homeworkContract'
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
    || !Array.isArray(candidate.steps)
  ) return null

  const solution = candidate as HomeworkSolution
  return ownerId ? { ...solution, ownerId } : solution
}

export function loadGeneratedSolutions(): HomeworkSolution[] {
  try {
    const stored = window.localStorage.getItem(generatedSolutionsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((entry) => parseStoredHomeworkSolution(entry))
      .filter((entry): entry is HomeworkSolution => entry !== null)
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

export async function prepareTaskPhoto(file: File): Promise<string> {
  if (file.size <= photoPassThroughBytes) return readFileAsDataUrl(file)
  if (typeof createImageBitmap !== 'function') {
    if (file.size <= photoMaxBytes) return readFileAsDataUrl(file)
    throw new Error('Фотография слишком большая. Выбери изображение до 2,8 МБ')
  }

  let compressed: Blob | null = null
  try {
    compressed = await shrinkPhoto(file, photoMaxSide, 0.8)
    // Всё ещё тяжёлая - значит снимок шумный; вторая попытка мельче и грубее.
    if (compressed && compressed.size > 1_200_000) compressed = await shrinkPhoto(file, 1280, 0.72)
  } catch {
    // Формат браузеру не по зубам (например, HEIC): отправляем как есть,
    // если влезает в предел. Лучше медленно, чем никак.
    compressed = null
  }

  if (!compressed) {
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

export class SolutionNotAcceptedError extends Error {
  constructor() {
    super('Сервер решений не принял задачу за 30 секунд: соединение до него не доходит. Попробуй ещё раз или смени сеть')
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
): Promise<HomeworkSolution> {
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...(!accessToken && guestId ? { 'X-Guest-Id': guestId } : {}),
      },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    })
  } catch {
    if (signal?.aborted) throw new SolutionNotAcceptedError()
    throw new SolutionConnectionLostError()
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    /* Шлюз перед сервером (функция на Supabase) живёт 150 секунд и на
       более долгом решении отвечает 504 текстом. Сам решатель при этом
       работает дальше и сохранит ответ в базу - для вкладки это обрыв
       связи, а не отказ: очередь дождётся и заберёт решение оттуда. */
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new SolutionConnectionLostError()
    }
    throw new Error('Сервер решений вернул некорректный ответ')
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

  return payload.solution as HomeworkSolution
}
