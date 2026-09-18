import { expect, test } from './fixtures'

/* Под готовым решением ученик видит, сколько оно шло и сколько списано.
   Чек присылает сервер вместе с решением (`receipt` в ответе /api/solve). */

test.beforeEach(async ({ page }) => {
  // Очередь в тесте не ходит в настоящую базу (см. photo-input.spec.ts).
  await page.route(/\/rest\/v1\/rpc\/(start_homework_job|close_homework_job|list_homework_jobs)\b/, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'очередь задач в тесте отключена' }) }))
})

test('показывает время решения и списанную сумму', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const condition = 'Найдите 15% от числа 240.'

  await page.route('**/api/solve', async (route) => {
    const request = route.request().postDataJSON() as Record<string, string>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        solution: {
          engineVersion: 2,
          textbookId: request.textbookId,
          task: request.task,
          source: 'text',
          textbookEdition: request.edition,
          sourceUrl: '',
          conditionNormalized: condition.toLocaleLowerCase('ru-RU'),
          subject: request.subject,
          textbookTitle: request.textbookTitle,
          condition,
          given: ['240 - 100%', 'x - 15%'],
          goal: { title: 'Найти', text: 'x.' },
          steps: ['240 · 0,15 = 36'],
          answer: '36.',
          diagram: { kind: 'none', description: 'Чертёж не требуется.', vertices: [] },
          sourceVerified: true,
          taskType: 'calculation',
          quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.7 },
          createdAt: new Date().toISOString(),
        },
        receipt: { seconds: 24, kopecks: 520 },
      }),
    })
  })

  await page.goto('/app')
  await page.getByRole('textbox', { name: 'Условие задачи' }).fill(condition)
  await page.getByRole('combobox', { name: 'Предмет' }).selectOption('Математика')
  await page.locator('.copy-task-submit').click()

  // Вкладка, что заказала решение, сама открывает его.
  await expect(page.locator('.solution-receipt')).toHaveText('решено за 24 с · списано 5,20 ₽')
  await page.screenshot({ path: 'test-results/solve-receipt-page.png' })

  // И карточка «Решение готово» на главной говорит то же.
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Главная' }).click()
  const ready = page.locator('.solve-card.is-ready')
  await expect(ready).toContainText('решено за 24 с · списано 5,20 ₽')
  await ready.screenshot({ path: 'test-results/solve-receipt-card.png' })
})
