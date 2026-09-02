/* Статические страницы под маршруты SPA.

   GitHub Pages раздаёт файлы, а не приложение: без своего `index.html` адрес
   вроде `/app` отдал бы 404 ещё до загрузки скрипта. Здесь для каждого
   маршрута кладётся копия сборки со своими заголовками.

   Список маршрутов и их описания берутся из `src/lib/siteMetadata.ts` — того
   же файла, по которому клиент проставляет метаданные при переходах. Раньше
   список был записан дважды, и копии разошлись: статика открывала ЦДЗ
   поисковикам и звала «найти условие по номеру в учебнике» из раздела,
   которого в продукте больше нет. */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getSeoMetadata, metadataByPath, siteOrigin } from '../src/lib/siteMetadata.ts'

const outputDirectory = resolve('dist')

/* Прежние адреса. Ссылки на них уже разошлись, поэтому страницы остаются,
   но каноническим объявляют новый адрес — его же вернёт `getSeoMetadata`. */
const legacyPaths = ['/main', '/base', '/tasks', '/textbooks', '/agreement']

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

const baseHtml = (await readFile(resolve(outputDirectory, 'index.html'), 'utf8')).replace(
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
