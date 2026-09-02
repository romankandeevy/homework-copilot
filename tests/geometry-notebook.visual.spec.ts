import { expect, test } from '@playwright/test'

test.describe('GeometryNotebookLayoutV1 visual regression', () => {
  test('approved full logical canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1086, height: 1448 })
    await page.goto('/?canvas=1')

    await expect(page.getByTestId('geometry-notebook-page')).toHaveScreenshot('geometry-notebook-layout-v1-canvas.png')
  })

  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    test(`scales the complete page at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/?canvas=1')

      // Лист грузится отдельным чанком: без ожидания снимок делался с пустой
      // страницы и расходился с эталоном на каждой второй прогонке.
      await expect(page.getByTestId('geometry-notebook-page')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      await expect(page).toHaveScreenshot(`geometry-notebook-layout-v1-${viewport.width}x${viewport.height}.png`, { fullPage: true })
    })
  }
})
