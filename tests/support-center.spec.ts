import { expect, test } from '@playwright/test'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}

test.describe('центр поддержки', () => {
  test('opens from the universal footer and keeps FAQ available to guests', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/main')
    await page.getByRole('button', { name: 'Поддержка' }).last().click()
    await expect(page.getByRole('heading', { name: 'Разберёмся вместе' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible()
    await page.getByRole('button', { name: 'Как открыть решение задачи?' }).click()
    await expect(page.getByText(/Выбери учебник, введи номер/).first()).toBeVisible()
    await expectNoPageOverflow(page)
  })

  test('stays usable on a phone and links the support route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/support')
    await expect(page.getByRole('heading', { name: 'Разберёмся вместе' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible()
    await expectNoPageOverflow(page)
    await page.getByRole('button', { name: 'Закрыть поддержку' }).click()
    await expect(page).toHaveURL(/\/main$/)
  })
})
