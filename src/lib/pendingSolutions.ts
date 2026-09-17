import type { HomeworkSource } from './homeworkContract'

/* Что нужно, чтобы отправить задачу решателю.

   Строка очереди в базе говорит, ЧТО решается, но решает-то устройство: только
   у него есть фотография и сессия ученика. Поэтому сам запрос хранится рядом,
   в браузере, и переживает перезаход — иначе задача, стоявшая в очереди в
   момент закрытия вкладки, никогда бы не ушла в работу.

   Хранилищ два (аудит 16 сентября, Б11). localStorage читается сразу, но
   держит около пяти мегабайт на весь домен, а пять фото по мегабайту в него
   не влезают: раньше при переполнении оставалась одна запись, и остальные
   задачи после перезагрузки закрывались «страница закрылась раньше». Теперь
   localStorage при переполнении теряет только самые старые записи, а полная
   копия лежит в IndexedDB - её вкладка дочитывает при запуске
   (`hydratePendingSolutions`), прежде чем отправлять очередь. */

export const pendingSolutionsStorageKey = 'homework-copilot:pending-solutions-v1'

const databaseName = 'homework-copilot-pending'
const storeName = 'requests'

export type PendingSolution = {
  idempotencyKey: string
  textbookId: string
  task: string
  source: HomeworkSource
  condition?: string
  imageDataUrl?: string
  subject?: string
  grade?: string
  /** Когда запрос сохранён: по нему истекает срок хранения. */
  savedAt?: number
}

// Держим немного и всегда самые свежие: старые запросы либо уже отработали,
// либо давно закрыты по сроку. Форма ставит пять задач за раз.
const maxPendingEntries = 12

/* Сроки хранения (аудит 16 сентября, В11). Фото тетради на общем компьютере
   не должно лежать бессрочно: после сбоя оно нужно только для «Решить ещё
   раз», и сутки на это хватает. Запрос без фото живёт двое суток - столько
   очередь показывает задачи (`list_homework_jobs`). Решённая или снятая
   задача забывается сразу (`prunePendingSolutions`). */
export const pendingPhotoLifetimeMs = 24 * 60 * 60 * 1000
export const pendingTextLifetimeMs = 2 * 24 * 60 * 60 * 1000

function isPendingSolution(entry: unknown): entry is PendingSolution {
  return Boolean(entry)
    && typeof entry === 'object'
    && typeof (entry as PendingSolution).idempotencyKey === 'string'
    && typeof (entry as PendingSolution).task === 'string'
}

export function isExpiredPendingSolution(entry: PendingSolution, now = Date.now()) {
  if (typeof entry.savedAt !== 'number') return false
  const lifetime = entry.imageDataUrl ? pendingPhotoLifetimeMs : pendingTextLifetimeMs
  return now - entry.savedAt > lifetime
}

function readLocal(): PendingSolution[] {
  try {
    const stored = window.localStorage.getItem(pendingSolutionsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPendingSolution)
  } catch {
    return []
  }
}

/* Запись с отступлением. Не влезло - убираем самую старую запись и пробуем
   снова, но не меньше одной: свежая задача важнее прошлых. Раньше при
   переполнении пропадало всё, кроме новой. */
function writeLocal(entries: readonly PendingSolution[]) {
  let kept = entries.slice(0, maxPendingEntries)
  while (kept.length > 0) {
    try {
      window.localStorage.setItem(pendingSolutionsStorageKey, JSON.stringify(kept))
      return true
    } catch {
      if (kept.length === 1) break
      kept = kept.slice(0, -1)
    }
  }
  try {
    window.localStorage.setItem(pendingSolutionsStorageKey, '[]')
  } catch {
    // Хранилище закрыто: задача решится в этой вкладке, без устойчивости к перезаходу.
  }
  return false
}

/* Запросы, дочитанные из IndexedDB: те, что не влезли в localStorage. */
const hydrated = new Map<string, PendingSolution>()

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined' || !indexedDB) return null
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: 'idempotencyKey' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
      request.onblocked = () => reject(new Error('indexedDB open blocked'))
    }).catch((error: unknown) => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const opening = openDatabase()
  if (!opening) return null
  try {
    const database = await opening
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = run(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB transaction failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB transaction aborted'))
    })
  } catch {
    // IndexedDB закрыт (приватный режим, запрет сайта) - остаётся localStorage.
    return null
  }
}

function freshLocal(now = Date.now()) {
  const stored = readLocal()
  const fresh = stored.filter((entry) => !isExpiredPendingSolution(entry, now))
  if (fresh.length !== stored.length) writeLocal(fresh)
  return fresh
}

function readAll(): PendingSolution[] {
  const now = Date.now()
  const local = freshLocal(now)
  const extra = [...hydrated.values()].filter((entry) => (
    !isExpiredPendingSolution(entry, now)
    && !local.some((stored) => stored.idempotencyKey === entry.idempotencyKey)
  ))
  return [...local, ...extra]
}

export function loadPendingSolutions(): PendingSolution[] {
  return readAll()
}

/* Дочитать запросы из IndexedDB. Вкладка ждёт этого перед отправкой очереди:
   иначе задача, чей запрос не влез в localStorage, закрылась бы как «страница
   закрылась раньше», хотя её фото лежит рядом. Просроченные удаляются. */
export async function hydratePendingSolutions(): Promise<void> {
  const stored = await withStore<unknown[]>('readonly', (store) => store.getAll() as IDBRequest<unknown[]>)
  if (!Array.isArray(stored)) return
  const now = Date.now()
  for (const entry of stored) {
    if (!isPendingSolution(entry)) continue
    if (isExpiredPendingSolution(entry, now)) {
      void withStore('readwrite', (store) => store.delete(entry.idempotencyKey))
      continue
    }
    hydrated.set(entry.idempotencyKey, entry)
  }
}

/* Сохранение. Запрос уходит в оба хранилища: localStorage - чтобы после
   перезагрузки он был под рукой сразу, IndexedDB - чтобы переполнение
   localStorage не стоило задачи. */
export function savePendingSolution(entry: PendingSolution) {
  const stamped: PendingSolution = { ...entry, savedAt: entry.savedAt ?? Date.now() }
  hydrated.set(stamped.idempotencyKey, stamped)
  void withStore('readwrite', (store) => store.put(stamped))
  const rest = freshLocal().filter((stored) => stored.idempotencyKey !== stamped.idempotencyKey)
  return writeLocal([stamped, ...rest])
}

export function forgetPendingSolution(idempotencyKey: string) {
  hydrated.delete(idempotencyKey)
  void withStore('readwrite', (store) => store.delete(idempotencyKey))
  const stored = readLocal()
  const rest = stored.filter((entry) => entry.idempotencyKey !== idempotencyKey)
  if (rest.length !== stored.length) writeLocal(rest)
}

export function findPendingSolution(idempotencyKey: string) {
  return readAll().find((entry) => entry.idempotencyKey === idempotencyKey) ?? null
}

/* Решённая и снятая задача больше не нуждается в запросе: фото тетради не
   должно оставаться в браузере после того, как решение получено. Сорвавшаяся
   держит его для «Решить ещё раз» - до срока хранения. */
export function prunePendingSolutions(jobs: readonly { idempotencyKey: string; status: string }[]) {
  const finished = jobs.filter((job) => job.status === 'done' || job.status === 'canceled')
  const stored = readAll()
  for (const job of finished) {
    if (stored.some((entry) => entry.idempotencyKey === job.idempotencyKey)) forgetPendingSolution(job.idempotencyKey)
  }
}
