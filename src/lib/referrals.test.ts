import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureReferralFromCurrentUrl,
  getPendingReferralCode,
  normalizeReferralCode,
  parseReferralStatus,
  parseReferralUrl,
  pendingReferralStorageKey,
  preparePendingReferralClaim,
} from './referrals'

describe('referrals', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.useRealTimers()
  })

  it('normalizes only opaque ten-character codes', () => {
    expect(normalizeReferralCode(' ab12cd34ef ')).toBe('AB12CD34EF')
    expect(normalizeReferralCode('ABCD')).toBeNull()
    expect(normalizeReferralCode('АB12CD34EF')).toBeNull()
  })

  it('captures a referral and removes it from the visible URL', () => {
    window.history.replaceState({}, '', '/?ref=ab12cd34ef&utm=test#start')
    expect(captureReferralFromCurrentUrl()).toBe('AB12CD34EF')
    expect(getPendingReferralCode()).toBe('AB12CD34EF')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/?utm=test#start')
  })

  it('drops expired referral state', () => {
    window.localStorage.setItem(pendingReferralStorageKey, JSON.stringify({
      code: 'AB12CD34EF',
      capturedAt: '2026-08-01T00:00:00.000Z',
    }))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
    expect(getPendingReferralCode()).toBeNull()
  })

  it('exchanges the public code for a single-use registration claim', async () => {
    window.history.replaceState({}, '', '/?ref=ab12cd34ef')
    captureReferralFromCurrentUrl()
    const rpc = vi.fn().mockResolvedValue({
      data: { claimToken: '0f65dd61-a5df-4b65-980c-74f1ef7cdf13' },
      error: null,
    })
    const client = { rpc } as unknown as Parameters<typeof preparePendingReferralClaim>[0]

    await expect(preparePendingReferralClaim(client)).resolves.toBe('0f65dd61-a5df-4b65-980c-74f1ef7cdf13')
    await expect(preparePendingReferralClaim(client)).resolves.toBe('0f65dd61-a5df-4b65-980c-74f1ef7cdf13')
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('begin_referral_registration', { p_code: 'AB12CD34EF' })
  })

  it('parses the server summary without exposing user ids', () => {
    expect(parseReferralStatus({
      code: 'AB12CD34EF',
      invitedCount: 3,
      pendingCount: 2,
      rewardedCount: 1,
      earnedAmount: 10,
      joinedViaReferral: true,
      joinedRewardStatus: 'pending',
      referrerRewardAmount: 10,
      inviteeRewardAmount: 5,
    })).toEqual({
      code: 'AB12CD34EF',
      invitedCount: 3,
      pendingCount: 2,
      rewardedCount: 1,
      earnedAmount: 10,
      joinedViaReferral: true,
      joinedRewardStatus: 'pending',
      referrerRewardAmount: 10,
      inviteeRewardAmount: 5,
    })
    expect(parseReferralUrl('https://example.com/?ref=bad').code).toBeNull()
  })
})
