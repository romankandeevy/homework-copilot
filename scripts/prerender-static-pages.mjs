/* Отрисовка публичных страниц в готовый HTML.

   До 8 сентября `curl` по любому адресу сайта возвращал пустое тело: `<head>`
   заполнен, `<div id="root">` пуст, весь текст рисовался на клиенте. Google
   исполняет скрипты уверенно, Яндекс - хуже и с задержкой, а проект живёт
   органическим поиском по школьным запросам. Два сторонних обхода без
   исполнения скриптов получили ноль содержимого, и один на этом основании
   выставил сайту несуществующие нарушения - просто потому, что не увидел
   почту, которая лежит в четырёх документах.

   Сборка идёт на GitHub Pages, сервера у нас нет, поэтому страницы
   отрисовываются один раз здесь: поднимаем `dist` статикой, обходим адреса
   настоящим браузером и кладём разметку обратно в файлы.

   Отрисовываются только те адреса, у которых есть смысл вне приложения:
   витрина и пять юридических документов. `/app`, `/chat`, `/solutions` и
   `/schedule` живут за входом и закрыты `noindex` - отрисовывать там нечего.
   `/support` тоже `noindex` (`siteMetadata.ts`), и его содержимое - личная
   переписка, а не страница для поиска.

   Скрипт идёт после `create-static-routes.mjs`: тот раскладывает файлы и
   заголовки, этот наполняет их телом. */
/* Адреса обходятся по очереди одной вкладкой: их шесть, параллелить нечего. */
/* eslint-disable no-await-in-loop */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const outputDirectory = resolve('dist')

/* Адрес, признак того, что страница дорисована, и файлы, в которые ложится
   результат. Витрина живёт в корневом `index.html`, документы - в двух копиях
   сразу: каталогом и файлом рядом, как их и раскладывает предыдущий скрипт. */
const pages = [
  { path: '/', ready: '#hero-title', files: ['index.html'] },
  { path: '/terms', ready: '.legal-document h1', files: ['terms/index.html', 'terms.html'] },
  { path: '/privacy', ready: '.legal-document h1', files: ['privacy/index.html', 'privacy.html'] },
  { path: '/consent', ready: '.legal-document h1', files: ['consent/index.html', 'consent.html'] },
  { path: '/cookies', ready: '.legal-document h1', files: ['cookies/index.html', 'cookies.html'] },
  { path: '/offer', ready: '.legal-document h1', files: ['offer/index.html', 'offer.html'] },
]

/* Появление секций при прокрутке сделано прозрачностью, и до срабатывания
   наблюдателя блок стоит `opacity: 0.001`. Поисковику это безразлично - текст
   в разметке есть, - а человеку без скриптов достался бы почти пустой экран.
   Наблюдателя без скриптов не будет никогда, поэтому там же и открываем. */
const noscriptStyles = [
  '.reveal, .compare-row { opacity: 1 !important; transform: none !important; }',
  '.compare-underline { transform: scaleX(1) !important; }',
].join(' ')

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.wasm', 'application/wasm'],
])

/* Раздача `dist` ровно так, как это делает Pages: сначала файл, потом
   `<адрес>/index.html`, потом `<адрес>.html`. Иначе документ, разложенный
   каталогом, не открылся бы по своему же адресу. */
function startServer() {
  const server = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    if (requestPath.includes('..')) {
      response.writeHead(400).end()
      return
    }

    const candidates = requestPath.endsWith('/')
      ? [join(requestPath, 'index.html')]
      : [requestPath, `${requestPath}/index.html`, `${requestPath}.html`]

    for (const candidate of candidates) {
      try {
        const body = await readFile(join(outputDirectory, candidate))
        response.writeHead(200, { 'content-type': mimeTypes.get(extname(candidate)) ?? 'application/octet-stream' })
        response.end(body)
        return
      } catch {
        // Пробуем следующий вариант имени.
      }
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  })

  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port }))
  })
}

function injectHead(html, addition) {
  return html.replace('</head>', `${addition}\n  </head>`)
}

/* Тело подставляется только внутрь `#root`: заголовки, канонический адрес и
   разметка JSON-LD уже проставлены предыдущим скриптом, и трогать их нельзя. */
function injectBody(html, markup) {
  const pattern = /(<div id="root">)(.*?)(<\/div>)/s
  if (!pattern.test(html)) throw new Error('в разметке нет пустого <div id="root">')
  return html.replace(pattern, (match, open, _current, close) => `${open}${markup}${close}`)
}

/* На Vercel отрисовки нет, и это осознанно.

   Прод раздаёт Pages, и его воркфлоу ставит хром своим шагом. Vercel держит
   превью и серверные функции, а браузер там не поднимается: хром скачивается,
   но падает с `libnspr4.so: cannot open shared object file` - в сборочном
   образе нет системных библиотек, а ставить их из сборки значит держать
   пакетный менеджер в критическом пути превью.

   Поэтому на Vercel шаг пропускается вслух. Плата за это одна и её надо
   помнить: **на превью страницы приходят пустым шеллом, как раньше.**
   Проверять отрисовку там нельзя - только на проде или локально после
   `npm run build`. */
if (process.env.VERCEL) {
  console.log('prerender: пропущен на Vercel - прод раздаёт Pages, отрисовка живёт там')
  process.exit(0)
}

/* Везде остальное отсутствие браузера - ошибка сборки, а не повод отдать
   пустые страницы: ровно эту поломку скрипт и чинит. */
const { server, port } = await startServer()

let browser
try {
  browser = await chromium.launch()
} catch (error) {
  server.close()
  console.error([
    'Отрисовка страниц требует браузера. Поставь его перед сборкой:',
    '  npx playwright install chromium --only-shell',
    `Причина: ${error instanceof Error ? error.message : String(error)}`,
  ].join('\n'))
  process.exit(1)
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })

/* Уведомление о хранении данных в готовую разметку попадать не должно:
   без скриптов его нечем закрыть, а поисковику оно только мешает. Ставим
   отметку о том, что оно уже прочитано, - решать, показывать ли его живому
   человеку, будет клиент после загрузки. */
await context.addInitScript(() => {
  try {
    window.localStorage.setItem('homework-copilot:storage-notice-v1', 'acknowledged')
  } catch {
    // Хранилище недоступно - уведомление просто попадёт в разметку.
  }
})

const page = await context.newPage()
const problems = []

for (const { path, ready, files } of pages) {
  const response = await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load' })
  if (!response?.ok()) {
    problems.push(`${path}: сервер ответил ${response?.status() ?? 'без ответа'}`)
    continue
  }

  try {
    await page.waitForSelector(ready, { timeout: 20_000, state: 'attached' })
  } catch {
    problems.push(`${path}: не дождались «${ready}»`)
    continue
  }

  const { markup, stylesheets } = await page.evaluate(() => ({
    markup: document.getElementById('root').innerHTML,
    // Стили страницы приезжают отдельными чанками вместе со скриптом. Без
    // ссылок на них готовая разметка показалась бы неоформленной, и это
    // было бы хуже пустой страницы.
    stylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => new URL(link.href).pathname)
      .filter((href) => href.endsWith('.css')),
  }))

  if (markup.length < 500) {
    problems.push(`${path}: отрисовано ${markup.length} знаков, это не страница`)
    continue
  }

  for (const file of files) {
    const target = resolve(outputDirectory, file)
    let html = await readFile(target, 'utf8')
    const missing = stylesheets.filter((href) => !html.includes(`href="${href}"`))
    const links = missing.map((href) => `    <link rel="stylesheet" href="${href}" />`)
    html = injectHead(html, [...links, `    <noscript><style>${noscriptStyles}</style></noscript>`].join('\n'))
    html = injectBody(html, markup)
    await writeFile(target, html, 'utf8')
  }

  console.log(`prerender ${path}: ${markup.length} знаков, стилей ${stylesheets.length}`)
}

await browser.close()
server.close()

if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
}
