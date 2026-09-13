import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { getGuestId } from './guestSolutions'
import { preparePendingReferralClaim } from './referrals'
import { forgetYandexNonce, rememberYandexNonce } from './yandexReturn'
import type { YandexReturn } from './yandexReturn'

/* Клиент входа через Яндекс ID. Функция на Vercel - через тот же прокси на
   домене Supabase, что решатель и оплата: из российских сетей до
   *.vercel.app доходит через раз. Как устроен поток - server/yandexAuth.ts. */

export class YandexAuthRequestError extends Error {}

const failedMessage = 'Не получилось связаться с сервером входа. Попробуй ещё раз через минуту'

export function yandexAuthApiUrl() {
  const explicit = import.meta.env.VITE_YANDEX_AUTH_API_URL as string | undefined
  if (explicit) return explicit
  const solve = import.meta.env.VITE_HOMEWORK_API_URL as string | undefined
  if (solve && /\/solve$/u.test(solve)) return solve.replace(/\/solve$/u, '/auth-yandex')
  return '/api/auth-yandex'
}

async function authAction<T>(body: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(yandexAuthApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new YandexAuthRequestError(failedMessage)
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    // Наружу - только наши тексты, их признак - кириллица (как в оплате).
    const message = typeof payload.error === 'string' && /[а-яё]/iu.test(payload.error) ? payload.error : failedMessage
    throw new YandexAuthRequestError(message)
  }
  return payload as T
}

/** Уводит вкладку на Яндекс. `consents` - отметки стояли на вкладке «Регистрация». */
export async function startYandexSignIn(consents: boolean) {
  const nonce = rememberYandexNonce()
  try {
    const { url } = await authAction<{ url?: unknown }>({ action: 'start', nonce, consents })
    if (typeof url !== 'string' || !url.startsWith('https://oauth.yandex.ru/')) throw new YandexAuthRequestError(failedMessage)
    window.location.assign(url)
  } catch (error) {
    forgetYandexNonce()
    throw error
  }
}

/** Завершает вход после возврата с Яндекса. Пустая строка - вошли, иначе текст для человека. */
export async function completeYandexSignIn(client: SupabaseClient<Database>, pending: YandexReturn): Promise<string> {
  if (pending.error) {
    return pending.error === 'access_denied' ? 'Вход через Яндекс ID отменён' : 'Яндекс не подтвердил вход. Попробуй ещё раз'
  }

  let referralClaimToken: string | null = null
  try {
    referralClaimToken = await preparePendingReferralClaim(client)
  } catch {
    // Без приглашения вход всё равно завершается: его привяжет bindPendingReferral.
  }

  try {
    const result = await authAction<{ tokenHash?: unknown; verificationType?: unknown }>({
      action: 'finish',
      code: pending.code,
      state: pending.state,
      nonce: pending.nonce,
      // Та же метка, по которой гостю выдаётся первое решение: стартовые 20 ₽ - раз на метку.
      deviceId: getGuestId(),
      referralClaimToken,
    })
    if (typeof result.tokenHash !== 'string' || !result.tokenHash) return failedMessage
    const type = result.verificationType === 'signup' || result.verificationType === 'email' ? result.verificationType : 'magiclink'
    const { error } = await client.auth.verifyOtp({ token_hash: result.tokenHash, type })
    return error ? 'Не получилось завершить вход. Нажми «Войти с Яндекс ID» ещё раз' : ''
  } catch (error) {
    return error instanceof YandexAuthRequestError ? error.message : failedMessage
  }
}
