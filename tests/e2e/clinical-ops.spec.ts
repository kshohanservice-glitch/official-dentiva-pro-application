/**
 * Clinical operations: patient registration through the real UI form,
 * repeated visits, dental-chart entries for ADULT (16) and PEDIATRIC (55)
 * teeth with restart persistence, appointment double-booking refusal, and
 * the full queue lifecycle — verified in SQLite after each app close.
 */
import { test, expect } from '@playwright/test'
import {
  ADMIN_PASSWORD,
  DENTIST_ARGS,
  all,
  api,
  apiExpectError,
  completeSetup,
  expectToast,
  field,
  launch,
  newAppointment,
  newChartEntry,
  newPatient,
  newVisit,
  one,
  scalar,
} from './helpers'
import type { Ctx } from './helpers'

async function seedPatient(ctx: Ctx, name: string, phone: string): Promise<number> {
  const p = await api(ctx.page, 'patients.create', newPatient(name, phone))
  return p.id
}

async function dentistId(ctx: Ctx): Promise<number> {
  const dentists = await api(ctx.page, 'dentists.list', DENTIST_ARGS)
  return dentists[0]!.id
}

test.describe('clinical operations', () => {
  test('patient registration via the UI form persists a real record', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'ops-admin' })

    await page.getByRole('link', { name: 'Patients' }).click()
    await expect(page.getByRole('button', { name: 'Register patient' })).toBeVisible()
    await page.getByRole('button', { name: 'Register patient' }).click()

    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()
    await field(modal, 'Full name').fill('Rahim Uddin Test')
    await field(modal, 'Phone').fill('01712345501')
    await field(modal, 'Presenting problem').fill('Tooth pain lower right')
    await modal.getByRole('button', { name: 'Register patient' }).click()

    await expectToast(page, 'success', 'Registered Rahim Uddin Test')
    await expect(page).toHaveURL(/\/patients\/\d+/, { timeout: 15_000 })

    await ctx.close()
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM patients')).toBe(1)
    const row = one<{
      full_name: string
      phone: string
      patient_code: string
      created_by: number | null
    }>(ctx.userData, 'SELECT full_name, phone, patient_code, created_by FROM patients')
    expect(row?.full_name).toBe('Rahim Uddin Test')
    expect(row?.phone).toBe('01712345501')
    expect(row?.patient_code).toBeTruthy()
    expect(row?.created_by ?? -1).toBeGreaterThan(0)
  })

  test('two visits + adult/pediatric dental chart entries survive a restart', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'chart-admin' })

    const patientId = await seedPatient(ctx, 'Chart Persistence', '01712345502')
    const dentist = await dentistId(ctx)

    // Longitudinal history: two visits on different days.
    await api(
      page,
      'visits.create',
      newVisit({
        patientId,
        dentistId: dentist,
        visitedAt: Date.now() - 48 * 3600_000,
        chiefComplaint: 'First visit — cleaning',
        diagnosis: 'Gingivitis',
      }),
    )
    await api(
      page,
      'visits.create',
      newVisit({
        patientId,
        dentistId: dentist,
        visitedAt: Date.now() - 3600_000,
        chiefComplaint: 'Second visit — follow-up',
        diagnosis: 'Resolved',
      }),
    )
    const visits = await api(page, 'visits.listByPatient', { patientId })
    expect(visits).toHaveLength(2)

    // Catalog exposes both dentitions and the codes we need.
    const catalog = await api(page, 'chart.catalog', {})
    const fd = new Set(catalog.teeth.map((t) => t.fdi))
    expect(fd.has('16')).toBe(true) // adult permanent
    expect(fd.has('55')).toBe(true) // pediatric primary
    const condition = catalog.conditions[0]!
    expect(condition.code).toBeTruthy()

    // Adult + pediatric chart entries.
    await api(
      page,
      'chart.setEntry',
      newChartEntry({
        patientId,
        fdi: '16',
        conditionCode: condition.code,
        severity: 'moderate',
        notes: 'Adult molar caries',
      }),
    )
    await api(
      page,
      'chart.setEntry',
      newChartEntry({
        patientId,
        fdi: '55',
        conditionCode: condition.code,
        severity: 'mild',
        notes: 'Pediatric molar caries',
      }),
    )

    // Unknown tooth refused by schema/service.
    const bad = await apiExpectError(
      page,
      'chart.setEntry',
      newChartEntry({ patientId, fdi: '99', conditionCode: condition.code }),
    )
    expect(bad.code).toBe('VALIDATION')

    expect(await api(page, 'chart.get', { patientId })).toHaveLength(2)

    await ctx.close()

    // Restart — same profile, activation written only once at launch.
    const again = await launch({ profileRoot: ctx.profileRoot, activate: false })
    await again.page.fill('#login-user', 'chart-admin')
    await again.page.fill('#login-pass', ADMIN_PASSWORD)
    await again.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(again.page.locator('.sidebar-nav')).toBeVisible()
    expect(await api(again.page, 'chart.get', { patientId })).toHaveLength(2)
    expect(await api(again.page, 'visits.listByPatient', { patientId })).toHaveLength(2)
    await again.close()

    // Authoritative final state.
    expect(
      scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM dental_chart_entries WHERE patient_id = ?', patientId),
    ).toBe(2)
    const fd2 = all<{ fdi: string }>(
      ctx.userData,
      'SELECT fdi FROM dental_chart_entries ORDER BY fdi',
    )
      .map((r) => r.fdi)
    expect(fd2).toEqual(['16', '55'])
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM visits WHERE patient_id = ?', patientId)).toBe(2)
    expect(
      scalar<number>(ctx.userData, "SELECT COUNT(*) FROM audit_logs WHERE action = 'chart.set'"),
    ).toBeGreaterThanOrEqual(2)
  })

  test('appointment double-booking refused; check-in → queue → completion updates appointments', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'queue-admin' })

    const patientId = await seedPatient(ctx, 'Queue Flow Patient', '01712345503')
    const dentist = await dentistId(ctx)

    const start = Math.ceil(Date.now() / 900_000) * 900_000 + 3600_000 // next quarter hour + 1h
    const appt = await api(
      page,
      'appointments.create',
      newAppointment({
        patientId,
        dentistId: dentist,
        startsAt: start,
        endsAt: start + 30 * 60_000,
        reason: 'Scaling',
      }),
    )
    expect(appt.status).toBe('scheduled')

    // Overlapping slot for the same dentist must be refused.
    const conflict = await apiExpectError(
      page,
      'appointments.create',
      newAppointment({
        patientId,
        dentistId: dentist,
        startsAt: start + 15 * 60_000,
        endsAt: start + 45 * 60_000,
        reason: 'Filling',
      }),
    )
    expect(conflict.code).toBe('CONFLICT')
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM appointments')).toBe(1)

    // Check in → queue entry waiting.
    const entry = await api(page, 'queue.checkIn', { appointmentId: appt.id })
    expect(entry.status).toBe('waiting')
    expect(scalar<string>(ctx.userData, 'SELECT status FROM appointments WHERE id = ?', appt.id)).toBe(
      'checked_in',
    )

    // Drive the queue from the UI.
    await page.getByRole('link', { name: 'Queue' }).click()
    await expect(page.getByText('Queue Flow Patient').first()).toBeVisible()
    await page.getByRole('button', { name: 'Start' }).click()
    await page.getByRole('button', { name: 'Complete' }).click()
    await expect(page.locator('.toast.success').first()).toBeVisible({ timeout: 15_000 })

    await ctx.close()
    expect(scalar<string>(ctx.userData, 'SELECT status FROM queue_entries WHERE id = ?', entry.id)).toBe(
      'completed',
    )
    expect(scalar<string>(ctx.userData, 'SELECT status FROM appointments WHERE id = ?', appt.id)).toBe(
      'completed',
    )
  })
})
