import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  finishYandexSignIn,
  handleYandexAuthRequest,
  signState,
  stateLifetimeMs,
  verifyState,
  yandexAuthConfigFromEnv,
  yandexAuthMessages,
} from './yandexAuth.ts'
import type { AuthAdminPort, YandexAuthConfig } from './yandexAuth.ts'

const config: YandexAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  stateSecret: 's'.repeat(40),
  redirectUri: 'https://www.homeworkcopilot.ru/app',
}
const now = Date.parse('2026-09-13T12:00:00Z')
const nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const deviceId = '5b0f6f0e-7a34-4d4c-9d1c-6a2f1b3c4d5e'
const claimToken = '0e3b8c6a-1f2d-4a5b-8c9d-0e1f2a3b4c5d'

function validState(consents = true) {
  return signState({ nonce, consents, expiresAt: now + stateLifetimeMs }, config.stateSecret)
}

function yandexFetch(info: Record<string, unknown>, token: Record<string, unknown> = { access_token: 'yandex-token', token_type: 'bearer' }) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === 'https://oauth.yandex.ru/token') {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('client_id')).toBe('client-id')
      expect(body.get('client_secret')).toBe('client-secret')
      return Response.json(token, { status: typeof token.access_token === 'string' ? 200 : 400 })
    }
    if (url === 'https://login.yandex.ru/info?format=json') {
      expect(new Headers(init?.headers).get('authorization')).toBe('OAuth yandex-token')
      return Response.json(info)
    }
    return new Response('not found', { status: 404 })
  })
}

function admin(result: Awaited<ReturnType<AuthAdminPort['createUser']>> = { ok: true }) {
  return {
    createUser: vi.fn<AuthAdminPort['createUser']>(async () => result),
    magicLink: vi.fn<AuthAdminPort['magicLink']>(async () => ({ tokenHash: 'hash-1', verificationType: 'magiclink' })),
  }
}

const profile = { id: '1130000012345678', login: 'pupil', default_email: 'Pupil@Yandex.ru', emails: ['Pupil@Yandex.ru'], real_name: 'Иван Петров', display_name: 'pupil' }

describe('yandex state', () => {
  it('round-trips nonce, consents and expiry', () => {
    const state = validState()
    expect(verifyState(state, config.stateSecret, now)).toEqual({ nonce, consents: true, expiresAt: now + stateLifetimeMs })
    expect(verifyState(validState(false), config.stateSecret, now)?.consents).toBe(false)
  })

  it('rejects a tampered body or signature', () => {
    const [body, signature] = validState(false).split('.')
    const forged = Buffer.from(JSON.stringify({ n: nonce, c: 1, e: now + stateLifetimeMs }), 'utf8').toString('base64url')
    expect(verifyState(`${forged}.${signature}`, config.stateSecret, now)).toBeNull()
    const flipped = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`
    expect(verifyState(`${body}.${flipped}`, config.stateSecret, now)).toBeNull()
    expect(verifyState(`${body}.${signature}.extra`, config.stateSecret, now)).toBeNull()
    expect(verifyState(validState(), 't'.repeat(40), now)).toBeNull()
    expect(verifyState('garbage', config.stateSecret, now)).toBeNull()
    expect(verifyState(undefined, config.stateSecret, now)).toBeNull()
  })

  it('expires after ten minutes', () => {
    const state = validState()
    expect(verifyState(state, config.stateSecret, now + stateLifetimeMs)).not.toBeNull()
    expect(verifyState(state, config.stateSecret, now + stateLifetimeMs + 1)).toBeNull()
  })
})

describe('yandex finish', () => {
  it('creates a new account with the same metadata as email sign-up', async () => {
    const port = admin()
    const fetchImpl = yandexFetch(profile)
    const result = await finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce, deviceId, referralClaimToken: claimToken }, { admin: port, fetchImpl, now })

    expect(result).toEqual({ tokenHash: 'hash-1', verificationType: 'magiclink', created: true })
    expect(port.createUser).toHaveBeenCalledWith({
      email: 'pupil@yandex.ru',
      userMetadata: { full_name: 'Иван Петров', device_id: deviceId, referral_claim_token: claimToken, legal_source: 'yandex' },
      appMetadata: { provider: 'yandex', yandex_id: '1130000012345678' },
    })
    expect(port.magicLink).toHaveBeenCalledWith('pupil@yandex.ru')
  })

  it('does not record consent when the button was pressed on the sign-in tab', async () => {
    const port = admin()
    await finishYandexSignIn(config, { code: 'code-123', state: validState(false), nonce }, { admin: port, fetchImpl: yandexFetch(profile), now })
    expect(port.createUser.mock.calls[0][0].userMetadata).toEqual({ full_name: 'Иван Петров' })
  })

  it('signs in to an existing account with that email', async () => {
    const port = admin({ ok: false, exists: true, message: 'A user with this email address has already been registered' })
    const result = await finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce }, { admin: port, fetchImpl: yandexFetch(profile), now })
    expect(result).toEqual({ tokenHash: 'hash-1', verificationType: 'magiclink', created: false })
    expect(port.magicLink).toHaveBeenCalledWith('pupil@yandex.ru')
  })

  it('refuses a Yandex account without email and creates nothing', async () => {
    const port = admin()
    const fetchImpl = yandexFetch({ id: '42', login: 'nomail', real_name: 'Без почты' })
    await expect(finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce }, { admin: port, fetchImpl, now }))
      .rejects.toMatchObject({ status: 400, message: yandexAuthMessages.noEmail })
    expect(port.createUser).not.toHaveBeenCalled()
    expect(port.magicLink).not.toHaveBeenCalled()
  })

  it('refuses a state from another tab before calling Yandex', async () => {
    const port = admin()
    const fetchImpl = yandexFetch(profile)
    await expect(finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce: 'f'.repeat(32) }, { admin: port, fetchImpl, now }))
      .rejects.toMatchObject({ status: 400, reason: 'nonce_mismatch' })
    await expect(finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce }, { admin: port, fetchImpl, now: now + stateLifetimeMs + 1 }))
      .rejects.toMatchObject({ status: 400, reason: 'bad_state' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks to start again when the code has expired', async () => {
    const port = admin()
    const fetchImpl = yandexFetch(profile, { error: 'invalid_grant', error_description: 'Code has expired' })
    await expect(finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce }, { admin: port, fetchImpl, now }))
      .rejects.toMatchObject({ status: 400, message: yandexAuthMessages.stale })
    expect(port.createUser).not.toHaveBeenCalled()
  })

  it('drops malformed device and referral values instead of storing them', async () => {
    const port = admin()
    await finishYandexSignIn(config, { code: 'code-123', state: validState(false), nonce, deviceId: '<script>', referralClaimToken: 'not-a-token' }, { admin: port, fetchImpl: yandexFetch(profile), now })
    expect(port.createUser.mock.calls[0][0].userMetadata).toEqual({ full_name: 'Иван Петров' })
  })

  it('fails loudly when the account cannot be created', async () => {
    const port = admin({ ok: false, exists: false, message: 'Database error saving new user' })
    await expect(finishYandexSignIn(config, { code: 'code-123', state: validState(), nonce }, { admin: port, fetchImpl: yandexFetch(profile), now }))
      .rejects.toMatchObject({ status: 502, message: yandexAuthMessages.accountFailed })
    expect(port.magicLink).not.toHaveBeenCalled()
  })
})

function mockRequest(body: unknown, origin = 'https://www.homeworkcopilot.ru') {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
  }) as unknown as IncomingMessage
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

describe('yandex auth endpoint', () => {
  it('answers 503 with a clear message until the keys are set', async () => {
    expect(yandexAuthConfigFromEnv({})).toBeNull()
    expect(yandexAuthConfigFromEnv({ YANDEX_CLIENT_ID: 'id', YANDEX_CLIENT_SECRET: 'secret', AUTH_STATE_SECRET: 'short' })).toBeNull()
    const { response, state } = mockResponse()
    await handleYandexAuthRequest(mockRequest({ action: 'start', nonce }), response, { yandex: null })
    expect(state.status).toBe(503)
    expect(JSON.parse(state.body)).toEqual({ error: 'Вход через Яндекс ID пока не подключён' })
  })

  it('returns the Yandex authorize URL with a signed state', async () => {
    const fromEnv = yandexAuthConfigFromEnv({ YANDEX_CLIENT_ID: 'client-id', YANDEX_CLIENT_SECRET: 'client-secret', AUTH_STATE_SECRET: 's'.repeat(40) })
    expect(fromEnv).toEqual(config)
    const { response, state, headers } = mockResponse()
    await handleYandexAuthRequest(mockRequest({ action: 'start', nonce, consents: true }), response, { yandex: config, now: () => now })

    expect(state.status).toBe(200)
    expect(headers.get('access-control-allow-origin')).toBe('https://www.homeworkcopilot.ru')
    const url = new URL(JSON.parse(state.body).url as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.yandex.ru/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://www.homeworkcopilot.ru/app')
    expect(url.searchParams.get('scope')).toBe('login:email login:info')
    expect(verifyState(url.searchParams.get('state'), config.stateSecret, now)).toEqual({ nonce, consents: true, expiresAt: now + stateLifetimeMs })
  })

  it('finishes through the admin port and returns only the token hash', async () => {
    const port = admin()
    const { response, state } = mockResponse()
    await handleYandexAuthRequest(
      mockRequest({ action: 'finish', code: 'code-123', state: validState(), nonce, deviceId }),
      response,
      { yandex: config, admin: port, fetchImpl: yandexFetch(profile), now: () => now },
    )
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ tokenHash: 'hash-1', verificationType: 'magiclink' })
  })

  it('refuses a start without a proper nonce', async () => {
    const { response, state } = mockResponse()
    await handleYandexAuthRequest(mockRequest({ action: 'start', nonce: 'short' }), response, { yandex: config, now: () => now })
    expect(state.status).toBe(400)
  })
})
