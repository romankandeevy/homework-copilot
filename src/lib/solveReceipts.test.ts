import { describe, expect, it } from 'vitest'
import { formatSolveDuration, receiptLabel } from './solveReceipts'

describe('чек решения', () => {
  it('время и списанная сумма одной строкой', () => {
    expect(receiptLabel({ seconds: 24, kopecks: 520 })).toBe('решено за 24 с · списано 5,20 ₽')
    expect(receiptLabel({ seconds: 83, kopecks: 400 })).toBe('решено за 1 мин 23 с · списано 4 ₽')
  })

  it('гостю и повторному открытию - без суммы', () => {
    expect(receiptLabel({ seconds: 15, kopecks: 0 })).toBe('решено за 15 с · бесплатно')
    expect(receiptLabel({ seconds: 1, kopecks: 0, reused: true })).toBe('уже было решено · повторно бесплатно')
  })

  it('без чека - только время по очереди, без него - ничего', () => {
    expect(receiptLabel(null, 47.4)).toBe('решено за 47 с')
    expect(receiptLabel(null, null)).toBeNull()
  })

  it('минуты ровно и доли секунды', () => {
    expect(formatSolveDuration(120)).toBe('2 мин')
    expect(formatSolveDuration(0.2)).toBe('1 с')
  })
})
