import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { handleAdminRequest, isAllowedAdminOrigin, isCronTokenShape, runHealthChecks } from './admin.ts'

/* Supabase подменён целиком: вход администратора, карточка удаляемого
   аккаунта, RPC по имени и хранилище. Ответы RPC задаёт `database.rpc`. */
const database = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  rpc: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  removed: [] as string[][],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }),
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, email: 'student@example.test', phone: '' } }, error: null }),
      },
    },
    rpc: async (name: string, args: unknown) => {
      database.calls.push({ name, args })
      return database.rpc[name] ?? { data: null, error: null }
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [{ id: 'file-1', name: 'photo.jpg' }], error: null }),
        remove: async (paths: string[]) => {
          database.removed.push(paths)
          return { data: null, error: null }
        },
      }),
    },
  }),
}))

const options = { supabaseUrl: 'https://db.test', supabasePublishableKey: 'publishable', serviceRoleKey: 'service-role-key' }
const studentId = '00000000-0000-4000-8000-000000000002'

function reset() {
  database.calls = []
  database.removed = []
  database.rpc = {
    get_admin_context: { data: { isAdmin: true, aal: 'aal2', role: 'owner', permissions: { delete: true } }, error: null },
    is_admin_user: { data: false, error: null },
    account_has_payment_in_flight: { data: false, error: null },
    admin_delete_user: { data: { deleted: true }, error: null },
  }
}

function jsonRequest(body: Record<string, unknown>) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer admin-session', 'content-type': 'application/json' },
    body,
  } as unknown as IncomingMessage
}

function mockResponse() {
  const end = vi.fn()
  const response = { statusCode: 0, setHeader: vi.fn(), end } as unknown as ServerResponse
  return { response, json: () => JSON.parse(String(end.mock.calls[0]?.[0])) as Record<string, unknown> }
}

describe('admin CORS', () => {
  it('lets the local dev server in only outside production', () => {
    expect(isAllowedAdminOrigin('http://localhost:5173', 'preview')).toBe(true)
    expect(isAllowedAdminOrigin('http://localhost:5173', undefined)).toBe(true)
    expect(isAllowedAdminOrigin('http://localhost:5173', 'production')).toBe(false)
    expect(isAllowedAdminOrigin('http://127.0.0.1:5173', 'production')).toBe(false)
    expect(isAllowedAdminOrigin('https://www.homeworkcopilot.ru', 'production')).toBe(true)
  })
})

describe('admin cron entry', () => {
  it('knows the shape of a token the database issues', () => {
    expect(isCronTokenShape('0123456789abcdef'.repeat(3))).toBe(true)
    expect(isCronTokenShape('0123456789ABCDEF'.repeat(3))).toBe(false)
    expect(isCronTokenShape('0123456789abcdef'.repeat(3).slice(1))).toBe(false)
    expect(isCronTokenShape(`${'0123456789abcdef'.repeat(3)}\n`)).toBe(false)
    expect(isCronTokenShape(undefined)).toBe(false)
  })

  it('refuses a malformed token without asking the database', async () => {
    reset()
    const { response, json } = mockResponse()
    await handleAdminRequest({ method: 'POST', headers: {}, body: { action: 'cron', token: 'guess' } } as unknown as IncomingMessage, response, options)
    expect(response.statusCode).toBe(401)
    expect(json().error).toBe('Токен cron не принят')
    expect(database.calls.map((call) => call.name)).not.toContain('claim_admin_cron')
  })

  it('marks a successful run so the database can tell when cron went silent', async () => {
    reset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-16T10:01:00Z'))
    database.rpc.claim_admin_cron = { data: { emails: [], notifications: [] }, error: null }
    const { response, json } = mockResponse()
    await handleAdminRequest({ method: 'POST', headers: {}, body: { action: 'cron', token: 'a'.repeat(48) } } as unknown as IncomingMessage, response, options)
    vi.useRealTimers()
    expect(response.statusCode).toBe(200)
    expect(json()).toMatchObject({ delivered: 0, health: 0, payments: 0 })
    expect(database.calls.map((call) => call.name)).toEqual(['claim_admin_cron', 'mark_admin_cron_ok'])
  })
})

describe('admin health checks', () => {
  it('logs a result the database did not record instead of swallowing it', async () => {
    reset()
    database.rpc.record_health_check = { data: null, error: { message: 'permission denied' } }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const results = await runHealthChecks({ ...options, fetchImpl })
    const failures = logged.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('admin_health_record_failed'))
    expect(failures).toHaveLength(results.length)
    logged.mockRestore()
  })
})

describe('admin account deletion', () => {
  it('does not take the word instead of the email for a single account', async () => {
    reset()
    const { response, json } = mockResponse()
    await handleAdminRequest(jsonRequest({ action: 'delete_users', userIds: [studentId], confirm: 'УДАЛИТЬ' }), response, options)
    expect(response.statusCode).toBe(200)
    expect(json()).toMatchObject({ done: 0, failed: [{ userId: studentId, error: 'Подтверждение не совпало с почтой или номером аккаунта' }] })
    expect(database.calls.map((call) => call.name)).not.toContain('admin_delete_user')
    expect(database.removed).toEqual([])
  })

  it('deletes a single account confirmed by its email', async () => {
    reset()
    const { response, json } = mockResponse()
    await handleAdminRequest(jsonRequest({ action: 'delete_users', userIds: [studentId], confirm: ' Student@Example.test ' }), response, options)
    expect(json()).toMatchObject({ done: 1, failed: [] })
    expect(database.calls.find((call) => call.name === 'admin_delete_user')?.args).toMatchObject({ p_user_id: studentId, p_confirm: 'student@example.test' })
  })

  it('needs the word for several accounts', async () => {
    reset()
    const { response, json } = mockResponse()
    const second = '00000000-0000-4000-8000-000000000003'
    await handleAdminRequest(jsonRequest({ action: 'delete_users', userIds: [studentId, second], confirm: 'student@example.test' }), response, options)
    expect(response.statusCode).toBe(400)
    expect(String(json().error)).toContain('УДАЛИТЬ')
  })

  it('keeps the chat files of an account with a payment in flight', async () => {
    reset()
    database.rpc.account_has_payment_in_flight = { data: true, error: null }
    const { response, json } = mockResponse()
    await handleAdminRequest(jsonRequest({ action: 'delete_users', userIds: [studentId], confirm: 'student@example.test' }), response, options)
    expect(json()).toMatchObject({ done: 0, failed: [{ userId: studentId }] })
    expect(String((json().failed as { error: string }[])[0]?.error)).toContain('платёж в пути')
    expect(database.removed).toEqual([])
    expect(database.calls.map((call) => call.name)).not.toContain('admin_delete_user')
  })
})
