import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleSmsHookRequest, smsHookConfigFromEnv, smsRuSender, smsText, verifyWebhook, webhookSecretKey } from './smsHook.ts'
import type { SmsHookConfig, SmsSender } from './smsHook.ts'

const key = randomBytes(32)
const secret = `v1,whsec_${key.toString('base64')}`
const now = 1_789_000_000

function signature(id: string, timestamp: string, body: string, signingKey = key) {
  return `v1,${createHmac('sha256', signingKey).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

function mockRequest(body: string, headers: Record<string, string>, method = 'POST') {
  return Object.assign(Readable.from([Buffer.from(body)]), { method, headers }) as unknown as IncomingMessage
}

function mockResponse() {
  const headers = new Map<string, string>()
  const state = { status: 0, body: '' }
  const response = {
    set statusCode(value: number) { state.status = value },
    get statusCode() { return state.status },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
    end(chunk?: string) { state.body = chunk ?? '' },
  } as unknown as ServerResponse
  return { response, headers, state }
}

function signedHook(payload: unknown, timestamp = String(now)) {
  const body = JSON.stringify(payload)
  return mockRequest(body, {
    'content-type': 'application/json',
    'webhook-id': 'msg_1',
    'webhook-timestamp': timestamp,
    'webhook-signature': signature('msg_1', timestamp, body),
  })
}

describe('webhook secret', () => {
  it('strips the v1 and whsec prefixes and decodes base64', () => {
    expect(webhookSecretKey(secret)?.equals(key)).toBe(true)
    expect(webhookSecretKey(`whsec_${key.toString('base64')}`)?.equals(key)).toBe(true)
    expect(webhookSecretKey('')).toBeNull()
    expect(webhookSecretKey('v1,whsec_not base64!')).toBeNull()
  })
})

describe('standard webhooks signature', () => {
  const body = '{"user":{"phone":"79123456789"},"sms":{"otp":"123456"}}'
  const ts = String(now)

  it('accepts a valid signature', () => {
    expect(verifyWebhook({ id: 'msg_1', timestamp: ts, signature: signature('msg_1', ts, body), body, key, nowSeconds: now })).toEqual({ ok: true })
  })

  it('rejects a signature made with another key or over another body', () => {
    expect(verifyWebhook({ id: 'msg_1', timestamp: ts, signature: signature('msg_1', ts, body, randomBytes(32)), body, key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWebhook({ id: 'msg_1', timestamp: ts, signature: signature('msg_1', ts, body), body: body.replace('123456', '654321'), key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyWebhook({ id: 'msg_2', timestamp: ts, signature: signature('msg_1', ts, body), body, key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects stale and future timestamps beyond five minutes', () => {
    const old = String(now - 301)
    expect(verifyWebhook({ id: 'msg_1', timestamp: old, signature: signature('msg_1', old, body), body, key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'stale_timestamp' })
    const future = String(now + 301)
    expect(verifyWebhook({ id: 'msg_1', timestamp: future, signature: signature('msg_1', future, body), body, key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'stale_timestamp' })
    const edge = String(now - 300)
    expect(verifyWebhook({ id: 'msg_1', timestamp: edge, signature: signature('msg_1', edge, body), body, key, nowSeconds: now })).toEqual({ ok: true })
  })

  it('accepts any matching signature among several', () => {
    const good = signature('msg_1', ts, body)
    const bad = signature('msg_1', ts, body, randomBytes(32))
    expect(verifyWebhook({ id: 'msg_1', timestamp: ts, signature: `${bad} v2,${good.slice(3)} ${good}`, body, key, nowSeconds: now })).toEqual({ ok: true })
    // Та же подпись, но с чужой версией не считается.
    expect(verifyWebhook({ id: 'msg_1', timestamp: ts, signature: `v2,${good.slice(3)}`, body, key, nowSeconds: now }))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects missing headers and malformed timestamps', () => {
    expect(verifyWebhook({ id: undefined, timestamp: ts, signature: 'v1,x', body, key, nowSeconds: now })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(verifyWebhook({ id: 'msg_1', timestamp: '17e8', signature: 'v1,x', body, key, nowSeconds: now })).toEqual({ ok: false, reason: 'bad_timestamp' })
  })
})

describe('sms.ru sender', () => {
  it('posts the message and accepts an OK for the number', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'OK', status_code: 100, sms: { 79123456789: { status: 'OK', status_code: 100, sms_id: '000000-10000000' } }, balance: 100 }))
    await smsRuSender({ apiId: 'api-key', fetchImpl })('79123456789', smsText('123456'))

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://sms.ru/sms/send')
    expect(init?.method).toBe('POST')
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('api_id')).toBe('api-key')
    expect(body.get('to')).toBe('79123456789')
    expect(body.get('msg')).toBe('Homework Copilot: код входа 123456')
    expect(body.get('json')).toBe('1')
    expect(body.has('test')).toBe(false)
  })

  it('fails on a provider-level error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'ERROR', status_code: 200, status_text: 'Неправильный api_id' }))
    await expect(smsRuSender({ apiId: 'wrong', fetchImpl })('79123456789', 'x')).rejects.toThrow(/200/)
  })

  it('fails when the number itself was rejected', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'OK', status_code: 100, sms: { 79123456789: { status: 'ERROR', status_code: 207, status_text: 'На этот номер нельзя отправлять сообщения' } } }))
    await expect(smsRuSender({ apiId: 'api-key', fetchImpl })('79123456789', 'x')).rejects.toThrow(/207/)
  })

  it('fails when sms.ru does not answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError('network') })
    await expect(smsRuSender({ apiId: 'api-key', fetchImpl })('79123456789', 'x')).rejects.toThrow(/did not respond/)
  })

  it('marks messages as test when SMSRU_TEST is on', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ status: 'OK', sms: { 79123456789: { status: 'OK' } } }))
    const config = smsHookConfigFromEnv({ SEND_SMS_HOOK_SECRET: secret, SMSRU_API_ID: 'api-key', SMSRU_TEST: '1' }, fetchImpl)
    await config?.sendSms('79123456789', 'x')
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body)).get('test')).toBe('1')
  })
})

describe('send sms hook endpoint', () => {
  const sendSms = vi.fn<SmsSender>(async () => undefined)
  const config: SmsHookConfig = { key, sendSms }

  it('sends the code to a Russian mobile and answers 200 with an empty body', async () => {
    sendSms.mockClear()
    const { response, state } = mockResponse()
    await handleSmsHookRequest(signedHook({ user: { id: 'u1', phone: '79123456789' }, sms: { otp: '123456' } }), response, config, now)
    expect(state).toEqual({ status: 200, body: '' })
    expect(sendSms).toHaveBeenCalledWith('79123456789', 'Homework Copilot: код входа 123456')
  })

  it('refuses a foreign number without sending anything', async () => {
    sendSms.mockClear()
    const { response, state } = mockResponse()
    await handleSmsHookRequest(signedHook({ user: { id: 'u1', phone: '447700900123' }, sms: { otp: '123456' } }), response, config, now)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: { http_code: 400, message: 'Only Russian mobile numbers are supported' } })
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('refuses an unsigned or stale call', async () => {
    sendSms.mockClear()
    const stale = mockResponse()
    await handleSmsHookRequest(signedHook({ user: { phone: '79123456789' }, sms: { otp: '123456' } }, String(now - 3600)), stale.response, config, now)
    expect(stale.state.status).toBe(401)
    const unsigned = mockResponse()
    await handleSmsHookRequest(mockRequest('{}', { 'webhook-id': 'x', 'webhook-timestamp': String(now), 'webhook-signature': 'v1,AAAA' }), unsigned.response, config, now)
    expect(unsigned.state.status).toBe(401)
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('reports a provider failure to Supabase', async () => {
    const { response, state } = mockResponse()
    const failing: SmsHookConfig = { key, sendSms: async () => { throw new Error('sms.ru rejected the request: 200') } }
    await handleSmsHookRequest(signedHook({ user: { phone: '79123456789' }, sms: { otp: '123456' } }), response, failing, now)
    expect(state.status).toBe(502)
    expect(JSON.parse(state.body).error.message).toBe('SMS provider did not accept the message')
  })

  it('answers 503 until the keys are set', async () => {
    expect(smsHookConfigFromEnv({})).toBeNull()
    expect(smsHookConfigFromEnv({ SEND_SMS_HOOK_SECRET: secret })).toBeNull()
    expect(smsHookConfigFromEnv({ SMSRU_API_ID: 'api-key' })).toBeNull()
    const { response, state } = mockResponse()
    await handleSmsHookRequest(signedHook({ user: { phone: '79123456789' }, sms: { otp: '123456' } }), response, null, now)
    expect(state.status).toBe(503)
  })
})
