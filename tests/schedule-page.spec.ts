import { expect, test } from '@playwright/test'

async function openSchedule(page: import('@playwright/test').Page) {
  await page.goto('/app')
  await page.getByRole('navigation', { name: 'Основная навигация' })
    .getByRole('link', { name: 'Расписание', exact: true })
    .click()
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

  test('суббота убирается и возвращается, выбор переживает перезагрузку', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openSchedule(page)

    await page.getByLabel('Предмет, суббота, урок 1 в недельной таблице').fill('Химия')
    await page.getByRole('button', { name: 'Убрать субботу' }).click()
    await expect(page.getByRole('columnheader', { name: 'Суббота' })).toHaveCount(0)
    await expect(page.getByText('7 уроков · 5 дней')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Суббота' })).toHaveCount(0)

    // Уроки убранной субботы не стираются.
    await page.getByRole('button', { name: 'Вернуть субботу' }).click()
    await expect(page.getByLabel('Предмет, суббота, урок 1 в недельной таблице')).toHaveValue('Химия')
  })

  test('прежнее расписание без настройки субботы читается как есть', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/app')
    await page.evaluate(() => {
      window.localStorage.setItem('homework-copilot:schedule-v1', JSON.stringify([
        { id: 'old-1', day: 'saturday', time: '08:30-09:15', subject: 'Физика', room: '12' },
      ]))
    })
    await openSchedule(page)

    await expect(page.getByRole('columnheader', { name: 'Суббота' })).toBeVisible()
    await expect(page.getByLabel('Предмет, суббота, урок 1 в недельной таблице')).toHaveValue('Физика')
  })

  test('время урока подписано и понимает запись с точкой', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openSchedule(page)

    await expect(page.getByRole('columnheader', { name: /Время урока/ })).toContainText('одно на все дни')
    const start = page.getByLabel('Начало урока 1 в недельной таблице')
    await start.fill('8.15')
    await start.press('Enter')
    await expect(start).toHaveValue('08:15')
    // Конец раньше начала не принимается: поле возвращает прежнее время.
    const end = page.getByLabel('Конец урока 1 в недельной таблице')
    await end.fill('7:00')
    await end.press('Enter')
    await expect(end).toHaveValue('09:15')
    await expect(page.getByText('Сохранено в аккаунте')).toHaveCount(0)
  })

  test('на телефоне переключает дни без горизонтальной таблицы', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSchedule(page)

    await expect(page.locator('.schedule-table-scroll')).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Пн' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Пт' }).click()
    await expect(page.getByRole('tab', { name: 'Пт' })).toHaveAttribute('aria-selected', 'true')
    // Расписание нового ученика пустое: демо-класс больше не подставляется.
    const friday = page.getByLabel('Предмет, пятница, урок 1', { exact: true })
    await expect(friday).toHaveValue('')
    await friday.fill('Химия')
    await expect(friday).toHaveValue('Химия')
    const widths = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }))
    expect(widths.documentWidth).toBeLessThanOrEqual(widths.viewportWidth)
    // Хранение только в браузере - предостережение, а не успех: смысл фразы
    // в том, что при смене телефона расписания не будет.
    await expect(page.getByText(/Только в этом браузере/)).toBeVisible()

    await page.getByRole('tab', { name: 'Сб' }).click()
    await page.getByRole('button', { name: 'Убрать субботу' }).click()
    await expect(page.getByRole('tab', { name: 'Сб' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Пт' })).toHaveAttribute('aria-selected', 'true')
  })
})
