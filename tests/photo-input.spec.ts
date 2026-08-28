import path from 'node:path'
import { expect, test } from '@playwright/test'

const imagePath = path.resolve('public/og-card.png')

async function attachPhoto(page: import('@playwright/test').Page) {
  await page.goto('/main')
  await page.setInputFiles('#task-photo', imagePath)
  await page.getByRole('button', { name: 'Продолжить с фото' }).click()
  await expect(page.getByRole('img', { name: 'Прикреплённое фото задачи' })).toBeVisible()
}

test('передаёт модели изображение без браузерного OCR', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let solveRequest: Record<string, unknown> | undefined

  await page.route('**/api/solve', async (route) => {
    solveRequest = route.request().postDataJSON() as Record<string, unknown>
    const condition = 'Найдите значение угла по условию на фотографии.'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        solution: {
          engineVersion: 2,
          textbookId: solveRequest.textbookId,
          task: solveRequest.task,
          source: 'photo',
          textbookEdition: solveRequest.edition,
          sourceUrl: 'photo',
          conditionNormalized: condition.toLocaleLowerCase('ru-RU'),
          subject: solveRequest.subject,
          textbookTitle: solveRequest.textbookTitle,
          condition,
          given: ['Дано на фото.'],
          goal: { title: 'Найти', text: 'ответ.' },
          steps: ['Решение по условию изображения.'],
          answer: 'Ответ.',
          diagram: { kind: 'none', description: 'Чертёж не требуется.', vertices: [] },
          sourceVerified: true,
          taskType: 'calculation',
          quality: { diagramRequired: false, reviewPassed: true, symbolicShare: 0.7 },
          createdAt: '2026-08-28T19:00:00.000Z',
        },
      }),
    })
  })

  await attachPhoto(page)
  await expect(page.getByRole('textbox', { name: /условие/i })).toHaveCount(0)
  await expect(page.getByText(/распознал/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Решить по этому фото' }).click()

  await expect.poll(() => solveRequest).toBeTruthy()
  expect(solveRequest).not.toHaveProperty('condition')
  expect(solveRequest?.imageDataUrl).toMatch(/^data:image\/png;base64,/)
})

test('показывает приложенное фото без переполнения на телефоне', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await attachPhoto(page)

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(widths.content).toBeLessThanOrEqual(widths.viewport)
  await expect(page.getByRole('button', { name: 'Решить по этому фото' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать другое фото' })).toBeVisible()
})
