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

    const subject = page.getByLabel('Предмет, понедельник, урок 1')
    await subject.fill('Математика')
    await expect(subject).toHaveValue('Математика')

    const before = await page.getByRole('row').count()
    await page.getByRole('button', { name: 'Добавить урок' }).click()
    await expect(page.getByRole('row')).toHaveCount(before + 1)

    await page.getByRole('button', { name: 'Включить тёмную тему' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('на телефоне листается внутри таблицы', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSchedule(page)

    const sizes = await page.evaluate(() => {
      const scroller = document.querySelector('.schedule-table-scroll') as HTMLElement
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        tableScrollWidth: scroller.scrollWidth,
        tableClientWidth: scroller.clientWidth,
      }
    })

    expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.viewportWidth)
    expect(sizes.tableScrollWidth).toBeGreaterThan(sizes.tableClientWidth)
    await expect(page.getByText('Всё сохраняется на этом устройстве')).toBeVisible()
  })
})
