import { chromium } from '@playwright/test'

/* Русский язык после перевода сверки на краткий ответ.

   До правки: 47 секунд, из них 19 — рецензент, хотя у выданного решения
   не было ни одного замечания. */

const origin = 'https://www.homeworkcopilot.ru'
const out = 'C:/Users/4CFA~1/AppData/Local/Temp/claude/C--prog/d1e8067f-6b17-49e0-9a4f-6773dafe8f93/scratchpad'
const condition = 'Разберите по составу слово «подоконник» и укажите способ его образования. Объясните написание приставки.'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const report = { stages: [] }

try {
  await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Понятно/ }).click({ timeout: 8000 }).catch(() => {})
  await page.getByRole('textbox', { name: 'Условие задачи' }).fill(condition)
  await page.getByRole('combobox', { name: 'Предмет' }).selectOption('Русский язык')
  await page.getByRole('combobox', { name: 'Класс' }).selectOption('8 класс')

  const startedAt = Date.now()
  await page.locator('.copy-task-submit').click()

  let seen = ''
  for (let tick = 0; tick < 400; tick += 1) {
    await page.waitForTimeout(500)
    if (await page.getByRole('heading', { name: 'Решение задачи' }).count() > 0) {
      report.solvedInMs = Date.now() - startedAt
      break
    }
    const state = await page.evaluate(() => {
      const card = document.querySelector('.solve-card')
      if (!card) return null
      return {
        card: card.className,
        current: card.querySelector('.solve-step.is-current strong')?.textContent ?? '',
        reason: card.querySelector('.solve-card-reason')?.textContent ?? '',
      }
    })
    if (!state) continue
    const key = `${state.card}|${state.current}`
    if (key !== seen) {
      seen = key
      report.stages.push({ atMs: Date.now() - startedAt, current: state.current })
    }
    if (state.card.includes('is-failed')) { report.failed = state.reason; break }
    if (state.card.includes('is-ready')) { report.solvedInMs = Date.now() - startedAt; break }
  }

  if (await page.getByRole('heading', { name: 'Решение задачи' }).count() > 0) {
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${out}/prod-russian-after-key.png`, fullPage: true })
    report.sheet = await page.locator('.notebook-sheet').innerText().catch(() => '')
  }
} catch (error) {
  report.crash = String(error).slice(0, 300)
} finally {
  await browser.close()
  const checking = report.stages.find((stage) => stage.current === 'Проверяем')
  console.log(JSON.stringify({
    ...report,
    checkingStartedMs: checking?.atMs ?? null,
    checkingDurationMs: checking && report.solvedInMs ? report.solvedInMs - checking.atMs : null,
  }, null, 2))
}
