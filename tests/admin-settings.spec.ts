import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures'
import type { Download, Page, Route } from '@playwright/test'
import { mockSupabase, signIn, studentId } from './adminMocks'

/* Разделы «Настройки» и «Промокоды» без настоящей базы: ответы Supabase и
   функции админки подменяются на уровне сети. Маршруты, объявленные в тесте
   позже mockSupabase, перекрывают общие фикстуры.

   Промокоды с 14 сентября 2026 - свой раздел меню, а не вкладка настроек,
   поэтому старая ссылка на вкладку проверяется здесь же.

   С ADMIN_SHOTS_DIR тест ещё и снимает состояния разделов для разбора
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

function ahead(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString()
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

function promo(code: string, patch: Record<string, unknown> = {}) {
  return {
    code, kind: 'balance', amountKopecks: 5000, planId: null, planDays: null, startsAt: null, expiresAt: null, maxUses: null,
    active: true, note: null, newUsersDays: null, createdAt: ago(1000), uses: 0, lastUsedAt: null, creditedKopecks: 0, paidAfter: 0,
    recent: [], ...patch,
  }
}

/* По коду на каждое состояние и ещё один действующий «только новым»:
   в фильтре 6 всего, 2 действуют, остальные по одному. */
const promoList = [
  promo('NEWBIE', { amountKopecks: 3000, newUsersDays: 7, note: 'Только новым', createdAt: ago(50) }),
  promo('SOON', { startsAt: ahead(600), createdAt: ago(100) }),
  promo('LIMIT1', { maxUses: 1, uses: 1, lastUsedAt: ago(200), creditedKopecks: 5000, createdAt: ago(1500) }),
  promo('OFFCODE', { active: false, createdAt: ago(2000) }),
  promo('PLUS50', {
    note: 'Рассылка в школе №57', uses: 2, lastUsedAt: ago(60), creditedKopecks: 10000, paidAfter: 1, createdAt: ago(3000),
    recent: [{ email: 'alina@example.test', redeemedAt: ago(60) }, { email: '', redeemedAt: ago(300) }],
  }),
  promo('SUMMER', { expiresAt: ago(600), uses: 5, lastUsedAt: ago(700), creditedKopecks: 50000, paidAfter: 2, createdAt: ago(9000) }),
]

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

async function mockPromos(page: Page) {
  await mockSettings(page)
  await page.route(/\/rest\/v1\/rpc\/admin_promo_list/, (route) => route.fulfill({ json: promoList }))
}

/* Фронт выкатили раньше миграции 20260914220000: новых функций в базе нет,
   PostgREST отвечает 404 с кодом PGRST202. */
async function withoutPromoMigration(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/admin_promo_(redemptions|generate|delete)/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({
      status: 404,
      json: { code: 'PGRST202', details: `Searched for the function public.${name}, but no matches were found in the schema cache.`, hint: null, message: `Could not find the function public.${name} in the schema cache` },
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

async function readDownload(download: Download) {
  return readFile(String(await download.path()), 'utf8')
}

// Первая таблица раздела - список кодов; таблица активаций живёт в карточке.
function promoRows(page: Page) {
  return page.locator('.adm-main .adm-table').first().locator('tbody tr')
}

test.describe('админка: настройки', () => {
  test('меню по частоте, «Лимиты и тарифы» с честным текстом, история', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockSettings(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    const rail = page.getByRole('navigation', { name: 'Разделы админки' })
    await expect(rail.locator('.adm-rail-group')).toHaveText(['Каждый день', 'Рост', 'Сайт', 'Система'])
    await expect(rail.getByRole('link', { name: 'Промокоды' })).toHaveAttribute('href', '/admin?section=promo')

    await rail.getByRole('link', { name: 'Настройки' }).click()
    await expect(page.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Лимиты и тарифы' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Промокоды' })).toHaveCount(0)
    await expect(page.getByText('Ученику как тариф не показывается', { exact: false })).toBeVisible()
    await expect(page.getByText('Платёжного провайдера пока нет', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Других тарифов пока нет' })).toBeVisible()
    await expect(page.getByText('всем без другого')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'История изменений' })).toBeVisible()
    await expect(page.getByText('решений в сутки: 50 → 60')).toBeVisible()
    await shot(page, 'plans')
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

  test('на телефоне вкладки - список, выбор пишется в адрес, страницы не шире экрана', async ({ page }) => {
    await mockPromos(page)
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
    await picker.selectOption('site')
    await expect(page.getByRole('heading', { name: 'Баннер на сайте' })).toBeVisible()
    await expectNoPageOverflow(page)

    await page.goto('/admin?section=promo')
    await expect(promoRows(page).first()).toContainText('NEWBIE')
    await expect(page.getByRole('button', { name: 'Исчерпаны · 1' })).toBeVisible()
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

  test('тёмная тема: промокоды и проверка промпта читаются', async ({ page }) => {
    await mockPromos(page)
    await mockPreview(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')
    await page.getByRole('button', { name: 'Тёмная тема' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(promoRows(page).first()).toContainText('NEWBIE')
    await shot(page, 'dark-promo')
    await page.goto('/admin?section=settings&set_tab=prompts')
    const dialog = await runPreview(page)
    await dialog.getByRole('button', { name: 'Проверить за ~2,5 кредита' }).click()
    await expect(page.getByRole('heading', { name: 'Было: версия 2' })).toBeVisible()
    await shot(page, 'dark-prompt-result')
    // Тема хранится у браузера: возвращаем светлую, чтобы не влиять на соседние тесты в том же профиле.
    await page.getByRole('button', { name: 'Светлая тема' }).click()
  })
})

test.describe('админка: промокоды', () => {
  test('старая ссылка на вкладку ведёт в раздел; пустой список, шаблон, история', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockSettings(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)

    await page.goto('/admin?section=settings&set_tab=promo')
    await expect(page).toHaveURL(/\/admin\?section=promo$/)
    await expect(page.getByRole('heading', { name: 'Промокоды', level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Разделы админки' }).getByRole('link', { name: 'Промокоды' })).toHaveAttribute('aria-current', 'page')
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
    await expect(drawer.getByLabel(/Только новым аккаунтам/)).toBeEnabled()
    await shot(page, 'promo-template', false)

    await page.getByRole('button', { name: 'Закрыть' }).click()
    await page.getByRole('button', { name: 'Весь журнал' }).click()
    await expect(page).toHaveURL(/section=audit/)
    await expect(page).toHaveURL(/a_event=promo_saved/)
    expect(errors).toEqual([])
  })

  test('поиск по коду и заметке, фильтр по состоянию с числами, сортировка', async ({ page }) => {
    await mockPromos(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')

    const rows = promoRows(page)
    await expect(rows).toHaveCount(6)
    await expect(rows.first()).toContainText('NEWBIE')
    await expect(rows.first()).toContainText('только новым: до 7 дн.')
    await expect(page.getByRole('group', { name: 'Фильтр по состоянию' }).getByRole('button'))
      .toHaveText(['Все · 6', 'Действуют · 2', 'Не начались · 1', 'Исчерпаны · 1', 'Истекли · 1', 'Выключены · 1'])
    await shot(page, 'promo-list')

    await page.getByLabel('Поиск').fill('школ')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('PLUS50')
    await page.getByLabel('Поиск').fill('summ')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('SUMMER')
    await page.getByLabel('Поиск').fill('такого нет')
    await expect(page.getByText('Под фильтр ничего не попало.')).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить фильтр' }).click()
    await expect(rows).toHaveCount(6)

    await page.getByRole('button', { name: 'Истекли · 1' }).click()
    await expect(page).toHaveURL(/pr_state=expired/)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('истёк')
    await page.getByRole('button', { name: 'Действуют · 2' }).click()
    await expect(rows).toHaveCount(2)
    await page.getByRole('button', { name: 'Все · 6' }).click()

    await page.getByLabel('Порядок').selectOption('credited:desc')
    await expect(page).toHaveURL(/pr_sort=credited/)
    await expect(rows.first()).toContainText('SUMMER')
    await expect(rows.nth(1)).toContainText('PLUS50')

    // Заголовок столбца сортирует тем же состоянием: второй щелчок - по возрастанию.
    const header = page.locator('.adm-main .adm-table').first().getByRole('button', { name: 'Использований' })
    await header.click()
    await expect(page).toHaveURL(/pr_sort=uses/)
    await expect(rows.first()).toContainText('SUMMER')
    await header.click()
    await expect(page).toHaveURL(/pr_dir=asc/)
    await expect(rows.first()).toContainText('NEWBIE')
    await expect(page.getByLabel('Порядок')).toHaveValue('uses:asc')
  })

  test('дублирование: новый код с теми же настройками', async ({ page }) => {
    await mockPromos(page)
    let saved: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_promo_save/, (route: Route) => {
      saved = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: {} })
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')

    await page.getByRole('button', { name: 'Дублировать NEWBIE' }).click()
    const drawer = page.getByRole('dialog', { name: 'Копия кода NEWBIE' })
    await expect(drawer.getByRole('textbox', { name: /^Код/ })).toHaveValue('NEWBIE-2')
    await expect(drawer.getByLabel('Сумма, ₽')).toHaveValue('30')
    await expect(drawer.getByLabel(/Только новым аккаунтам/)).toHaveValue('7')
    await expect(drawer.getByLabel('Заметка')).toHaveValue('Только новым')
    await shot(page, 'promo-duplicate', false)
    await drawer.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Код NEWBIE-2 сохранён.')).toBeVisible()
    expect(saved).toMatchObject({
      p_promo: { code: 'NEWBIE-2', kind: 'balance', amountKopecks: 3000, planId: null, planDays: null, maxUses: null, active: true, note: 'Только новым', newUsersDays: 7 },
    })
    await expect(drawer).toHaveCount(0)
  })

  test('пакет одноразовых кодов: префикс, общие настройки и CSV со ссылками', async ({ page }) => {
    await mockSettings(page)
    let batchBody: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_promo_generate/, (route: Route) => {
      batchBody = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { prefix: 'SCHOOL', count: 3, codes: ['SCHOOL-7F3K9Q', 'SCHOOL-H4M2PX', 'SCHOOL-R8T6WZ'] } })
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')

    await page.getByRole('button', { name: 'Пакет кодов' }).click()
    const drawer = page.getByRole('dialog', { name: 'Пакет одноразовых кодов' })
    await drawer.getByLabel('Префикс').fill('school-')
    await expect(drawer.getByText('SCHOOL-7F3K9Q')).toBeVisible()
    await drawer.getByLabel('Сколько кодов').fill('501')
    await expect(drawer.getByRole('alert')).toHaveText('Кодов в пакете - от 1 до 500.')
    await drawer.getByLabel('Сколько кодов').fill('3')
    await drawer.getByLabel('Сумма, ₽').fill('100')
    await drawer.getByLabel(/Только новым аккаунтам/).fill('7')
    await drawer.getByLabel('Заметка').fill('Школа 57, 8 класс')
    await shot(page, 'promo-batch', false)
    await drawer.getByRole('button', { name: 'Создать коды' }).click()

    await expect(drawer.getByRole('list', { name: 'Созданные коды' }).getByRole('listitem')).toHaveCount(3)
    expect(batchBody).toMatchObject({
      p_batch: { prefix: 'SCHOOL', count: 3, kind: 'balance', amountKopecks: 10000, planId: null, planDays: null, startsAt: null, expiresAt: null, newUsersDays: 7, note: 'Школа 57, 8 класс', active: true },
    })

    const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'Скачать CSV' }).click()])
    expect(download.suggestedFilename()).toMatch(/^promo-SCHOOL-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = await readDownload(download)
    expect(csv).toContain('Код;Ссылка;Что даёт')
    expect(csv).toContain('SCHOOL-H4M2PX')
    expect(csv).toContain('http://127.0.0.1:4173/balance?promo=SCHOOL-R8T6WZ')
    expect(csv).toContain('Школа 57, 8 класс')

    await drawer.getByRole('button', { name: 'Показать в списке' }).click()
    await expect(page).toHaveURL(/pr_q=SCHOOL-/)
    await expect(drawer).toHaveCount(0)
  })

  test('карточка кода: активации со ссылкой на ученика, CSV, ссылка с кодом, удаление неиспользованного', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockPromos(page)
    let deleted: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_promo_delete/, (route: Route) => {
      deleted = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { deleted: true, code: 'OFFCODE' } })
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')

    await promoRows(page).filter({ hasText: 'PLUS50' }).getByText('PLUS50', { exact: true }).click()
    await expect(page).toHaveURL(/pr_code=PLUS50/)
    const used = page.getByRole('dialog', { name: 'Код PLUS50' })
    await expect(used.getByText('Кодом уже пользовались, поэтому удалить его нельзя', { exact: false })).toBeVisible()
    await expect(used.getByRole('button', { name: 'Удалить' })).toHaveCount(0)
    await expect(used.getByRole('button', { name: 'alina@example.test' })).toBeVisible()
    await expect(used.getByRole('button', { name: '+79991234567' })).toBeVisible()
    await expect(used.getByText('Всего 2.', { exact: false })).toBeVisible()
    await shot(page, 'promo-detail', false)

    const [download] = await Promise.all([page.waitForEvent('download'), used.getByRole('button', { name: 'CSV' }).click()])
    const csv = await readDownload(download)
    expect(csv).toContain('alina@example.test')
    expect(csv).toContain('+79991234567')
    expect(csv).toContain('50,00')

    await used.getByRole('button', { name: 'Скопировать ссылку', exact: true }).click()
    await expect(page.getByText('Ссылка скопирована', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/balance?promo=PLUS50')

    await used.getByRole('button', { name: 'alina@example.test' }).click()
    await expect(page).toHaveURL(new RegExp(`user=${studentId}`))
    await page.goto('/admin?section=promo&pr_code=OFFCODE')

    const unused = page.getByRole('dialog', { name: 'Код OFFCODE' })
    await expect(unused.getByText('Код ещё никто не использовал.')).toBeVisible()
    await unused.getByRole('button', { name: 'Удалить', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Удалить код OFFCODE?' })
    await expect(confirm.getByText('Кодом ни разу не пользовались', { exact: false })).toBeVisible()
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByText('Код OFFCODE удалён.')).toBeVisible()
    expect(deleted).toEqual({ p_code: 'OFFCODE' })
    await expect(unused).toHaveCount(0)
    await expect(page).not.toHaveURL(/pr_code=/)
  })

  test('до миграции 20260914220000: спокойная подсказка, старое работает как прежде', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockPromos(page)
    await withoutPromoMigration(page)
    let saved: Record<string, unknown> | null = null
    await page.route(/\/rest\/v1\/rpc\/admin_promo_save/, (route: Route) => {
      saved = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: {} })
    })
    await page.setViewportSize({ width: 1440, height: 960 })
    await signIn(page)
    await page.goto('/admin?section=promo')

    await expect(page.getByRole('note').filter({ hasText: 'Нужно применить миграцию 20260914220000.' }).first()).toBeVisible()
    await expect(promoRows(page)).toHaveCount(6)
    await shot(page, 'promo-before-migration')

    // Включение и поиск - как раньше.
    await promoRows(page).filter({ hasText: 'OFFCODE' }).getByRole('button', { name: 'Включить' }).click()
    await expect(page.getByText('Код OFFCODE включён.')).toBeVisible()
    expect(saved).toMatchObject({ p_promo: { code: 'OFFCODE', active: true } })
    await page.getByLabel('Поиск').fill('plus')
    await expect(promoRows(page)).toHaveCount(1)

    // Пакет кодов ждёт миграции и так и говорит.
    await page.getByRole('button', { name: 'Пакет кодов' }).click()
    const batch = page.getByRole('dialog', { name: 'Пакет одноразовых кодов' })
    await expect(batch.getByText('Нужно применить миграцию 20260914220000.')).toBeVisible()
    await expect(batch.getByRole('button', { name: 'Создать коды' })).toHaveCount(0)
    await batch.getByRole('button', { name: 'Закрыть', exact: true }).last().click()

    // Карточка: последние активации из списка вместо полного, удаление ждёт.
    await promoRows(page).getByText('PLUS50', { exact: true }).click()
    const detail = page.getByRole('dialog', { name: 'Код PLUS50' })
    await expect(detail.getByText('Полный список с выгрузкой появится после миграции 20260914220000', { exact: false })).toBeVisible()
    await expect(detail.getByText('alina@example.test', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')

    // «Только новым аккаунтам» не отправить в базу, которая его не прочтёт.
    await page.getByRole('button', { name: 'Новый код' }).click()
    const form = page.getByRole('dialog', { name: 'Новый промокод' })
    await expect(form.getByLabel(/Только новым аккаунтам/)).toBeDisabled()

    await expect(page.locator('.adm-toast.is-error')).toHaveCount(0)
    await expect(page.locator('.adm-state.is-error')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
