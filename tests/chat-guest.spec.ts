import { expect, test } from '@playwright/test'

/* Гость открывает чат.

   8 сентября на проде незалогиненный видел красное «Чат не загрузился» и
   строку «permission denied for function list_chat_models». Функция списка
   моделей намеренно выдана только вошедшим - чат платный, - а страница
   звала её сразу при открытии. Приглашение войти не показывалось никогда:
   оно ждёт готового списка моделей, а статус был «ошибка». */
test('гость видит приглашение войти, а не ошибку прав', async ({ page }) => {
  const failedRpc: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/list_chat_models')) failedRpc.push(request.url())
  })

  await page.goto('/chat')

  await expect(page.getByRole('heading', { name: 'ИИ-чат' })).toBeVisible()
  await expect(page.getByText('Чат не загрузился')).toHaveCount(0)
  await expect(page.getByText('permission denied', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Модели пока недоступны.')).toHaveCount(0)

  // Списка моделей у гостя не спрашиваем вовсе: он на него не имеет прав.
  expect(failedRpc).toEqual([])
})
