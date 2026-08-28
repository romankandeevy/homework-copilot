import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database, Json } from './database.types'

export const pendingReferralStorageKey = 'homework-copilot:pending-referral'

export type ReferralStatus = {
  code: string
  invitedCount: number
  pendingCount: number
  rewardedCount: number
  earnedAmount: number
  joinedViaReferral: boolean
  joinedRewardStatus: 'pending' | 'rewarded' | null
  referrerRewardAmount: number
  inviteeRewardAmount: number
}

type PendingReferral = {
  code: string
  capturedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function normalizeReferralCode(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null
}

export function parseReferralUrl(href: string) {
  const url = new URL(href)
  const code = normalizeReferralCode(url.searchParams.get('ref'))
  url.searchParams.delete('ref')
  return {
    code,
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
  }
}

export function captureReferralFromCurrentUrl() {
  const currentUrl = new URL(window.location.href)
  if (!currentUrl.searchParams.has('ref')) return null

  const { code, cleanUrl } = parseReferralUrl(currentUrl.href)
  if (code) {
    const pending: PendingReferral = { code, capturedAt: new Date().toISOString() }
    try {
      window.localStorage.setItem(pendingReferralStorageKey, JSON.stringify(pending))
    } catch {
      // The registration flow can continue without referral persistence.
    }
  }
  window.history.replaceState(window.history.state, '', cleanUrl)
  return code
}

export function getPendingReferralCode() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(pendingReferralStorageKey) ?? 'null') as unknown
    if (!isRecord(parsed)) return null
    const code = normalizeReferralCode(parsed.code)
    const capturedAt = typeof parsed.capturedAt === 'string' ? Date.parse(parsed.capturedAt) : Number.NaN
    if (!code || !Number.isFinite(capturedAt) || Date.now() - capturedAt > 7 * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(pendingReferralStorageKey)
      return null
    }
    return code
  } catch {
    return null
  }
}

export function clearPendingReferral() {
  try {
    window.localStorage.removeItem(pendingReferralStorageKey)
  } catch {
    // No cleanup is needed when storage is unavailable.
  }
}

export function parseReferralStatus(value: Json): ReferralStatus | null {
  if (!isRecord(value)) return null
  const code = normalizeReferralCode(value.code)
  if (!code) return null
  const joinedRewardStatus = value.joinedRewardStatus === 'pending' || value.joinedRewardStatus === 'rewarded'
    ? value.joinedRewardStatus
    : null
  return {
    code,
    invitedCount: numberValue(value.invitedCount),
    pendingCount: numberValue(value.pendingCount),
    rewardedCount: numberValue(value.rewardedCount),
    earnedAmount: numberValue(value.earnedAmount),
    joinedViaReferral: value.joinedViaReferral === true,
    joinedRewardStatus,
    referrerRewardAmount: numberValue(value.referrerRewardAmount),
    inviteeRewardAmount: numberValue(value.inviteeRewardAmount),
  }
}

export async function loadReferralStatus(client: SupabaseClient<Database>) {
  const { data, error } = await client.rpc('get_my_referral')
  if (error) throw error
  const status = parseReferralStatus(data)
  if (!status) throw new Error('invalid referral response')
  return status
}

export async function bindPendingReferral(client: SupabaseClient<Database>, user: User) {
  const code = getPendingReferralCode()
  if (!code) return false

  const accountCreatedAt = Date.parse(user.created_at)
  if (!Number.isFinite(accountCreatedAt) || Date.now() - accountCreatedAt > 24 * 60 * 60 * 1000) {
    clearPendingReferral()
    return false
  }

  const { error } = await client.rpc('bind_my_referral', { p_code: code })
  if (!error) {
    clearPendingReferral()
    return true
  }

  const permanentError = [
    'available only during registration',
    'invalid referral code',
    'referral code not found',
    'another referral is already bound',
    'self referral is not allowed',
    'after a top up',
  ].some((fragment) => error.message.includes(fragment))
  if (permanentError) clearPendingReferral()
  return false
}
