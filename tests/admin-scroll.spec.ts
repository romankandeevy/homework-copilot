import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './adminMocks'

/* Админка листается с первой загрузки - на компьютере и на телефоне.
   14 сентября 2026 владелец не мог её прокрутить: окна админки оставляли
   `body.style.overflow = 'hidden'` после закрытия (src/admin/ui.tsx). */
for (const viewport of [{ width: 1440, height: 600 }, { width: 390, height: 640 }]) {
  test(`админка листается на ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockSupabase(page)
    await signIn(page)

    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(room).toBeGreaterThan(100)

    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.wheel(0, 800)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })
}
