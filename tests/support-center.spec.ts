import { expect, test } from './fixtures'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}

test.describe('центр поддержки', () => {
  test('opens from the floating button on the home screen and keeps FAQ available to guests', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/app')
    // Уведомление о хранении данных при первом заходе лежит в том же углу.
    await page.getByRole('button', { name: 'Закрыть уведомление' }).click()
    // С 14 сентября плавающая кнопка стоит на каждой странице, включая
    // главную, а подвал приложения - тот же полный, что на витрине.
    await expect(page.locator('.site-footer').getByRole('button', { name: 'Написать в поддержку' })).toBeVisible()
    await page.locator('.support-launcher').click()
    await expect(page.getByRole('heading', { name: 'Разберёмся вместе' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible()
    await page.getByRole('button', { name: 'Как получить решение задачи?' }).click()
    await expect(page.getByText(/Впиши условие на главной/).first()).toBeVisible()
    await expectNoPageOverflow(page)
  })

  test('floating support stands on the landing and the documents too', async ({ page }) => {
    for (const path of ['/', '/terms']) {
      await page.goto(path)
      await expect(page.locator('a.support-launcher')).toHaveAttribute('href', '/support')
    }
  })

  test('stays usable on a phone and links the support route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/support')
    await expect(page.getByRole('heading', { name: 'Разберёмся вместе' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible()
    await expectNoPageOverflow(page)
    await page.getByRole('button', { name: 'Закрыть поддержку' }).click()
    await expect(page).toHaveURL(/\/app$/)
  })
})
