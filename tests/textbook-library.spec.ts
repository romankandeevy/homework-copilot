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
    await expect(page.getByRole('button', { name: 'Условие верное' })).toBeVisible()
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

  test('показывает точное условие из базы без выдуманной схемы', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/main')

    await page.getByRole('textbox', { name: 'Номер задачи' }).fill('3')
    await page.getByRole('button', { name: 'Проверить условие' }).click()

    await expect(page.getByText('Условие задачи № 3')).toBeVisible()
    await expect(page.getByText('Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.')).toBeVisible()
    await expect(page.getByText(/Издание учебника: 14-е издание, Просвещение, 2023/)).toBeVisible()
    await expect(page.locator('.task-condition-preview')).toHaveClass(/task-condition-preview--copy-only/)
    await expect(page.locator('.task-source-preview')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Условие верное' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Проверить условие' })).toHaveCount(0)
  })

  test('показывает исходный чертёж вместе с условием', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/main')

    await page.getByRole('textbox', { name: 'Номер задачи' }).fill('50')
    await page.getByRole('button', { name: 'Проверить условие' }).click()

    await expect(page.getByText('Условие задачи № 50')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/На рисунке 43 изображены лучи с общим началом O/)).toBeVisible()
    await expect(page.getByText('Рисунок 43 из учебника')).toBeVisible()
    const sourceDiagram = page.getByRole('img', { name: 'Рисунок 43 из учебника для задачи № 50' })
    await expect(sourceDiagram).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => sourceDiagram.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Условие верное' })).toBeEnabled()
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
