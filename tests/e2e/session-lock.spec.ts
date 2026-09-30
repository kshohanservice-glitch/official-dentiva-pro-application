/**
 * Session lock/unlock through the real LockScreen UI, locked-channel refusal,
 * and a REAL-TIME idle auto-lock run at the configured minimum (5 minutes).
 * The idle test intentionally takes ~5 minutes — it proves the live timer,
 * not a mock. Activity is only reported on real user input, so simply polling
 * session state does not keep the session alive.
 */
import { test, expect } from '@playwright/test'
import {
  ADMIN_PASSWORD,
  TREATMENT_ARGS,
  api,
  apiExpectError,
  completeSetup,
  launch,
} from './helpers'

test.describe('session lock & idle auto-lock', () => {
  test('lock now blocks data channels; unlock requires the right password', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'lock-admin' })

    await page.getByRole('button', { name: 'Lock now' }).click()
    await expect(page.locator('#lock-pass')).toBeVisible({ timeout: 15_000 })
    expect((await api(page, 'session.state', {})).locked).toBe(true)

    // Every data channel is refused while locked — even reads.
    const refused = await apiExpectError(page, 'treatments.list', TREATMENT_ARGS)
    expect(refused.code).toBe('LOCKED')

    // Wrong password keeps the lock.
    await page.fill('#lock-pass', 'TotallyWrong123!')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.locator('#lock-pass')).toBeVisible()
    expect((await api(page, 'session.state', {})).locked).toBe(true)

    // Correct password releases it.
    await page.fill('#lock-pass', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 15_000 })
    expect((await api(page, 'session.state', {})).locked).toBe(false)
    await api(page, 'treatments.list', TREATMENT_ARGS)

    await ctx.close()
  })

  test('idle session auto-locks at the configured 5-minute interval (real time)', async () => {
    test.setTimeout(7 * 60_000)
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { autoLockMinutes: 5, username: 'idle-admin' })

    const start = Date.now()
    let unlockedPast4Min = false
    let lockedAtMs: number | null = null
    while (Date.now() - start < 6 * 60_000) {
      const s = await api(page, 'session.state', {})
      if (s.locked) {
        lockedAtMs = Date.now() - start
        break
      }
      if (Date.now() - start >= 4 * 60_000) unlockedPast4Min = true
      await page.waitForTimeout(10_000)
    }

    // Still live at 4 minutes, locked before 6 — the 5-minute timer is real.
    expect(unlockedPast4Min).toBe(true)
    expect(lockedAtMs).not.toBeNull()
    expect(lockedAtMs ?? Number.MAX_SAFE_INTEGER).toBeLessThan(6 * 60_000)
    await expect(page.locator('#lock-pass')).toBeVisible({ timeout: 20_000 })

    await page.fill('#lock-pass', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 15_000 })

    await ctx.close()
  })
})
