import { beforeEach, describe, expect, it } from 'vitest'
import { captureYandexReturn, rememberYandexNonce, takeYandexReturn } from './yandexReturn'

describe('yandex return capture', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  // Чужой `?code=` (например, обмен Supabase) не трогаем: код забирается,
  // только если эта вкладка сама ушла на Яндекс.
  it('leaves the URL alone when this tab did not start the sign-in', () => {
    window.history.replaceState({}, '', '/app?code=abc123&state=signed.state')
    expect(captureYandexReturn()).toBe(false)
    expect(window.location.search).toBe('?code=abc123&state=signed.state')
    expect(takeYandexReturn()).toBeNull()
  })

  it('moves code and state out of the URL before supabase-js can see them', () => {
    const nonce = rememberYandexNonce()
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    window.history.replaceState({}, '', '/app?code=abc123&state=signed.state&cid=42')

    expect(captureYandexReturn()).toBe(true)
    expect(`${window.location.pathname}${window.location.search}`).toBe('/app?auth=yandex')
    expect(takeYandexReturn()).toEqual({ code: 'abc123', state: 'signed.state', error: '', nonce })
    // Отдаётся один раз, и nonce после этого не лежит.
    expect(takeYandexReturn()).toBeNull()
    expect(captureYandexReturn()).toBe(false)
  })

  it('captures a refusal too, so supabase-js does not treat it as its own error', () => {
    const nonce = rememberYandexNonce()
    window.history.replaceState({}, '', '/app?error=access_denied&error_description=user+denied&state=signed.state')
    expect(captureYandexReturn()).toBe(true)
    expect(window.location.search).toBe('?auth=yandex')
    expect(takeYandexReturn()).toEqual({ code: '', state: 'signed.state', error: 'access_denied', nonce })
  })
})
