import { expect, test } from '@playwright/test'

async function openTextbooks(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Учебники', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeVisible()
}

test.describe('учебники', () => {
  test('выбирает несколько задач с клавиатуры и просит вход перед запуском очереди', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    const firstTask = page.getByRole('button', { name: 'Задача № 1 · 5 ₽' })
    await firstTask.focus()
    await page.keyboard.press('Space')
    await expect(firstTask).toHaveAttribute('aria-pressed', 'true')

    const nextTask = page.getByRole('button', { name: 'Задача № 2 · 5 ₽' })
    await nextTask.click()
    await expect(nextTask).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Решить выбранные · 2' })).toBeEnabled()
    await expect(page.getByText('2 задачи · 10 ₽')).toBeVisible()

    await page.getByRole('button', { name: 'Решить выбранные · 2' }).click()
    await expect(page.getByRole('dialog', { name: /Войди в аккаунт/ })).toBeVisible()
    await expect(page.getByText('Войди в аккаунт и проверь баланс, чтобы запустить очередь.')).toBeVisible()
  })

  test('открывает геометрию из превью без выдуманных страниц', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    await page.getByRole('button', { name: '02 Площадь', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Площадь' })).toBeVisible()
    await expect(page.getByText('Глава 02 · Формула и разбиение')).toBeVisible()
    await page.getByRole('button', { name: 'Открыть учебник' }).click()
    const reader = page.getByRole('region', { name: 'Учебник: Геометрия. 7-9 классы' })
    await expect(reader).toHaveAttribute('data-pdf-source', '/textbooks/geometry-7-9-atanasyan.pdf')
    await expect(page.getByRole('button', { name: 'Показать точный скан' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Полный скан · 417 страниц')).toBeVisible()
    await expect(reader.locator('.textbook-pdf-page.is-visible')).toBeVisible()
    await expect(reader.getByRole('status')).toHaveCount(0)
    const fittedPage = await reader.locator('.textbook-pdf-viewport').evaluate((viewport) => {
      const page = viewport.querySelector('.textbook-pdf-page')!
      const viewportBox = viewport.getBoundingClientRect()
      const pageBox = page.getBoundingClientRect()
      return {
        clientWidth: viewport.clientWidth,
        scrollWidth: viewport.scrollWidth,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        pageTop: pageBox.top,
        pageBottom: pageBox.bottom,
        viewportTop: viewportBox.top,
        viewportBottom: viewportBox.bottom,
      }
    })
    expect(fittedPage.scrollWidth).toBeLessThanOrEqual(fittedPage.clientWidth)
    expect(fittedPage.scrollHeight).toBeLessThanOrEqual(fittedPage.clientHeight)
    expect(fittedPage.pageTop).toBeGreaterThanOrEqual(fittedPage.viewportTop)
    expect(fittedPage.pageBottom).toBeLessThanOrEqual(fittedPage.viewportBottom)
    await expect(page.getByRole('button', { name: 'Следующая страница' })).toBeEnabled()
    await expect(page.locator('iframe')).toHaveCount(0)
    await page.getByRole('button', { name: 'Следующая страница' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Номер страницы' })).toHaveValue('2')
    await page.getByRole('button', { name: 'К превью' }).click()
    await expect(page.getByRole('heading', { name: 'Площадь' })).toBeVisible()
    await expect(page.getByText('1 / 2', { exact: true })).toHaveCount(0)
  })

  test('сохраняет точный скан и показывает OCR-текст только по запросу', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'homework-copilot:textbook-ocr-v1:/textbooks/geometry-7-9-atanasyan.pdf:1',
        JSON.stringify({
          pageNumber: 1,
          confidence: 96,
          blocks: [
            { text: 'НАЧАЛЬНЫЕ ГЕОМЕТРИЧЕСКИЕ СВЕДЕНИЯ', heading: true },
            { text: 'Угол состоит из точки и двух лучей, исходящих из этой точки.', heading: false },
          ],
        }),
      )
    })
    await openTextbooks(page)
    await page.getByRole('button', { name: 'Открыть учебник' }).click()

    await expect(page.getByRole('button', { name: 'Показать точный скан' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.textbook-pdf-page.is-visible')).toBeVisible()
    await page.getByRole('button', { name: 'Показать читаемый текст' }).click()
    await expect(page.getByRole('heading', { name: 'НАЧАЛЬНЫЕ ГЕОМЕТРИЧЕСКИЕ СВЕДЕНИЯ' })).toBeVisible()
    const readableParagraph = page.getByText('Угол состоит из точки и двух лучей, исходящих из этой точки.')
    await expect(readableParagraph).toBeVisible()
    expect(await readableParagraph.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15)
    await expect(page.locator('.textbook-scan-page .textbook-pdf-page.is-visible')).toBeVisible()
    await expect(page.getByText(/Точный порядок, отступы, рисунки, формулы/)).toBeVisible()

    await page.getByRole('button', { name: 'Показать точный скан' }).click()
    await expect(page.locator('.textbook-pdf-page.is-visible')).toBeVisible()
  })

  test('разворот не обрезает название главы и кнопку чтения', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 935 })
    await openTextbooks(page)

    const preview = await page.locator('.textbook-reader-book').evaluate((book) => {
      const cover = book.querySelector('.textbook-reader-cover')!
      const sheet = book.querySelector('.textbook-reader-page-sheet')!
      const title = sheet.querySelector('h2')!
      const action = sheet.querySelector('.textbook-reader-open-book')!
      const button = action.querySelector('button')!
      const bookBox = book.getBoundingClientRect()
      const sheetBox = sheet.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      const actionBox = action.getBoundingClientRect()
      const buttonBox = button.getBoundingClientRect()

      return {
        bookWidth: book.clientWidth,
        bookScrollWidth: book.scrollWidth,
        coverWidth: cover.clientWidth,
        coverScrollWidth: cover.scrollWidth,
        sheetWidth: sheet.clientWidth,
        sheetScrollWidth: sheet.scrollWidth,
        bookRight: bookBox.right,
        sheetRight: sheetBox.right,
        titleRight: titleBox.right,
        titleWidth: title.clientWidth,
        titleScrollWidth: title.scrollWidth,
        actionRight: actionBox.right,
        buttonRight: buttonBox.right,
      }
    })

    expect(preview.bookScrollWidth).toBeLessThanOrEqual(preview.bookWidth)
    expect(preview.coverScrollWidth).toBeLessThanOrEqual(preview.coverWidth)
    expect(preview.sheetScrollWidth).toBeLessThanOrEqual(preview.sheetWidth)
    expect(preview.titleScrollWidth).toBeLessThanOrEqual(preview.titleWidth)
    expect(preview.titleRight).toBeLessThanOrEqual(preview.sheetRight)
    expect(preview.actionRight).toBeLessThanOrEqual(preview.sheetRight)
    expect(preview.buttonRight).toBeLessThanOrEqual(preview.sheetRight)
    expect(preview.sheetRight).toBeLessThanOrEqual(preview.bookRight)
  })

  test('открывает физику из превью', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    await page.locator('.textbook-book-options').getByRole('button', { name: /Физика.*Перышкин/ }).click()
    await expect(page.getByRole('heading', { name: 'Тепловые явления' })).toBeVisible()
    await page.getByRole('button', { name: 'Открыть учебник' }).click()
    const reader = page.getByRole('region', { name: 'Учебник: Физика. 8 класс' })
    await expect(reader).toHaveAttribute('data-pdf-source', '/textbooks/physics-8-peryshkin-2026.pdf')
    await expect(page.getByRole('button', { name: 'Показать точный скан' })).toHaveAttribute('aria-pressed', 'true')
    await expect(reader.locator('input[type="number"]')).toHaveAttribute('max', '255')
    await expect(reader.getByText('Полный скан · 255 страниц')).toBeVisible()
    await expect(reader.locator('.textbook-pdf-page.is-visible')).toBeVisible()
    await expect(reader.locator('.textbook-pdf-page.is-visible')).toBeVisible()
  })

  test('открывает химию из превью', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    await page.locator('.textbook-book-options').getByRole('button', { name: /Химия.*Габриелян/ }).click()
    await expect(page.getByRole('heading', { name: 'Вещество и язык химии' })).toBeVisible()
    await page.getByRole('button', { name: 'Открыть учебник' }).click()
    const reader = page.getByRole('region', { name: 'Учебник: Химия. 8 класс. Базовый уровень' })
    await expect(reader).toHaveAttribute('data-pdf-source', '/textbooks/chemistry-8-gabrielyan-2025.pdf')
    await expect(page.getByRole('button', { name: 'Показать точный скан' })).toHaveAttribute('aria-pressed', 'true')
    await expect(reader.locator('input[type="number"]')).toHaveAttribute('max', '176')
    await expect(reader.getByText('Полный скан · 176 страниц')).toBeVisible()
    await expect(reader.locator('.textbook-pdf-page.is-visible')).toBeVisible()
    await expect(reader.locator('.textbook-pdf-page.is-visible')).toBeVisible()
  })

  test('сохраняет выбранный учебник после обновления', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    const physics = page.locator('.textbook-book-options').getByRole('button', { name: /Физика.*Перышкин/ })
    await physics.click()
    await expect(physics).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/\/textbooks$/)
    await page.reload()
    await expect(page).toHaveURL(/\/textbooks$/)
    await expect(page.getByRole('heading', { name: 'Учебник без лишнего шума' })).toBeVisible()
    await expect(page.locator('.textbook-book-options').getByRole('button', { name: /Физика.*Перышкин/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('открывает загруженный PDF прямо в читателе', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTextbooks(page)

    await page.locator('#textbook-reader-file').setInputFiles({
      name: 'Геометрия 8.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'),
    })

    await expect(page.getByRole('heading', { name: 'Геометрия 8' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Учебник: Геометрия 8' })).toHaveAttribute('data-pdf-source', /^blob:/)
  })

  test('не переполняется и сохраняет touch-targets на телефоне', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openTextbooks(page)

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      contentWidth: document.querySelector('.product-content')?.scrollWidth,
      contentViewportWidth: document.querySelector('.product-content')?.clientWidth,
    }))
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.contentViewportWidth)

    const tooSmall = await page.locator('.textbook-reader-page button').evaluateAll((buttons) => buttons
      .map((button) => {
        const rect = button.getBoundingClientRect()
        return { label: button.getAttribute('aria-label') || button.textContent || '', width: rect.width, height: rect.height }
      })
      .filter(({ width, height }) => width > 0 && height > 0 && (width < 44 || height < 44)))
    expect(tooSmall).toEqual([])
  })
})
