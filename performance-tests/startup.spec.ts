import { expect, test } from '@playwright/test'

test('desktop shows an immediate shell while JavaScript is still downloading', async ({ page }) => {
  let releaseApplication = () => {}
  const applicationStall = new Promise<void>((resolve) => { releaseApplication = resolve })

  await page.route('**/assets/index-*.js', async (route) => {
    await applicationStall
    await route.continue().catch(() => {})
  })

  const startedAt = Date.now()
  await page.goto('/main', { waitUntil: 'commit' })

  try {
    await expect(page.locator('.startup-shell')).toBeVisible({ timeout: 2_500 })
    expect(Date.now() - startedAt).toBeLessThan(2_500)
  } finally {
    releaseApplication()
  }
})

test('desktop shell does not wait for a stalled account request', async ({ page }) => {
  let authRequestSeen = false
  let releaseAuthRequest = () => {}
  const authStall = new Promise<void>((resolve) => { releaseAuthRequest = resolve })

  await page.route('https://stalled.supabase.co/**', async (route) => {
    authRequestSeen = true
    await authStall
    await route.abort('failed').catch(() => {})
  })

  await page.addInitScript(() => {
    window.localStorage.setItem('sb-stalled-auth-token', JSON.stringify({
      access_token: 'expired-access-token',
      refresh_token: 'stalled-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 1,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'performance@example.test',
      },
    }))
  })

  const startedAt = Date.now()
  await page.goto('/main', { waitUntil: 'domcontentloaded' })

  try {
    await expect(page.locator('.product-shell')).toBeVisible({ timeout: 2_500 })
    expect(Date.now() - startedAt).toBeLessThan(2_500)
    await expect.poll(() => authRequestSeen, { timeout: 2_500 }).toBe(true)
    await expect(page.locator('.session-loading-screen')).toHaveCount(0)
    const taskNumber = page.getByRole('textbox', { name: 'Номер задачи' })
    await taskNumber.fill('123')
    await expect(taskNumber).toHaveValue('123')
  } finally {
    releaseAuthRequest()
  }
})
