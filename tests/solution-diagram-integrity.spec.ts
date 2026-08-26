import { expect, test } from '@playwright/test'

const storageKey = 'homework-copilot:generated-solutions-v1'
const edition = '14-е издание, Просвещение, 2023'
const sourceUrl = '/textbooks/geometry-7-9-atanasyan.pdf'

function solution(task: string, condition: string) {
  const isTask50 = task === '50'

  return {
    textbookId: 'geometry',
    task,
    source: 'number',
    textbookEdition: edition,
    sourceUrl,
    sourcePage: task === '50' ? 23 : 9,
    conditionNormalized: condition.toLocaleLowerCase('ru-RU'),
    subject: 'Геометрия',
    textbookTitle: 'Геометрия. 7-9 классы',
    condition,
    given: isTask50
      ? ['∠AOX = 40°', '∠BOX = 60°', '∠COX = 80°']
      : ['Три прямые a, b, c', 'Каждые две прямые пересекаются'],
    goal: isTask50
      ? { title: 'Найти', text: 'остальные углы' }
      : { title: 'Найти', text: 'количество точек пересечения' },
    steps: isTask50
      ? [
          'По шкале транспортира: ∠AOX = 40°, ∠BOX = 60°, ∠COX = 80°, ∠DOX = 130°.',
          '∠AOB = 60° − 40° = 20°.',
          '∠COB = 80° − 60° = 20°.',
        ]
      : [
          'Случай 1: Прямые не проходят через одну точку. Каждая пара прямых пересекается в отдельной точке. Итого 3 точки.',
          'Случай 2: Все три прямые проходят через одну общую точку. Итого 1 точка.',
          'Вывод: Получается либо 3 точки, либо 1 точка.',
        ],
    answer: isTask50 ? '∠AOB = ∠COB = 20°' : '3 точки или 1 точка',
    diagram: {
      kind: 'triangle',
      description: 'Ошибочный шаблонный треугольник ABC',
      vertices: ['A', 'B', 'C'],
    },
    sourceVerified: true,
    createdAt: '2026-08-26T12:00:00.000Z',
  }
}

function trackRuntimeFailures(page: import('@playwright/test').Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedResponses: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`.trim())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.failure()?.errorText ?? 'request failed'} ${request.url()}`)
  })

  return { consoleErrors, pageErrors, failedResponses, failedRequests }
}

async function seedSolution(page: import('@playwright/test').Page, value: ReturnType<typeof solution>) {
  await page.addInitScript(({ key, storedSolution }) => {
    window.localStorage.setItem(key, JSON.stringify([storedSolution]))
  }, { key: storageKey, storedSolution: value })
}

async function mockTaskLookup(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/homework_solution_catalog*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/rest/v1/rpc/get_verified_homework_task', async (route) => {
    const body = route.request().postDataJSON() as { p_task?: string }
    const isDiagramTask = body.p_task === '50'
    const condition = body.p_task === '4'
      ? 'Отметьте точки A, B, C, D так, чтобы точки A, B, C лежали на одной прямой, а точка D не лежала на ней. Через каждые две точки проведите прямую. Сколько получилось прямых?'
      : isDiagramTask
        ? 'На рисунке 43 изображены лучи с общим началом O.'
        : 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        condition,
        condition_normalized: condition.toLocaleLowerCase('ru-RU'),
        source_url: sourceUrl,
        source_page: isDiagramTask ? 23 : 9,
        source_region: isDiagramTask
          ? { page: 23, x: 94, y: 457, width: 696, height: 177, sourceWidth: 827, sourceHeight: 1100 }
          : { page: 9, x: 94, y: 724, width: 696, height: 79, sourceWidth: 827, sourceHeight: 1100 },
        diagram_regions: isDiagramTask
          ? [{ figure: 43, page: 23, x: 515, y: 135, width: 250, height: 200, sourceWidth: 828, sourceHeight: 1096 }]
          : [],
        ocr_confidence: 95,
        has_diagram: isDiagramTask,
      }]),
    })
  })
}

test('task 3 renders the two correct intersection cases and fits on one sheet', async ({ page }, testInfo) => {
  const failures = trackRuntimeFailures(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const condition = 'Проведите три прямые так, чтобы каждые две из них пересекались. Обозначьте все точки пересечения этих прямых. Сколько получилось точек? Рассмотрите все возможные случаи.'
  await seedSolution(page, solution('3', condition))
  await mockTaskLookup(page)

  await page.goto('/solutions/geometry/3')

  await expect(page.getByRole('heading', { name: 'Решение № 3' })).toBeVisible()
  await expect(page.getByTestId('geometry-notebook-page')).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Два случая пересечения трёх прямых: три разные точки и одна общая точка.' })).toBeVisible()
  await expect(page.locator('.geometry-diagram')).toHaveCount(1)
  await expect(page.locator('.source-diagram-image')).toHaveCount(0)
  await expect(page.getByText('Решение. (продолжение)')).toHaveCount(0)
  await expect(page.getByText('Ответ: 1 или 3 точки')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('task-3-mobile.png'), fullPage: true })
  expect(failures).toEqual({ consoleErrors: [], pageErrors: [], failedResponses: [], failedRequests: [] })
})

test('task 4 uses symbols, the correct four-line drawing, and no grey side fields', async ({ page }, testInfo) => {
  const failures = trackRuntimeFailures(page)
  await page.setViewportSize({ width: 730, height: 900 })
  const condition = 'Отметьте точки A, B, C, D так, чтобы точки A, B, C лежали на одной прямой, а точка D не лежала на ней. Через каждые две точки проведите прямую. Сколько получилось прямых?'
  await seedSolution(page, solution('4', condition))
  await mockTaskLookup(page)

  await page.goto('/solutions/geometry/4')

  await expect(page.getByRole('heading', { name: 'Решение № 4' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Точки A, B, C лежат на прямой a, точка D не лежит на ней; проведены прямые AD, BD и CD.' })).toBeVisible()
  await expect(page.getByText('A, B, C ∈ a')).toBeVisible()
  await expect(page.getByText('D ∉ a')).toBeVisible()
  await expect(page.getByText('n = n₁ + n₂ = 1 + 3 = 4.')).toBeVisible()
  await expect(page.getByText('Ответ: 4 прямые')).toBeVisible()
  await expect(page.locator('.source-diagram-image')).toHaveCount(0)
  await expect(page.getByTestId('geometry-notebook-page')).toHaveCount(1)

  const widths = await page.locator('.solution-notebook-preview').evaluate((preview) => {
    const pageElement = preview.querySelector<HTMLElement>('.geometry-notebook-page')
    return {
      preview: preview.getBoundingClientRect().width,
      notebook: pageElement?.getBoundingClientRect().width ?? 0,
      background: getComputedStyle(preview).backgroundColor,
    }
  })
  expect(Math.abs(widths.preview - widths.notebook)).toBeLessThanOrEqual(2)
  expect(widths.background).toBe('rgba(0, 0, 0, 0)')

  const overflowingText = await page.locator('.geometry-notebook-page text').evaluateAll((elements) => elements
    .map((element) => ({ text: element.textContent, right: (element as SVGGraphicsElement).getBBox().x + (element as SVGGraphicsElement).getBBox().width }))
    .filter((entry) => entry.right > 1086))
  expect(overflowingText).toEqual([])

  await page.getByTestId('geometry-notebook-page').screenshot({ path: testInfo.outputPath('task-4-sheet.png') })
  await page.screenshot({ path: testInfo.outputPath('task-4-correct.png'), fullPage: true })
  expect(failures).toEqual({ consoleErrors: [], pageErrors: [], failedResponses: [], failedRequests: [] })
})

test('task 50 replaces a stale generated triangle with the exact PDF crop', async ({ page }, testInfo) => {
  const failures = trackRuntimeFailures(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedSolution(page, solution('50', 'На рисунке 43 изображены лучи с общим началом O.'))
  await mockTaskLookup(page)

  await page.goto('/solutions/geometry/50')

  const sourceDiagram = page.getByRole('img', { name: 'Исходный рисунок 43 из учебника для задачи № 50' })
  await expect(sourceDiagram).toBeVisible({ timeout: 30_000 })
  await expect(sourceDiagram).toHaveAttribute('href', /^data:image\/jpeg;base64,/)
  await expect(page.locator('.geometry-diagram')).toHaveCount(0)
  await expect(page.getByTestId('geometry-notebook-page')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('task-50-desktop.png'), fullPage: true })
  expect(failures).toEqual({ consoleErrors: [], pageErrors: [], failedResponses: [], failedRequests: [] })
})
