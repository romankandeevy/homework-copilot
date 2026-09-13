import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from './database.types'

/* Дата действующей редакции. В базе она живёт в `private.current_legal_version()`
   и проставляется сервером — здесь копия только для показа на странице. */
export const legalDocumentVersion = '2026-09-13'
const pendingAcceptanceKey = 'homework-copilot:legal-acceptance-pending'

/* Чем человек вошёл, когда принимал документы. Тот же список проверяет база
   (`legal_acceptances.source`, миграция 20260913100500). Google остаётся для
   аккаунтов, созданных до 13 сентября. */
export type AcceptanceSource = 'email' | 'google' | 'yandex' | 'phone'

const acceptanceSources: readonly AcceptanceSource[] = ['email', 'google', 'yandex', 'phone']

function parseAcceptanceSource(value: unknown): AcceptanceSource | null {
  return acceptanceSources.find((source) => source === value) ?? null
}

/** Источник для окна согласия: способ входа аккаунта. */
export function acceptanceSourceForUser(user: Pick<User, 'app_metadata'>): AcceptanceSource {
  return parseAcceptanceSource(user.app_metadata?.provider) ?? 'email'
}

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
    const source = parseAcceptanceSource(pending.source)
    // Почта известна только у регистрации по почте. Для Яндекса она
    // неизвестна в момент клика по кнопке, у телефона её нет вовсе — такое
    // согласие запоминается без почты и сверяется, только если она есть.
    const expectedEmail = typeof pending.email === 'string' ? pending.email.trim().toLocaleLowerCase('ru') : ''
    const currentEmail = userEmail?.trim().toLocaleLowerCase('ru') ?? ''
    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    const expired = Date.now() - createdAt > 24 * 60 * 60 * 1000
    const emailMismatch = expectedEmail !== '' && expectedEmail !== currentEmail
    if (!source || expired || emailMismatch) {
      forgetPendingLegalAcceptance()
      return
    }

    const { error } = await client.rpc('record_current_legal_acceptance', { p_source: source })
    if (!error) forgetPendingLegalAcceptance()
  } catch {
    forgetPendingLegalAcceptance()
  }
}
