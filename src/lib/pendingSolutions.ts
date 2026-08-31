import type { HomeworkSource } from './homeworkContract'

/* Что нужно, чтобы отправить задачу решателю.

   Строка очереди в базе говорит, ЧТО решается, но решает-то устройство: только
   у него есть фотография и сессия ученика. Поэтому сам запрос хранится рядом,
   в браузере, и переживает перезаход — иначе задача, стоявшая в очереди в
   момент закрытия вкладки, никогда бы не ушла в работу. */

export const pendingSolutionsStorageKey = 'homework-copilot:pending-solutions-v1'

export type PendingSolution = {
  idempotencyKey: string
  textbookId: string
  task: string
  source: HomeworkSource
  condition?: string
  imageDataUrl?: string
  subject?: string
  grade?: string
}

// Фотографии тяжёлые, а localStorage — около пяти мегабайт на весь домен.
// Держим немного и всегда самые свежие: старые запросы либо уже отработали,
// либо давно закрыты по сроку.
const maxPendingEntries = 6

function readAll(): PendingSolution[] {
  try {
    const stored = window.localStorage.getItem(pendingSolutionsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is PendingSolution => (
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as PendingSolution).idempotencyKey === 'string'
      && typeof (entry as PendingSolution).task === 'string'
    ))
  } catch {
    return []
  }
}

function writeAll(entries: readonly PendingSolution[]) {
  try {
    window.localStorage.setItem(pendingSolutionsStorageKey, JSON.stringify(entries.slice(0, maxPendingEntries)))
    return true
  } catch {
    return false
  }
}

export function loadPendingSolutions(): PendingSolution[] {
  return readAll()
}

/* Сохранение с запасным вариантом.

   Если места нет, запрос с фотографией сначала пробуем положить без неё —
   бесполезно: без снимка задачу не решить. Поэтому вместо этого вычищаем
   прежние записи и пробуем ещё раз. Не вышло и так — задача всё равно уйдёт
   в работу в этой вкладке, потеряется только устойчивость к перезаходу. */
export function savePendingSolution(entry: PendingSolution) {
  const rest = readAll().filter((stored) => stored.idempotencyKey !== entry.idempotencyKey)
  if (writeAll([entry, ...rest])) return true
  return writeAll([entry])
}

export function forgetPendingSolution(idempotencyKey: string) {
  writeAll(readAll().filter((entry) => entry.idempotencyKey !== idempotencyKey))
}

export function findPendingSolution(idempotencyKey: string) {
  return readAll().find((entry) => entry.idempotencyKey === idempotencyKey) ?? null
}
