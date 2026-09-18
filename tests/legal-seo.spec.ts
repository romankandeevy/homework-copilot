/* Адреса обходятся по очереди одной вкладкой: каждый шаг зависит от предыдущего. */
/* eslint-disable no-await-in-loop */
import { expect, test } from './fixtures'

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}

/* С 14 сентября 2026 документы живут под /docs/. */
const documentPaths = ['/docs/terms', '/docs/privacy', '/docs/consent', '/docs/cookies', '/docs/offer', '/docs/refund', '/docs/contacts']

/* Прежние адреса уже в письмах, отметках согласия и поиске - обязаны
   открывать тот же документ. */
const legacyAddresses: [string, string][] = [
  ['/terms', '/docs/terms'],
  ['/agreement', '/docs/terms'],
  ['/privacy', '/docs/privacy'],
  ['/consent', '/docs/consent'],
  ['/cookies', '/docs/cookies'],
  ['/offer', '/docs/offer'],
  ['/contacts', '/docs/contacts'],
  ['/docs', '/docs/terms'],
]

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
]) {
  test(`legal pages and storage notice remain usable at ${viewport.width}px`, async ({ page }) => {
    // Документ живёт в том же чанке приложения, что и /app: первый заход в
    // файле часто попадает на холодный dev-сервер (CLAUDE.md, «первая
    // загрузка страницы в dev медленная»), а тест открывает три документа
    // подряд. Запас по времени - не ослабление проверки, а место для
    // одноразовой компиляции.
    test.setTimeout(90_000)
    const consoleErrors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.setViewportSize(viewport)
    await page.goto('/docs/privacy')

    await expect(page.getByRole('heading', { name: 'Политика обработки персональных данных' })).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/docs/privacy')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
    await page.getByRole('button', { name: 'Закрыть уведомление' }).click()
    const footer = page.locator('.site-footer')
    await expect(footer.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute('href', '/docs/terms')
    await expect(footer.getByRole('link', { name: 'Cookie и хранилище' })).toHaveAttribute('href', '/docs/cookies')
    await expect(footer.getByRole('link', { name: 'Публичная оферта' })).toHaveAttribute('href', '/docs/offer')
    await expectNoPageOverflow(page)

    await page.goto('/docs/cookies')
    await expect(page.getByRole('heading', { name: 'Cookie и локальное хранение' })).toBeVisible()
    await expect(page.getByText('Homework Copilot не устанавливает рекламные или аналитические cookie.')).toBeVisible()
    await expectNoPageOverflow(page)

    await page.goto('/docs/offer')
    await expect(page.getByRole('heading', { name: 'Публичная оферта' })).toBeVisible()
    /* С 14 сентября 2026 оферта действующая: акцепт - оплата заказа
       пополнения, возврат остатка - раздел 12. */
    await expect(page.getByText(/в момент оплаты пользователем Заказа пополнения/)).toBeVisible()
    await expect(page.getByRole('heading', { name: '12. Возврат неиспользованного остатка' })).toBeVisible()
    await expectNoPageOverflow(page)
    expect(consoleErrors).toEqual([])
  })
}

test('old document addresses open the same document under /docs/', async ({ page }) => {
  // Девять переходов подряд, каждый - полная перезагрузка страницы (проверяем
  // прямой заход по старому адресу, а не переход внутри приложения): та же
  // оговорка про холодный dev-сервер, что и у проверки выше, только помноженная
  // на число адресов.
  test.setTimeout(120_000)
  for (const [legacy, target] of legacyAddresses) {
    await page.goto(legacy)
    await expect(page).toHaveURL(new RegExp(`${target}$`))
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://www.homeworkcopilot.ru${target}`)
  }

  // Якорь едет вместе с адресом: окно баланса ссылается на «Оплату и возвраты».
  await page.goto('/terms#section-8')
  await expect(page).toHaveURL(/\/docs\/terms#section-8$/)
  await expect(page.locator('#section-8 h2')).toHaveText('8. Оплата и возвраты')
  await expect(page.locator('#section-8 h2')).toBeInViewport()
})

test('every document lists all seven, marks the open one and has no tables', async ({ page }) => {
  // Семь полных перезагрузок подряд: та же оговорка, что и выше.
  test.setTimeout(120_000)
  for (const path of documentPaths) {
    await page.goto(path)
    const documents = page.getByRole('navigation', { name: 'Юридические документы' })
    await expect(documents.getByRole('link')).toHaveCount(7)
    await expect(documents.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(documents.locator('[aria-current="page"]')).toHaveAttribute('href', path)
    await expect(page.locator('table')).toHaveCount(0)
    await expect(page.locator('.legal-sections section:not([id^="section-"])')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Вернуться в сервис' })).toHaveAttribute('href', '/app')
  }
})

test('on a phone the document list leaves the title on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/docs/privacy')
  const list = await page.getByRole('navigation', { name: 'Юридические документы' }).boundingBox()
  expect(list?.height ?? 812).toBeLessThan(812 / 3)
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
  await expectNoPageOverflow(page)
})

test('private routes receive noindex metadata', async ({ page }) => {
  await page.goto('/support')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.homeworkcopilot.ru/support')
})
