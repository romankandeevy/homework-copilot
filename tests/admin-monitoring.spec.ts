import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, monitoringOverview, signIn, studentId } from './adminMocks'

/* Раздел «Мониторинг» без настоящей базы: ответы admin-RPC подменяются
   на уровне сети (tests/adminMocks.ts). Проверяем то, что просил владелец:
   сводку, график, алерты, подробности ошибки, групповые действия,
   автодополнение маршрута, хронологию, пустое состояние и светофор. */

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

function rpc(name: string) {
  return new RegExp(`/rest/v1/rpc/${name}(\\?|$)`)
}

async function openMonitoring(page: Page, query = '') {
  await page.goto(`/admin?section=monitoring${query}`)
  await expect(page.getByRole('heading', { name: 'Мониторинг', level: 1 })).toBeVisible()
}

test.describe('админка: мониторинг', () => {
  test('сводка, график, алерты, подробности, групповые действия и хронология', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
    })
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await openMonitoring(page)

    // Сводка и алерт: карточки, жёлтый всплеск, ручной кнопки «Обновить» нет.
    const cards = page.getByRole('region', { name: 'Сводка ошибок' })
    await expect(cards.getByText('Открытых ошибок')).toBeVisible()
    await expect(cards.getByText('Решено за сутки')).toBeVisible()
    await expect(page.locator('.mon-alert.is-warning')).toContainText('Всплеск: 3 ошибки за последний час')
    await expect(page.getByText(/Обновлено/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toHaveCount(0)

    // График: легенда выключает вид, стрелки показывают столбец.
    const legendModel = page.getByRole('group', { name: 'Виды ошибок на графике' }).getByRole('button', { name: /Модель/ })
    await expect(legendModel).toHaveAttribute('aria-pressed', 'true')
    await legendModel.click()
    await expect(legendModel).toHaveAttribute('aria-pressed', 'false')
    await legendModel.click()
    const chart = page.getByRole('group', { name: /Ошибки за 24 часа/ })
    await chart.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.mon-chart-tip')).toContainText(/ошиб/)
    await page.keyboard.press('Tab')
    await expect(page.locator('.mon-chart-tip')).toHaveCount(0)

    // Понятные колонки с подсказками.
    await expect(page.getByRole('button', { name: 'Что значит «За последний час»' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Что значит «За 7 дней»' })).toBeVisible()

    // Автодополнение маршрута из реальных маршрутов.
    await expect(page.locator('#mon-route-options option')).toHaveCount(3)

    // Групповое действие уходит одним запросом со списком отпечатков.
    await page.getByLabel('Выбрать строку').first().check()
    const bulkbar = page.getByRole('region', { name: 'Действия с выбранными группами' })
    await expect(bulkbar).toContainText('Выбрано групп: 1')
    const bulkRequest = page.waitForRequest((request) => request.url().includes('admin_errors_set_status_bulk'))
    await bulkbar.getByRole('button', { name: 'Решено' }).click()
    expect((await bulkRequest).postDataJSON()).toEqual({ p_fingerprints: ['fp-1'], p_status: 'resolved' })
    await expect(page.getByText('«Решено»: изменено групп 1')).toBeVisible()
    await expect(bulkbar).toHaveCount(0)

    // Подробности: видно, что строка открывается, и в панели всё для разбора.
    await page.getByRole('button', { name: /^Подробнее:/ }).nth(1).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Стек-трейс')).toBeVisible()
    await expect(drawer.getByText('Safari 18.0, iOS 18.0, телефон', { exact: true })).toBeVisible()
    await expect(drawer.getByText(/МСК/).first()).toBeVisible()
    await expect(drawer.getByText('10.0.0.1')).toBeVisible()
    await expect(drawer.getByText('Как воспроизвести')).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Скопировать весь контекст' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Открыть лог' })).toBeVisible()
    await drawer.getByRole('button', { name: /alina@example\.test/ }).click()
    await expect(page).toHaveURL(new RegExp(`user=${studentId}`))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Хронология: лента событий по дням, клик открывает ту же панель.
    await page.getByRole('group', { name: 'Вид списка' }).getByRole('button', { name: 'Хронология' }).click()
    await expect(page).toHaveURL(/m_view=timeline/)
    const feed = page.locator('.mon-feed-item')
    await expect(feed).toHaveCount(2)
    await feed.first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/m_event=102/)
    await page.keyboard.press('Escape')

    expect(errors).toEqual([])
  })

  test('пустой список - иллюстрация и зелёное «всё работает»', async ({ page }) => {
    await mockSupabase(page)
    await page.route(rpc('admin_errors_list'), (route) => route.fulfill({ json: { total: 0, page: 1, pageSize: 50, routes: [], items: [] } }))
    await page.route(rpc('admin_monitoring_overview'), (route) => route.fulfill({
      json: monitoringOverview({ alerts: [], cards: { open: 0, critical: 0, newLastHour: 0, eventsLastHour: 0, resolvedLastDay: 2 } }),
    }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await openMonitoring(page)
    await expect(page.getByText('Открытых ошибок нет')).toBeVisible()
    await expect(page.locator('.mon-empty-status.is-ok')).toContainText('Всё работает: последняя проверка сервисов')
    await expect(page.locator('.mon-empty-art')).toBeVisible()
    await expect(page.getByText('Тревог нет')).toBeVisible()

    // Пусто из-за фильтра - другое состояние, с выходом из него.
    await page.getByRole('group', { name: 'Статус ошибок' }).getByRole('button', { name: 'Решённые' }).click()
    await expect(page.getByText('Под эти фильтры ошибок нет')).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()
    await expect(page.getByText('Открытых ошибок нет')).toBeVisible()
  })

  test('красные алерты: сервис не отвечает и доля 5xx', async ({ page }) => {
    await mockSupabase(page)
    await page.route(rpc('admin_monitoring_overview'), (route) => route.fulfill({
      json: monitoringOverview({
        alerts: [
          { id: 'down:vercel-api', level: 'danger', kind: 'service_down', service: 'vercel-api', status: 'http_502', detail: null, since: new Date(Date.now() - 25 * 60_000).toISOString(), minutes: 25 },
          { id: 'api_5xx', level: 'danger', kind: 'api_5xx', value: 62.5, norm: 0.8, failed: 25, total: 40 },
        ],
      }),
    }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await openMonitoring(page)
    const danger = page.locator('.mon-alert.is-danger')
    await expect(danger).toHaveCount(2)
    await expect(danger.first()).toContainText('Функции на Vercel не отвечает 25 мин')
    await expect(danger.nth(1)).toContainText('62,5 % запросов за час закончились ошибкой 5xx')
    await danger.first().getByRole('button', { name: 'Открыть «Состояние»' }).click()
    await expect(page).toHaveURL(/m_tab=health/)
    await expect(page.getByRole('tab', { name: 'Состояние' })).toHaveAttribute('aria-selected', 'true')
  })

  test('качество, логи и светофор - понятные подписи без кнопки «Обновить»', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await openMonitoring(page, '&m_tab=health')
    const lights = page.locator('.mon-light-row')
    await expect(lights).toHaveCount(2)
    await expect(page.locator('.mon-light-row.is-ok')).toContainText('Шлюз моделей Kie.ai')
    await expect(page.locator('.mon-light-row.is-ok')).toContainText('127 мс')
    await expect(page.locator('.mon-light-row.is-warn')).toContainText('Не настроен')
    await expect(page.getByRole('button', { name: 'Проверить сейчас' })).toBeVisible()

    await page.getByRole('tab', { name: 'Качество' }).click()
    await expect(page.getByRole('button', { name: 'Что значит «Доля сбоев»' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Химия' }).first()).toBeVisible()

    await page.getByRole('tab', { name: 'Логи' }).click()
    await expect(page.getByText('Safari 18.0, iOS 18.0, телефон')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Длительность' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toHaveCount(0)
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await openMonitoring(page)
    await expect(page.getByText('Открытых ошибок')).toBeVisible()
    await expectNoPageOverflow(page)
    await page.getByRole('button', { name: /^Подробнее:/ }).first().click()
    await expect(page.getByRole('dialog').getByText('Как воспроизвести')).toBeVisible()
    await expectNoPageOverflow(page)
    await page.keyboard.press('Escape')
    await openMonitoring(page, '&m_view=timeline')
    await expect(page.locator('.mon-feed-item')).toHaveCount(2)
    await expectNoPageOverflow(page)
    await openMonitoring(page, '&m_tab=health')
    await expect(page.locator('.mon-light-row')).toHaveCount(2)
    await expectNoPageOverflow(page)
  })
})
