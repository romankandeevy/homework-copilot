/* Адрес ученика и подпись прокси. Отдельный модуль без `Deno.serve`, чтобы
   vitest проверял его так же, как код на Vercel (proxyIdentity.test.ts).

   Адрес (аудит 16 сентября, В1). Раньше брался первый элемент
   `x-forwarded-for` - его пишет сам клиент: скрипт со случайным
   `X-Forwarded-For` и новой меткой гостя получал бесплатное решение без
   предела. Что на самом деле ставит платформа:
   - `*.supabase.co` стоит за Cloudflare, и `cf-connecting-ip` Cloudflare
     перезаписывает на своём крае адресом того, кто к нему подключился.
     Присланный клиентом заголовок до функции не доходит;
   - в `x-forwarded-for` шлюз дописывает настоящий адрес в конец: на запрос с
     подделкой функция видит `подделка, настоящий` (supabase discussion
     #34647). Первый элемент - слово клиента, последний - слово шлюза;
   - `info.remoteAddr` у `Deno.serve` на Supabase - адрес внутреннего шлюза,
     а не ученика: все гости слились бы в один адрес;
   - `x-real-ip` шлюз не обещает, его может прислать клиент.
   Поэтому: `cf-connecting-ip`, иначе последний элемент `x-forwarded-for`.
   Расхождение двух источников пишется в журнал (`proxy_address_sources`) -
   по нему владелец сверяет выбор вживую. */

type HeaderSource = { get(name: string): string | null }

const maxAddressLength = 64
const addressPattern = /^[0-9A-Fa-f:.]{2,64}$/u

function cleanAddress(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  return addressPattern.test(trimmed) ? trimmed.slice(0, maxAddressLength) : ''
}

export function clientAddressSources(headers: HeaderSource) {
  const cloudflare = cleanAddress(headers.get('cf-connecting-ip'))
  const forwarded = (headers.get('x-forwarded-for') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  const lastForwarded = cleanAddress(forwarded[forwarded.length - 1])
  return { cloudflare, lastForwarded, forwardedCount: forwarded.length }
}

export function clientAddress(headers: HeaderSource) {
  const { cloudflare, lastForwarded } = clientAddressSources(headers)
  return cloudflare || lastForwarded
}

/* Подпись (аудит 16 сентября, В9). Подписываем отдельным случайным секретом
   `HOMEWORK_PROXY_SECRET`, который лежит и здесь, и на Vercel. Прежде
   подписью был хэш JWT `service_role` (`HOMEWORK_PROXY_KEY`) - секрет функции
   тогда давал полный доступ к базе.

   Переход без простоя: пока нового секрета нет - подписываем по-старому,
   всеми служебными ключами. Когда секрет задан - подписываем им, а прежними
   ключами только пока ещё задан `HOMEWORK_PROXY_KEY`. Снять его - последний
   шаг выкатки, после того как Vercel перестал принимать прежнюю подпись. */
export const minProxySecretLength = 32

function collectKeys(value: unknown, into: Set<string>) {
  if (typeof value === 'string') {
    if (/^(?:eyJ|sb_secret_)/u.test(value)) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) collectKeys(entry, into)
  }
}

export type ProxyKeys = { keys: string[]; mode: 'secret' | 'transition' | 'legacy'; secretTooShort: boolean }

export function proxySigningKeys(env: (name: string) => string | undefined): ProxyKeys {
  const rawSecret = (env('HOMEWORK_PROXY_SECRET') ?? '').trim()
  const secretTooShort = rawSecret.length > 0 && rawSecret.length < minProxySecretLength
  const secret = secretTooShort ? '' : rawSecret
  const legacyShared = (env('HOMEWORK_PROXY_KEY') ?? '').trim()

  const legacy = new Set<string>()
  if (!secret || legacyShared) {
    const serviceRole = env('SUPABASE_SERVICE_ROLE_KEY')
    if (serviceRole) legacy.add(serviceRole)
    if (legacyShared) legacy.add(legacyShared)
    const secretRaw = env('SUPABASE_SECRET_KEYS')
    if (secretRaw) {
      try {
        collectKeys(JSON.parse(secretRaw) as unknown, legacy)
      } catch {
        collectKeys(secretRaw, legacy)
      }
    }
  }

  if (!secret) return { keys: [...legacy], mode: 'legacy', secretTooShort }
  legacy.delete(secret)
  return legacy.size ? { keys: [secret, ...legacy], mode: 'transition', secretTooShort } : { keys: [secret], mode: 'secret', secretTooShort }
}

export async function proxyAuthDigest(key: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + ':homework-copilot-proxy'))
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
