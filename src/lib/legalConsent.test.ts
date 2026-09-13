import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { acceptanceSourceForUser, recordPendingLegalAcceptance, rememberPendingLegalAcceptance } from './legalConsent'

describe('legal acceptance handoff', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('records only for the same verified email', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    rememberPendingLegalAcceptance('email', 'Student@Example.com')
    await recordPendingLegalAcceptance(client, 'student@example.com')
    expect(rpc).toHaveBeenCalledWith('record_current_legal_acceptance', { p_source: 'email' })

    rememberPendingLegalAcceptance('email', 'other@example.com')
    await recordPendingLegalAcceptance(client, 'student@example.com')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('records a Google acceptance even before the email is known', async () => {
    // Гугл не даёт почту в момент клика по кнопке - согласие запоминается
    // без неё и засчитывается на первую же почту, которую вернёт сессия.
    const rpc = vi.fn(async () => ({ error: null }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    rememberPendingLegalAcceptance('google')
    await recordPendingLegalAcceptance(client, 'student@example.com')
    expect(rpc).toHaveBeenCalledWith('record_current_legal_acceptance', { p_source: 'google' })
  })

  // У аккаунта, вошедшего по телефону, почты нет вовсе: согласие с вкладки
  // «Регистрация» всё равно должно записаться.
  it('records a phone acceptance for an account without email and a Yandex one before the email is known', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    rememberPendingLegalAcceptance('phone')
    await recordPendingLegalAcceptance(client, undefined)
    expect(rpc).toHaveBeenCalledWith('record_current_legal_acceptance', { p_source: 'phone' })

    rememberPendingLegalAcceptance('yandex')
    await recordPendingLegalAcceptance(client, 'pupil@yandex.ru')
    expect(rpc).toHaveBeenLastCalledWith('record_current_legal_acceptance', { p_source: 'yandex' })
  })

  it('takes the acceptance source from the way the account signs in', () => {
    expect(acceptanceSourceForUser({ app_metadata: { provider: 'phone' } })).toBe('phone')
    expect(acceptanceSourceForUser({ app_metadata: { provider: 'yandex' } })).toBe('yandex')
    expect(acceptanceSourceForUser({ app_metadata: { provider: 'google' } })).toBe('google')
    expect(acceptanceSourceForUser({ app_metadata: { provider: 'email' } })).toBe('email')
    expect(acceptanceSourceForUser({ app_metadata: {} })).toBe('email')
  })
})
