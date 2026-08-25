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
  test('тема стоит слева от профиля внизу сайдбара', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const footer = page.locator('.sidebar-footer')
    const theme = footer.getByRole('button', { name: 'Включить тёмную тему' })
    const profile = footer.getByRole('button', { name: 'Войти или зарегистрироваться' })
    const [footerBox, themeBox, profileBox] = await Promise.all([
      footer.boundingBox(),
      theme.boundingBox(),
      profile.boundingBox(),
    ])

    expect(footerBox).not.toBeNull()
    expect(themeBox).not.toBeNull()
    expect(profileBox).not.toBeNull()
    expect(themeBox!.x + themeBox!.width).toBeLessThan(profileBox!.x)
    expect(Math.abs(themeBox!.y - profileBox!.y)).toBeLessThan(1)
    expect(footerBox!.y).toBeGreaterThan(780)
    await expect(page.locator('.mobile-profile-button')).toBeHidden()
  })

  test('маркер активного раздела остаётся напротив иконки при прокрутке', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    const marker = page.locator('.product-seam span')
    const navigationItems = page.locator('.product-sidebar .navigation-item')
    const activeItemBox = await navigationItems.first().boundingBox()
    const inactiveItemBox = await navigationItems.nth(1).boundingBox()
    const activeIconBox = await navigationItems.first().locator('.navigation-icon').boundingBox()
    const inactiveIconBox = await navigationItems.nth(1).locator('.navigation-icon').boundingBox()
    const activeLabelBox = await navigationItems.first().locator('.navigation-label').boundingBox()
    const inactiveLabelBox = await navigationItems.nth(1).locator('.navigation-label').boundingBox()

    expect(activeItemBox).not.toBeNull()
    expect(inactiveItemBox).not.toBeNull()
    expect(activeIconBox).not.toBeNull()
    expect(inactiveIconBox).not.toBeNull()
    expect(activeLabelBox).not.toBeNull()
    expect(inactiveLabelBox).not.toBeNull()
    expect(activeItemBox!.x - inactiveItemBox!.x).toBeCloseTo(0, 0)
    expect(activeIconBox!.x - inactiveIconBox!.x).toBeCloseTo(24, 0)
    expect(activeLabelBox!.x - inactiveLabelBox!.x).toBeCloseTo(0, 0)
    await expect(page.locator('.navigation-route')).toHaveCount(1)
    await expect(page.locator('.product-seam')).toHaveCount(1)

    for (let index = 0; index < await navigationItems.count(); index += 1) {
      const item = navigationItems.nth(index)
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await expect.poll(async () => {
        const markerBox = await marker.boundingBox()
        const iconBox = await item.locator('.navigation-icon').boundingBox()
        if (!markerBox || !iconBox) return Number.POSITIVE_INFINITY
        return Math.abs((markerBox.y + markerBox.height / 2) - (iconBox.y + iconBox.height / 2))
      }).toBeLessThan(1)
    }

    const activeIcon = navigationItems.last().locator('.navigation-icon')
    const markerBefore = await marker.boundingBox()
    expect(markerBefore).not.toBeNull()

    const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)
    if (canScroll) {
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    }

    const markerAfter = await marker.boundingBox()
    const iconAfter = await activeIcon.boundingBox()
    expect(markerAfter).not.toBeNull()
    expect(iconAfter).not.toBeNull()
    expect(Math.abs(markerAfter!.y - markerBefore!.y)).toBeLessThan(1)
    expect(Math.abs((markerAfter!.y + markerAfter!.height / 2) - (iconAfter!.y + iconAfter!.height / 2))).toBeLessThan(1)
  })

  test('логотип остаётся внутри узкого сайдбара на широком экране', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 935 })
    await page.goto('/')

    const [brandBox, sidebarBox, seamBox] = await Promise.all([
      page.locator('.sidebar-brand .brand-lockup').boundingBox(),
      page.locator('.product-sidebar').boundingBox(),
      page.locator('.product-seam').boundingBox(),
    ])

    expect(brandBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    expect(seamBox).not.toBeNull()
    expect(sidebarBox!.width).toBe(272)
    expect(brandBox!.x + brandBox!.width).toBeLessThan(seamBox!.x)
  })

  test('карточки на главной совпадают по высоте, цвету и расположению кнопок', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 935 })
    await page.goto('/')

    const cards = page.locator('.home-action-card')
    await expect(cards).toHaveCount(2)

    const [firstCard, secondCard] = await cards.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      const icon = element.querySelector('.home-action-card-icon')!
      const button = element.querySelector('button')!
      const iconBox = icon.getBoundingClientRect()

      return {
        height: element.getBoundingClientRect().height,
        background: style.backgroundColor,
        border: style.borderColor,
        iconColor: getComputedStyle(icon).color,
        iconWidth: iconBox.width,
        iconHeight: iconBox.height,
        buttonTop: button.getBoundingClientRect().top,
      }
    }))

    expect(firstCard.height).toBe(secondCard.height)
    expect(firstCard.background).toBe(secondCard.background)
    expect(firstCard.border).toBe(secondCard.border)
    expect(firstCard.iconColor).toBe(secondCard.iconColor)
    expect(firstCard.iconWidth).toBe(secondCard.iconWidth)
    expect(firstCard.iconHeight).toBe(secondCard.iconHeight)
    expect(firstCard.buttonTop).toBe(secondCard.buttonTop)
  })

  for (const viewport of phoneViewports) {
    test(`главная не переполняется на ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      await expectNoPageOverflow(page)
      const mobileNavigation = page.locator('.mobile-navigation')
      await expect(mobileNavigation).toBeVisible()
      const [contentBox, navigationBox] = await Promise.all([
        page.locator('.product-content').boundingBox(),
        mobileNavigation.boundingBox(),
      ])
      expect(contentBox).not.toBeNull()
      expect(navigationBox).not.toBeNull()
      expect(Math.abs(contentBox!.y + contentBox!.height - navigationBox!.y)).toBeLessThan(1)

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
    await page.goto('/')

    const taskField = page.locator('.task-number-field')
    const photoField = page.locator('.photo-task-field')
    const [taskBox, photoBox] = await Promise.all([taskField.boundingBox(), photoField.boundingBox()])
    expect(taskBox).not.toBeNull()
    expect(photoBox).not.toBeNull()
    expect(photoBox!.y).toBeGreaterThan(taskBox!.y + taskBox!.height)
    expect(Math.abs(photoBox!.width - taskBox!.width)).toBeLessThan(1)

    await page.getByRole('button', { name: /Учебник Геометрия/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Выбери учебник' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(350)
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.abs(box!.y - (812 - box!.height) / 2)).toBeLessThan(2)
    await expectNoPageOverflow(page)

    await page.getByRole('button', { name: 'Закрыть выбор учебника' }).click()
    const initialTheme = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: /Включить (светлую|тёмную) тему/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark')
  })

  test('уменьшенное движение отключает анимацию диалога', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await page.getByRole('button', { name: /Учебник Геометрия/ }).click()

    await expect(page.locator('.textbook-dialog-backdrop')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.textbook-dialog')).toHaveCSS('animation-name', 'none')
  })

  test('диалог учебника изолирует страницу, удерживает фокус и возвращает его', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    const trigger = page.getByRole('button', { name: /Учебник Геометрия/ })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Выбери учебник' })
    const closeButton = page.getByRole('button', { name: 'Закрыть выбор учебника' })
    const lastControl = page.getByRole('textbox', { name: 'Ссылка на учебник' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.product-shell')).toHaveAttribute('aria-hidden', 'true')

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
    await page.goto('/')

    await page.locator('.page-header').getByRole('button', { name: 'Войти', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Войди в аккаунт' })
    await expect(dialog).toBeVisible()
    await page.getByRole('tab', { name: 'Регистрация' }).click()
    await expect(page.getByRole('heading', { name: 'Создай аккаунт' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Имя' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Почта' })).toBeVisible()
    const createAccount = page.getByRole('button', { name: 'Создать аккаунт' })
    await expect(createAccount).toBeDisabled()
    await page.getByRole('textbox', { name: 'Имя' }).fill('Рома')
    await page.getByRole('textbox', { name: 'Почта' }).fill('roma@example.com')
    await page.getByLabel('Пароль').fill('12')
    await expect(createAccount).toBeDisabled()
    await page.getByLabel('Пароль').fill('12345678')
    await expect(createAccount).toBeDisabled()
    await expect(page.getByText('Слишком предсказуемый')).toBeVisible()
    await page.getByLabel('Пароль').fill('Homework2026!')
    await expect(createAccount).toBeDisabled()
    await page.getByRole('checkbox').check({ force: true })
    await expect(page.getByRole('checkbox')).toBeChecked()
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
      await page.goto('/')
      await page.getByRole('button', { name: 'Расписание', exact: true }).click()
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
