import { test } from '@playwright/test'
import { mockSupabase, signIn } from './adminMocks'

/* Снимки всех разделов админки для разбора дизайна. Запускается вручную:
   ADMIN_SHOTS_DIR=<папка> npx playwright test tests/admin-shots.local.spec.ts */

const dir = process.env.ADMIN_SHOTS_DIR
const sections = ['dashboard', 'users', 'fraud', 'support', 'monitoring', 'finance', 'library', 'settings', 'notifications', 'audit']

test.skip(!dir, 'нужна переменная ADMIN_SHOTS_DIR')

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test(`снимки разделов: ${label}`, async ({ page }) => {
    test.setTimeout(120_000)
    await mockSupabase(page)
    await page.setViewportSize(viewport)
    await signIn(page)
    for (const section of sections) {
      if (label === 'mobile' && !['dashboard', 'users', 'support'].includes(section)) continue
      await page.goto(section === 'dashboard' ? '/admin' : `/admin?section=${section}`)
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${dir}/${label}-${section}.png`, fullPage: label === 'desktop' })
    }
    await page.goto('/admin?section=support&conversation=conversation-1')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${dir}/${label}-support-thread.png`, fullPage: label === 'desktop' })
    await page.goto('/admin?section=users&user=22222222-2222-4222-8222-222222222222')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${dir}/${label}-user-card.png` })
  })
}
