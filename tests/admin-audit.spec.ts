import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, ownerId, signIn } from './adminMocks'

/* Журнал действий и журнал обращений к админ-API. Ответы admin-RPC
   подменены (tests/adminMocks.ts), поэтому проверяем, что интерфейс
   отправляет в базу правильные фильтры и честно показывает ответ.

   С ADMIN_SHOTS_DIR=<папка> тест ещё и снимает боковую панель, сводку и
   телефон - для разбора дизайна; в CI переменной нет и снимков тоже. */

function rpcBodies(page: Page, name: string) {
  const bodies: Record<string, unknown>[] = []
  page.on('request', (request) => {
    if (request.url().includes(`/rest/v1/rpc/${name}`)) bodies.push(JSON.parse(request.postData() ?? '{}') as Record<string, unknown>)
  })
  return bodies
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

async function shot(page: Page, name: string) {
  const dir = process.env.ADMIN_SHOTS_DIR
  // Без остановки анимаций снимок ловит панель на середине появления.
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' })
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('журнал действий', () => {
  test('группы событий, фильтры и пресеты уходят в базу', async ({ page }) => {
    const errors = watchErrors(page)
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    const bodies = rpcBodies(page, 'admin_audit_log_v2')
    await signIn(page)
    await page.goto('/admin?section=audit')

    await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible()
    await expect(page.getByText('reason: Списание ошибочного пополнения')).toBeVisible()
    await expect(page.getByText('опасное', { exact: true })).toBeVisible()
    await expect(page.getByText('Хранится без срока', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: /Событие/ }).click()
    const search = page.getByRole('combobox', { name: 'Найти событие' })
    await expect(search).toBeFocused()
    await expect(page.getByRole('group', { name: 'Финансы' })).toBeVisible()
    await expect(page.getByRole('option', { name: /Изменён баланс/ })).toContainText('balance_adjusted')
    await shot(page, 'audit-combo')
    await search.fill('возврат')
    await expect(page.getByRole('listbox', { name: 'События' }).getByRole('option')).toHaveCount(2)
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect.poll(() => bodies.at(-1)?.p_event).toBe('reservation_refunded')
    await expect(page.getByRole('button', { name: /Событие/ })).toContainText('reservation_refunded')

    await page.getByRole('button', { name: 'Опасные действия' }).click()
    await expect.poll(() => bodies.at(-1)?.p_dangerous).toBe(true)
    await expect(page.getByText('Опасными считаются', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'Только сегодня' }).click()
    await expect.poll(() => bodies.at(-1)).toMatchObject({ p_event: null, p_dangerous: false, p_user: null })
    const today = bodies.at(-1)
    expect(today?.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today?.p_from).toBe(today?.p_to)

    await page.getByLabel('Ученик').fill('alina')
    await page.getByLabel('Ученик').press('Enter')
    await expect.poll(() => bodies.at(-1)?.p_user).toBe('alina')

    await page.getByLabel('Кто').selectOption('system')
    await expect.poll(() => bodies.at(-1)?.p_actor).toBe('system')

    await page.getByRole('button', { name: 'Свой период' }).click()
    await expect(page.getByLabel('Начало периода')).toBeVisible()

    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()
    await expect.poll(() => bodies.at(-1)).toMatchObject({ p_event: null, p_actor: null, p_user: null, p_from: null, p_to: null, p_dangerous: false })

    expect(errors).toEqual([])
  })

  test('подробности открываются сбоку: было → стало, JSON и ссылки', async ({ page }) => {
    const errors = watchErrors(page)
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=audit')

    await page.getByRole('button', { name: /status: pending_owner → resolved/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Изменён статус обращения' })
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('tr.is-changed')).toHaveCount(2)
    await expect(drawer.locator('tr.is-same')).toHaveCount(1)
    await expect(drawer.getByText('изменено полей: 2 из 3')).toBeVisible()
    await expect(drawer.getByRole('heading', { name: 'Полный JSON' })).toBeVisible()
    // Таблица под панелью не раздувается: подробностей в строках нет.
    await expect(page.locator('.adm-table details')).toHaveCount(0)
    await shot(page, 'audit-drawer')

    await drawer.getByRole('button', { name: 'conversation-1' }).click()
    await expect(page).toHaveURL(/section=support/)
    await expect(page).toHaveURL(/conversation=conversation-1/)

    await page.goto('/admin?section=audit')
    await page.getByRole('button', { name: /status: pending_owner → resolved/ }).click()
    await page.getByRole('dialog', { name: 'Изменён статус обращения' }).getByRole('button', { name: ownerId }).click()
    await expect(page).toHaveURL(new RegExp(`user=${ownerId}`))

    expect(errors).toEqual([])
  })

  test('обращения к админ-API: фильтры, «это вы» и сводка частого опроса', async ({ page }) => {
    const errors = watchErrors(page)
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    const list = rpcBodies(page, 'admin_request_log_v2')
    const summary = rpcBodies(page, 'admin_request_log_summary')
    await signIn(page)
    await page.goto('/admin?section=audit&a_tab=requests')

    await expect(page.getByText('это вы', { exact: true })).toHaveCount(2)
    await expect(page.getByText('Разных IP')).toBeVisible()
    await expect(page.getByText('Хранится 90 дней', { exact: false })).toBeVisible()
    expect(list.at(-1)?.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await shot(page, 'audit-requests-list')

    await page.getByLabel('Путь').fill('signal')
    await page.getByLabel('IP', { exact: true }).fill('10.0.')
    await page.getByRole('button', { name: 'Найти' }).click()
    await expect.poll(() => list.at(-1)).toMatchObject({ p_path: 'signal', p_ip: '10.0.' })

    await page.getByRole('button', { name: 'Сводка' }).click()
    await expect.poll(() => summary.at(-1)?.p_threshold).toBe(2)
    await expect(page.locator('tr.aud-poll-danger')).toHaveCount(1)
    await expect(page.locator('tr.aud-poll-warning')).toHaveCount(1)
    await expect(page.locator('tr.aud-poll-danger')).toContainText('Похоже на частый опрос')
    await shot(page, 'audit-requests-summary')

    await page.getByText('/rpc/admin_users_list').click()
    await expect.poll(() => list.at(-1)?.p_path).toBe('/rpc/admin_users_list')
    await expect(page.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true')

    expect(errors).toEqual([])
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/admin?section=audit')
    await expect(page.getByRole('button', { name: /Событие/ })).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'audit-mobile')
    await page.getByRole('button', { name: /Событие/ }).click()
    await expectNoPageOverflow(page)
    await shot(page, 'audit-mobile-combo')
    await page.keyboard.press('Escape')
    await page.goto('/admin?section=audit&a_tab=requests&a_rview=summary')
    await expect(page.locator('tr.aud-poll-danger')).toHaveCount(1)
    await expectNoPageOverflow(page)
    await shot(page, 'audit-mobile-summary')
  })
})
