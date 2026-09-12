import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { recordPendingLegalAcceptance, rememberPendingLegalAcceptance } from './legalConsent'

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
})
