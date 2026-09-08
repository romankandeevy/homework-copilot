import { describe, expect, it } from 'vitest'
/* Файлы читаются через `?raw` Vite, а не через `node:fs`: тесты приложения
   собираются с типами браузера (`tsconfig.app.json`), модулей Node там нет. */
import vercelConfigSource from '../../vercel.json?raw'
import indexHtmlSource from '../../index.html?raw'

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
     ставит, и там от врезки в чужую страницу защищает только `X-Frame-Options`
     из `<meta>`-набора Pages. */
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
})
