import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { mockSupabase, signIn } from './adminMocks'

/* Раздел «Настройки» без настоящей базы: ответы Supabase и функции админки
   подменяются на уровне сети. Маршруты, объявленные в тесте позже
   mockSupabase, перекрывают общие фикстуры.

   С ADMIN_SHOTS_DIR тест ещё и снимает состояния раздела для разбора
   дизайна; без переменной снимков нет. */

const shotsDir = process.env.ADMIN_SHOTS_DIR

async function shot(page: Page, name: string, fullPage = true) {
  if (!shotsDir) return
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${shotsDir}/settings-${name}.png`, fullPage })
}

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const overview = {
  plans: [{ id: 'base', title: 'Базовый', description: 'Оплата за каждое решение с баланса.', priceKopecks: 0, periodDays: 30, dailySolveLimit: 60, features: [], isDefault: true, active: true, sort: 0, updatedAt: ago(5000), users: 0 }],
  subjects: [{ id: 'mathematics', enabled: true, sort: 0, promptVersion: 2 }, { id: 'physics', enabled: true, sort: 1, promptVersion: null }],
  flags: [
    { key: 'ai_chat', description: 'ИИ-чат: раздел и отправка сообщений', enabled: true, rolloutPercent: 100, updatedAt: ago(5000) },
    { key: 'photo_input', description: 'Постановка задачи фотографией', enabled: true, rolloutPercent: 100, updatedAt: ago(5000) },
    { key: 'schedule', description: 'Раздел «Расписание»', enabled: true, rolloutPercent: 30, updatedAt: ago(5000) },
    { key: 'solution_rating', description: 'Оценка решения', enabled: false, rolloutPercent: 100, updatedAt: ago(5000) },
  ],
  settings: { site_banner: { enabled: false, text: '', tone: 'info', link: '' }, support_sla_minutes: 30 },
}

const solution = (answer: string) => ({
  given: ['2x + 3 = 11'],
  goal: { title: 'Найти', text: 'x' },
  explanation: ['Переносим 3 в правую часть и делим на 2.'],
  steps: ['2x = 11 - 3', '2x = 8', 'x = 4'],
  answer,
  code: null,
  form: 'notebook',
  reviewPassed: true,
  issues: [],
  hasDiagram: false,
})

const previewResponse = {
  id: 'preview-1',
  credits: 2.4,
  kopecks: 103,
  seconds: 41.2,
  runs: [
    { variant: 'draft', promptVersion: null, hadPrompt: true, ok: true, error: null, seconds: 41.2, calls: 1, credits: 1.3, kopecks: 56, models: 'gpt-5-6-sol', solution: solution('x = 4') },
    { variant: 'current', promptVersion: 2, hadPrompt: true, ok: true, error: null, seconds: 38.5, calls: 1, credits: 1.1, kopecks: 47, models: 'gpt-5-6-sol', solution: solution('x = 4, проверка: 2 · 4 + 3 = 11') },
  ],
}

async function mockSettings(page: Page) {
  await mockSupabase(page)
  await page.route(/\/rest\/v1\/rpc\/admin_settings_overview/, (route) => route.fulfill({ json: overview }))
  await page.route(/\/rest\/v1\/rpc\/admin_prompt_action/, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.p_action !== 'list') return route.fulfill({ json: {} })
    return route.fulfill({
      json: body.p_subject_id === 'mathematics'
        ? [{ id: 'prompt-2', subjectId: 'mathematics', version: 2, body: 'Пиши подробно.', note: null, active: true, authorEmail: 'owner@example.test', createdAt: ago(600) }]
        : [],
    })
  })
}

async function mockPreview(page: Page, onBody: (body: Record<string, unknown>) => void = () => {}) {
  await page.route(/\/api\/admin(\?.*)?$/, (route: Route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' })
    onBody(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ headers, json: previewResponse })
  })
}

async function runPreview(page: Page) {
  await expect(page.getByRole('heading', { name: 'Активная версия 2' })).toBeVisible()
  await page.getByLabel('Текст промпта').fill('Пиши коротко.')
  await page.getByLabel('Пример задачи').fill('Решите уравнение 2x + 3 = 11 и сделайте проверку.')
  await expect(page.getByLabel(/Сравнить с активной версией 2/)).toBeChecked()
  const run = page.getByRole('button', { name: 'Проверить (стоит ~2,5 кредита)' })
  await expect(run).toBeEnabled()
  await run.click()
  const dialog = page.getByRole('dialog', { name: 'Запустить проверку промпта?' })
  await expect(dialog.getByText('с кошелька ничего не списывается', { exact: false })).toBeVisible()
  return dialog
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

test.describe('админка: настройки', () => {
  test('тарифы и промокоды: честный статус, пустые состояния, шаблоны, история', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockSettings(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await page.goto('/admin?section=settings')
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible()
    await expect(page.getByText('Платёжного провайдера пока нет - тарифы работают без оплаты', { exact: false })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Других тарифов пока нет' })).toBeVisible()
    await expect(page.getByText('всем без другого')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'История изменений' })).toBeVisible()
    await expect(page.getByText('решений в сутки: 50 → 60')).toBeVisible()
    await shot(page, 'plans')

    await page.getByRole('tab', { name: 'Промокоды' }).click()
    await expect(page).toHaveURL(/set_tab=promo/)
    await expect(page.getByRole('heading', { name: 'Промокодов пока нет' })).toBeVisible()
    await expect(page.getByText('Изменений пока не было', { exact: false })).toBeVisible()
    await shot(page, 'promo-empty')
    await page.getByRole('button', { name: 'Создать промокод' }).click()
    const drawer = page.getByRole('dialog', { name: 'Новый промокод' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: '+50 ₽ на баланс' }).click()
    await expect(drawer.getByRole('textbox', { name: /^Код/ })).toHaveValue('PLUS50')
    await expect(drawer.getByLabel('Сумма, ₽')).toHaveValue('50')
    await expect(drawer.getByRole('button', { name: '+50 ₽ на баланс' })).toHaveAttribute('aria-pressed', 'true')
    await expect(drawer.getByText('Шаблон «тариф на 7 дней» появится', { exact: false })).toBeVisible()
    await shot(page, 'promo-template', false)

    await page.getByRole('button', { name: 'Закрыть' }).click()
    await page.getByRole('button', { name: 'Весь журнал' }).click()
    await expect(page).toHaveURL(/section=audit/)
    await expect(page).toHaveURL(/a_event=promo_saved/)
    expect(errors).toEqual([])
  })

  test('фиче-флаги: поиск, фильтр в адресе и массовое выключение', async ({ page }) => {
    await mockSettings(page)
    let bulkBody: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_flags_bulk/, (route: Route) => {
      bulkBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { selected: 2, changed: 2 } })
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=settings&set_tab=flags')

    const table = page.locator('.adm-table')
    await expect(table.getByText('solution_rating')).toBeVisible()
    await page.getByLabel('Поиск').fill('расписан')
    await expect(table.getByText('schedule', { exact: true })).toBeVisible()
    await expect(table.getByText('ai_chat')).toHaveCount(0)
    await page.getByLabel('Поиск').fill('')

    await page.getByRole('button', { name: 'Частично · 1' }).click()
    await expect(page).toHaveURL(/f_state=partial/)
    await expect(table.getByText('schedule', { exact: true })).toBeVisible()
    await expect(table.getByText('photo_input')).toHaveCount(0)
    await page.getByRole('button', { name: 'Все · 4' }).click()

    await page.getByLabel('Выбрать: ai_chat').check()
    await page.getByLabel('Выбрать: schedule').check()
    const bar = page.getByRole('region', { name: 'Действия с выбранными флагами' })
    await expect(bar.getByText('Выбрано: 2')).toBeVisible()
    await shot(page, 'flags-selected')
    await bar.getByRole('button', { name: 'Выключить' }).click()

    const dialog = page.getByRole('dialog', { name: 'Выключить флаги?' })
    await expect(dialog.getByText('всем → выключен')).toBeVisible()
    await expect(dialog.getByText('30 % → выключен')).toBeVisible()
    await shot(page, 'flags-bulk-confirm', false)
    await dialog.getByRole('button', { name: 'Выключить', exact: true }).click()
    await expect(page.getByText('Изменено флагов: 2 из 2.')).toBeVisible()
    expect(bulkBody).toMatchObject({ p_keys: ['ai_chat', 'schedule'], p_action: 'disable' })
    await expect(bar).toHaveCount(0)
    await expect(page.getByText('Изменён фиче-флаг').first()).toBeVisible()
  })

  test('промпт: проверка на примере с ценой, подтверждением и сравнением было/стало', async ({ page }) => {
    await mockSettings(page)
    let previewBody: Record<string, unknown> | null = null
    await mockPreview(page, (body) => { previewBody = body })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=settings&set_tab=prompts')

    const dialog = await runPreview(page)
    await expect(dialog.getByText('самое дорогое - 2,2 кредита', { exact: false })).toBeVisible()
    await shot(page, 'prompt-confirm', false)
    await dialog.getByRole('button', { name: 'Проверить за ~2,5 кредита' }).click()

    await expect(page.getByRole('heading', { name: 'Было: версия 2' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Стало: текст из редактора' })).toBeVisible()
    await expect(page.getByText('x = 4, проверка: 2 · 4 + 3 = 11')).toBeVisible()
    expect(previewBody).toMatchObject({ action: 'prompt_preview', subjectId: 'mathematics', grade: '8 класс', prompt: 'Пиши коротко.', compare: true })
    await page.getByText('Что поменялось в промпте', { exact: false }).click()
    await expect(page.locator('.set-diff .is-add')).toHaveText('+ Пиши коротко.')
    await shot(page, 'prompt-result')
  })

  test('на телефоне вкладки - список, выбор пишется в адрес, страница не шире экрана', async ({ page }) => {
    await mockSettings(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/admin?section=settings')

    const picker = page.getByLabel('Раздел настроек')
    await expect(picker).toBeVisible()
    await expect(page.getByRole('tablist')).toBeHidden()
    await picker.selectOption('flags')
    await expect(page).toHaveURL(/set_tab=flags/)
    await expect(page.getByRole('heading', { name: 'Фиче-флаги' })).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'mobile-flags', false)
    await picker.selectOption('promo')
    await expect(page.getByRole('heading', { name: 'Промокодов пока нет' })).toBeVisible()
    await expectNoPageOverflow(page)
    await shot(page, 'mobile-promo')
  })

  test('на среднем экране полоса вкладок показывает край, за которым есть ещё вкладки', async ({ page }) => {
    await mockSettings(page)
    await page.setViewportSize({ width: 1024, height: 800 })
    await signIn(page)
    await page.goto('/admin?section=settings')
    await expect(page.getByRole('tablist')).toBeVisible()
    const state = await page.locator('.set-tabs-scroll').evaluate((node) => {
      const list = node.querySelector<HTMLElement>('.adm-tabs')
      return { overflow: list ? list.scrollWidth > list.clientWidth + 1 : false, hint: node.classList.contains('has-end') }
    })
    expect(state.hint).toBe(state.overflow)
    await expectNoPageOverflow(page)
    await shot(page, 'tabs-1024', false)
  })

  test('тёмная тема: пустое состояние и проверка промпта читаются', async ({ page }) => {
    await mockSettings(page)
    await mockPreview(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=settings&set_tab=promo')
    await page.getByRole('button', { name: 'Тёмная тема' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('heading', { name: 'Промокодов пока нет' })).toBeVisible()
    await shot(page, 'dark-promo')
    await page.getByRole('tab', { name: 'Промпты решателя' }).click()
    const dialog = await runPreview(page)
    await dialog.getByRole('button', { name: 'Проверить за ~2,5 кредита' }).click()
    await expect(page.getByRole('heading', { name: 'Было: версия 2' })).toBeVisible()
    await shot(page, 'dark-prompt-result')
    // Тема хранится у браузера: возвращаем светлую, чтобы не влиять на соседние тесты в том же профиле.
    await page.getByRole('button', { name: 'Светлая тема' }).click()
  })
})
