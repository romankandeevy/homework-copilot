/* Вход для функций решателя, чата и поддержки.

   Сами функции живут на Vercel, но из российских сетей запрос до
   `*.vercel.app` доходит через раз, а тяжёлый - с фотографией - не доходит
   вовсе (аудит 5 сентября 2026, AGENTS.md «Хостинг»). Домен Supabase из
   тех же сетей ходит без сбоев: опрос очереди шёл весь день с тех же
   телефонов. Поэтому браузер шлёт запрос сюда, а отсюда он уходит на
   Vercel уже из Франкфурта.

   Функция ничего не решает и ничего не проверяет: передаёт запрос как
   есть и возвращает ответ как есть, включая поток ответа чата и заголовки
   CORS, которые ставит сама функция на Vercel. Единственное, что она
   добавляет, - настоящий адрес ученика в `x-client-ip` с подписью
   `x-proxy-auth`: Vercel переписывает `x-forwarded-for` адресом самого
   прокси, а по адресу считается предел бесплатных решений гостя. Адрес
   берётся из того, что ставит платформа, а не клиент (proxyIdentity.ts).

   Срок жизни функции на бесплатном плане - 150 секунд. Решатель обычно
   укладывается в 30-60; если нет, Vercel дорешает сам и запишет ответ в
   базу, а вкладка заберёт его оттуда - для неё это обрыв связи, не отказ.

   Деплой: `supabase functions deploy api --no-verify-jwt` или через MCP.
   JWT не проверяется намеренно: гость приходит без токена, а сессию
   ученика проверяет сама функция на Vercel. */

import { clientAddress, clientAddressSources, minProxySecretLength, proxyAuthDigest, proxySigningKeys } from './proxyIdentity.ts'

const upstreamOrigin = 'https://homework-copilot-taupe.vercel.app'
/* `payment` зовут двое: браузер ученика и сама Робокасса - её уведомление
   Result приходит сюда же, с серверов в России, для которых *.vercel.app
   так же ненадёжен, как для учеников.
   `auth-yandex` - вход через Яндекс ID (server/yandexAuth.ts). Хук СМС
   (`sms-hook`) сюда не ходит: его зовёт сам Supabase Auth из Франкфурта. */
const routes = new Set(['solve', 'chat', 'support', 'admin', 'payment', 'auth-yandex'])

const forwardedRequestHeaders = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'origin',
  'x-guest-id',
  'access-control-request-method',
  'access-control-request-headers',
]

// Тело ответа приходит уже распакованным, длина и кодировка исходного не совпадут.
const droppedResponseHeaders = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive'])

const allowedOrigins = new Set(['https://www.homeworkcopilot.ru', 'https://homeworkcopilot.ru'])

let proxyAuthCache: string | null = null
let addressSourcesReported = false

/* Подпись прокси: хэш общего секрета, который есть и здесь, и на Vercel.
   Сам секрет по сети не ходит. Какими ключами подписываем и почему -
   proxyIdentity.ts. */
async function proxyAuth() {
  if (proxyAuthCache !== null) return proxyAuthCache
  const { keys, mode, secretTooShort } = proxySigningKeys((name) => Deno.env.get(name))
  if (secretTooShort) {
    console.error(JSON.stringify({
      event: 'proxy_secret_too_short',
      message: `HOMEWORK_PROXY_SECRET короче ${minProxySecretLength} знаков и не используется. Сгенерируй: openssl rand -hex 32`,
    }))
  }
  const digests = await Promise.all(keys.map((key) => proxyAuthDigest(key)))
  proxyAuthCache = digests.join(',')
  /* Раз на воркер: режим и начала подписей, по восемь знаков. По ним видно,
     сошлась ли подпись с той, которую ждёт Vercel (`proxyAuthExpected` в его
     журнале). Самих ключей в журнале нет. */
  console.log(JSON.stringify({
    event: 'proxy_auth_ready',
    mode,
    digests: digests.map((digest) => digest.slice(0, 8)),
  }))
  return proxyAuthCache
}

/* Раз на воркер: совпадают ли два источника адреса, которые ставит платформа.
   Адресов в журнале нет - только признаки. */
function reportAddressSources(request: Request) {
  if (addressSourcesReported) return
  addressSourcesReported = true
  const { cloudflare, lastForwarded, forwardedCount } = clientAddressSources(request.headers)
  console.log(JSON.stringify({
    event: 'proxy_address_sources',
    cloudflare: Boolean(cloudflare),
    lastForwarded: Boolean(lastForwarded),
    forwardedCount,
    same: Boolean(cloudflare) && cloudflare === lastForwarded,
  }))
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  if (!allowedOrigins.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Guest-Id',
    Vary: 'Origin',
  }
}

function routeOf(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/functions\/v1/u, '').replace(/^\/api\/?/u, '')
  const route = path.split('/')[0]
  return routes.has(route) ? route : null
}

Deno.serve(async (request: Request) => {
  const route = routeOf(request)
  if (!route) {
    return new Response(JSON.stringify({ error: 'Неизвестный маршрут' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
    })
  }

  const headers = new Headers()
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  reportAddressSources(request)
  const address = clientAddress(request.headers)
  if (address) {
    headers.set('x-client-ip', address)
    headers.set('x-proxy-auth', await proxyAuth())
  } else {
    console.log(JSON.stringify({ event: 'proxy_no_client_address', headers: [...request.headers.keys()] }))
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
  let upstream: Response
  try {
    // Строка запроса идёт дальше как есть: Робокасса умеет слать Result и GET.
    upstream = await fetch(`${upstreamOrigin}/api/${route}${new URL(request.url).search}`, {
      method: request.method,
      headers,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      redirect: 'manual',
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Сервер решений не ответил. Попробуй ещё раз через минуту' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
    })
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, name) => {
    if (!droppedResponseHeaders.has(name.toLowerCase())) responseHeaders.set(name, value)
  })

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
})
