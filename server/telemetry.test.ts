import type { IncomingMessage } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Телеметрия не должна ронять ответ функции и не должна верить заголовкам
   больше, чем нужно. Клиент Supabase подменён: проверяем, что уходит в RPC
   и как читается ответ, без сети. */

const rpc = vi.fn()
const createClient = vi.fn(() => ({ rpc }))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

const telemetry = await import('./telemetry.ts')
const {
  defaultSolverContext,
  flagEnabled,
  loadSolverContext,
  recordDeviceTouch,
  recordError,
  recordRequestLog,
  requestAddress,
  requestBytes,
  requestGuestId,
  requestIdOf,
  requestUserAgent,
  telemetryClient,
} = telemetry

const options = { supabaseUrl: 'https://project.supabase.co', serviceRoleKey: 'service-role-key-for-tests' }

function request(headers: Record<string, string | string[]>) {
  return { headers, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage
}

beforeEach(() => {
  rpc.mockReset()
})

describe('заголовки запроса', () => {
  it('проверенный адрес прокси важнее заголовков и обрезается до 64 знаков', () => {
    const trusted = '203.0.113.9'
    expect(requestAddress(request({ 'x-forwarded-for': '198.51.100.1' }), trusted)).toBe(trusted)
    expect(requestAddress(request({}), 'a'.repeat(100))).toHaveLength(64)
  })

  it('user-agent обрезается до 400 знаков, пустой - null', () => {
    expect(requestUserAgent(request({ 'user-agent': `  ${'x'.repeat(500)}  ` }))).toHaveLength(400)
    expect(requestUserAgent(request({ 'user-agent': '   ' }))).toBeNull()
    expect(requestUserAgent(request({}))).toBeNull()
  })

  it('номер запроса Vercel, а без него - local', () => {
    expect(requestIdOf(request({ 'x-vercel-id': 'fra1::abc' }))).toBe('fra1::abc')
    expect(requestIdOf(request({ 'x-vercel-id': ['fra1::first', 'fra1::second'] }))).toBe('fra1::first')
    expect(requestIdOf(request({}))).toBe('local')
  })

  it('размер тела - только положительное целое из content-length', () => {
    expect(requestBytes(request({ 'content-length': '1024' }))).toBe(1024)
    expect(requestBytes(request({ 'content-length': '0' }))).toBeNull()
    expect(requestBytes(request({ 'content-length': 'много' }))).toBeNull()
    expect(requestBytes(request({}))).toBeNull()
  })

  it('метка гостя принимается только как UUID и приводится к строчным', () => {
    expect(requestGuestId(request({ 'x-guest-id': '6F9619FF-8B86-4D11-B42D-00C04FC964FF' }))).toBe('6f9619ff-8b86-4d11-b42d-00c04fc964ff')
    expect(requestGuestId(request({ 'x-guest-id': 'guest; drop table' }))).toBeNull()
    expect(requestGuestId(request({ 'x-guest-id': '6f9619ff-8b86-6d11-b42d-00c04fc964ff' }))).toBeNull()
    expect(requestGuestId(request({}))).toBeNull()
  })
})

describe('клиент телеметрии', () => {
  it('без адреса базы или служебного ключа клиента нет, и запись молча пропускается', async () => {
    expect(telemetryClient({ supabaseUrl: options.supabaseUrl })).toBeNull()
    expect(telemetryClient({ serviceRoleKey: options.serviceRoleKey })).toBeNull()
    await recordRequestLog({}, { route: 'solve', status: 200, requestId: 'local' })
    await recordError({}, { kind: 'api', route: 'solve', message: 'boom' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('клиент создаётся один раз на пару адрес и ключ', () => {
    createClient.mockClear()
    const first = telemetryClient({ ...options, supabaseUrl: 'https://cache.supabase.co' })
    const second = telemetryClient({ ...options, supabaseUrl: 'https://cache.supabase.co' })
    expect(first).toBe(second)
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})

describe('запись', () => {
  it('журнал запроса: значения по умолчанию, округление длительности, ошибка до 400 знаков', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await recordRequestLog(options, { route: 'chat', status: 502, requestId: 'r1', durationMs: 12.7, error: 'e'.repeat(1000) })
    expect(rpc).toHaveBeenCalledWith('record_request_log', expect.objectContaining({
      p_route: 'chat',
      p_status: 502,
      p_method: 'POST',
      p_user_id: null,
      p_duration_ms: 13,
      p_bytes_in: null,
    }))
    const payload = rpc.mock.calls[0][1] as { p_error: string }
    expect(payload.p_error).toHaveLength(400)
  })

  it('ошибка базы при записи не выходит наружу', async () => {
    rpc.mockRejectedValue(new Error('network down'))
    await expect(recordRequestLog(options, { route: 'solve', status: 500, requestId: 'r2' })).resolves.toBeUndefined()
    await expect(recordError(options, { kind: 'db', route: 'solve', message: 'x' })).resolves.toBeUndefined()
    await expect(recordDeviceTouch(options, { userId: 'u1' })).resolves.toBeUndefined()
  })

  it('ошибка: важность по умолчанию error, сообщение и стек обрезаны, окружение дополняется', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await recordError(options, {
      kind: 'llm',
      route: 'solve',
      message: 'm'.repeat(2000),
      stack: 's'.repeat(9000),
      environment: { model: 'test-model' },
    })
    const [name, payload] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('record_error_event')
    expect(payload.p_severity).toBe('error')
    expect(String(payload.p_message)).toHaveLength(1000)
    expect(String(payload.p_stack)).toHaveLength(8000)
    expect(payload.p_environment).toMatchObject({ runtime: 'vercel', model: 'test-model' })
  })

  it('отметка устройства без ученика и без гостя не пишется', async () => {
    await recordDeviceTouch(options, { deviceId: 'device-1' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('настройки решателя', () => {
  it('разбирает ответ базы: лимит, предмет, промпт без пробелов, флаги', async () => {
    rpc.mockResolvedValue({
      data: { dailySolveLimit: 20, subjectEnabled: false, prompt: '  Пиши кратко  ', promptVersion: 3, flags: { chat: false, photo: 'yes' } },
      error: null,
    })
    const context = await loadSolverContext(options, { userId: 'u1', subjectId: 'physics' })
    expect(rpc).toHaveBeenCalledWith('solver_context', { p_user_id: 'u1', p_guest_id: null, p_subject_id: 'physics' })
    expect(context).toEqual({
      dailySolveLimit: 20,
      subjectEnabled: false,
      prompt: 'Пиши кратко',
      promptVersion: 3,
      flags: { chat: false, photo: true },
    })
    expect(flagEnabled(context, 'chat')).toBe(false)
    expect(flagEnabled(context, 'photo')).toBe(true)
    expect(flagEnabled(context, 'unknown')).toBe(true)
  })

  it('ошибка, пустой или странный ответ - настройки по умолчанию', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await loadSolverContext(options, {})).toBe(defaultSolverContext)
    rpc.mockResolvedValueOnce({ data: ['not', 'an', 'object'], error: null })
    expect(await loadSolverContext(options, {})).toBe(defaultSolverContext)
    rpc.mockRejectedValueOnce(new Error('network down'))
    expect(await loadSolverContext(options, {})).toBe(defaultSolverContext)
    expect(await loadSolverContext({}, {})).toBe(defaultSolverContext)
  })

  it('пустой промпт и нечисловой лимит не считаются настройкой', async () => {
    rpc.mockResolvedValue({ data: { dailySolveLimit: '20', prompt: '   ', flags: [] }, error: null })
    expect(await loadSolverContext(options, { guestId: 'g1' })).toEqual({
      dailySolveLimit: null,
      subjectEnabled: true,
      prompt: null,
      promptVersion: null,
      flags: {},
    })
  })
})
