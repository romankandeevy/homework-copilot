import { expect, test } from '@playwright/test'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => ({
        className: element.className,
        tag: element.tagName,
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }))
  expect(widths.scroll, JSON.stringify(widths.overflowing)).toBeLessThanOrEqual(widths.client)
}

test.describe('пульт владельца', () => {
  test('показывает расширенные показатели и открывает инспектор пользователя', async ({ page }) => {
    const errors: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`))

    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/admin?admin-preview=1')

    await expect(page.getByRole('heading', { name: 'Управление сервисом' })).toBeVisible()
    await expect(page.getByText('Баланс пользователей')).toBeVisible()
    await expect(page.getByText('Просмотры страниц')).toBeVisible()

    await page.getByRole('button', { name: '7 дней' }).click()
    await expect(page.getByRole('heading', { name: 'Динамика за 7 дней' })).toBeVisible()
    await page.getByRole('button', { name: 'Решения' }).click()
    await expect(page.getByRole('button', { name: 'Решения' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: /Открыть Алина Смирнова/ }).click()
    await expect(page.getByRole('heading', { name: 'Алина Смирнова' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить баланс' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Алина Смирнова' })).toHaveCount(0)

    await page.locator('.support-admin-inbox-item').first().click()
    await expect(page.getByText('«да это хорошая идея»')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Нужно решение владельца' })).toBeDisabled()

    await expectNoPageOverflow(page)
    expect(errors).toEqual([])
    expect(failedRequests).toEqual([])
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin?admin-preview=1')

    await expect(page.getByRole('heading', { name: 'Управление сервисом' })).toBeVisible()
    await expect(page.getByRole('button', { name: '90 дней' })).toBeVisible()
    await page.getByRole('button', { name: /Открыть Алина Смирнова/ }).click()
    await expect(page.getByRole('heading', { name: 'Алина Смирнова' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.support-admin-inbox-item').first().click()
    await expect(page.getByRole('button', { name: 'Нужно решение владельца' })).toBeDisabled()
    await expectNoPageOverflow(page)
  })
})
