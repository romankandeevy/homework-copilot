import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { checkOrderWithRobokassa, handlePaymentRequest, handleResultNotice, isAllowedPaymentOrigin } from './payments.ts'
import type { CloseOrder, ConfirmOrder, ReportIncident } from './payments.ts'
import { buildPaymentUrl, paymentReceipt, resultSignature } from './robokassa.ts'
import type { RobokassaConfig } from './robokassa.ts'

/* Supabase подменён только для заведения заказа: вход отдаёт аккаунт с
   почтой из `account`, база - заказ 100001. Остальные тесты файла к
   Supabase не ходят. */
const account = vi.hoisted(() => ({ email: 'student@example.com' as string | undefined }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: account.email } }, error: null }) },
    rpc: async () => ({ data: { invId: 100001 }, error: null }),
  }),
}))

const config: RobokassaConfig = {
  merchantLogin: 'homework-copilot',
  hash: 'md5',
  live: { password1: 'live-one', password2: 'live-two' },
  test: { password1: 'test-one', password2: 'test-two' },
  testMode: false,
  receipts: false,
}

function notice(password2 = 'live-two') {
  const params = new URLSearchParams({ OutSum: '150.000000', InvId: '100001' })
  params.set('SignatureValue', resultSignature('md5', '150.000000', '100001', password2))
  return params.toString()
}

function mockResponse() {
  const headers = new Map<string, string>()
  const end = vi.fn()
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
    },
    end,
  } as unknown as ServerResponse
  return { response, headers, end }
}

describe('robokassa result url', () => {
  it('answers OK{InvId} only after the database confirmed the order', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => undefined)
    await expect(handleResultNotice(config, notice(), confirm)).resolves.toEqual({ status: 200, body: 'OK100001' })
    expect(confirm).toHaveBeenCalledWith({
      invId: 100001,
      amountKopecks: 15000,
      isTest: false,
      via: 'result',
      payload: { OutSum: '150.000000', InvId: '100001' },
    })
  })

  it('does not touch the database when the signature is wrong', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => undefined)
    await expect(handleResultNotice(config, notice('live-one'), confirm)).resolves.toEqual({ status: 400, body: 'bad sign' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('refuses for good when the order does not match the notice', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => { throw new Error('payment amount mismatch') })
    await expect(handleResultNotice(config, notice(), confirm)).resolves.toEqual({ status: 400, body: 'rejected' })
  })

  it('asks Robokassa to repeat the notice after a passing failure', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => { throw new Error('connection reset') })
    const report = vi.fn<ReportIncident>(async () => undefined)
    await expect(handleResultNotice(config, notice(), confirm, report)).resolves.toEqual({ status: 500, body: 'retry' })
    expect(report).not.toHaveBeenCalled()
  })

  it('tells the owner about a notice the database refused for good', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => { throw new Error('payment amount mismatch') })
    const report = vi.fn<ReportIncident>(async () => undefined)
    await expect(handleResultNotice(config, notice(), confirm, report)).resolves.toEqual({ status: 400, body: 'rejected' })
    expect(report).toHaveBeenCalledWith({ kind: 'result_mismatch', invId: 100001, detail: 'payment amount mismatch, сумма 150.00' })
  })

  it('tells the owner about a bad signature, but not about an empty request', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => undefined)
    const report = vi.fn<ReportIncident>(async () => undefined)
    await expect(handleResultNotice(config, notice('live-one'), confirm, report)).resolves.toEqual({ status: 400, body: 'bad sign' })
    expect(report).toHaveBeenCalledWith({ kind: 'result_rejected', invId: 100001, detail: 'bad signature' })

    report.mockClear()
    await expect(handleResultNotice(config, '', confirm, report)).resolves.toEqual({ status: 400, body: 'bad sign' })
    expect(report).not.toHaveBeenCalled()
  })

  it('answers Robokassa the same when the owner could not be told', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => { throw new Error('payment mode mismatch') })
    const report = vi.fn<ReportIncident>(async () => { throw new Error('database down') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(handleResultNotice(config, notice(), confirm, report)).resolves.toEqual({ status: 400, body: 'rejected' })
    expect(String(logged.mock.calls[0]?.[0])).toContain('payment_incident_report_failed')
    logged.mockRestore()
  })

  it('reads the notice from a query string the same way as from a form', async () => {
    const confirm = vi.fn<ConfirmOrder>(async () => undefined)
    await expect(handleResultNotice(config, new URLSearchParams(notice()), confirm)).resolves.toEqual({ status: 200, body: 'OK100001' })
  })
})

describe('payment status check', () => {
  const order = { invId: 100001, amount: 15000, isTest: false, createdAt: '2026-09-13T10:00:00Z' }
  const minutesLater = Date.parse('2026-09-13T10:05:00Z')
  const state = (result: number, stateCode?: number, outSum = '150.000000') => `<OperationStateResponse><Result><Code>${result}</Code></Result>${
    stateCode === undefined ? '' : `<State><Code>${stateCode}</Code></State>`
  }<Info><OutSum>${outSum}</OutSum></Info></OperationStateResponse>`
  const answer = (xml: string) => vi.fn(async () => new Response(xml)) as unknown as typeof fetch
  const deps = (fetchImpl: typeof fetch, now = minutesLater) => ({
    fetchImpl,
    confirm: vi.fn<ConfirmOrder>(async () => undefined),
    close: vi.fn<CloseOrder>(async () => undefined),
    report: vi.fn<ReportIncident>(async () => undefined),
    via: 'reconcile' as const,
    now,
  })
  const threeDaysLater = Date.parse('2026-09-17T10:00:00Z')

  it('credits a payment whose notice never arrived', async () => {
    const check = deps(answer(state(0, 100)))
    await expect(checkOrderWithRobokassa(config, order, check)).resolves.toBe('paid')
    expect(check.confirm).toHaveBeenCalledWith({ invId: 100001, amountKopecks: 15000, isTest: false, via: 'reconcile', payload: { OpState: '100', OutSum: '150.00' } })
    expect(check.close).not.toHaveBeenCalled()
  })

  it('credits the order amount even when Robokassa reports a sum net of its fee', async () => {
    const check = deps(answer(state(0, 100, '144.150000')))
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(checkOrderWithRobokassa(config, order, check)).resolves.toBe('paid')
    expect(check.confirm).toHaveBeenCalledWith({ invId: 100001, amountKopecks: 15000, isTest: false, via: 'reconcile', payload: { OpState: '100', OutSum: '144.15' } })
    expect(logged.mock.calls.map((call) => String(call[0])).join('\n')).toContain('robokassa_opstate_sum_differs')
    logged.mockRestore()
  })

  it('closes a cancelled payment without crediting', async () => {
    const check = deps(answer(state(0, 10)))
    await expect(checkOrderWithRobokassa(config, order, check)).resolves.toBe('cancelled')
    expect(check.close).toHaveBeenCalledWith(100001, 'cancelled')
    expect(check.confirm).not.toHaveBeenCalled()
  })

  it('keeps a fresh unpaid order open and expires it after three days', async () => {
    const fresh = deps(answer(state(3)))
    await expect(checkOrderWithRobokassa(config, order, fresh)).resolves.toBe('not_found')
    expect(fresh.close).not.toHaveBeenCalled()

    const stale = deps(answer(state(3)), threeDaysLater)
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(checkOrderWithRobokassa(config, order, stale)).resolves.toBe('expired')
    expect(stale.close).toHaveBeenCalledWith(100001, 'expired')
    expect(logged.mock.calls.map((call) => String(call[0])).join('\n')).toContain('robokassa_reconcile_failed')
    // Ученик не дошёл до оплаты - владельцу об этом знать незачем.
    expect(stale.report).not.toHaveBeenCalled()
    logged.mockRestore()
  })

  it('expires an order Robokassa never answered about and tells the owner', async () => {
    const stale = deps(vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch, threeDaysLater)
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(checkOrderWithRobokassa(config, order, stale)).resolves.toBe('expired')
    expect(stale.close).toHaveBeenCalledWith(100001, 'expired')
    expect(stale.report).toHaveBeenCalledWith({ kind: 'reconcile_failed', invId: 100001, detail: 'timeout' })
    logged.mockRestore()
  })

  it('expires a stale order even without passwords for its mode', async () => {
    const liveOnly: RobokassaConfig = { ...config, test: null }
    const stale = deps(answer(state(0, 100)), threeDaysLater)
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(checkOrderWithRobokassa(liveOnly, { ...order, isTest: true }, stale)).resolves.toBe('expired')
    expect(stale.fetchImpl).not.toHaveBeenCalled()
    expect(stale.confirm).not.toHaveBeenCalled()
    expect(stale.report).toHaveBeenCalledWith({ kind: 'reconcile_failed', invId: 100001, detail: 'нет паролей для режима заказа' })
    logged.mockRestore()
  })

  it('leaves the order alone when Robokassa does not answer', async () => {
    const check = deps(vi.fn(async () => { throw new Error('timeout') }) as unknown as typeof fetch)
    await expect(checkOrderWithRobokassa(config, order, check)).resolves.toBe('error')
    expect(check.confirm).not.toHaveBeenCalled()
    expect(check.close).not.toHaveBeenCalled()
  })
})

describe('payment endpoint', () => {
  it('lets the production site call it', async () => {
    const request = { method: 'OPTIONS', headers: { origin: 'https://www.homeworkcopilot.ru' } } as IncomingMessage
    const { response, headers, end } = mockResponse()
    await handlePaymentRequest(request, response, { robokassa: config })
    expect(response.statusCode).toBe(204)
    expect(headers.get('access-control-allow-origin')).toBe('https://www.homeworkcopilot.ru')
    expect(end).toHaveBeenCalledOnce()
  })

  it('lets preview deployments of this project call it, but only outside production', () => {
    expect(isAllowedPaymentOrigin('https://homework-copilot-taupe.vercel.app', 'preview')).toBe(true)
    expect(isAllowedPaymentOrigin('https://homework-copilot-abc123-team.vercel.app', 'preview')).toBe(true)
    expect(isAllowedPaymentOrigin('https://homework-copilot-taupe.vercel.app', 'production')).toBe(false)
    expect(isAllowedPaymentOrigin('https://evil-homework-copilot.vercel.app', 'preview')).toBe(false)
    expect(isAllowedPaymentOrigin('https://homework-copilot-x.vercel.app.evil.test', 'preview')).toBe(false)
    expect(isAllowedPaymentOrigin('https://www.homeworkcopilot.ru', 'production')).toBe(true)
  })

  it('accepts only GET and POST', async () => {
    const request = { method: 'PUT', headers: {} } as IncomingMessage
    const { response, headers } = mockResponse()
    await handlePaymentRequest(request, response, { robokassa: config })
    expect(response.statusCode).toBe(405)
    expect(headers.get('allow')).toBe('GET, POST, OPTIONS')
  })

  it('takes the Result notice by GET from the query string', async () => {
    const request = { method: 'GET', url: `/api/payment?${notice()}`, headers: {} } as IncomingMessage
    const { response, end } = mockResponse()
    await handlePaymentRequest(request, response, { supabaseUrl: 'https://db.test', serviceRoleKey: 'service', robokassa: config })
    expect(response.statusCode).toBe(200)
    expect(end).toHaveBeenCalledWith('OK100001')
  })

  it('takes the Result notice by POST from a form', async () => {
    const request = Object.assign(Readable.from([notice()]), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }) as unknown as IncomingMessage
    const { response, end } = mockResponse()
    await handlePaymentRequest(request, response, { supabaseUrl: 'https://db.test', serviceRoleKey: 'service', robokassa: config })
    expect(response.statusCode).toBe(200)
    expect(end).toHaveBeenCalledWith('OK100001')
  })

  it('refuses a GET without a valid signature', async () => {
    const request = { method: 'GET', url: '/api/payment', headers: {} } as IncomingMessage
    const { response, end } = mockResponse()
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await handlePaymentRequest(request, response, { supabaseUrl: 'https://db.test', serviceRoleKey: 'service', robokassa: config })
    expect(response.statusCode).toBe(400)
    expect(end).toHaveBeenCalledWith('bad sign')
    logged.mockRestore()
  })
})

describe('payment order', () => {
  async function createLink(robokassa: RobokassaConfig) {
    const request = Object.assign(Readable.from([JSON.stringify({ action: 'create', amountKopecks: 15000 })]), {
      method: 'POST',
      headers: { origin: 'https://www.homeworkcopilot.ru', 'content-type': 'application/json', authorization: 'Bearer session' },
    }) as unknown as IncomingMessage
    const { response, end } = mockResponse()
    await handlePaymentRequest(request, response, { supabaseUrl: 'https://db.test', supabasePublishableKey: 'publishable', serviceRoleKey: 'service', robokassa })
    expect(response.statusCode).toBe(200)
    return (JSON.parse(String(end.mock.calls[0]?.[0])) as { url: string }).url
  }

  it('keeps the old link without receipts, though the account has an email', async () => {
    account.email = 'student@example.com'
    const link = await createLink(config)
    expect(link).toBe(buildPaymentUrl(config, { invId: 100001, amountKopecks: 15000, isTest: false }))
    expect(link).not.toContain('Email=')
    expect(link).not.toContain('Receipt=')
  })

  it('sends the receipt and the account email with receipts on', async () => {
    account.email = 'student@example.com'
    const url = new URL(await createLink({ ...config, receipts: true }))
    expect(url.searchParams.get('Receipt')).toBe(paymentReceipt(15000))
    expect(url.searchParams.get('Email')).toBe('student@example.com')
  })

  it('sends the receipt without Email for an account made by phone', async () => {
    account.email = undefined
    const url = new URL(await createLink({ ...config, receipts: true }))
    expect(url.searchParams.get('Receipt')).toBe(paymentReceipt(15000))
    expect(url.searchParams.has('Email')).toBe(false)
  })
})
