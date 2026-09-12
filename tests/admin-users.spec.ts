import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockSupabase, signIn, studentId } from './adminMocks'

/* Раздел «Пользователи» без настоящей базы: ответы admin-RPC подменяются
   в tests/adminMocks.ts. Проверяем то, что просил владелец: фильтры
   сохраняются, сортировка видна и объявлена, быстрый поиск, меню строки,
   массовые действия, пустое состояние и телефон без прокрутки вбок. */

async function openUsers(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Пользователи' }).click()
  await expect(page.getByRole('heading', { name: 'Пользователи', level: 1 })).toBeVisible()
  await expect(page.getByRole('cell', { name: /alina@example\.test/ })).toBeVisible()
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

test.describe('админка: пользователи', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
  })

  test('цифры над таблицей, сортировка и активность', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openUsers(page)

    const stats = page.getByRole('definition').filter({ hasText: '400 ₽' })
    await expect(stats).toBeVisible()
    await expect(page.locator('.adm-users-stats')).toContainText('Учеников')
    await expect(page.locator('.adm-users-stats')).toContainText('Онлайн сейчас')

    const activity = page.getByRole('columnheader', { name: /Активность/ })
    const balance = page.getByRole('columnheader', { name: /Баланс/ })
    await expect(activity).toHaveAttribute('aria-sort', 'descending')
    await expect(balance).toHaveAttribute('aria-sort', 'none')
    await expect(page.getByRole('columnheader', { name: 'Статус аккаунта' })).not.toHaveAttribute('aria-sort')
    await balance.getByRole('button').click()
    await expect(balance).toHaveAttribute('aria-sort', 'descending')
    await expect(activity).toHaveAttribute('aria-sort', 'none')
    await expect(page).toHaveURL(/u_sort=balance/)

    await expect(page.getByRole('columnheader', { name: /Класс школы/ })).toBeVisible()
    const misha = page.getByRole('row', { name: /Миша Волков/ })
    await expect(misha.getByText('онлайн', { exact: true })).toBeVisible()
    await expect(page.getByRole('row', { name: /Алина Смирнова/ }).getByText('Проверка антифрода')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Экспортировать CSV' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('фильтры переживают перезагрузку и переход через меню', async ({ page }) => {
    await openUsers(page)
    await page.getByLabel('Активность').selectOption('7d')
    await expect(page).toHaveURL(/u_seen=7d/)
    await expect(page.locator('.adm-users-note')).toContainText('Активность пишется с 12.09.2026')

    await page.getByRole('button', { name: /Показать фильтры/ }).click()
    const from = page.getByRole('slider', { name: 'Баланс от' })
    await from.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/u_bmin=\d+/)
    await expect(page.getByRole('button', { name: /Скрыть фильтры/ })).toContainText('1')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Пользователи', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Активность')).toHaveValue('7d')
    await expect(page.getByRole('button', { name: /Показать фильтры/ })).toContainText('1')

    await page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Дашборд' }).click()
    await expect(page).not.toHaveURL(/u_seen/)
    await openUsers(page)
    await expect(page).toHaveURL(/u_seen=7d/)
    await expect(page.getByLabel('Активность')).toHaveValue('7d')

    await page.getByRole('button', { name: 'Сбросить', exact: true }).click()
    await expect(page).not.toHaveURL(/u_seen|u_bmin/)
    await expect(page.getByLabel('Активность')).toHaveValue('')
  })

  test('быстрый поиск: недавние карточки, стрелки и Enter', async ({ page }) => {
    await openUsers(page)
    await page.getByRole('cell', { name: /alina@example\.test/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const search = page.getByRole('combobox', { name: 'Поиск пользователей' })
    await search.focus()
    await expect(page.getByRole('listbox', { name: 'Недавно открытые' })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: /Алина Смирнова/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`user=${studentId}`))
    await page.keyboard.press('Escape')

    await search.fill('ми')
    await expect(page.getByRole('option', { name: /Миша Волков/ })).toBeVisible()
    await search.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page).toHaveURL(/u_q=/)
  })

  test('меню строки: действия через окно подтверждения', async ({ page }) => {
    await openUsers(page)
    await page.getByRole('button', { name: 'Действия: Алина Смирнова' }).click()
    const menu = page.getByRole('menu', { name: 'Действия: Алина Смирнова' })
    await expect(menu.getByRole('menuitem', { name: 'Открыть карточку' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Изменить баланс' })).toBeFocused()
    await menu.getByRole('menuitem', { name: 'Забанить' }).click()

    const dialog = page.getByRole('dialog', { name: 'Заблокировать' })
    await expect(dialog).toContainText('Алина Смирнова')
    await dialog.getByLabel('Причина').fill('Несколько аккаунтов с одного адреса')
    await dialog.getByRole('button', { name: 'Заблокировать' }).click()
    await expect(page.getByText('Алина Смирнова: заблокирован бессрочно')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Действия: Миша Волков' }).click()
    await page.getByRole('menuitem', { name: 'Изменить баланс' }).click()
    const balance = page.getByRole('dialog', { name: 'Изменить баланс' })
    await balance.getByLabel('Сумма, ₽').fill('-40')
    await balance.getByLabel('Причина').fill('Ошибочное начисление')
    await balance.getByRole('button', { name: /Списать/ }).click()
    await expect(page.getByText('Миша Волков: списано 40 ₽')).toBeVisible()

    const sofia = page.getByRole('button', { name: 'Действия: София Крылова' })
    await sofia.click()
    await expect(page.getByRole('menuitem', { name: 'Разбанить' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Забанить' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(sofia).toBeFocused()
  })

  test('массовые действия и выгрузка выбранных', async ({ page }) => {
    await openUsers(page)
    await page.getByRole('checkbox', { name: 'Выбрать: Алина Смирнова' }).check()
    await page.getByRole('checkbox', { name: 'Выбрать: Миша Волков' }).check()
    await expect(page.getByRole('checkbox', { name: 'Выбрать все строки на странице' })).toHaveJSProperty('indeterminate', true)

    const bar = page.getByRole('region', { name: 'Действия с выбранными' })
    await expect(bar).toContainText('Выбрано: 2')
    const download = page.waitForEvent('download')
    await bar.getByRole('button', { name: 'Экспорт выбранных в CSV' }).click()
    expect((await download).suggestedFilename()).toMatch(/^users-selected-.*\.csv$/)

    await bar.getByRole('button', { name: 'Забанить' }).click()
    const dialog = page.getByRole('dialog', { name: 'Заблокировать: 2' })
    await dialog.getByLabel('Причина').fill('Проверка антифрода')
    await dialog.getByRole('button', { name: 'Заблокировать' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Блокировка: выполнено 2, не вышло 0' }).first()).toBeVisible()
    await expect(bar).toHaveCount(0)
  })

  test('пустой результат: иллюстрация и сброс фильтров', async ({ page }) => {
    await openUsers(page)
    await page.getByRole('combobox', { name: 'Поиск пользователей' }).fill('nobody')
    await expect(page.getByRole('heading', { name: 'По этим условиям никого нет' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Поиск пользователей' }).press('Escape')
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()
    await expect(page.getByRole('cell', { name: /alina@example\.test/ })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Поиск пользователей' })).toHaveValue('')
  })

  test('телефон: страница не прокручивается вбок', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openUsers(page)
    await expectNoPageOverflow(page)
    await page.getByRole('button', { name: /Показать фильтры/ }).click()
    await expect(page.getByRole('slider', { name: 'Баланс до' })).toBeVisible()
    await expectNoPageOverflow(page)
    await page.getByRole('checkbox', { name: 'Выбрать: Алина Смирнова' }).check()
    await expect(page.getByRole('region', { name: 'Действия с выбранными' })).toBeVisible()
    await expectNoPageOverflow(page)
  })
})
