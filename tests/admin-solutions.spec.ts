import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { emptySolutionList, mockSupabase, signIn, solutionList } from './adminMocks'

/* База решений в админке. Раньше раздел читал только общий каталог и при
   выданных решениях показывал «Выданных решений пока нет» и нули. Здесь
   проверяем: цифры и строки из admin_solutions_v2, варианты фильтров только
   из данных, полное решение по клику, понятная ошибка с «Повторить» и
   пустая база со схемой. */

const listRoute = /\/rest\/v1\/rpc\/admin_solutions_v2/

// Снимки для разбора дизайна - только если задана папка, как в admin-shots.local.spec.ts.
const shotsDir = process.env.ADMIN_SHOTS_DIR

async function shot(page: Page, name: string, fullPage = false) {
  if (!shotsDir) return
  // Боковая панель въезжает 280 мс - снимок ждёт конца анимации.
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${shotsDir}/solutions-${name}.png`, fullPage })
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

function statValue(page: Page, labelText: string) {
  return page.locator('.adm-stat', { hasText: labelText }).locator('.adm-stat-value')
}

test.describe('админка: база решений', () => {
  test('показывает выданные решения, цифры, фильтры из данных и полное решение', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/WebSocket|realtime/i.test(message.text())) errors.push(message.text())
    })
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'База решений' }).click()
    await expect(page).toHaveURL(/section=library/)
    await expect(page.getByRole('heading', { name: 'База решений', level: 1 })).toBeVisible()

    await expect(statValue(page, 'Выдано решений')).toHaveText('34')
    await expect(statValue(page, 'Добавлено сегодня')).toHaveText('2')
    await expect(statValue(page, 'В общем каталоге')).toHaveText('0')
    await expect(page.getByText('проверенных задач по номеру нет')).toBeVisible()
    await expect(page.getByText('Выданных решений пока нет')).toHaveCount(0)

    // Статусов проверки в данных один - в фильтре только он и «Любой».
    await expect(page.getByLabel('Статус проверки').locator('option')).toHaveText(['Любой', 'Проверка пройдена · 31'])
    await expect(page.getByLabel('Источник').locator('option')).toHaveText(['Любой', 'Текст · 22', 'Фото · 9'])

    const filtered = page.waitForRequest((request) => listRoute.test(request.url()) && request.postDataJSON()?.p_subject === 'Алгебра')
    await page.getByLabel('Предмет').selectOption('Алгебра')
    await filtered
    await expect(page).toHaveURL(/s_subject=/)
    await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible()

    await page.getByText('Диагонали ромба 10 и 24 см', { exact: false }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/s_open=/)
    await expect(dialog.getByText('Проверки решателя')).toBeVisible()
    await expect(dialog.getByText('0,7x > 7 |:0,7', { exact: true })).toBeVisible()
    await expect(dialog.locator('.sol-answer-line')).toHaveText('x > 10')
    await expect(dialog.getByText('gpt-5-6-sol×1')).toBeVisible()
    await shot(page, 'desktop-drawer')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    if (shotsDir) {
      await page.getByText('Откуда берутся решения и как считаются цифры').click()
      await shot(page, 'desktop-list', true)
      await page.getByRole('button', { name: 'Тёмная тема' }).click()
      await shot(page, 'desktop-dark', true)
    }

    expect(errors).toEqual([])
  })

  test('ошибка загрузки видна текстом и повторяется кнопкой', async ({ page }) => {
    await mockSupabase(page)
    let failing = true
    await page.route(listRoute, (route) => (failing
      ? route.fulfill({ status: 500, json: { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null } })
      : route.fulfill({ json: solutionList })))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=library')

    const alert = page.getByRole('alert').filter({ hasText: 'Не получилось загрузить базу решений' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Повтори попытку')
    await expect(page.getByText('Выданных решений пока нет')).toHaveCount(0)
    await shot(page, 'desktop-error')

    failing = false
    await alert.getByRole('button', { name: 'Повторить' }).click()
    await expect(statValue(page, 'Выдано решений')).toHaveText('34')
    await expect(alert).toHaveCount(0)
  })

  test('пустая база объясняет, откуда берутся решения', async ({ page }) => {
    await mockSupabase(page)
    await page.route(listRoute, (route) => route.fulfill({ json: emptySolutionList }))
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=library')

    await expect(page.getByRole('heading', { name: 'Выданных решений пока нет' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Схема: условие уходит решателю/ })).toBeVisible()
    await expect(page.getByText('Решения по фото и по тексту остаются личными.')).toBeVisible()
    await shot(page, 'desktop-empty')
  })

  test('не переполняется на телефоне', async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/admin?section=library')
    await expect(statValue(page, 'Выдано решений')).toHaveText('34')
    await expectNoPageOverflow(page)
    await shot(page, 'mobile-list', true)
    await page.getByText('В треугольнике ABC угол C прямой', { exact: false }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'mobile-drawer')
  })
})
