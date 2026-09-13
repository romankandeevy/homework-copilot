import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { checkOrderWithRobokassa, handlePaymentRequest, handleResultNotice } from './payments.ts'
import type { CloseOrder, ConfirmOrder } from './payments.ts'
import { resultSignature } from './robokassa.ts'
import type { RobokassaConfig } from './robokassa.ts'

const config: RobokassaConfig = {
  merchantLogin: 'homework-copilot',
  hash: 'md5',
  live: { password1: 'live-one', password2: 'live-two' },
  test: { password1: 'test-one', password2: 'test-two' },
  testMode: false,
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
    await expect(handleResultNotice(config, notice(), confirm)).resolves.toEqual({ status: 500, body: 'retry' })
  })
})

describe('payment status check', () => {
  const order = { invId: 100001, amount: 15000, isTest: false, createdAt: '2026-09-13T10:00:00Z' }
  const minutesLater = Date.parse('2026-09-13T10:05:00Z')
  const state = (result: number, stateCode?: number) => `<OperationStateResponse><Result><Code>${result}</Code></Result>${
    stateCode === undefined ? '' : `<State><Code>${stateCode}</Code></State>`
  }<Info><OutSum>150.000000</OutSum></Info></OperationStateResponse>`
  const answer = (xml: string) => vi.fn(async () => new Response(xml)) as unknown as typeof fetch
  const deps = (fetchImpl: typeof fetch, now = minutesLater) => ({
    fetchImpl,
    confirm: vi.fn<ConfirmOrder>(async () => undefined),
    close: vi.fn<CloseOrder>(async () => undefined),
    via: 'reconcile' as const,
    now,
  })

  it('credits a payment whose notice never arrived', async () => {
    const check = deps(answer(state(0, 100)))
    await expect(checkOrderWithRobokassa(config, order, check)).resolves.toBe('paid')
    expect(check.confirm).toHaveBeenCalledWith({ invId: 100001, amountKopecks: 15000, isTest: false, via: 'reconcile', payload: { OpState: '100' } })
    expect(check.close).not.toHaveBeenCalled()
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

    const stale = deps(answer(state(3)), Date.parse('2026-09-17T10:00:00Z'))
    await expect(checkOrderWithRobokassa(config, order, stale)).resolves.toBe('expired')
    expect(stale.close).toHaveBeenCalledWith(100001, 'expired')
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

  it('accepts only POST', async () => {
    const request = { method: 'GET', headers: {} } as IncomingMessage
    const { response, headers } = mockResponse()
    await handlePaymentRequest(request, response, { robokassa: config })
    expect(response.statusCode).toBe(405)
    expect(headers.get('allow')).toBe('POST, OPTIONS')
  })
})
