import { expect, test } from '@playwright/test'

async function openCodeScreen(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('homework-copilot:verification-email', 'roma@example.com')
    sessionStorage.setItem('homework-copilot:verification-kind', 'signup')
    sessionStorage.setItem('homework-copilot:verification-sent-at', String(Date.now()))
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Войти(?: или зарегистрироваться)?/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Введи код' })).toBeVisible()
}

test('код подтверждения остаётся на ПК и повторно отправляется только через минуту', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openCodeScreen(page)

  const input = page.getByRole('textbox', { name: 'Код подтверждения' })
  await input.fill('12a34567')
  await expect(input).toHaveValue('123456')
  await expect(page.getByRole('button', { name: 'Подтвердить и войти' })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Новый код через/ })).toBeDisabled()
  await expect(page.getByText(/Supabase Auth/)).toHaveCount(0)
  await expect(page.locator('.product-shell')).toHaveAttribute('aria-hidden', 'true')

  const closeButton = page.getByRole('button', { name: 'Закрыть окно аккаунта' })
  const changeEmailButton = page.getByRole('button', { name: 'Изменить почту' })
  await closeButton.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(changeEmailButton).toBeFocused()
  await changeEmailButton.focus()
  await page.keyboard.press('Tab')
  await expect(closeButton).toBeFocused()

  await page.screenshot({ path: '.impeccable/review/desktop.png', animations: 'disabled' })
})

test('экран кода не переполняет телефон', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await openCodeScreen(page)

  const metrics = await page.locator('.account-dialog').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    pageWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
  }))
  expect(metrics.scrollWidth).toBe(metrics.clientWidth)
  expect(metrics.pageScrollWidth).toBe(metrics.pageWidth)
  await page.screenshot({ path: '.impeccable/review/mobile.png', animations: 'disabled' })
})
