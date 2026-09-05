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
   прокси, а по адресу считается предел бесплатных решений гостя.

   Срок жизни функции на бесплатном плане - 150 секунд. Решатель обычно
   укладывается в 30-60; если нет, Vercel дорешает сам и запишет ответ в
   базу, а вкладка заберёт его оттуда - для неё это обрыв связи, не отказ.

   Деплой: `supabase functions deploy api --no-verify-jwt` или через MCP.
   JWT не проверяется намеренно: гость приходит без токена, а сессию
   ученика проверяет сама функция на Vercel. */

const upstreamOrigin = 'https://homework-copilot-taupe.vercel.app'
const routes = new Set(['solve', 'chat', 'support'])

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

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* Подпись прокси - хэш служебного ключа проекта, который есть и здесь, и на
   Vercel. Сам ключ по сети не ходит. Ключей у проекта может быть два -
   прежний JWT и новый секретный, - подписываем каждым, чтобы сойтись с тем,
   который лежит на Vercel. */
/* Все строки-ключи из переменной: форма `SUPABASE_SECRET_KEYS` - объект, и
   значения в нём могут быть вложенными. Берём каждую строку, похожую на
   ключ: JWT или `sb_secret_…`. */
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

async function proxyAuth() {
  if (proxyAuthCache !== null) return proxyAuthCache
  const keys = new Set<string>()
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) keys.add(legacy)
  /* Ключ, которым подписывает Vercel. Платформа кладёт в SUPABASE_SERVICE_ROLE_KEY
     новый секретный ключ `sb_secret_…`, а на Vercel лежит прежний JWT
     service_role - подписи не сходились (5 сентября, журнал
     proxy_auth_ready против homework_solve_started). Тот же JWT положен
     секретом функции: `supabase secrets set HOMEWORK_PROXY_KEY=…`. */
  const shared = Deno.env.get('HOMEWORK_PROXY_KEY')
  if (shared) keys.add(shared)
  const secretRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretRaw) {
    try {
      collectKeys(JSON.parse(secretRaw) as unknown, keys)
    } catch {
      collectKeys(secretRaw, keys)
    }
  }
  const digests = await Promise.all([...keys].map((key) => sha256Hex(key + ':homework-copilot-proxy')))
  proxyAuthCache = digests.join(',')
  /* Раз на воркер: начала подписей, по восемь знаков. По ним видно, сошлась
     ли подпись с той, которую ждёт Vercel (`proxyAuthExpected` в его
     журнале). Самих ключей в журнале нет. */
  console.log(JSON.stringify({
    event: 'proxy_auth_ready',
    digests: digests.map((digest) => digest.slice(0, 8)),
  }))
  return proxyAuthCache
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0].trim()
  return first || request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || ''
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
  const address = clientAddress(request)
  if (address) {
    headers.set('x-client-ip', address)
    headers.set('x-proxy-auth', await proxyAuth())
  } else {
    console.log(JSON.stringify({ event: 'proxy_no_client_address', headers: [...request.headers.keys()] }))
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
  let upstream: Response
  try {
    upstream = await fetch(`${upstreamOrigin}/api/${route}`, {
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
