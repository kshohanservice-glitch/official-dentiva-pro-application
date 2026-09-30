/**
 * Money workflows end-to-end: invoice creation through the real modal with a
 * historical line-item snapshot, partial payment through the payments modal,
 * full payment, over-payment refusal, idempotent double-submission, void,
 * and payment-summary arithmetic — all asserted on integer poisha in SQLite.
 */
import { test, expect } from '@playwright/test'
import {
  all,
  api,
  apiExpectError,
  completeSetup,
  expectToast,
  field,
  launch,
  newInvoice,
  newInvoiceItem,
  newPatient,
  newPayment,
  newTreatment,
  one,
  scalar,
} from './helpers'
import type { Ctx } from './helpers'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function seedInvoice(
  ctx: Ctx,
  opts: { totalPoisha: number; key: string },
): Promise<{ patientId: number; invoiceId: number; invoiceCode: string }> {
  const patient = await api(ctx.page, 'patients.create', newPatient('Finance Flow Patient', '01712345504'))
  const inv = await api(
    ctx.page,
    'invoices.create',
    newInvoice({
      patientId: patient.id,
      invoiceDate: today(),
      items: [newInvoiceItem('Composite Filling', opts.totalPoisha)],
      idempotencyKey: opts.key,
    }),
  )
  return { patientId: patient.id, invoiceId: inv.id, invoiceCode: inv.invoiceCode }
}

test.describe('billing & finance', () => {
  test('invoice UI creates a historical line snapshot; payment UI records partial cash', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'fin-admin' })

    const treatment = await api(
      page,
      'treatments.save',
      newTreatment('Scaling & Polishing', 'Preventive', 350_000, 'T-SCAL'),
    )
    await api(page, 'patients.create', newPatient('Invoice UI Patient', '01712345505'))

    await page.getByRole('link', { name: 'Invoice' }).click()
    await page.getByRole('button', { name: 'New invoice' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()

    // Patient search-select.
    await field(modal, 'Patient').fill('Invoice UI Patient')
    await expect(modal.locator('.search-result')).toBeVisible({ timeout: 10_000 })
    await modal.locator('.search-result').first().click()

    // Treatment datalist pick fills the historical default price.
    const line = modal.locator('.line-row').first()
    await line.locator('input').first().fill('Scaling & Polishing')
    await line.locator('input').first().press('Tab')
    await expect(line.locator('input').nth(2)).toHaveValue('3500.00')

    await modal.getByRole('button', { name: /^Create invoice/ }).click()
    await expectToast(page, 'success', 'Invoice')
    await expect(modal).toBeHidden({ timeout: 15_000 })

    await ctx.close()

    // Historical values frozen at sale time, independent of the catalog row.
    const inv = one<Record<string, number | string>>(
      ctx.userData,
      'SELECT id, total_poisha, status, adjustment_poisha FROM invoices',
    )
    expect(Number(inv?.total_poisha)).toBe(350_000)
    expect(inv?.status).toBe('unpaid')
    const item = one<Record<string, number | string>>(
      ctx.userData,
      'SELECT treatment_id, unit_price_poisha, total_poisha FROM invoice_items',
    )
    expect(Number(item?.treatment_id)).toBe(treatment.id)
    expect(Number(item?.unit_price_poisha)).toBe(350_000)

    // Catalog price can move without rewriting history.
    // (Checked after close against the surviving treatments row.)
    expect(
      scalar<number>(ctx.userData, 'SELECT default_price_poisha FROM treatments WHERE id = ?', treatment.id),
    ).toBe(350_000)
  })

  test('partial → full payment, overpay refusal, idempotency, void, summary math', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'pay-admin' })

    const { patientId, invoiceId, invoiceCode } = await seedInvoice(ctx, {
      totalPoisha: 500_000,
      key: 'e2e-invoice-idem-01',
    })

    // Idempotent invoice creation: same key, same row.
    const dup = await api(
      page,
      'invoices.create',
      newInvoice({
        patientId,
        invoiceDate: today(),
        items: [newInvoiceItem('Composite Filling', 500_000)],
        idempotencyKey: 'e2e-invoice-idem-01',
      }),
    )
    expect(dup.id).toBe(invoiceId)
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM invoices')).toBe(1)

    // --- Partial payment through the real modal (৳200 of ৳500). ---
    await page.getByRole('link', { name: 'Payments' }).click()
    await page.getByRole('button', { name: 'Record payment' }).click()
    const modal = page.locator('.modal-overlay')
    await expect(modal).toBeVisible()
    await field(modal, 'Unpaid invoice').fill(invoiceCode)
    await expect(modal.locator('.search-result')).toBeVisible({ timeout: 10_000 })
    await modal.locator('.search-result').first().click()
    await field(modal, 'Amount').fill('200')
    await field(modal, 'Method').selectOption('bkash')
    await modal.getByRole('button', { name: 'Record payment' }).click()
    await expectToast(page, 'success', 'Payment recorded')
    await expect(modal).toBeHidden({ timeout: 15_000 })

    expect(scalar<string>(ctx.userData, 'SELECT status FROM invoices WHERE id = ?', invoiceId)).toBe(
      'partial',
    )
    expect(
      scalar<number>(ctx.userData, 'SELECT SUM(amount_poisha) FROM payments WHERE is_voided = 0'),
    ).toBe(200_000)

    // --- Full remainder via the service. ---
    await api(
      page,
      'payments.create',
      newPayment({
        patientId,
        invoiceId,
        amountPoisha: 300_000,
        method: 'cash',
        idempotencyKey: 'e2e-pay-full-01',
      }),
    )
    expect(scalar<string>(ctx.userData, 'SELECT status FROM invoices WHERE id = ?', invoiceId)).toBe('paid')

    // --- Over-payment refused (due is 0 now). ---
    const over = await apiExpectError(
      page,
      'payments.create',
      newPayment({
        patientId,
        invoiceId,
        amountPoisha: 100_000,
        method: 'cash',
        idempotencyKey: 'e2e-pay-over-01',
      }),
    )
    expect(over.code).toBe('CONFLICT')
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM payments')).toBe(2)

    // --- Idempotent payment submission: one row only. ---
    await api(
      page,
      'payments.create',
      newPayment({
        patientId,
        invoiceId,
        amountPoisha: 300_000,
        method: 'cash',
        idempotencyKey: 'e2e-pay-full-01',
      }),
    )
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM payments')).toBe(2)

    // --- Summary excludes voided, arithmetic over integer poisha. ---
    let summary = await api(page, 'payments.summary', { preset: 'today' })
    expect(summary.totalPoisha).toBe(500_000)
    expect(summary.count).toBe(2)

    // --- Void the full payment → due returns; summary drops it. ---
    const fullPayment = one<{ id: number }>(
      ctx.userData,
      'SELECT id FROM payments WHERE idempotency_key = ?',
      'e2e-pay-full-01',
    )
    await api(page, 'payments.void', { id: fullPayment!.id, reason: 'Wrong amount' })
    summary = await api(page, 'payments.summary', { preset: 'today' })
    expect(summary.totalPoisha).toBe(200_000)
    expect(summary.count).toBe(1)
    expect(
      scalar<number>(ctx.userData, 'SELECT SUM(amount_poisha) FROM payments WHERE is_voided = 0'),
    ).toBe(200_000)

    // Double-void refused.
    const twice = await apiExpectError(page, 'payments.void', {
      id: fullPayment!.id,
      reason: 'Again',
    })
    expect(twice.code).toBe('CONFLICT')

    await ctx.close()

    // --- Post-close authoritative state ---
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM payments')).toBe(2)
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM payments WHERE is_voided = 1')).toBe(1)
    expect(scalar<number>(ctx.userData, 'SELECT total_poisha FROM invoices WHERE id = ?', invoiceId)).toBe(
      500_000,
    )
    expect(
      scalar<number>(
        ctx.userData,
        "SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'payment.%' OR action LIKE 'invoice.%'",
      ),
    ).toBeGreaterThanOrEqual(3)
    const methods = all<{ method: string }>(ctx.userData, 'SELECT DISTINCT method FROM payments')
    expect(methods.map((m) => m.method).sort()).toEqual(['bkash', 'cash'])
  })
})
