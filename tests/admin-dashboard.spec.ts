import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, signIn, studentId } from './adminMocks'

/* Админку проверяем без настоящей базы: ответы Supabase подменяются на
   уровне сети (tests/adminMocks.ts). Так проходит весь путь входа - пароль,
   код второго фактора, повышение сессии до aal2 - и разделы получают те же
   JSON, что отдают admin-RPC на проде. */

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => !element.closest('.adm-table-wrap, .adm-rail, .adm-tabs'))
      .map((element) => ({ className: String(element.className), tag: element.tagName, right: Math.round(element.getBoundingClientRect().right) }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }))
  expect(widths.scroll, JSON.stringify(widths.overflowing)).toBeLessThanOrEqual(widths.client)
}

test.describe('админка', () => {
  test('пускает только после второго фактора и показывает дашборд и пользователей', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
    })
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await expect(page.getByText('Без ответа дольше 30 мин:')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Заработано за 30 дней' })).toBeVisible()
    await expect(page.getByText('За всё время:')).toBeVisible()
    await expect(page.getByText('Решено за 30 дней')).toBeVisible()
    await page.getByRole('button', { name: 'День', exact: true }).click()
    await expect(page.getByText('Решено сегодня')).toBeVisible()
    await page.getByRole('button', { name: 'Как считается' }).first().hover()
    await expect(page.getByRole('tooltip').first()).toBeVisible()
    await expect(page.getByText('Сверка кошельков:')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Кредиты шлюза' })).toBeVisible()
    await expect(page.getByText('пополнил баланс')).toBeVisible()

    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Пользователи' }).click()
    await expect(page).toHaveURL(/section=users/)
    await page.getByText('alina@example.test').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`user=${studentId}`))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await expectNoPageOverflow(page)
    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Пользователи' }).click()
    await expect(page.getByText('alina@example.test').first()).toBeVisible()
    await expectNoPageOverflow(page)
  })
})
