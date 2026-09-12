/* Чистые функции мониторинга: время по Москве, подписи столбцов графика,
   разбор user agent, текст контекста ошибки для копирования. */

const exactFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/Moscow',
})

const hourFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })
const dayLongFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Europe/Moscow' })

/** 12.09.2026, 14:03:27 МСК - точное время события. */
export function formatExactMsk(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${exactFormatter.format(date)} МСК`
}

/** 14:03 по Москве. */
export function formatClockMsk(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : hourFormatter.format(date)
}

/** Ключ дня по Москве: 2026-09-12. */
export function mskDayKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(value))
}

/** «12 сентября, сб» - заголовок дня в хронологии. */
export function formatDayHeading(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dayLongFormatter.format(date)
}

/** Подпись оси и подсказки для столбца графика: час, шесть часов или сутки. */
export function formatBucket(start: string, end: string, bucketMinutes: number, mode: 'axis' | 'full') {
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return start
  if (bucketMinutes >= 1440) return mode === 'axis' ? dayFormatter.format(from) : dayLongFormatter.format(from)
  const hours = `${hourFormatter.format(from)}-${hourFormatter.format(to)}`
  if (bucketMinutes <= 60) return mode === 'axis' ? hourFormatter.format(from) : `${dayFormatter.format(from)}, ${hours}`
  return mode === 'axis' ? `${dayFormatter.format(from)} ${hourFormatter.format(from)}` : `${dayFormatter.format(from)}, ${hours}`
}

/** «только что», «40 с назад», «3 мин назад», «2 ч назад». */
export function formatAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 10) return 'только что'
  if (seconds < 60) return `${seconds} с назад`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

/** Сколько минут: «12 мин», «2 ч 5 мин», «3 дн». */
export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`
  return `${Math.floor(hours / 24)} дн`
}

export type ParsedAgent = { browser: string | null; os: string | null; device: 'телефон' | 'планшет' | 'компьютер' | 'сервер' }

/* Узнаём браузер и систему по строке user agent. Порядок важен: Edge,
   Opera и Яндекс.Браузер представляются ещё и Chrome, а Chrome - Safari. */
export function parseUserAgent(userAgent: string | null | undefined): ParsedAgent | null {
  const ua = (userAgent ?? '').trim()
  if (!ua) return null
  if (/^(node|undici|axios|curl|python|go-http|deno|vercel)/i.test(ua)) return { browser: ua.split(/[\s/]/)[0], os: null, device: 'сервер' }

  const version = (pattern: RegExp) => ua.match(pattern)?.[1] ?? null
  let browser: string | null = null
  const browsers: [string, RegExp][] = [
    ['Яндекс.Браузер', /YaBrowser\/(\d+(?:\.\d+)?)/],
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /(?:OPR|Opera)\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ]
  for (const [name, pattern] of browsers) {
    const found = version(pattern)
    if (found) {
      browser = `${name} ${found}`
      break
    }
  }
  if (!browser && /Safari\//.test(ua)) {
    const found = version(/Version\/(\d+(?:\.\d+)?)/)
    browser = found ? `Safari ${found}` : 'Safari'
  }

  let os: string | null = null
  const ios = ua.match(/(iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/)
  if (ios) os = `${ios[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${ios[2]}.${ios[3]}`
  else if (/Android/.test(ua)) os = `Android ${version(/Android (\d+(?:\.\d+)?)/) ?? ''}`.trim()
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10 или 11'
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1'
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Mac OS X/.test(ua)) {
    const mac = ua.match(/Mac OS X (\d+)[_.](\d+)/)
    os = mac ? `macOS ${mac[1]}.${mac[2]}` : 'macOS'
  } else if (/Linux/.test(ua)) os = 'Linux'

  const device: ParsedAgent['device'] = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? 'планшет'
    : /Mobi|iPhone|iPod/.test(ua) ? 'телефон' : 'компьютер'

  if (!browser && !os) return null
  return { browser, os, device }
}

export function describeAgent(userAgent: string | null | undefined) {
  const parsed = parseUserAgent(userAgent)
  if (!parsed) return null
  return [parsed.browser, parsed.os, parsed.device].filter(Boolean).join(', ')
}

const countFormatter = new Intl.NumberFormat('ru-RU')

/** «1 ошибка», «3 ошибки», «12 ошибок». */
export function errorsWord(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  const word = mod10 === 1 && mod100 !== 11
    ? 'ошибка'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'ошибки' : 'ошибок'
  return `${countFormatter.format(count)} ${word}`
}

/* ---------- Контекст для воспроизведения ---------- */

export type ReproEvent = {
  title: string
  fingerprint: string
  kind: string
  severity: string
  message: string
  route: string | null
  createdAt: string | null
  who: string
  ip: string | null
  userAgent: string | null
  requestId: string | null
  request: { method: string; route: string; status: number | null; durationMs: number | null } | null
  environment: unknown
  input: unknown
  stack: string | null
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

/** Шаги воспроизведения из того, что реально записано у события. */
export function reproSteps(event: ReproEvent): string[] {
  const steps: string[] = []
  const agent = describeAgent(event.userAgent)
  if (event.kind === 'frontend') {
    steps.push(`Открыть страницу ${event.route || '(маршрут не записан)'} на сайте${agent ? ` в браузере: ${agent}` : ''}.`)
    const env = event.environment && typeof event.environment === 'object' ? event.environment as Record<string, unknown> : {}
    if (typeof env.viewport === 'string') steps.push(`Выставить размер окна ${env.viewport}${typeof env.language === 'string' ? `, язык ${env.language}` : ''}.`)
  } else if (event.request) {
    steps.push(`Отправить ${event.request.method} на /api/${event.request.route}${event.request.status !== null ? ` - тогда ответ был ${event.request.status}` : ''}.`)
  } else {
    steps.push(`Вызвать маршрут ${event.route || '(не записан)'} функций на Vercel.`)
  }
  if (event.input !== null && event.input !== undefined) steps.push('Передать входные данные из блока «Входные данные».')
  steps.push(`Войти как ${event.who}.`)
  steps.push(`Сверить сообщение: «${event.message}».`)
  return steps
}

/** Весь контекст одним текстом: вставить в задачу или чат с разработчиком. */
export function reproContext(event: ReproEvent) {
  const lines = [
    `Ошибка: ${event.title}`,
    `Отпечаток: ${event.fingerprint}`,
    `Вид: ${event.kind}, важность: ${event.severity}`,
    `Когда: ${formatExactMsk(event.createdAt)}`,
    `Маршрут: ${event.route || '-'}`,
    `Кто: ${event.who}`,
    `IP: ${event.ip || '-'}`,
    `Браузер: ${describeAgent(event.userAgent) ?? '-'}`,
    `User agent: ${event.userAgent || '-'}`,
    `Request id: ${event.requestId || '-'}`,
  ]
  if (event.request) lines.push(`Запрос: ${event.request.method} ${event.request.route}, статус ${event.request.status ?? '-'}, ${event.request.durationMs ?? '-'} мс`)
  lines.push('', 'Как воспроизвести:', ...reproSteps(event).map((step, index) => `${index + 1}. ${step}`))
  lines.push('', `Сообщение: ${event.message}`)
  if (event.environment !== null && event.environment !== undefined) lines.push('', 'Окружение:', json(event.environment))
  if (event.input !== null && event.input !== undefined) lines.push('', 'Входные данные:', json(event.input))
  if (event.stack) lines.push('', 'Стек:', event.stack)
  return lines.join('\n')
}
