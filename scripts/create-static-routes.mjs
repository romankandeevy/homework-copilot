/* Маршруты пишутся по очереди: 1791 параллельная запись упёрлась бы в лимит дескрипторов. */
/* eslint-disable no-await-in-loop */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')
const siteOrigin = 'https://www.homeworkcopilot.ru'
const numberedSolutionRoutes = {
  geometry: 1431,
  physics: 180,
  chemistry: 180,
}

const homepage = {
  title: 'Homework Copilot — решение задачи по фото за одну минуту',
  description: 'Сфотографируй задачу или впиши условие. Получишь готовую запись для тетради: дано, ход решения, чертёж и ответ. Любой предмет с 5 по 11 класс.',
  canonicalPath: '/',
  robots: 'index, follow',
}

// Рабочая главная. `/main` — прежний адрес, он остаётся ради разошедшихся
// ссылок и канонизируется на `/app`.
const application = {
  title: 'Решить задачу — Homework Copilot',
  description: 'Рабочая страница Homework Copilot: условие текстом или фотографией, готовое решение и история задач.',
  canonicalPath: '/app',
  robots: 'index, follow',
}

const routeMetadata = new Map([
  ['app', application],
  ['main', application],
  ['solutions', { title: 'Решения задач — Homework Copilot', description: 'Личные и готовые решения задач по выбранным школьным учебникам.', canonicalPath: '/solutions', robots: 'index, follow' }],
  ['base', { title: 'Решения задач — Homework Copilot', description: 'Личные и готовые решения задач по выбранным школьным учебникам.', canonicalPath: '/solutions', robots: 'index, follow' }],
  ['cdz', { title: 'Учебники и ЦДЗ — Homework Copilot', description: 'Выбери учебник и найди точное условие задачи по номеру перед получением решения.', canonicalPath: '/cdz', robots: 'index, follow' }],
  ['tasks', { title: 'Учебники и ЦДЗ — Homework Copilot', description: 'Выбери учебник и найди точное условие задачи по номеру перед получением решения.', canonicalPath: '/cdz', robots: 'index, follow' }],
  ['textbooks', { title: 'Учебники и ЦДЗ — Homework Copilot', description: 'Выбери учебник и найди точное условие задачи по номеру перед получением решения.', canonicalPath: '/cdz', robots: 'index, follow' }],
  ['schedule', { title: 'Расписание — Homework Copilot', description: 'Личное школьное расписание в Homework Copilot.', canonicalPath: '/schedule', robots: 'noindex, nofollow' }],
  ['chat', { title: 'ИИ-чат — Homework Copilot', description: 'Личные диалоги с ИИ в Homework Copilot.', canonicalPath: '/chat', robots: 'noindex, nofollow' }],
  ['support', { title: 'Поддержка — Homework Copilot', description: 'Личные обращения в поддержку Homework Copilot.', canonicalPath: '/support', robots: 'noindex, nofollow' }],
  ['privacy', { title: 'Политика обработки персональных данных — Homework Copilot', description: 'Какие данные использует Homework Copilot, зачем они нужны и как управлять своими данными.', canonicalPath: '/privacy', robots: 'index, follow' }],
  ['terms', { title: 'Пользовательское соглашение — Homework Copilot', description: 'Правила использования Homework Copilot, аккаунта, решений и баланса.', canonicalPath: '/terms', robots: 'index, follow' }],
  ['agreement', { title: 'Пользовательское соглашение — Homework Copilot', description: 'Правила использования Homework Copilot, аккаунта, решений и баланса.', canonicalPath: '/terms', robots: 'index, follow' }],
  ['consent', { title: 'Согласие на обработку персональных данных — Homework Copilot', description: 'Отдельное согласие пользователя на обработку персональных данных в Homework Copilot.', canonicalPath: '/consent', robots: 'noindex, follow' }],
  ['cookies', { title: 'Cookie и локальное хранение — Homework Copilot', description: 'Какие данные Homework Copilot сохраняет в браузере и почему рекламные cookie не используются.', canonicalPath: '/cookies', robots: 'index, follow' }],
  ['offer', { title: 'Публичная оферта — Homework Copilot', description: 'Статус платных услуг и публичной оферты Homework Copilot.', canonicalPath: '/offer', robots: 'index, follow' }],
  ['admin', { title: 'Управление — Homework Copilot', description: 'Закрытая панель управления Homework Copilot.', canonicalPath: '/admin', robots: 'noindex, nofollow' }],
])

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function replaceMeta(html, selector, content) {
  const escaped = escapeAttribute(content)
  const pattern = selector === 'description' || selector === 'robots'
    ? new RegExp(`<meta\\s+name="${selector}"\\s+content="[^"]*"\\s*\\/>`, 'i')
    : selector.startsWith('og:')
      ? new RegExp(`<meta\\s+property="${selector}"\\s+content="[^"]*"\\s*\\/>`, 'i')
      : new RegExp(`<meta\\s+name="${selector}"\\s+content="[^"]*"\\s*\\/>`, 'i')
  return html.replace(pattern, (match) => match.replace(/content="[^"]*"/, `content="${escaped}"`))
}

function renderMetadata(baseHtml, metadata) {
  const canonicalUrl = new URL(metadata.canonicalPath, siteOrigin).toString()
  let html = baseHtml.replace(/<title>.*?<\/title>/s, `<title>${escapeAttribute(metadata.title)}</title>`)
  html = replaceMeta(html, 'description', metadata.description)
  html = replaceMeta(html, 'robots', metadata.robots)
  html = replaceMeta(html, 'og:title', metadata.title)
  html = replaceMeta(html, 'og:description', metadata.description)
  html = replaceMeta(html, 'og:url', canonicalUrl)
  html = replaceMeta(html, 'twitter:title', metadata.title)
  html = replaceMeta(html, 'twitter:description', metadata.description)
  return html.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${canonicalUrl}" />`)
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
await writeFile(resolve(outputDirectory, 'index.html'), renderMetadata(baseHtml, homepage), 'utf8')

const appHtml = appLink ? baseHtml.replace('<link rel="icon"', `${appLink}\n    <link rel="icon"`) : baseHtml

for (const [route, metadata] of routeMetadata) {
  const routeDirectory = resolve(outputDirectory, route)
  await mkdir(routeDirectory, { recursive: true })
  await writeFile(resolve(routeDirectory, 'index.html'), renderMetadata(appHtml, metadata), 'utf8')
}

for (const [textbookId, taskCount] of Object.entries(numberedSolutionRoutes)) {
  for (let task = 1; task <= taskCount; task += 1) {
    const route = `solutions/${textbookId}/${task}`
    const routeDirectory = resolve(outputDirectory, route)
    await mkdir(routeDirectory, { recursive: true })
    await writeFile(resolve(routeDirectory, 'index.html'), renderMetadata(appHtml, {
      title: `Решение задачи № ${task} — Homework Copilot`,
      description: 'Личное решение задачи в Homework Copilot.',
      canonicalPath: `/${route}`,
      robots: 'noindex, nofollow',
    }), 'utf8')
  }
}

await writeFile(resolve(outputDirectory, '404.html'), renderMetadata(baseHtml, {
  title: 'Страница не найдена — Homework Copilot',
  description: 'Запрошенная страница не найдена.',
  canonicalPath: '/',
  robots: 'noindex, nofollow',
}), 'utf8')
