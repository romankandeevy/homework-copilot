import { expect, test } from '@playwright/test'

const phoneViewports = [
  { width: 320, height: 812 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('адаптация под телефон', () => {
  test('тема и профиль находятся справа в верхней навигации', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app')

    const topbar = page.locator('.product-topbar')
    const actions = page.locator('.topbar-actions')
    const theme = actions.getByRole('button', { name: 'Включить тёмную тему' })
    const profile = actions.getByRole('button', { name: 'Войти или зарегистрироваться' })
    const [topbarBox, themeBox, profileBox] = await Promise.all([
      topbar.boundingBox(),
      theme.boundingBox(),
      profile.boundingBox(),
    ])

    expect(topbarBox).not.toBeNull()
    expect(themeBox).not.toBeNull()
    expect(profileBox).not.toBeNull()
    expect(themeBox!.x + themeBox!.width).toBeLessThan(profileBox!.x)
    expect(Math.abs(themeBox!.y - profileBox!.y)).toBeLessThan(1)
    expect(topbarBox!.y).toBe(0)
    expect(topbarBox!.width).toBe(1440)
    await expect(page.locator('.product-sidebar')).toHaveCount(0)
  })

  test('верхняя навигация отмечает активный раздел и остаётся сверху при прокрутке', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app')

    const topbar = page.locator('.product-topbar')
    const navigationItems = topbar.locator('.navigation-item')
    // Разделы — ссылки, а не кнопки: их открывают в новой вкладке и копируют.
    await expect(navigationItems).toHaveCount(4)
    await expect(topbar.getByRole('link', { name: 'Главная' })).toHaveAttribute('href', '/app')
    await expect(topbar.getByRole('link', { name: 'Решения' })).toHaveAttribute('href', '/solutions')
    // Незапущенного раздела в основном меню быть не должно.
    await expect(topbar.getByRole('link', { name: 'ЦДЗ', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Мои решения', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'База решений', exact: true })).toHaveCount(0)

    for (let index = 0; index < await navigationItems.count(); index += 1) {
      const item = navigationItems.nth(index)
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await expect(topbar).toBeVisible()
    }

    const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)
    if (canScroll) {
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    }

    const topbarBox = await topbar.boundingBox()
    expect(topbarBox).not.toBeNull()
    expect(topbarBox!.y).toBe(0)
  })

  test('логотип и все разделы помещаются в верхнюю строку на широком экране', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 935 })
    await page.goto('/app')

    const [brandBox, navigationBox, topbarBox] = await Promise.all([
      page.locator('.topbar-brand .brand-lockup').boundingBox(),
      page.locator('.product-navigation').boundingBox(),
      page.locator('.product-topbar').boundingBox(),
    ])

    expect(brandBox).not.toBeNull()
    expect(navigationBox).not.toBeNull()
    expect(topbarBox).not.toBeNull()
    expect(brandBox!.x + brandBox!.width).toBeLessThan(navigationBox!.x)
    expect(topbarBox!.height).toBeLessThanOrEqual(80)
  })

  test('личные решения и общая база находятся на одной странице', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app')
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Решения', exact: true }).click()

    await expect(page).toHaveURL(/\/solutions$/)
    const personalTab = page.getByRole('tab', { name: 'Мои решения' })
    const sharedTab = page.getByRole('tab', { name: 'База решений' })
    await expect(sharedTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'База решений' })).toBeVisible()
    await personalTab.click()
    await expect(personalTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Мои решения' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'База решений' })).toHaveCount(0)
    await sharedTab.click()
    // Пустая база — это не результат неудачного поиска: человек ничего
    // не искал, и «Совпадений нет» читалось как «ты сделал что-то не так».
    await expect(page.getByRole('heading', { name: 'База пополняется решёнными задачами' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Отправить свою задачу' })).toBeVisible()
    const search = page.getByRole('textbox', { name: 'Найти решение' })
    await search.fill('999')
    await expect(page.getByRole('heading', { name: 'База пополняется решёнными задачами' })).toBeVisible()
    await expectNoPageOverflow(page)
  })

  test('под формой стоит одна карточка, а вход предложен строкой', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 935 })
    await page.goto('/app')

    const cards = page.locator('.home-action-card')
    await expect(cards).toHaveCount(1)
    await expect(cards.getByRole('heading', { name: 'База решений' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Войти, чтобы сохранять решения/ })).toBeVisible()

    // Карточек было две, и тест сверял их между собой. Осталась одна, поэтому
    // проверяем её саму: иконка нужного размера и кнопка прижата к нижнему
    // краю карточки, а не висит сразу под текстом.
    const card = await cards.evaluate((element) => {
      const style = getComputedStyle(element)
      const cardBox = element.getBoundingClientRect()
      const iconBox = element.querySelector('.home-action-card-icon')!.getBoundingClientRect()
      const buttonBox = element.querySelector('button')!.getBoundingClientRect()

      return {
        height: cardBox.height,
        innerBottom: cardBox.bottom - Number.parseFloat(style.borderBottomWidth) - Number.parseFloat(style.paddingBottom),
        iconWidth: iconBox.width,
        iconHeight: iconBox.height,
        buttonBottom: buttonBox.bottom,
      }
    })

    expect(card.iconWidth).toBe(40)
    expect(card.iconHeight).toBe(40)
    expect(card.height).toBeGreaterThanOrEqual(192)
    expect(Math.abs(card.innerBottom - card.buttonBottom)).toBeLessThan(1)
  })

  test('главная карточка чёрная в светлой теме и белая в тёмной', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/app')

    const card = page.locator('.copy-task')
    const title = card.getByRole('heading', { name: 'Списать задачу' })
    // Выбора учебника в форме больше нет. Тот же токен текста карточки
    // держат условие и кнопка фотографии — по ним и проверяем инверсию.
    const condition = card.getByRole('textbox', { name: 'Условие задачи' })
    const photoButton = card.locator('.task-photo-button')

    await expect(card).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(condition).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(photoButton).toHaveCSS('color', 'rgb(255, 255, 255)')

    await page.locator('.topbar-actions').getByRole('button', { name: 'Включить тёмную тему' }).click()

    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(title).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(condition).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(photoButton).toHaveCSS('color', 'rgb(0, 0, 0)')
  })

  for (const viewport of phoneViewports) {
    test(`главная не переполняется на ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/app')

      await expectNoPageOverflow(page)
      const topbar = page.locator('.product-topbar')
      const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
      await expect(topbar).toBeVisible()
      await expect(navigation).toBeVisible()
      const [contentBox, navigationBox] = await Promise.all([
        page.locator('.product-content').boundingBox(),
        navigation.boundingBox(),
      ])
      expect(contentBox).not.toBeNull()
      expect(navigationBox).not.toBeNull()
      // Панель разделов прижата к низу экрана и не наезжает на шапку.
      expect(Math.round(navigationBox!.y + navigationBox!.height)).toBe(viewport.height)
      expect(navigationBox!.y).toBeGreaterThan(contentBox!.y)

      const smallButtons = await page.locator('button').evaluateAll((buttons) => buttons
        .map((button) => {
          const rect = button.getBoundingClientRect()
          return {
            name: button.getAttribute('aria-label') || button.textContent || '',
            width: rect.width,
            height: rect.height,
          }
        })
        .filter(({ width, height }) => width > 0 && height > 0 && (width < 44 || height < 44)))

      expect(smallButtons).toEqual([])
    })
  }

  test('компактный телефон складывает ввод и сохраняет центрированный диалог', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/app')

    // Условие, кнопка фотографии и «Решить» идут во всю ширину друг под
    // другом, а два коротких селекта делят одну строку пополам.
    const condition = page.getByRole('textbox', { name: 'Условие задачи' })
    const photoButton = page.locator('.task-photo-button')
    const submit = page.locator('.copy-task-submit')
    const [conditionBox, photoBox, submitBox] = await Promise.all([
      condition.boundingBox(),
      photoButton.boundingBox(),
      submit.boundingBox(),
    ])
    expect(conditionBox).not.toBeNull()
    expect(photoBox).not.toBeNull()
    expect(submitBox).not.toBeNull()
    expect(photoBox!.y).toBeGreaterThan(conditionBox!.y + conditionBox!.height)
    expect(submitBox!.y).toBeGreaterThan(photoBox!.y + photoBox!.height)
    expect(Math.abs(photoBox!.width - conditionBox!.width)).toBeLessThan(1)
    expect(Math.abs(submitBox!.width - conditionBox!.width)).toBeLessThan(1)

    const selects = page.locator('.task-select')
    await expect(selects).toHaveCount(2)
    const [subjectBox, gradeBox] = await selects.evaluateAll(
      (elements) => elements.map((element) => element.getBoundingClientRect().toJSON()),
    )
    expect(Math.abs(subjectBox.y - gradeBox.y)).toBeLessThan(1)
    expect(subjectBox.right).toBeLessThanOrEqual(gradeBox.x + 1)
    expect(subjectBox.y).toBeGreaterThan(photoBox!.y)
    expect(gradeBox.bottom).toBeLessThanOrEqual(submitBox!.y + 1)

    await page.locator('.topbar-actions').getByRole('button', { name: 'Войти или зарегистрироваться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Войди в аккаунт' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(350)
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.abs(box!.y - (812 - box!.height) / 2)).toBeLessThan(2)
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
    await expect(dialog).toBeHidden()
    const initialTheme = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: /Включить (светлую|тёмную) тему/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark')
  })

  test('уменьшенное движение отключает анимацию диалога', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app')

    // Диалог учебника удалён вместе с выбором учебника. Окно аккаунта
    // анимируется не CSS-кадрами, а motion, поэтому «анимации нет» здесь
    // значит: окно с первого же кадра стоит на месте и полностью видимо.
    await page.evaluate(() => {
      const frames: { opacity: string; transform: string }[] = []
      Object.assign(window, { __dialogFrames: frames })
      const readFrame = () => {
        const element = document.querySelector('.account-dialog')
        if (element) {
          const style = getComputedStyle(element)
          frames.push({ opacity: style.opacity, transform: style.transform })
          if (frames.length >= 3) return
        }
        requestAnimationFrame(readFrame)
      }
      requestAnimationFrame(readFrame)
    })

    await page.locator('.topbar-actions').getByRole('button', { name: 'Войти или зарегистрироваться' }).click()
    await expect(page.getByRole('dialog', { name: 'Войди в аккаунт' })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __dialogFrames: unknown[] }).__dialogFrames.length))
      .toBeGreaterThanOrEqual(3)

    const frames = await page.evaluate(
      () => (window as unknown as { __dialogFrames: { opacity: string; transform: string }[] }).__dialogFrames,
    )
    for (const frame of frames) {
      expect(frame.opacity).toBe('1')
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(frame.transform)
    }

    // Наведения и нажатия внутри окна тоже не разъезжаются плавно: общий
    // сброс оставляет от перехода 0,01 мс, а не полноценную длительность.
    const durations = await page.locator('.account-dialog-close, .account-dialog .account-primary-button')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transitionDuration))
    expect(durations).toHaveLength(2)
    for (const duration of durations) {
      expect(Number.parseFloat(duration)).toBeLessThan(0.05)
    }
  })

  test('окно аккаунта изолирует страницу, удерживает фокус и возвращает его', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app')

    const trigger = page.locator('.topbar-actions').getByRole('button', { name: 'Войти или зарегистрироваться' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Войди в аккаунт' })
    const closeButton = page.getByRole('button', { name: 'Закрыть окно аккаунта' })
    const lastControl = page.getByRole('button', { name: 'Не помню пароль' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.product-shell')).toHaveAttribute('aria-hidden', 'true')
    // Фокус ставится таймером после открытия: если начать раньше, он уедет
    // на первое поле уже посреди проверки петли.
    await expect(page.getByRole('textbox', { name: 'Почта' })).toBeFocused()

    await closeButton.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(lastControl).toBeFocused()
    await lastControl.focus()
    await page.keyboard.press('Tab')
    await expect(closeButton).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page.locator('.product-shell')).not.toHaveAttribute('aria-hidden', 'true')
  })

  test('регистрация помещается на экран и прокручивается внутри диалога', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/app')

    await page.locator('.topbar-actions').getByRole('button', { name: 'Войти или зарегистрироваться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Войди в аккаунт' })
    await expect(dialog).toBeVisible()
    await page.getByRole('tab', { name: 'Регистрация' }).click()
    await expect(page.getByRole('heading', { name: 'Создай аккаунт' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Имя' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Почта' })).toBeVisible()
    const grade = page.getByRole('combobox', { name: 'Класс' })
    await expect(grade).toContainText('Выбери')
    await grade.click()
    const gradeList = page.getByRole('listbox', { name: 'Выбрать класс' })
    await expect(gradeList).toBeVisible()
    await expect(page.getByRole('option', { name: '8 класс' })).toHaveAttribute('aria-selected', 'false')
    await page.getByRole('option', { name: '9 класс' }).click()
    await expect(grade).toContainText('9')
    await expect(gradeList).toBeHidden()
    const createAccount = page.getByRole('button', { name: 'Создать аккаунт' })
    await expect(createAccount).toBeDisabled()
    await page.getByRole('textbox', { name: 'Имя' }).fill('Рома')
    await page.getByRole('textbox', { name: 'Почта' }).fill('roma@example.com')
    await page.getByLabel('Пароль', { exact: true }).fill('12')
    await expect(createAccount).toBeDisabled()
    await page.getByLabel('Пароль', { exact: true }).fill('12345678')
    await expect(createAccount).toBeDisabled()
    await expect(page.getByText('Слишком предсказуемый')).toBeVisible()
    await page.getByLabel('Пароль', { exact: true }).fill('Homework2026!')
    await expect(createAccount).toBeDisabled()
    const agreement = page.getByRole('checkbox', { name: /пользовательское соглашение/ })
    const personalData = page.getByRole('checkbox', { name: /отдельно даю/ })
    await agreement.check({ force: true })
    await expect(agreement).toBeChecked()
    await expect(createAccount).toBeDisabled()
    await personalData.check({ force: true })
    await expect(personalData).toBeChecked()
    await expect(createAccount).toBeEnabled()
    await expect(page.getByRole('meter', { name: 'Надёжность пароля' })).toHaveAttribute('aria-valuetext', 'Надёжный')
    await expect(page.getByRole('textbox', { name: 'Имя' })).toHaveCSS('box-shadow', 'none')
    await expect(page.getByText(/Аккаунт сохраняет решения/)).toHaveCount(0)
    await expectNoPageOverflow(page)

    const metrics = await page.locator('.account-dialog').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }
    })
    expect(metrics.left).toBeGreaterThanOrEqual(0)
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.top).toBeGreaterThanOrEqual(0)
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight)
  })

  test('расписание показывает один выбранный день на телефоне и в альбомной ориентации', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 812 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/app')
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Расписание', exact: true }).click()
      await expect(page.getByText(/Выбери день/)).toBeVisible()
      await expectNoPageOverflow(page)
      await expect(page.locator('.schedule-table-scroll')).toBeHidden()
      await expect(page.getByRole('tab', { name: /Пн|Понедельник/ })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: /Вт|Вторник/ }).click()
      await expect(page.getByRole('tab', { name: /Вт|Вторник/ })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByLabel('Предмет, вторник, урок 1', { exact: true })).toHaveValue('Геометрия')
    }
  })
})
