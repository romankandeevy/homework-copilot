import { describe, expect, it } from 'vitest'
import { deleteConfirmMatches, deleteConfirmWord } from './deleteConfirm'

describe('deleteConfirmMatches', () => {
  it('accepts the account email regardless of case and spaces', () => {
    expect(deleteConfirmMatches(' Student@Example.test ', 'student@example.test')).toBe(true)
    expect(deleteConfirmMatches('student@example.tes', 'student@example.test')).toBe(false)
  })

  it('accepts the phone number in any format', () => {
    expect(deleteConfirmMatches('+7 (900) 123-45-67', '79001234567')).toBe(true)
    expect(deleteConfirmMatches('+7 900 123-45-6', '79001234567')).toBe(false)
  })

  it('needs the exact word for several accounts', () => {
    expect(deleteConfirmMatches(deleteConfirmWord, deleteConfirmWord)).toBe(true)
    expect(deleteConfirmMatches('удалить', deleteConfirmWord)).toBe(false)
  })

  it('never matches an empty target', () => {
    expect(deleteConfirmMatches('', '')).toBe(false)
    expect(deleteConfirmMatches('anything', '')).toBe(false)
  })
})
