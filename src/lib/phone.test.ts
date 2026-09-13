import { describe, expect, it } from 'vitest'
import { formatPhoneDigits, formatPhoneForDisplay, isRussianMobileDigits, normalizeRussianMobile, phoneDigitsFromInput, russianPhoneE164 } from './phone'

describe('phone input', () => {
  it('keeps ten national digits whatever the prefix', () => {
    expect(phoneDigitsFromInput('9123456789')).toBe('9123456789')
    expect(phoneDigitsFromInput('+7 (912) 345-67-89')).toBe('9123456789')
    expect(phoneDigitsFromInput('8 912 345 67 89')).toBe('9123456789')
    expect(phoneDigitsFromInput('79123456789')).toBe('9123456789')
    // Набор с восьмёрки: пока цифр десять, это ещё номер, одиннадцатая снимает префикс.
    expect(phoneDigitsFromInput('8912345678')).toBe('8912345678')
    expect(phoneDigitsFromInput('891 234-56-789')).toBe('9123456789')
    expect(phoneDigitsFromInput('91234567890123')).toBe('9123456789')
  })

  it('formats progressively', () => {
    expect(formatPhoneDigits('')).toBe('')
    expect(formatPhoneDigits('912')).toBe('912')
    expect(formatPhoneDigits('9123')).toBe('912 3')
    expect(formatPhoneDigits('9123456')).toBe('912 345-6')
    expect(formatPhoneDigits('912345678')).toBe('912 345-67-8')
    expect(formatPhoneDigits('9123456789')).toBe('912 345-67-89')
  })

  it('accepts only Russian mobile numbers', () => {
    expect(isRussianMobileDigits('9123456789')).toBe(true)
    expect(isRussianMobileDigits('4951234567')).toBe(false)
    expect(isRussianMobileDigits('912345678')).toBe(false)
  })
})

describe('phone normalization', () => {
  it('reads the number Supabase sends to the hook', () => {
    expect(normalizeRussianMobile('79123456789')).toBe('9123456789')
    expect(normalizeRussianMobile('+79123456789')).toBe('9123456789')
    expect(normalizeRussianMobile('+7 912 345-67-89')).toBe('9123456789')
    expect(normalizeRussianMobile('89123456789')).toBe('9123456789')
  })

  it('rejects foreign, landline and malformed numbers', () => {
    expect(normalizeRussianMobile('77012345678')).toBeNull() // Казахстан, +7 7XX
    expect(normalizeRussianMobile('74951234567')).toBeNull() // городской
    expect(normalizeRussianMobile('380501234567')).toBeNull()
    expect(normalizeRussianMobile('7912345678')).toBeNull()
    expect(normalizeRussianMobile('7912345678a')).toBeNull()
    expect(normalizeRussianMobile(79123456789)).toBeNull()
    expect(normalizeRussianMobile(undefined)).toBeNull()
  })

  it('builds E.164 and display forms', () => {
    expect(russianPhoneE164('9123456789')).toBe('+79123456789')
    expect(formatPhoneForDisplay('79123456789')).toBe('+7 912 345-67-89')
    expect(formatPhoneForDisplay('380501234567')).toBe('+380501234567')
    expect(formatPhoneForDisplay('')).toBe('')
    expect(formatPhoneForDisplay(null)).toBe('')
  })
})
