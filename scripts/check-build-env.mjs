// Проверка переменных окружения перед production-сборкой.
//
// Фронтенд раздаётся с GitHub Pages, а serverless-функции живут на Vercel.
// Если адрес функции не задан, клиент бьёт по относительному пути и попадает
// в SPA-заглушку Pages: запрос молча не доходит, а пользователь видит
// невнятную ошибку. Так уже дважды ломались поддержка и ИИ-чат, поэтому
// теперь сборка падает вместо тихой выкатки нерабочей функции.
//
// Проверка включается только когда собираем именно под Pages —
// локальная разработка и превью работают по относительным путям.

const buildingForPages = Boolean(process.env.GITHUB_PAGES_CUSTOM_DOMAIN)

if (!buildingForPages) {
  process.exit(0)
}

const required = [
  ['VITE_HOMEWORK_API_URL', 'решатель задач'],
  ['VITE_SUPPORT_API_URL', 'поддержка'],
  ['VITE_CHAT_API_URL', 'ИИ-чат'],
  ['VITE_SUPABASE_URL', 'подключение к базе'],
  ['VITE_SUPABASE_PUBLISHABLE_KEY', 'публичный ключ базы'],
]

const missing = required.filter(([name]) => !String(process.env[name] ?? '').trim())

if (missing.length > 0) {
  console.error('\nСборка под GitHub Pages остановлена: не заданы переменные окружения.\n')
  for (const [name, purpose] of missing) {
    console.error(`  ${name} — ${purpose}`)
  }
  console.error('\nБез них клиент будет обращаться к относительному пути и попадёт')
  console.error('в заглушку Pages вместо функции на Vercel.')
  console.error('Задай их в .github/workflows/deploy-pages.yml, блок env у шага build.\n')
  process.exit(1)
}

console.log('[env] адреса функций заданы, собираем под Pages')
