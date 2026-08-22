import { expect, test } from '@playwright/test'

const phoneViewports = [
  { width: 320, height: 812 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('адаптация под телефон', () => {
  for (const viewport of phoneViewports) {
    test(`главная не переполняется на ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      await expectNoPageOverflow(page)
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

      const smallButtons = await page.locator('button').evaluateAll((buttons) => buttons
        .map((button) => {
          const rect = button.getBoundingClientRect()
          return {
            name: button.getAttribute('aria-label') || button.textContent || '',
            width: rect.width,
            height: rect.height,
          }
        })
        .filter(({ width, height }) => width > 0 && height > 0 && (width < 44 || height < 44)))

      expect(smallButtons).toEqual([])
    })
  }

  test('компактный телефон складывает ввод и сохраняет центрированный диалог', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/')

    const taskField = page.locator('.task-number-field')
    const photoField = page.locator('.photo-task-field')
    const [taskBox, photoBox] = await Promise.all([taskField.boundingBox(), photoField.boundingBox()])
    expect(taskBox).not.toBeNull()
    expect(photoBox).not.toBeNull()
    expect(photoBox!.y).toBeGreaterThan(taskBox!.y + taskBox!.height)
    expect(Math.abs(photoBox!.width - taskBox!.width)).toBeLessThan(1)

    await page.getByRole('button', { name: /Учебник Геометрия/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Выбери учебник' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(350)
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.abs(box!.y - (812 - box!.height) / 2)).toBeLessThan(2)
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: 'Закрыть выбор учебника' }).click()
    const initialTheme = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: /Включить (светлую|тёмную) тему/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark')
  })

  test('расписание листается только внутри таблицы на телефоне и в альбомной ориентации', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 812 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.getByRole('button', { name: 'Расписание', exact: true }).click()
      await expect(page.getByText(/Свайпни таблицу/)).toBeVisible()
      await expectNoPageOverflow(page)

      const tableWidths = await page.locator('.schedule-table-scroll').evaluate((scroller) => ({
        client: scroller.clientWidth,
        scroll: scroller.scrollWidth,
      }))
      expect(tableWidths.scroll).toBeGreaterThan(tableWidths.client)
    }
  })
})
