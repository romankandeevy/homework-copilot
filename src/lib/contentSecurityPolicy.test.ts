import { describe, expect, it, vi } from 'vitest'
/* Файлы читаются через `?raw` Vite, а не через `node:fs`: тесты приложения
   собираются с типами браузера (`tsconfig.app.json`), модулей Node там нет. */
import vercelConfigSource from '../../vercel.json?raw'
import indexHtmlSource from '../../index.html?raw'
import staticRoutesSource from '../../scripts/create-static-routes.mjs?raw'

/* Политика безопасности содержимого разбирается на директивы.

   8 сентября в заголовке Vercel нашлась потерянная точка с запятой:
   `worker-src 'self' blob: frame-ancestors 'none'`. Браузер прочитал это как
   одну директиву `worker-src` со значением `'self' blob: frame-ancestors
   'none'` - а `'none'` рядом с другими источниками делает директиву
   недействительной целиком. То есть `worker-src` не работал вовсе, а
   `frame-ancestors` не существовал: обе защиты пропали молча, в консоли -
   предупреждение, которое никто не читает.

   Проверка дешёвая и ловит ровно этот класс опечатки: имя директивы должно
   быть известным, а `'none'` - единственным источником. */

const knownDirectives = new Set([
  'base-uri', 'child-src', 'connect-src', 'default-src', 'font-src', 'form-action',
  'frame-ancestors', 'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src',
  'report-to', 'report-uri', 'sandbox', 'script-src', 'script-src-attr', 'script-src-elem',
  'style-src', 'style-src-attr', 'style-src-elem', 'upgrade-insecure-requests', 'worker-src',
])

function parsePolicy(policy: string) {
  return policy
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, ...sources] = entry.split(/\s+/)
      return { name: name ?? '', sources }
    })
}

function expectValidPolicy(policy: string, where: string) {
  const directives = parsePolicy(policy)
  expect(directives.length, where).toBeGreaterThan(0)

  for (const { name, sources } of directives) {
    expect(knownDirectives, `${where}: неизвестная директива «${name}» — потеряна точка с запятой?`)
      .toContain(name)

    if (sources.includes("'none'")) {
      expect(sources, `${where}: «'none'» в «${name}» стоит не одна, поэтому директива игнорируется`)
        .toEqual(["'none'"])
    }
  }

  const names = directives.map(({ name }) => name)
  expect(new Set(names).size, `${where}: директива повторяется`).toBe(names.length)
}

function readVercelHeaderPolicy() {
  const config = JSON.parse(vercelConfigSource) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const values = config.headers
    .flatMap(({ headers }) => headers)
    .filter(({ key }) => key.toLowerCase() === 'content-security-policy')
    .map(({ value }) => value)
  expect(values, 'в vercel.json нет заголовка Content-Security-Policy').toHaveLength(1)
  return values[0]!
}

function readMetaPolicy() {
  const match = indexHtmlSource.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  expect(match, 'в index.html нет meta Content-Security-Policy').not.toBeNull()
  return match![1]!
}

describe('политика безопасности содержимого', () => {
  it('заголовок Vercel разбирается на известные директивы', () => {
    expectValidPolicy(readVercelHeaderPolicy(), 'vercel.json')
  })

  it('meta в index.html разбирается на известные директивы', () => {
    expectValidPolicy(readMetaPolicy(), 'index.html')
  })

  /* `frame-ancestors` в `<meta>` браузер игнорирует по спецификации: она
     работает только заголовком. Поэтому у страницы её быть не должно, а у
     заголовка - должна. Прод раздаёт GitHub Pages, который заголовков не
     ставит, а `X-Frame-Options` в `<meta>` браузеры не читают вовсе. На проде
     от врезки в чужую страницу защищает только скрипт в начале `<head>` -
     его проверка ниже (аудит 16 сентября, В4). */
  it('frame-ancestors живёт в заголовке, а не в meta', () => {
    expect(readVercelHeaderPolicy()).toContain("frame-ancestors 'none'")
    expect(readMetaPolicy()).not.toContain('frame-ancestors')
  })

  /* Распознавание расписания запускает воркер tesseract.js, и часть сборок
     создаёт его из blob. Без `blob:` фотография расписания не разбирается. */
  it('воркеру расписания разрешён blob', () => {
    for (const policy of [readVercelHeaderPolicy(), readMetaPolicy()]) {
      const worker = parsePolicy(policy).find(({ name }) => name === 'worker-src')
      expect(worker?.sources).toEqual(["'self'", 'blob:'])
    }
  })

  /* Вход через Google снят 13 сентября (406-ФЗ), его фрейм не нужен. */
  it('не разрешает фреймы Google', () => {
    for (const policy of [readVercelHeaderPolicy(), readMetaPolicy()]) {
      expect(policy).not.toContain('accounts.google.com')
    }
  })
})

/* Инлайн-скрипты - хэшами, а не `'unsafe-inline'` (аудит 16 сентября, В8).

   `'unsafe-inline'` разрешал бы любой внедрённый скрипт. Хэш считается от
   текста между `<script>` и `</script>` байт в байт, с отступами и переводами
   строк: поправил скрипт темы или защиты - пересчитай хэш в `index.html` и
   `vercel.json`. Тест считает хэш из файлов; сборка
   (`scripts/create-static-routes.mjs`) повторяет проверку на готовых страницах. */
async function sha256Source(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return `'sha256-${btoa(binary)}'`
}

function scriptSources(policy: string) {
  return parsePolicy(policy).find(({ name }) => name === 'script-src')?.sources ?? []
}

function inlineScripts(html: string) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((match) => !/\bsrc=/.test(match[1] ?? '') && !/type="application\/ld\+json"/.test(match[1] ?? ''))
    .map((match) => match[2] ?? '')
}

function documentRedirectScript() {
  const match = staticRoutesSource.match(/const documentRedirectScript = `([^`]*)`/)
  expect(match, 'в create-static-routes.mjs нет documentRedirectScript').not.toBeNull()
  return match![1]!
}

describe('инлайн-скрипты под политикой', () => {
  it('script-src без unsafe-inline', () => {
    for (const policy of [readVercelHeaderPolicy(), readMetaPolicy()]) {
      expect(scriptSources(policy)).not.toContain("'unsafe-inline'")
    }
  })

  it('каждый инлайн-скрипт index.html разрешён своим хэшем и в meta, и в заголовке', async () => {
    const scripts = inlineScripts(indexHtmlSource)
    expect(scripts.length, 'в index.html ждём защиту от фрейма и скрипт темы').toBe(2)
    const hashes = await Promise.all(scripts.map(sha256Source))
    for (const hash of hashes) {
      expect(scriptSources(readMetaPolicy()), `index.html: нет ${hash}`).toContain(hash)
      expect(scriptSources(readVercelHeaderPolicy()), `vercel.json: нет ${hash}`).toContain(hash)
    }
  })

  it('скрипт перехода со старых адресов документов разрешён хэшем', async () => {
    const hash = await sha256Source(documentRedirectScript())
    expect(scriptSources(readVercelHeaderPolicy())).toContain(hash)
    expect(scriptSources(readMetaPolicy())).toContain(hash)
  })

  it('в политике нет лишних хэшей', async () => {
    const expected = await Promise.all([...inlineScripts(indexHtmlSource), documentRedirectScript()].map(sha256Source))
    for (const policy of [readVercelHeaderPolicy(), readMetaPolicy()]) {
      const hashes = scriptSources(policy).filter((source) => source.startsWith("'sha256-"))
      expect([...hashes].sort()).toEqual([...expected].sort())
    }
  })
})

/* Кликджекинг (аудит 16 сентября, В4). Прод на Pages заголовков не ставит,
   поэтому защита - скрипт, и стоять он должен до всего, что можно нажать. */
describe('защита от встраивания в чужой фрейм', () => {
  it('первый скрипт в head прячет страницу во фрейме с чужого адреса', () => {
    const head = indexHtmlSource.slice(0, indexHtmlSource.indexOf('</head>'))
    const firstScript = head.match(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/)
    expect(firstScript?.[1] ?? '', 'первый скрипт - без src и без type').toBe('')
    const guard = firstScript?.[2] ?? ''
    expect(guard).toContain('window.top === window.self')
    expect(guard).toContain("document.documentElement.style.display = 'none'")
    expect(guard).toContain('window.top.location.replace(window.location.href)')
    expect(head.indexOf(guard)).toBeLessThan(head.indexOf('http-equiv="Content-Security-Policy"'))
  })

  it('страницы перехода со старых адресов ставят ту же защиту', () => {
    expect(staticRoutesSource).toContain('`    <script>${frameGuardScript}</script>`')
  })

  it('во фрейме с чужого адреса страница прячется и уходит наверх', () => {
    const guard = inlineScripts(indexHtmlSource)[0]!
    const replace = vi.fn()
    const style = { display: '' }
    const selfWindow = { location: { href: 'https://www.homeworkcopilot.ru/profile', origin: 'https://www.homeworkcopilot.ru' } }
    const topWindow = {
      location: {
        get origin(): string {
          throw new DOMException('Blocked a frame', 'SecurityError')
        },
        replace,
      },
    }
    const window = { ...selfWindow, top: topWindow, self: selfWindow }
    new Function('window', 'document', guard)(window, { documentElement: { style } })
    expect(style.display).toBe('none')
    expect(replace).toHaveBeenCalledWith('https://www.homeworkcopilot.ru/profile')
  })

  it('без фрейма и во фрейме своего адреса ничего не трогает', () => {
    const guard = inlineScripts(indexHtmlSource)[0]!
    const style = { display: '' }
    const selfWindow: Record<string, unknown> = { location: { href: 'https://www.homeworkcopilot.ru/', origin: 'https://www.homeworkcopilot.ru' } }
    selfWindow.top = selfWindow
    selfWindow.self = selfWindow
    new Function('window', 'document', guard)(selfWindow, { documentElement: { style } })
    expect(style.display).toBe('')

    const parent = { location: { origin: 'https://www.homeworkcopilot.ru', replace: vi.fn() } }
    const framed = { location: selfWindow.location, top: parent, self: {} }
    new Function('window', 'document', guard)(framed, { documentElement: { style } })
    expect(style.display).toBe('')
    expect(parent.location.replace).not.toHaveBeenCalled()
  })
})
