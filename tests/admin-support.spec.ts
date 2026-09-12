import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, signIn } from './adminMocks'

/* Раздел «Поддержка» на подменённой базе (tests/adminMocks.ts): тревога SLA
   с фильтром, пустое состояние справа и сводка, карточка ученика с
   историей только при открытом обращении, горячие клавиши, массовые
   действия, выгрузка и телефон без горизонтальной прокрутки. */

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => !element.closest('.adm-table-wrap, .adm-rail, .adm-tabs, .sup-print-sheet'))
      .map((element) => ({ className: String(element.className), tag: element.tagName, right: Math.round(element.getBoundingClientRect().right) }))
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }))
  expect(widths.scroll, JSON.stringify(widths.overflowing)).toBeLessThanOrEqual(widths.client)
}

async function openSupport(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: /Поддержка/ }).click()
  await expect(page.getByRole('heading', { name: 'Поддержка', level: 1 })).toBeVisible()
}

test.describe('админка: поддержка', () => {
  test('сводка, тревога SLA, горячие клавиши, история ученика и массовые действия', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
    })
    const bulkCalls: unknown[] = []
    page.on('request', (request) => {
      if (request.url().includes('/rpc/admin_support_bulk_update')) bulkCalls.push(request.postDataJSON())
    })

    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await openSupport(page)

    // Ручного обновления и кнопки уведомлений в поддержке больше нет.
    await expect(page.getByRole('button', { name: 'Обновить' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Включить уведомления' })).toHaveCount(0)
    await expect(page.getByText(/обновлено (только что|\d+ с назад)/)).toBeVisible()

    // Просрочка - красный блок со ссылкой-фильтром.
    const alert = page.getByRole('alert').filter({ hasText: 'Просрочено по SLA: 1' })
    await expect(alert).toBeVisible()
    await alert.getByRole('link', { name: /Показать просроченные/ }).click()
    await expect(page).toHaveURL(/s_overdue=1/)
    await expect(page.getByRole('button', { name: 'Убрать фильтр: только просроченные по SLA' })).toBeVisible()
    await page.getByRole('button', { name: 'Убрать фильтр: только просроченные по SLA' }).click()
    await expect(page).not.toHaveURL(/s_overdue=1/)

    // Ничего не выбрано: пустое состояние со шпаргалкой и сводка, карточки ученика нет.
    await expect(page.getByRole('heading', { name: 'Выбери обращение' })).toBeVisible()
    await expect(page.getByText('Сводка поддержки')).toBeVisible()
    await expect(page.getByText('Обращений в день')).toBeVisible()
    await expect(page.getByText('72,2 %')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Ученик' })).toHaveCount(0)
    const inbox = page.getByRole('region', { name: 'Входящие обращения' })
    await expect(inbox.locator('.sup-tag.is-payment').first()).toHaveText('Платёж')

    // Фильтр по дате уходит в адрес.
    await page.getByRole('group', { name: 'Когда создано обращение' }).getByRole('button', { name: 'Неделя' }).click()
    await expect(page).toHaveURL(/s_period=week/)

    // Шпаргалка по «?».
    await page.locator('body').click({ position: { x: 5, y: 400 } })
    await page.keyboard.press('Shift+Slash')
    await expect(page.getByRole('dialog', { name: 'Горячие клавиши' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // J открывает первое обращение, справа - карточка с историей.
    await page.keyboard.press('j')
    await expect(page).toHaveURL(/conversation=conversation-1/)
    const card = page.getByRole('complementary', { name: 'Ученик' })
    await expect(card).toBeVisible()
    await expect(card.getByText('История обращений · 1')).toBeVisible()
    await expect(card.getByRole('button', { name: /Не приходит код входа/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Выбери обращение' })).toHaveCount(0)

    // R - к ответу; в поле буквы остаются буквами, Ctrl+A не перехвачен.
    await page.keyboard.press('r')
    const reply = page.getByLabel('Ответ ученику')
    await expect(reply).toBeFocused()
    await page.keyboard.type('jk')
    await expect(reply).toHaveValue('jk')
    await expect(page).toHaveURL(/conversation=conversation-1/)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await expect(reply).toHaveValue('')

    // Esc вне поля - назад к списку.
    await page.getByRole('heading', { name: 'Проблема с оплатой или балансом', level: 2 }).click()
    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/conversation=/)
    await expect(page.getByRole('heading', { name: 'Выбери обращение' })).toBeVisible()

    // Массовое действие одним вызовом.
    await inbox.getByRole('checkbox', { name: /Выбрать: Проблема с оплатой/ }).check()
    await inbox.getByRole('checkbox', { name: /Выбрать: Идея для сервиса/ }).check()
    const bulk = page.getByRole('region', { name: 'Действия с выбранными обращениями' })
    await expect(bulk.getByText('Выбрано: 2')).toBeVisible()
    await bulk.getByRole('button', { name: 'Закрыть' }).click()
    await expect(page.getByText('Закрыто: 2 обращения')).toBeVisible()
    expect(bulkCalls).toHaveLength(1)
    expect(bulkCalls[0]).toMatchObject({ p_status: 'resolved', p_conversation_ids: ['conversation-1', 'conversation-2'] })

    // Выгрузка CSV.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV' }).click()
    expect((await download).suggestedFilename()).toMatch(/^support-\d{4}-\d{2}-\d{2}\.csv$/)

    expect(errors).toEqual([])
  })

  test('на телефоне одна колонка с переходами и без горизонтальной прокрутки', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await openSupport(page)
    await expect(page.getByText('Сводка поддержки')).toBeVisible()
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: /Алина Смирнова/ }).click()
    await expect(page.getByRole('heading', { name: 'Проблема с оплатой или балансом', level: 2 })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Входящие обращения' })).toBeHidden()
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: 'Ученик', exact: true }).click()
    await expect(page.getByText('История обращений · 1')).toBeVisible()
    await expectNoPageOverflow(page)
    await page.getByRole('button', { name: 'К переписке' }).click()
    await page.getByRole('button', { name: 'Все обращения' }).click()
    await expect(page.getByRole('region', { name: 'Входящие обращения' })).toBeVisible()
  })

  test('разрешение на системные уведомления живёт в разделе «Уведомления»', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page)
    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Уведомления' }).click()
    await expect(page.getByText('Уведомления в этом браузере')).toBeVisible()
  })
})
