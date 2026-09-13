import { describe, expect, it } from 'vitest'
import { checkTopUpKopecks, maxTopUpKopecks, minTopUpKopecks, parseTopUpRubles } from './topUpLimits'

describe('top-up limits', () => {
  it('accepts whole rubles written the way people type them', () => {
    expect(parseTopUpRubles('150')).toEqual({ ok: true, kopecks: 15000 })
    expect(parseTopUpRubles('1 500 ₽')).toEqual({ ok: true, kopecks: 150000 })
    expect(parseTopUpRubles(' 300 руб. ')).toEqual({ ok: true, kopecks: 30000 })
  })

  it('refuses fractions instead of silently rounding the payment', () => {
    expect(parseTopUpRubles('150,50').ok).toBe(false)
    expect(parseTopUpRubles('1e3').ok).toBe(false)
    expect(parseTopUpRubles('').ok).toBe(false)
  })

  it('keeps the amount inside the limits mirrored by create_payment_order', () => {
    expect(checkTopUpKopecks(minTopUpKopecks).ok).toBe(true)
    expect(checkTopUpKopecks(maxTopUpKopecks).ok).toBe(true)
    expect(checkTopUpKopecks(minTopUpKopecks - 100).ok).toBe(false)
    expect(checkTopUpKopecks(maxTopUpKopecks + 100).ok).toBe(false)
    expect(checkTopUpKopecks(minTopUpKopecks + 50).ok).toBe(false)
  })
})
