import { describe, expect, it } from 'vitest'
import { readPaymentReturn, withoutPaymentReturn } from './payments'

describe('payment return address', () => {
  it('reads which order to ask about, and nothing more', () => {
    expect(readPaymentReturn('?payment=success&InvId=100001&OutSum=150.00&SignatureValue=abc')).toEqual({ outcome: 'success', invId: 100001 })
    expect(readPaymentReturn('?payment=fail')).toEqual({ outcome: 'fail', invId: null })
    expect(readPaymentReturn('?payment=success&InvId=-3')).toEqual({ outcome: 'success', invId: null })
    expect(readPaymentReturn('?payment=maybe')).toBeNull()
    expect(readPaymentReturn('')).toBeNull()
  })

  it('removes Robokassa parameters and keeps the rest of the address', () => {
    expect(withoutPaymentReturn('https://www.homeworkcopilot.ru/app?payment=success&InvId=1&OutSum=1&SignatureValue=x&Culture=ru&shp_a=1&tab=x#top'))
      .toBe('/app?tab=x#top')
  })
})
