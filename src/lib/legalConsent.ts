import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const legalDocumentVersion = '2026-08-28'
const pendingAcceptanceKey = 'homework-copilot:legal-acceptance-pending'

type AcceptanceSource = 'email' | 'google'

export function rememberPendingLegalAcceptance(source: AcceptanceSource, email?: string) {
  sessionStorage.setItem(pendingAcceptanceKey, JSON.stringify({ source, email: email?.trim().toLocaleLowerCase('ru'), createdAt: Date.now() }))
}

export function forgetPendingLegalAcceptance() {
  sessionStorage.removeItem(pendingAcceptanceKey)
}

export async function recordPendingLegalAcceptance(client: SupabaseClient<Database>, userEmail?: string) {
  const value = sessionStorage.getItem(pendingAcceptanceKey)
  if (!value) return

  try {
    const pending = JSON.parse(value) as { source?: unknown; email?: unknown; createdAt?: unknown }
    const source = pending.source === 'google' ? 'google' : pending.source === 'email' ? 'email' : null
    const expectedEmail = typeof pending.email === 'string' ? pending.email.trim().toLocaleLowerCase('ru') : ''
    const currentEmail = userEmail?.trim().toLocaleLowerCase('ru') ?? ''
    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    if (!source || !expectedEmail || !currentEmail || expectedEmail !== currentEmail || Date.now() - createdAt > 24 * 60 * 60 * 1000) {
      if (!source || (expectedEmail && currentEmail && expectedEmail !== currentEmail) || Date.now() - createdAt > 24 * 60 * 60 * 1000) forgetPendingLegalAcceptance()
      return
    }

    const { error } = await client.rpc('record_current_legal_acceptance', { p_source: source })
    if (!error) forgetPendingLegalAcceptance()
  } catch {
    forgetPendingLegalAcceptance()
  }
}
