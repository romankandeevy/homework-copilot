import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { mockSupabase, signIn } from './adminMocks'

/* Админка после аудита 15 сентября 2026: деньги с налогом и комиссией,
   настраиваемая ежедневная сводка, очистка статистики, предметы в фокусе
   по выбору владельца. Ответы базы подменяются на уровне сети
   (tests/adminMocks.ts); маршруты теста перекрывают общие фикстуры и
   заодно запоминают, что админка отправила.

   С ADMIN_SHOTS_DIR тест снимает состояния для разбора дизайна. */

const shotsDir = process.env.ADMIN_SHOTS_DIR

async function shot(page: Page, name: string, fullPage = false) {
  if (!shotsDir) return
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${shotsDir}/real-stats-${name}.png`, fullPage })
}

async function captureRpc(page: Page, name: string, reply: (body: Record<string, unknown>) => unknown) {
  const bodies: Record<string, unknown>[] = []
  await page.route(new RegExp(`/rest/v1/rpc/${name}(\\?|$)`), (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    bodies.push(body)
    return route.fulfill({ json: reply(body) })
  })
  return bodies
}

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

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test.describe('админка: реальные данные и настройки', () => {
  test('дашборд: пришло, налог и комиссия, чистыми, ручные зачисления отдельно', async ({ page }) => {
    const errors = trackErrors(page)
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await expect(page.getByRole('heading', { name: 'Пришло за 30 дней' })).toBeVisible()
    const stats = page.locator('.dash-hero-stats')
    await expect(stats.getByText('Налог и комиссия')).toBeVisible()
    await expect(stats.getByText('Чистыми')).toBeVisible()
    await expect(stats.getByText('Прибыль', { exact: true })).toHaveCount(0)
    await expect(stats.getByText(/^налог .+, комиссия .+$/u)).toBeVisible()
    await expect(page.getByText('Зачислено вручную за 30 дней:')).toBeVisible()
    await expect(page.getByText('Платёжного провайдера нет', { exact: false })).toHaveCount(0)
    await shot(page, 'dashboard')
    expect(errors).toEqual([])
  })

  test('ежедневная сводка: часы, дни, период, блоки, предпросмотр и сохранение', async ({ page }) => {
    const errors = trackErrors(page)
    await mockSupabase(page)
    const saved = await captureRpc(page, 'admin_setting_save', (body) => ({ key: body.p_key, value: body.p_value }))
    const sent = await captureRpc(page, 'admin_daily_summary_send_now', () => ({ queued: true, day: '2026-09-14' }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=notifications')

    const panel = page.locator('.adm-panel', { has: page.getByRole('heading', { name: 'Ежедневная сводка' }) })
    await expect(panel.locator('.ntf-preview')).toContainText('Сводка за 14.09.2026')
    await expect(panel.getByText('Уйдёт каждый день в 09:00 МСК, итоги вчерашнего дня.')).toBeVisible()

    const hours = panel.getByRole('group', { name: 'Часы отправки' })
    await expect(hours.getByRole('button', { name: '09' })).toHaveAttribute('aria-pressed', 'true')
    await hours.getByRole('button', { name: '21' }).click()
    await panel.getByRole('button', { name: 'Сегодня к часу отправки' }).click()
    await panel.getByLabel('Предметы дня').check()
    await expect(panel.getByText('Уйдёт каждый день в 09:00 и 21:00 МСК, итоги сегодняшнего дня к моменту отправки.')).toBeVisible()
    await expect(panel.locator('.ntf-preview')).toContainText('Сводка за сегодня')
    await expect(panel.locator('.ntf-preview')).toContainText('Предметы: Алгебра 3')
    // Пока изменения не сохранены, отправлять нечего: ушла бы старая сводка.
    await expect(panel.getByRole('button', { name: 'Отправить сейчас' })).toBeDisabled()
    await shot(page, 'summary-editor', true)

    // Без дней сводка не уходит - и сохранить её нельзя.
    const days = panel.getByRole('group', { name: 'Дни отправки' })
    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) await days.getByRole('button', { name: day }).click()
    await expect(panel.getByText('Выбери хотя бы один день.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Сохранить сводку' })).toBeDisabled()
    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']) await days.getByRole('button', { name: day }).click()
    await expect(panel.getByText('Уйдёт по будням в 09:00 и 21:00 МСК', { exact: false })).toBeVisible()

    await panel.getByRole('button', { name: 'Сохранить сводку' }).click()
    await expect(page.getByText('Сводка сохранена.')).toBeVisible()
    const lastSaved = saved.at(-1) ?? {}
    expect(lastSaved).toMatchObject({
      p_key: 'daily_summary',
      p_value: { hours: [9, 21], days: [1, 2, 3, 4, 5], period: 'today' },
    })
    expect((lastSaved.p_value as { blocks: string[] }).blocks).toContain('subjects')

    // После сохранения форма снова чистая - и сводку можно отправить.
    await panel.getByRole('button', { name: 'Отправить сейчас' }).click()
    await expect(page.getByText('Сводка в очереди - уйдёт в течение минуты.')).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(errors).toEqual([])
  })

  test('очистка статистики: подсчёт, подтверждение словом, только свой аккаунт', async ({ page }) => {
    const errors = trackErrors(page)
    await mockSupabase(page)
    const calls = await captureRpc(page, 'admin_stats_purge', (body) => ({
      dryRun: body.p_dry_run !== false, from: body.p_from, to: body.p_to, onlyMine: body.p_only_mine === true,
      counts: { solution_costs: 15, solution_logs: 15 }, total: 30,
    }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=settings&set_tab=stats')

    await expect(page.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Деньги - кошельки, пополнения, возвраты и заказы - не удаляются никогда', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Только мой аккаунт' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled()

    await page.getByRole('button', { name: 'Посчитать' }).click()
    await expect(page.getByRole('cell', { name: 'Задачи (график, предметы, расход на модели)' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Всего\s+30/u })).toBeVisible()
    expect(calls[0]).toMatchObject({ p_scopes: ['solutions'], p_only_mine: true, p_dry_run: true })

    await page.getByRole('button', { name: 'Удалить 30' }).click()
    const dialog = page.getByRole('dialog', { name: 'Очистить статистику?' })
    await expect(dialog.getByText('только твоего аккаунта', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Удалить 30' })).toBeDisabled()
    await shot(page, 'purge-confirm')
    await dialog.getByLabel('Напиши «очистить», чтобы подтвердить').fill('очистить')
    await dialog.getByRole('button', { name: 'Удалить 30' }).click()
    await expect(page.getByText('Удалено записей: 30. Цифры дашборда пересчитаны.')).toBeVisible()
    expect(calls.at(-1)).toMatchObject({ p_scopes: ['solutions'], p_only_mine: true, p_dry_run: false })
    // После удаления прежний подсчёт недействителен.
    await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('предметы в фокусе: автоматически где проблемы, выбор владельца сохраняется', async ({ page }) => {
    const errors = trackErrors(page)
    await mockSupabase(page)
    const saved = await captureRpc(page, 'admin_setting_save', (body) => ({ key: body.p_key, value: body.p_value }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=monitoring&m_tab=quality')

    const focus = page.getByRole('region', { name: 'Предметы в фокусе' })
    await expect(focus.getByText('автоматически: где больше проблем')).toBeVisible()
    // У химии в фикстуре 16,7 % сбоев - она первая, дальше самые частые.
    await expect(focus.locator('.adm-stat-label')).toHaveText(['Химия', 'Физика', 'Алгебра'])

    await focus.getByRole('button', { name: 'Выбрать предметы' }).click()
    const options = focus.getByRole('group', { name: 'Выбор предметов в фокусе' })
    await expect(options.getByRole('checkbox', { name: 'Химия' })).toBeChecked()
    await options.getByRole('checkbox', { name: 'Химия' }).uncheck()
    await options.getByRole('checkbox', { name: 'История' }).check()
    await shot(page, 'focus-editor')
    await focus.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Предметы в фокусе сохранены.')).toBeVisible()
    expect(saved.at(-1)).toEqual({ p_key: 'quality_focus_subjects', p_value: ['Алгебра', 'Физика', 'История'] })
    expect(errors).toEqual([])
  })

  test('на телефоне новые панели не шире экрана', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/admin?section=notifications')
    await expect(page.getByRole('heading', { name: 'Ежедневная сводка' })).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'summary-mobile', true)
    await page.goto('/admin?section=settings&set_tab=stats')
    await expect(page.getByRole('button', { name: 'Посчитать' })).toBeVisible()
    await expectNoPageOverflow(page)
    await page.goto('/admin?section=settings&set_tab=site')
    await expect(page.getByRole('heading', { name: 'Налог и комиссия' })).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'rates-mobile', true)
  })
})
