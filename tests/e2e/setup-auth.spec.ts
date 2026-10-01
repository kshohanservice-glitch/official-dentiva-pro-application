/**
 * First-run setup wizard (full UI walk-through), interrupted-draft resume,
 * activation persistence across restart, login/logout, and wrong-password
 * rejection — each verified against the app's SQLite file after close.
 */
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import {
  ADMIN_PASSWORD,
  api,
  completeSetup,
  expectToast,
  field,
  launch,
  one,
  scalar,
} from './helpers'

test.describe('setup wizard & authentication', () => {
  test('full setup wizard UI completes and persists every entity', async () => {
    const ctx = await launch()
    const page = ctx.page
    await expect(page.locator('.wizard-steps')).toBeVisible()

    // Step 0 — clinic (validation: name + phone/address required).
    await field(page, 'Clinic name').fill('Sunrise Dental Care')
    await field(page, 'Address').fill('Road 5, Dhanmondi, Dhaka 1205')
    await field(page, 'Phone').fill('01712349999')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 1 — dentist with multiple designations and qualifications.
    await expect(page.locator('.wizard-steps li.active')).toContainText('Dentists')
    await field(page, 'Full name').fill('Dr. Nabila Rahman')
    await field(page, 'Designations').fill('BDS')
    await field(page, 'Designations').press('Enter')
    await field(page, 'Designations').fill('FCPS (Oral Surgery)')
    await field(page, 'Designations').press('Enter')
    await field(page, 'Qualifications').fill('DDS, DU')
    await field(page, 'Qualifications').press('Enter')
    await field(page, 'Qualifications').fill('Certified Endodontist')
    await field(page, 'Qualifications').press('Enter')
    await expect(page.locator('.chip')).toHaveCount(4)
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2 — administrator.
    await expect(page.locator('.wizard-steps li.active')).toContainText('Administrator')
    await field(page, 'Full name').fill('Dr. Nabila Rahman')
    await field(page, 'Username').fill('sunrise-admin')
    await field(page, /^Password/).fill(ADMIN_PASSWORD)
    await field(page, /^Confirm password/).fill(ADMIN_PASSWORD)
    await field(page, 'Auto-lock screen after').selectOption('15')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3 — backup schedule (auto-backup on: folder required).
    await field(page, 'Backup folder').fill(join(ctx.profileRoot, 'auto-backups'))
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 4 — printer profiles.
    await field(page, 'Default paper size').selectOption('A4')
    await page.getByRole('button', { name: 'Finish setup' }).click()

    await expectToast(page, 'success', 'Setup complete')
    await expect(page.locator('.sidebar-nav')).toBeVisible()

    await ctx.close()

    // ---- Authoritative persisted state ----
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM users')).toBe(1)
    const user = one<Record<string, string>>(
      ctx.userData,
      'SELECT username, password_hash FROM users WHERE id = 1',
    )
    expect(user?.username).toBe('sunrise-admin')
    expect(user?.password_hash).toMatch(/^\$argon2/)
    expect(user?.password_hash).not.toContain(ADMIN_PASSWORD)

    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM dentists')).toBe(1)
    expect(
      scalar<string>(ctx.userData, 'SELECT full_name FROM dentists'),
    ).toBe('Dr. Nabila Rahman')
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM dentist_designations')).toBe(2)
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM dentist_qualifications')).toBe(2)

    expect(scalar<string>(ctx.userData, 'SELECT clinic_name FROM clinic_config WHERE id = 1')).toBe(
      'Sunrise Dental Care',
    )

    expect(scalar<string>(ctx.userData, "SELECT value FROM settings WHERE key = 'autoLockMinutes'")).toBe(
      '15',
    )
    expect(
      scalar<string>(ctx.userData, "SELECT value FROM settings WHERE key = 'backupFolder'"),
    ).toBe(join(ctx.profileRoot, 'auto-backups'))

    // Suggested printer profiles created (A4, A5, thermal 80 mm…).
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM printer_profiles')).toBeGreaterThanOrEqual(3)

    // 52-tooth adult + pediatric FDI seed present for the dental chart.
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM teeth')).toBe(52)

    // Audit trail records setup completion.
    expect(
      scalar<number>(ctx.userData, "SELECT COUNT(*) FROM audit_logs WHERE action = 'setup.complete'"),
    ).toBeGreaterThanOrEqual(1)
  })

  test('interrupted setup resumes from the saved draft; activation survives restart', async () => {
    const ctx = await launch()
    const page = ctx.page
    await expect(page.locator('.wizard-steps')).toBeVisible()

    await field(page, 'Clinic name').fill('Resume Test Clinic')
    await field(page, 'Phone').fill('01811112222')
    await page.getByRole('button', { name: 'Continue' }).click()
    await field(page, 'Full name').fill('Dr. Resume Check')
    await field(page, 'Designations').fill('BDS')
    await field(page, 'Designations').press('Enter')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('.wizard-steps li.active')).toContainText('Administrator')

    // Simulate interruption: kill the app mid-setup.
    await ctx.close()

    // Restart WITHOUT re-writing the activation file — it must survive.
    const again = await launch({ profileRoot: ctx.profileRoot, activate: false })
    await expect(again.page.locator('.wizard-steps')).toBeVisible({ timeout: 20_000 })
    await expect(field(again.page, 'Clinic name')).toHaveValue('Resume Test Clinic')
    // Draft step restored: the Administrator panel is the active one again.
    await expect(again.page.locator('.wizard-steps li.active')).toContainText('Administrator')
    await expect(field(again.page, 'Username')).toBeVisible()
    await again.close()
  })

  test('wrong password rejected with persisted failure; login, logout, restart persistence', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'auth-admin', clinicName: 'Auth Check Clinic' })

    // End the setup session → back to the login screen.
    await api(page, 'session.logout', {})
    await expect(page.locator('#login-user')).toBeVisible({ timeout: 20_000 })

    // Rejected credentials.
    await page.fill('#login-user', 'auth-admin')
    await page.fill('#login-pass', 'WrongPass123!')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.error')).toContainText(/invalid|password|sign in/i, {
      timeout: 15_000,
    })
    expect(
      scalar<number>(ctx.userData, 'SELECT failed_attempts FROM users WHERE username = ?', 'auth-admin'),
    ).toBeGreaterThanOrEqual(1)
    expect(page.locator('.sidebar-nav')).toHaveCount(0)

    // Correct credentials.
    await page.fill('#login-pass', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 20_000 })
    expect(
      scalar<number>(ctx.userData, 'SELECT last_login_at FROM users WHERE username = ?', 'auth-admin'),
    ).toBeGreaterThan(0)

    await ctx.close()

    // Full restart: activation and data persist; the session does not.
    const again = await launch({ profileRoot: ctx.profileRoot, activate: false })
    await expect(again.page.locator('#login-user')).toBeVisible({ timeout: 20_000 })
    await again.page.fill('#login-user', 'auth-admin')
    await again.page.fill('#login-pass', ADMIN_PASSWORD)
    await again.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(again.page.locator('.sidebar-nav')).toBeVisible({ timeout: 20_000 })
    const status = await api(again.page, 'app.status', {})
    expect(status.setupComplete).toBe(true)
    expect(status.clinicName).toBe('Auth Check Clinic')
    await again.close()
  })
})
