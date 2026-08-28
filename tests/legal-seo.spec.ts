import { expect, test } from '@playwright/test'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
]) {
  test(`legal pages and storage notice remain usable at ${viewport.width}px`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.setViewportSize(viewport)
    await page.goto('/privacy')

    await expect(page.getByRole('heading', { name: 'Политика обработки персональных данных' })).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/privacy')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
    await page.getByRole('button', { name: /Понятно/ }).click()
    const footer = page.locator('.site-footer')
    await expect(footer.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute('href', '/terms')
    await expect(footer.getByRole('link', { name: 'Cookie и хранилище' })).toHaveAttribute('href', '/cookies')
    await expect(footer.getByRole('link', { name: 'Публичная оферта' })).toHaveAttribute('href', '/offer')
    await expectNoPageOverflow(page)

    await page.goto('/cookies')
    await expect(page.getByRole('heading', { name: 'Cookie и локальное хранение' })).toBeVisible()
    await expect(page.getByText('Homework Copilot не устанавливает рекламные или аналитические cookie.')).toBeVisible()
    await expectNoPageOverflow(page)

    await page.goto('/offer')
    await expect(page.getByRole('heading', { name: 'Публичная оферта' })).toBeVisible()
    await expect(page.getByText(/пока не принимает оплату/)).toBeVisible()
    await expect(page.getByText(/не является действующей публичной офертой/)).toBeVisible()
    await expectNoPageOverflow(page)
    expect(consoleErrors).toEqual([])
  })
}

test('private routes receive noindex metadata', async ({ page }) => {
  await page.goto('/support')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/support')
})
