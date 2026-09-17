import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { browserOriginAllowed, clientAddress, proxyAuthDigest, proxyAuthExpectedPrefixes, trustedClientAddress } from './telemetry.ts'

const productionOrigins = new Set(['https://www.homeworkcopilot.ru'])

/* Аудит 16 сентября, В8: localhost в CORS только вне прода. */
describe('CORS функций', () => {
  it('на проде пускает только адреса сайта', () => {
    const env = { VERCEL_ENV: 'production' }
    expect(browserOriginAllowed('https://www.homeworkcopilot.ru', productionOrigins, env)).toBe(true)
    expect(browserOriginAllowed('http://localhost:5173', productionOrigins, env)).toBe(false)
    expect(browserOriginAllowed('http://127.0.0.1:4173', productionOrigins, env)).toBe(false)
  })

  it('вне прода пускает и локальную разработку, но не чужие адреса', () => {
    expect(browserOriginAllowed('http://localhost:5173', productionOrigins, { VERCEL_ENV: 'preview' })).toBe(true)
    expect(browserOriginAllowed('http://127.0.0.1:4173', productionOrigins, {})).toBe(true)
    expect(browserOriginAllowed('https://example.com', productionOrigins, {})).toBe(false)
    expect(browserOriginAllowed(undefined, productionOrigins, {})).toBe(false)
  })
})

/* Аудит 16 сентября, В9 и В11: подпись прокси и адрес ученика в журналах. */
describe('адрес ученика за прокси', () => {
  const key = 'service-role-key-for-tests'
  const secret = 'f'.repeat(64)

  function request(headers: Record<string, string>) {
    return { headers, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage
  }

  it('журнал берёт подписанный адрес прокси, а без подписи - адрес соединения', () => {
    const previous = process.env.HOMEWORK_PROXY_SECRET
    delete process.env.HOMEWORK_PROXY_SECRET
    try {
      expect(clientAddress(request({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': proxyAuthDigest(key), 'x-forwarded-for': '52.1.1.1' }), key)).toBe('203.0.113.7')
      expect(clientAddress(request({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': 'forged', 'x-forwarded-for': '52.1.1.1' }), key)).toBe('52.1.1.1')
      expect(proxyAuthExpectedPrefixes(key)).toBe(proxyAuthDigest(key).slice(0, 8))
    } finally {
      if (previous !== undefined) process.env.HOMEWORK_PROXY_SECRET = previous
    }
  })

  it('короткий секрет не заменяет прежнюю подпись', () => {
    const headers = { 'x-client-ip': '203.0.113.7', 'x-proxy-auth': proxyAuthDigest('short') }
    expect(trustedClientAddress(headers, key, { HOMEWORK_PROXY_SECRET: 'short' })).toBeNull()
    expect(trustedClientAddress({ ...headers, 'x-proxy-auth': proxyAuthDigest(key) }, key, { HOMEWORK_PROXY_SECRET: 'short' })).toBe('203.0.113.7')
  })

  it('с секретом ожидает его подпись первой', () => {
    expect(proxyAuthExpectedPrefixes(key, { HOMEWORK_PROXY_SECRET: secret })).toBe(proxyAuthDigest(secret).slice(0, 8))
    expect(proxyAuthExpectedPrefixes(key, { HOMEWORK_PROXY_SECRET: secret, HOMEWORK_PROXY_ACCEPT_LEGACY: '1' }))
      .toBe(`${proxyAuthDigest(secret).slice(0, 8)},${proxyAuthDigest(key).slice(0, 8)}`)
  })
})
