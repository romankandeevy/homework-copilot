import { afterEach, describe, expect, it, vi } from 'vitest'
import { withRequestTimeout } from './supabase'

afterEach(() => {
  vi.useRealTimers()
})

function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  }))
}

describe('срок запросов к Supabase', () => {
  // 19 сентября обновление токена входа повисло без обрыва, и задача не ушла
  // на сервер: без срока запрос ждёт вечно.
  it('обрывает подвисший запрос по сроку', async () => {
    vi.useFakeTimers()
    const timed = withRequestTimeout(hangingFetch(), 1000)
    const pending = timed('https://example.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' })
    const settled = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(1000)
    await settled
  })

  it('пропускает отмену от вызывающего', async () => {
    const outer = new AbortController()
    const timed = withRequestTimeout(hangingFetch(), 60_000)
    const pending = timed('https://example.supabase.co/rest/v1/rpc/list_homework_jobs', { signal: outer.signal })
    outer.abort(new Error('отменено'))
    await expect(pending).rejects.toThrow('отменено')
  })

  it('не ставит срок загрузке файлов в хранилище', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(String(Boolean(init?.signal))))
    const timed = withRequestTimeout(fetchImpl, 1000)
    const response = await timed('https://example.supabase.co/storage/v1/object/chat/file.png', {})
    expect(await response.text()).toBe('false')
  })
})
