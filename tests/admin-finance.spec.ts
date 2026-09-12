import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, signIn, studentId } from './adminMocks'
import { financeFixed, financePlan } from './financeMocks'

/* Раздел «Финансы» без настоящей базы: ответы admin-RPC подменены
   (tests/adminMocks.ts, tests/financeMocks.ts). Проверяется то, что видит и
   нажимает владелец: значки статусов, план исправления сверки перед
   подтверждением, выравнивание баланса, выгрузки CSV и график баланса. */

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

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

test.describe('финансы', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
  })

  test('платежи: значок статуса стоит рядом с текстом, CSV выгружается', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/admin?section=finance&fin_tab=payments')
    const success = page.locator('.adm-badge:visible', { hasText: 'Успешно' }).first()
    await expect(success).toBeVisible()
    await expect(success.locator('svg.fin-status-icon.is-ok')).toHaveCount(1)
    const failed = page.locator('.adm-badge:visible', { hasText: 'Отказ оплаты' }).first()
    await expect(failed.locator('svg.fin-status-icon.is-bad')).toHaveCount(1)

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Экспортировать CSV' }).click()
    expect((await download).suggestedFilename()).toMatch(/^payments-.+\.csv$/)
    expect(errors).toEqual([])
  })

  test('сверка: исправление показывает план, просит подтверждения и шлёт суммы плана', async ({ page }) => {
    const errors = watchErrors(page)
    let realRun: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_finance_fix_reconciliation/, (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      if (body.p_dry_run === false) {
        realRun = body
        return route.fulfill({ json: financeFixed })
      }
      return route.fulfill({ json: financePlan })
    })

    await page.goto('/admin?section=finance&fin_tab=reconciliation')
    await expect(page.getByRole('heading', { name: 'Проверить вручную' })).toBeVisible()
    await expect(page.getByText('История очереди за этот день удалена', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('сделаны при выдаче решения', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'Исправить автоматически' }).click()
    const planDialog = page.getByRole('dialog', { name: 'План исправления' })
    await expect(planDialog.locator('.fin-refund-summary')).toContainText('7 ₽')
    await expect(planDialog.getByText('Не трогаем 1 списание на 5 ₽', { exact: false })).toBeVisible()
    expect(realRun).toBeNull()

    await planDialog.getByRole('button', { name: 'Перейти к подтверждению' }).click()
    const confirmDialog = page.getByRole('dialog', { name: 'Подтверди возврат' })
    await confirmDialog.getByRole('button', { name: 'Вернуть 7 ₽' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Вернули 1 резерв на 7 ₽.')).toBeVisible()
    expect(realRun).toMatchObject({ p_dry_run: false, p_expected_count: 1, p_expected_total: 700 })
    expect(errors).toEqual([])
  })

  test('сверка: баланс приводится к операциям по одному пользователю и с причиной', async ({ page }) => {
    await page.goto('/admin?section=finance&fin_tab=reconciliation')
    await page.getByRole('button', { name: 'Привести к операциям' }).click()
    const dialog = page.getByRole('dialog', { name: 'Привести баланс к операциям' })
    await expect(dialog.locator('.fin-refund-summary')).toContainText('100 ₽')
    const confirm = dialog.getByRole('button', { name: 'Привести к 20 ₽' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Причина').fill('Тестовый аккаунт e2e')
    const request = page.waitForRequest(/\/rest\/v1\/rpc\/admin_finance_align_wallet/)
    await confirm.click()
    expect((await request).postDataJSON()).toMatchObject({ p_expected_balance: 10000, p_expected_ledger: 2000, p_reason: 'Тестовый аккаунт e2e' })
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  for (const [tab, pattern] of [['report', /^revenue-/], ['llm', /^llm-/], ['unit', /^unit-economics-/]] as const) {
    test(`вкладка ${tab} выгружается в CSV`, async ({ page }) => {
      await page.goto(`/admin?section=finance&fin_tab=${tab}`)
      const button = page.getByRole('button', { name: 'Экспортировать CSV' })
      await expect(button).toBeEnabled()
      const download = page.waitForEvent('download')
      await button.click()
      expect((await download).suggestedFilename()).toMatch(pattern)
    })
  }

  test('история баланса в карточке ученика показывает дату и баланс под курсором', async ({ page }) => {
    await page.goto(`/admin?section=users&user=${studentId}`)
    const card = page.getByRole('dialog')
    // Вкладку открываем с клавиатуры: над вкладками карточки лежит липкая шапка.
    const balanceTab = card.getByRole('tab', { name: 'Баланс' })
    await balanceTab.focus()
    await page.keyboard.press('Enter')
    await expect(balanceTab).toHaveAttribute('aria-selected', 'true')
    await expect(card.getByRole('heading', { name: 'История баланса' })).toBeVisible()
    const chart = card.locator('.adm-chart svg').first()
    await chart.scrollIntoViewIfNeeded()
    const box = await chart.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * 0.9, box!.y + box!.height * 0.75)
    await expect(card.locator('.adm-chart-legend-date').first()).toBeVisible()
    await expect(card.locator('.adm-chart-legend b').first()).toContainText('₽')
  })

  for (const tab of ['payments', 'reconciliation']) {
    test(`вкладка ${tab} не переполняется на телефоне`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/admin?section=finance&fin_tab=${tab}`)
      await expect(page.getByRole('button', { name: 'Экспортировать CSV' })).toBeVisible()
      await expectNoPageOverflow(page)
    })
  }
})
