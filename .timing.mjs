/* Разбор времени решения: сколько вызовов к провайдеру, каким моделям
   и сколько каждый занял. Ключи читаются из .env.local и не печатаются. */

import { readFile } from 'node:fs/promises'
import { solveHomeworkWithReview } from './server/geometrySolutionEngine.ts'

const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8')).split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
)

const calls = []
const timedFetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const model = body.model ?? '?'
  const startedAt = Date.now()
  const response = await fetch(url, init)
  const text = await response.text()
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  let credits = '?'
  try { credits = JSON.parse(text)?.data?.credits_consumed ?? JSON.parse(text)?.credits_consumed ?? '?' } catch { /* не JSON */ }
  calls.push({ model, seconds, bytes: text.length, credits })
  return new Response(text, { status: response.status, headers: response.headers })
}

const request = {
  textbookId: 'algebra', task: 'Решите уравнение 2x + 7 = 19.', source: 'text',
  subject: 'Алгебра', grade: '7 класс', textbookTitle: 'Любой учебник',
  authors: '—', edition: 'по фото или тексту',
  condition: 'Решите уравнение 2x + 7 = 19.', idempotencyKey: 'timing-' + Date.now(),
}

const stages = []
const startedAt = Date.now()
const solution = await solveHomeworkWithReview(request, {
  apiKey: env.KIE_API_KEY,
  fetchImpl: timedFetch,
  onTrace: (event) => stages.push({
    stage: event.stage, approved: event.approved,
    issues: event.issues.slice(0, 3),
    at: ((Date.now() - startedAt) / 1000).toFixed(1),
  }),
})

console.log('ИТОГО:', ((Date.now() - startedAt) / 1000).toFixed(1), 'с; ответ:', solution.answer)
console.log('\nвызовы к провайдеру:')
calls.forEach((c, i) => console.log(`  ${i + 1}. ${c.model.padEnd(18)} ${String(c.seconds).padStart(6)} с  ${String(c.bytes).padStart(6)} байт  кредитов ${c.credits}`))
console.log('\nэтапы:')
stages.forEach((s) => console.log(`  ${s.stage.padEnd(9)} на ${s.at} с, одобрено=${s.approved}${s.issues.length ? ', замечания: ' + s.issues.join(' | ') : ''}`))
