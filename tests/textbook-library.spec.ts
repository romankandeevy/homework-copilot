import { expect, test } from '@playwright/test'

async function openTasks(page: import('@playwright/test').Page) {
  await page.goto('/cdz')
  await expect(page).toHaveURL(/\/cdz$/)
  await expect(page.getByRole('heading', { name: 'Выбери задачи' })).toBeVisible()
}

test.describe('выбор задач', () => {
  test('ведёт к подтверждению условия до оплаты', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTasks(page)

    const nextTask = page.getByRole('button', { name: 'Задача № 2 · 5 ₽' })
    await nextTask.click()
    await expect(nextTask).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('complementary', { name: 'Выбранные' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()

    await page.getByRole('button', { name: 'Проверить условие' }).click()
    await expect(page).toHaveURL(/\/main$/)
    await expect(page.getByText('Условие задачи № 2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Да, это моя задача' })).toHaveCount(0)
  })

  test('сохраняет общую корзину разных предметов после обновления страницы', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTasks(page)

    await page.getByRole('button', { name: 'Задача № 1 · 5 ₽' }).click()
    await page.getByRole('button', { name: /Физика.*8 класс/ }).click()
    await page.getByRole('button', { name: 'Задача № 2 · 5 ₽' }).click()
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/\/cdz$/)
    await expect(page.getByRole('button', { name: 'Убрать из выбранных: Геометрия, задача № 1' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Убрать из выбранных: Физика, задача № 2' })).toBeVisible()

    await page.getByRole('button', { name: 'Убрать из выбранных: Геометрия, задача № 1' }).click()
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()
    await page.getByRole('button', { name: 'Очистить выбранные' }).click()
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toBeDisabled()
  })

  test('показывает задачи выбранной главы без просмотра учебника', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTasks(page)

    await page.getByRole('button', { name: '02 Площадь', exact: true }).click()
    await expect(page.getByText('Глава 02: Площадь')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Задача № 61 · 5 ₽' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Задача № 1 · 5 ₽' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Открыть учебник' })).toHaveCount(0)
    await expect(page.locator('.textbook-pdf-reader')).toHaveCount(0)
  })

  test('сохраняет выбранный предмет после обновления', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTasks(page)

    const physics = page.getByRole('button', { name: /Физика.*8 класс/ })
    await physics.click()
    await expect(physics).toHaveAttribute('aria-pressed', 'true')
    await page.reload()

    await expect(page).toHaveURL(/\/cdz$/)
    await expect(page.getByRole('button', { name: /Физика.*8 класс/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('показывает точное условие без вводящей в заблуждение схемы', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/main')

    await page.getByRole('textbox', { name: 'Номер задачи' }).fill('2')

    await expect(page.getByText('Условие задачи № 2')).toBeVisible()
    await expect(page.getByText('Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?')).toBeVisible()
    await expect(page.getByText(/Издание учебника: 14-е издание, Просвещение, 2023/)).toBeVisible()
    await expect(page.locator('.task-condition-preview')).toHaveClass(/task-condition-preview--copy-only/)
    await expect(page.getByRole('img', { name: /Три точки A, B и C/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toBeEnabled()
  })

  test('не переполняется и сохраняет touch-targets на телефоне', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openTasks(page)

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      contentWidth: document.querySelector('.product-content')?.scrollWidth,
      contentViewportWidth: document.querySelector('.product-content')?.clientWidth,
    }))
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.contentViewportWidth)

    const tooSmall = await page.locator('.textbook-reader-page button').evaluateAll((buttons) => buttons
      .map((button) => {
        const rect = button.getBoundingClientRect()
        return { label: button.getAttribute('aria-label') || button.textContent || '', width: rect.width, height: rect.height }
      })
      .filter(({ width, height }) => width > 0 && height > 0 && (width < 44 || height < 44)))
    expect(tooSmall).toEqual([])
  })
})
