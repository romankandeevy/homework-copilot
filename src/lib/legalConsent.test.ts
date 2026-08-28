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

  it('waits until Google supplies the verified email', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    rememberPendingLegalAcceptance('google')
    await recordPendingLegalAcceptance(client, 'student@example.com')
    expect(rpc).not.toHaveBeenCalled()

    rememberPendingLegalAcceptance('google', 'student@example.com')
    await recordPendingLegalAcceptance(client, 'student@example.com')
    expect(rpc).toHaveBeenCalledWith('record_current_legal_acceptance', { p_source: 'google' })
  })
})
