import { expect, test } from '@playwright/test'

async function openSchedule(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Расписание' }).click()
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
}

test.describe('недельное расписание', () => {
  test('показывает всю неделю и редактирует ячейки', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openSchedule(page)

    await expect(page.getByRole('columnheader', { name: 'Понедельник' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Суббота' })).toBeVisible()
    await expect(page.getByLabel('Начало урока 1 в недельной таблице')).toHaveValue('08:30')
    await expect(page.getByLabel('Конец урока 1 в недельной таблице')).toHaveValue('09:15')

    const subject = page.getByLabel('Предмет, понедельник, урок 1 в недельной таблице')
    await subject.fill('Математика')
    await expect(subject).toHaveValue('Математика')

    await expect(page.getByRole('button', { name: 'Добавить урок' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Включить тёмную тему' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('сохраняет расписание после обновления страницы', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openSchedule(page)

    const subject = page.getByLabel('Предмет, понедельник, урок 1 в недельной таблице')
    await subject.fill('История')
    await expect(subject).toHaveValue('История')

    await expect(page).toHaveURL(/\/schedule$/)
    await page.reload()
    await expect(page).toHaveURL(/\/schedule$/)
    await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
    await expect(page.getByLabel('Предмет, понедельник, урок 1 в недельной таблице')).toHaveValue('История')
  })

  test('на телефоне переключает дни без горизонтальной таблицы', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSchedule(page)

    await expect(page.locator('.schedule-table-scroll')).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Пн' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Пт' }).click()
    await expect(page.getByRole('tab', { name: 'Пт' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Предмет, пятница, урок 1', { exact: true })).toHaveValue('Химия')
    const widths = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }))
    expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth)
    await expect(page.getByText('Сохраняется в этом браузере')).toBeVisible()
  })
})
