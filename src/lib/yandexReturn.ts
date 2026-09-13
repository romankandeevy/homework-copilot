/* Возврат из Яндекс ID.

   Яндекс возвращает человека на `/app?code=…&state=…` (или `?error=…`, если
   он отказался). Код забирается из адреса здесь, в `src/main.tsx`, до
   создания клиента Supabase: supabase-js с `detectSessionInUrl` принимает
   `?code=` за свой PKCE-обмен, если у него лежит code verifier, а `?error=`
   - за отказ неявного потока. Вместо них в адресе остаётся `auth=yandex`,
   и приложение завершает вход (`completeYandexSignIn`).

   Чужой `code` не трогаем: забираем, только если эта вкладка сама начала
   вход и оставила nonce в sessionStorage.

   Модуль без зависимостей - он в основном бандле, до разводки витрины и
   приложения. */

const nonceKey = 'homework-copilot:yandex-auth-nonce'
const returnKey = 'homework-copilot:yandex-auth-return'
const returnParams = ['code', 'state', 'error', 'error_description', 'cid']

export type YandexReturn = { code: string; state: string; error: string; nonce: string }

export function rememberYandexNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(nonceKey, nonce)
  return nonce
}

export function forgetYandexNonce() {
  try {
    sessionStorage.removeItem(nonceKey)
  } catch {
    // Хранилище недоступно - и забывать нечего.
  }
}

export function captureYandexReturn() {
  let nonce: string | null
  try {
    nonce = sessionStorage.getItem(nonceKey)
  } catch {
    return false
  }
  if (!nonce) return false

  const url = new URL(window.location.href)
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  const error = url.searchParams.get('error') ?? ''
  if (!state || (!code && !error)) return false

  try {
    sessionStorage.setItem(returnKey, JSON.stringify({ code, state, error, nonce }))
    sessionStorage.removeItem(nonceKey)
  } catch {
    return false
  }

  for (const name of returnParams) url.searchParams.delete(name)
  url.searchParams.set('auth', 'yandex')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return true
}

/** Возврат, пойманный `captureYandexReturn`. Отдаётся один раз. */
export function takeYandexReturn(): YandexReturn | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(returnKey)
    sessionStorage.removeItem(returnKey)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const pick = (key: string) => (typeof parsed[key] === 'string' ? parsed[key] : '')
    const value = { code: pick('code'), state: pick('state'), error: pick('error'), nonce: pick('nonce') }
    return value.state && value.nonce && (value.code || value.error) ? value : null
  } catch {
    return null
  }
}
