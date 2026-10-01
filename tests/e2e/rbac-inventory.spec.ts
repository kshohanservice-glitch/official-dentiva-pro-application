/**
 * RBAC at the service layer (financial masking + forbidden channels after a
 * real role-scoped login) and inventory movement integrity (stock math,
 * low-stock/expiry alerts, negative-stock refusal).
 */
import { test, expect } from '@playwright/test'
import {
  ADMIN_PASSWORD,
  TREATMENT_ARGS,
  all,
  api,
  apiExpectError,
  completeSetup,
  launch,
  login,
  newAdjustment,
  newInvoice,
  newInvoiceItem,
  newPatient,
  newPayment,
  newUser,
  one,
  patientsArgs,
  scalar,
} from './helpers'
import type { Ctx } from './helpers'

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}

async function moneyFixture(ctx: Ctx): Promise<{ patientId: number; invoiceId: number }> {
  const patient = await api(ctx.page, 'patients.create', newPatient('RBAC Money Patient', '01712345506'))
  const inv = await api(
    ctx.page,
    'invoices.create',
    newInvoice({
      patientId: patient.id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      items: [newInvoiceItem('Crown Prep', 500_000)],
      idempotencyKey: 'e2e-rbac-money-01',
    }),
  )
  await api(
    ctx.page,
    'payments.create',
    newPayment({
      patientId: patient.id,
      invoiceId: inv.id,
      amountPoisha: 500_000,
      method: 'cash',
      idempotencyKey: 'e2e-rbac-pay-01',
    }),
  )
  return { patientId: patient.id, invoiceId: inv.id }
}

test.describe('RBAC enforcement', () => {
  test('dentist login: clinical reads allowed, financial writes refused, money masked', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'rbac-admin' })
    await moneyFixture(ctx)

    // Admin sees the real money.
    const adminDash = await api(page, 'dashboard.get', {})
    expect(adminDash.todayRevenuePoisha).toBe(500_000)
    expect(adminDash.methodBreakdown.some((m) => m.method === 'cash')).toBe(true)

    // Provision a dentist-scoped user through the real user service.
    const roles = await api(page, 'roles.list', {})
    const dentistRole = roles.find((r) => r.name === 'Dentist')
    expect(dentistRole).toBeTruthy()
    await api(
      page,
      'users.save',
      newUser({
        username: 'e2e-dentist',
        displayName: 'Dr. RBAC Dentist',
        password: ADMIN_PASSWORD,
        roleIds: [dentistRole!.id],
      }),
    )

    // Switch identities through the real login screen.
    await api(page, 'session.logout', {})
    await login(page, 'e2e-dentist', ADMIN_PASSWORD)

    // Allowed: clinical and catalog reads.
    const patients = await api(page, 'patients.list', patientsArgs())
    expect(patients.total).toBeGreaterThanOrEqual(1)
    await api(page, 'treatments.list', TREATMENT_ARGS)

    // Refused: financial write, money report surfaces, security surfaces.
    expect(
      (
        await apiExpectError(
          page,
          'payments.create',
          newPayment({
            patientId: 1,
            invoiceId: null,
            amountPoisha: 100,
            method: 'cash',
            idempotencyKey: 'e2e-forbidden-01',
          }),
        )
      ).code,
    ).toBe('FORBIDDEN')
    expect((await apiExpectError(page, 'backup.create', { kind: 'manual' })).code).toBe('FORBIDDEN')
    expect(
      (
        await apiExpectError(
          page,
          'users.save',
          newUser({
            username: 'sneaky',
            displayName: 'Sneaky',
            password: ADMIN_PASSWORD,
            roleIds: [dentistRole!.id],
          }),
        )
      ).code,
    ).toBe('FORBIDDEN')
    expect((await apiExpectError(page, 'roles.list', {})).code).toBe('FORBIDDEN')

    // Dashboard money is masked for roles without financial visibility.
    const masked = await api(page, 'dashboard.get', {})
    expect(masked.todayRevenuePoisha).toBe(0)
    expect(masked.outstandingPoisha).toBe(0)
    expect(masked.methodBreakdown).toHaveLength(0)

    // The refused writes left no trace.
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM payments')).toBe(1)
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM backup_records')).toBe(0)
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM users')).toBe(2)

    await ctx.close()
    // Role link persisted; the extra user never became an admin.
    expect(
      scalar<number>(
        ctx.userData,
        `SELECT COUNT(*) FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         WHERE u.username = 'e2e-dentist' AND r.name = 'Dentist'`,
      ),
    ).toBe(1)
    expect(
      scalar<number>(
        ctx.userData,
        `SELECT COUNT(*) FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         WHERE u.username = 'e2e-dentist' AND r.name LIKE 'Administrator%'`,
      ),
    ).toBe(0)
  })
})

test.describe('inventory integrity', () => {
  test('stock math, low-stock + expiry alerts, negative-stock refusal', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'inv-admin' })

    const item = await api(page, 'inventory.save', {
      id: null,
      sku: 'GLOVE-M-E2E',
      name: 'Nitrile Gloves (M)',
      category: 'PPE',
      unit: 'box',
      supplierId: null,
      purchasePricePoisha: 120_000,
      salePricePoisha: 150_000,
      reorderLevel: 10,
      expiryDate: tomorrow(),
      batchNumber: 'B-01',
      isActive: true,
      notes: 'E2E stock item',
    })

    // Receive 50, consume 45 → 5 left (≤ reorder level 10).
    const afterPurchase = await api(
      page,
      'inventory.adjust',
      newAdjustment({
        itemId: item.id,
        type: 'purchase',
        quantity: 50,
        unitPricePoisha: 120_000,
        reference: 'PO-E2E-1',
        note: 'Initial stock',
      }),
    )
    expect(afterPurchase.receivedQty - afterPurchase.usedQty).toBe(50)

    const afterUse = await api(
      page,
      'inventory.adjust',
      newAdjustment({ itemId: item.id, type: 'usage', quantity: -45, note: 'Chair usage' }),
    )
    expect(afterUse.receivedQty - afterUse.usedQty).toBe(5)

    const alerts = await api(page, 'inventory.alerts', {})
    expect(alerts.lowStock.some((i) => i.id === item.id)).toBe(true)
    expect(alerts.expiring.some((i) => i.id === item.id)).toBe(true)

    // Cannot go below zero.
    const negative = await apiExpectError(
      page,
      'inventory.adjust',
      newAdjustment({ itemId: item.id, type: 'usage', quantity: -99 }),
    )
    expect(negative.code).toBe('CONFLICT')
    expect(
      scalar<number>(ctx.userData, 'SELECT received_qty - used_qty FROM inventory_items WHERE id = ?', item.id),
    ).toBe(5)

    // Refused adjustment wrote no transaction row.
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM inventory_transactions')).toBe(2)
    const txns = all<{ type: string; quantity: number }>(
      ctx.userData,
      'SELECT type, quantity FROM inventory_transactions ORDER BY id',
    )
    expect(txns).toEqual([
      { type: 'purchase', quantity: 50 },
      { type: 'usage', quantity: -45 },
    ])
    expect(
      scalar<number>(ctx.userData, "SELECT COUNT(*) FROM audit_logs WHERE action = 'inventory.adjust'"),
    ).toBe(2)
    expect(
      one<Record<string, string>>(ctx.userData, 'SELECT expiry_date FROM inventory_items WHERE id = ?', item.id)
        ?.expiry_date,
    ).toBe(tomorrow())

    await ctx.close()
  })
})
