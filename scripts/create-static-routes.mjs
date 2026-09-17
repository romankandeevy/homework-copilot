/* Статические страницы под маршруты SPA.

   GitHub Pages раздаёт файлы, а не приложение: без своего `index.html` адрес
   вроде `/app` отдал бы 404 ещё до загрузки скрипта. Здесь для каждого
   маршрута кладётся копия сборки со своими заголовками.

   Список маршрутов и их описания берутся из `src/lib/siteMetadata.ts` — того
   же файла, по которому клиент проставляет метаданные при переходах. Раньше
   список был записан дважды, и копии разошлись: статика открывала ЦДЗ
   поисковикам и звала «найти условие по номеру в учебнике» из раздела,
   которого в продукте больше нет. */
/* Маршруты пишутся по очереди: их два десятка, параллелить нечего. */
/* eslint-disable no-await-in-loop */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getSeoMetadata, legacyDocumentPaths, metadataByPath, siteOrigin } from '../src/lib/siteMetadata.ts'

const outputDirectory = resolve('dist')

/* Прежние адреса. Ссылки на них уже разошлись, поэтому страницы остаются,
   но каноническим объявляют новый адрес — его же вернёт `getSeoMetadata`.
   Прежние адреса документов (и `/agreement` среди них) разложены ниже
   отдельно: там не копия приложения, а мгновенный переход. `/cdz`, `/tasks`
   и `/textbooks` - адреса удалённого раздела ЦДЗ, канонический у них `/app`. */
const legacyPaths = ['/main', '/base', '/tasks', '/textbooks', '/cdz']

const routes = [...Object.keys(metadataByPath), ...legacyPaths]
  .filter((path) => path !== '/')
  .map((path) => ({ directory: path.replace(/^\//, ''), metadata: getSeoMetadata(path) }))

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function replaceMeta(html, selector, content) {
  const escaped = escapeAttribute(content)
  const pattern = selector.startsWith('og:')
    ? new RegExp(`<meta\\s+property="${selector}"\\s+content="[^"]*"\\s*\\/>`, 'i')
    : new RegExp(`<meta\\s+name="${selector}"\\s+content="[^"]*"\\s*\\/>`, 'i')
  return html.replace(pattern, (match) => match.replace(/content="[^"]*"/, `content="${escaped}"`))
}

function renderMetadata(baseHtml, metadata) {
  const canonicalUrl = new URL(metadata.path, siteOrigin).toString()
  let html = baseHtml.replace(/<title>.*?<\/title>/s, `<title>${escapeAttribute(metadata.title)}</title>`)
  html = replaceMeta(html, 'description', metadata.description)
  html = replaceMeta(html, 'robots', metadata.robots)
  html = replaceMeta(html, 'og:title', metadata.title)
  html = replaceMeta(html, 'og:description', metadata.description)
  html = replaceMeta(html, 'og:url', canonicalUrl)
  html = replaceMeta(html, 'twitter:title', metadata.title)
  html = replaceMeta(html, 'twitter:description', metadata.description)
  // У страницы, которой нет, канонического адреса нет тоже: иначе 404 объявит
  // себя главной, а поисковик поверит.
  return metadata.canonical === false
    ? html.replace(/\s*<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, '')
    : html.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${canonicalUrl}" />`)
}

/* Кириллические подрезки Unbounded и Onest нужны на каждой странице: ими
   набраны заголовок и весь текст. Без предзагрузки они приезжают после
   разбора CSS, и заголовок первого экрана перерисовывается уже после
   отрисовки — это и есть сдвиг макета. Имена файлов содержат хэш сборки,
   поэтому ссылки собираются здесь, а не пишутся руками в index.html. */
async function fontPreloadLinks() {
  const assets = await readdir(resolve(outputDirectory, 'assets'))
  return ['unbounded-cyr', 'onest-cyr']
    .map((face) => assets.find((file) => file.startsWith(`${face}-`) && file.endsWith('.woff2')))
    .filter(Boolean)
    .map((file) => `    <link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin />`)
    .join('\n')
}

/* Оболочка приложения лежит отдельным чанком: витрине она не нужна (src/Root.tsx).
   Для адресов приложения он всё равно понадобится сразу, поэтому здесь ставится
   modulepreload — запрос уходит вместе с входным чанком, а не после него. */
async function appPreloadLink() {
  const assets = await readdir(resolve(outputDirectory, 'assets'))
  const chunk = assets.find((file) => /^App-[\w-]+\.js$/.test(file))
  return chunk ? `    <link rel="modulepreload" href="/assets/${chunk}" crossorigin />` : ''
}

const preloadLinks = await fontPreloadLinks()
const appLink = await appPreloadLink()

const builtIndexHtml = await readFile(resolve(outputDirectory, 'index.html'), 'utf8')

/* Защита от встраивания в чужой фрейм - первый скрипт `index.html`. Берём
   его из сборки как есть: у страниц-переходов он должен совпасть до байта,
   иначе его хэш не совпадёт с разрешённым в политике. */
const frameGuardScript = builtIndexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]
if (!frameGuardScript?.includes('window.top')) {
  throw new Error('В index.html первым скриптом должна стоять защита от встраивания во фрейм (window.top)')
}

const baseHtml = builtIndexHtml.replace(
  '<link rel="icon"',
  preloadLinks ? `${preloadLinks}\n    <link rel="icon"` : '<link rel="icon"',
)
// Витрина остаётся без ссылки на оболочку: там её незачем греть.
await writeFile(resolve(outputDirectory, 'index.html'), renderMetadata(baseHtml, getSeoMetadata('/')), 'utf8')

const appHtml = appLink ? baseHtml.replace('<link rel="icon"', `${appLink}\n    <link rel="icon"`) : baseHtml

for (const { directory, metadata } of routes) {
  const html = renderMetadata(appHtml, metadata)
  await mkdir(resolve(outputDirectory, directory), { recursive: true })
  await writeFile(resolve(outputDirectory, directory, 'index.html'), html, 'utf8')
  /* Тот же файл рядом с каталогом. Pages иначе отвечает на `/app` редиректом
     на `/app/`, и лишний переход получала каждая ссылка продукта — включая
     возврат авторизации, где в адресе едет одноразовый код. */
  await writeFile(resolve(outputDirectory, `${directory}.html`), html, 'utf8')
}

/* Прежние адреса документов: /terms, /agreement, /privacy, /consent,
   /cookies, /offer, /contacts и `/docs` без хвоста.

   14 сентября 2026 документы переехали под /docs/, а старые адреса уже стоят
   в письмах, в отметках согласия и в поиске. Отвечать редиректом Pages не
   умеет, поэтому здесь лежит маленькая страница: канонический адрес - новый,
   `meta refresh` - для обходчиков без скриптов, `location.replace` - чтобы
   вместе с адресом доехали запрос и якорь (`/terms#section-8`). Копия
   приложения тут не нужна: человек на этой странице не задерживается.

   Скрипт перехода одинаков для всех страниц - адрес он читает из
   канонической ссылки. Так у него один хэш в политике безопасности
   содержимого вместо `'unsafe-inline'` (аудит 16 сентября, В8). */
const documentRedirectScript = `location.replace(new URL(document.querySelector('link[rel="canonical"]').href).pathname + location.search + location.hash)`

function renderDocumentRedirect(target) {
  const metadata = getSeoMetadata(target)
  const canonicalUrl = new URL(target, siteOrigin).toString()
  const title = escapeAttribute(metadata.title)
  return [
    '<!doctype html>',
    '<html lang="ru">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="color-scheme" content="light dark" />',
    `    <title>${title}</title>`,
    `    <link rel="canonical" href="${canonicalUrl}" />`,
    `    <script>${frameGuardScript}</script>`,
    `    <meta http-equiv="refresh" content="0; url=${target}" />`,
    `    <script>${documentRedirectScript}</script>`,
    '  </head>',
    '  <body>',
    `    <p>Документ открывается по новому адресу: <a href="${target}">${title}</a></p>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}

for (const [legacyPath, target] of Object.entries(legacyDocumentPaths)) {
  const directory = legacyPath.replace(/^\//, '')
  const html = renderDocumentRedirect(target)
  await mkdir(resolve(outputDirectory, directory), { recursive: true })
  await writeFile(resolve(outputDirectory, directory, 'index.html'), html, 'utf8')
  await writeFile(resolve(outputDirectory, `${directory}.html`), html, 'utf8')
}

/* Страницы решений заранее не раскладываются.

   Их было 1791 — под номера задач из индекса учебников, которого в продукте
   больше нет: подпись решения теперь может быть срезом условия или меткой
   фотографии, и заранее такой адрес не угадать. Прямой заход на решение
   обслуживает 404.html: Pages отдаёт его на любой неизвестный путь, а
   приложение внутри разбирает адрес само. Все такие страницы личные и
   закрыты `noindex`, поэтому код ответа роли не играет. */
await writeFile(
  resolve(outputDirectory, '404.html'),
  renderMetadata(appHtml, getSeoMetadata('/404')),
  'utf8',
)

/* Каждый инлайн-скрипт готовых страниц разрешён хэшем и в meta-политике
   `index.html` (её читает прод на Pages), и в заголовке `vercel.json` (превью).
   Разошлось - сборка падает здесь, а не молча в браузере ученика, где
   заблокированный скрипт темы или защиты виден только в консоли. */
function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter(([, attributes = '']) => !/\bsrc=/.test(attributes) && !/type="application\/ld\+json"/.test(attributes))
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
}

function scriptSources(policy) {
  const directive = policy.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('script-src '))
  return new Set(directive ? directive.split(/\s+/).slice(1) : [])
}

const metaPolicy = builtIndexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? ''
const vercelConfig = JSON.parse(await readFile(resolve('vercel.json'), 'utf8'))
const headerPolicy = vercelConfig.headers
  .flatMap(({ headers }) => headers)
  .find(({ key }) => key.toLowerCase() === 'content-security-policy')?.value ?? ''
const allowedBySource = { 'index.html': scriptSources(metaPolicy), 'vercel.json': scriptSources(headerPolicy) }
const checkedPages = [
  renderMetadata(baseHtml, getSeoMetadata('/')),
  appHtml,
  renderDocumentRedirect(Object.values(legacyDocumentPaths)[0] ?? '/docs/terms'),
]
const missingHashes = []
for (const html of checkedPages) {
  for (const hash of inlineScriptHashes(html)) {
    for (const [where, allowed] of Object.entries(allowedBySource)) {
      if (!allowed.has(hash)) missingHashes.push(`${where}: script-src без ${hash}`)
    }
  }
}
if (missingHashes.length) {
  throw new Error(`Инлайн-скрипт не разрешён политикой безопасности содержимого:\n${[...new Set(missingHashes)].join('\n')}`)
}
