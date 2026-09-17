import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findPendingSolution,
  forgetPendingSolution,
  pendingPhotoLifetimeMs,
  pendingSolutionsStorageKey,
  prunePendingSolutions,
  savePendingSolution,
} from './pendingSolutions'
import type { PendingSolution } from './pendingSolutions'

function entry(key: string, extra: Partial<PendingSolution> = {}): PendingSolution {
  return {
    idempotencyKey: key,
    textbookId: 'algebra',
    task: 'text-' + key,
    source: 'text',
    condition: 'Решите уравнение 5x = 20.',
    subject: 'Алгебра',
    ...extra,
  }
}

function storedKeys() {
  const stored = JSON.parse(window.localStorage.getItem(pendingSolutionsStorageKey) ?? '[]') as PendingSolution[]
  return stored.map((item) => item.idempotencyKey)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('запросы очереди в браузере', () => {
  /* Б11. Раньше при переполнении оставалась одна новая запись, и остальные
     задачи после перезагрузки закрывались «страница закрылась раньше». */
  it('при переполнении теряет только самые старые записи', () => {
    for (const key of ['solution-a', 'solution-b', 'solution-c']) savePendingSolution(entry(key))

    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, name: string, value: string) {
      // Хранилище вмещает не больше трёх запросов.
      if (name === pendingSolutionsStorageKey && (JSON.parse(value) as unknown[]).length > 3) {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      originalSetItem.call(this, name, value)
    })

    savePendingSolution(entry('solution-d', { source: 'photo', imageDataUrl: 'data:image/jpeg;base64,AAAA' }))
    expect(storedKeys()).toEqual(['solution-d', 'solution-c', 'solution-b'])
  })

  it('забывает решённую и снятую задачу, а сорвавшуюся держит для повтора', () => {
    savePendingSolution(entry('solution-done'))
    savePendingSolution(entry('solution-failed'))
    savePendingSolution(entry('solution-canceled'))

    prunePendingSolutions([
      { idempotencyKey: 'solution-done', status: 'done' },
      { idempotencyKey: 'solution-failed', status: 'failed' },
      { idempotencyKey: 'solution-canceled', status: 'canceled' },
    ])

    expect(findPendingSolution('solution-done')).toBeNull()
    expect(findPendingSolution('solution-canceled')).toBeNull()
    expect(findPendingSolution('solution-failed')).not.toBeNull()
  })

  /* В11. Фото тетради не лежит в браузере дольше суток. */
  it('фото хранится не дольше суток', () => {
    const now = Date.now()
    savePendingSolution(entry('solution-photo', {
      source: 'photo',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      savedAt: now - pendingPhotoLifetimeMs - 1_000,
    }))
    savePendingSolution(entry('solution-text', { savedAt: now - pendingPhotoLifetimeMs - 1_000 }))

    expect(findPendingSolution('solution-photo')).toBeNull()
    expect(findPendingSolution('solution-text')).not.toBeNull()
    forgetPendingSolution('solution-text')
    expect(storedKeys()).toEqual([])
  })
})
