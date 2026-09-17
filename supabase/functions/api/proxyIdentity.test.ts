// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { proxyAuthDigest as vercelDigest, trustedClientAddress } from '../../../server/telemetry.ts'
import { clientAddress, proxyAuthDigest, proxySigningKeys } from './proxyIdentity.ts'

const secret = 'a'.repeat(64)
const serviceRole = 'eyJservice-role-jwt'

function envOf(values: Record<string, string>) {
  return (name: string) => values[name]
}

describe('адрес ученика в прокси', () => {
  it('подделанный первый элемент x-forwarded-for не становится адресом', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })
    expect(clientAddress(headers)).toBe('203.0.113.7')
  })

  it('cf-connecting-ip важнее x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9', 'cf-connecting-ip': '203.0.113.7' })
    expect(clientAddress(headers)).toBe('203.0.113.7')
  })

  it('x-real-ip от клиента не читается, мусор вместо адреса - тоже', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('')
    expect(clientAddress(new Headers({ 'x-forwarded-for': '<script>' }))).toBe('')
    expect(clientAddress(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1')
  })
})

describe('подпись прокси', () => {
  it('без нового секрета подписывает по-старому', () => {
    const result = proxySigningKeys(envOf({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', HOMEWORK_PROXY_KEY: serviceRole }))
    expect(result.mode).toBe('legacy')
    expect(result.keys).toEqual(['sb_secret_x', serviceRole])
  })

  it('на переходе подписывает и секретом, и прежним ключом', () => {
    const result = proxySigningKeys(envOf({ HOMEWORK_PROXY_SECRET: secret, HOMEWORK_PROXY_KEY: serviceRole, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }))
    expect(result.mode).toBe('transition')
    expect(result.keys[0]).toBe(secret)
    expect(result.keys).toContain(serviceRole)
  })

  it('после снятия HOMEWORK_PROXY_KEY - только секретом', () => {
    const result = proxySigningKeys(envOf({ HOMEWORK_PROXY_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }))
    expect(result).toEqual({ keys: [secret], mode: 'secret', secretTooShort: false })
  })

  it('короткий секрет не используется', () => {
    const result = proxySigningKeys(envOf({ HOMEWORK_PROXY_SECRET: 'short', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }))
    expect(result.secretTooShort).toBe(true)
    expect(result.mode).toBe('legacy')
  })

  it('подпись функции совпадает с той, что ждёт Vercel', async () => {
    expect(await proxyAuthDigest(secret)).toBe(vercelDigest(secret))
  })
})

describe('Vercel принимает подпись прокси', () => {
  const headersWith = (auth: string) => ({ 'x-client-ip': '203.0.113.7', 'x-proxy-auth': auth })

  it('с новым секретом прежняя подпись не принимается', () => {
    const env = { HOMEWORK_PROXY_SECRET: secret }
    expect(trustedClientAddress(headersWith(vercelDigest(secret)), serviceRole, env)).toBe('203.0.113.7')
    expect(trustedClientAddress(headersWith(vercelDigest(serviceRole)), serviceRole, env)).toBeNull()
  })

  it('на переходе принимаются обе', () => {
    const env = { HOMEWORK_PROXY_SECRET: secret, HOMEWORK_PROXY_ACCEPT_LEGACY: '1' }
    expect(trustedClientAddress(headersWith(vercelDigest(secret)), serviceRole, env)).toBe('203.0.113.7')
    expect(trustedClientAddress(headersWith(vercelDigest(serviceRole)), serviceRole, env)).toBe('203.0.113.7')
  })

  it('без секрета работает прежняя подпись', () => {
    expect(trustedClientAddress(headersWith(vercelDigest(serviceRole)), serviceRole, {})).toBe('203.0.113.7')
    expect(trustedClientAddress(headersWith('forged'), serviceRole, {})).toBeNull()
  })
})
