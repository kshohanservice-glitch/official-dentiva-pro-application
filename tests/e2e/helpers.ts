/**
 * Shared E2E helpers: isolated application profiles, activation bootstrap,
 * renderer-bridge API access, setup/login flows, and direct SQLite assertions
 * against the app's own persisted database (WAL, foreign keys — read-only).
 *
 * Every test launches its own profile under the OS temp dir (APPDATA /
 * XDG_CONFIG_HOME redirected) so suites never touch production or each other.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { writeActivationState } from '../../src/main/security/activation'
import type { ChannelName, ChannelRequest, ResponseMap } from '../../src/shared/ipc'

export const ROOT = join(__dirname, '..', '..')
export const ARTIFACTS = join(ROOT, 'artifacts', 'e2e')

/** ≥10 chars, mixed classes — satisfies every app password rule. */
export const ADMIN_PASSWORD = 'E2eAdmin!2026'

export interface IpcFailure {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export interface Ctx {
  app: ElectronApplication
  page: Page
  userData: string
  profileRoot: string
  close(): Promise<void>
}

type WindowBridge = { dentiva: { invoke(channel: string, request: unknown): Promise<unknown> } }

/** Raw IpcResult (never throws) — use when asserting error codes. */
export async function apiRaw<C extends ChannelName>(
  page: Page,
  channel: C,
  request: ChannelRequest<C>,
): Promise<unknown> {
  return page.evaluate(
    ([c, r]) => (window as unknown as WindowBridge).dentiva.invoke(c, r),
    [channel, request] as [string, unknown],
  )
}

/** Unwrapped response — resolves with data, rejects with {code,message} attached. */
export async function api<C extends ChannelName>(
  page: Page,
  channel: C,
  request: ChannelRequest<C>,
): Promise<ResponseMap[C]> {
  const res = (await apiRaw(page, channel, request)) as { ok: true; data: ResponseMap[C] } | IpcFailure
  if (!res.ok) {
    throw Object.assign(new Error(res.error.message), { code: res.error.code })
  }
  return res.data
}

export async function apiExpectError<C extends ChannelName>(
  page: Page,
  channel: C,
  request: ChannelRequest<C>,
): Promise<{ code: string; message: string }> {
  const res = (await apiRaw(page, channel, request)) as { ok: true } | IpcFailure
  if (res.ok) throw new Error(`${channel} unexpectedly succeeded`)
  return { code: res.error.code, message: res.error.message }
}

/**
 * Launch the packaged-at-repo-root Electron app against a fresh temp profile.
 * Activation is written through the app's own writeActivationState() (HMAC over
 * the embedded verifier) — no code, secret, or bypass lives in the test.
 */
export function appDataRootOf(profileRoot: string): string {
  return process.platform === 'win32' ? join(profileRoot, 'Roaming') : join(profileRoot, 'config')
}

export async function launch(
  opts: { activate?: boolean; profileRoot?: string } = {},
): Promise<Ctx> {
  const activate = opts.activate !== false
  const profileRoot = opts.profileRoot ?? mkdtempSync(join(tmpdir(), 'dentiva-e2e-'))
  const appDataRoot = appDataRootOf(profileRoot)
  mkdirSync(appDataRoot, { recursive: true })

  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: ROOT,
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      XDG_CONFIG_HOME: appDataRoot,
      HOME: profileRoot,
      USERPROFILE: profileRoot,
    },
  })

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
  if (activate) {
    mkdirSync(userData, { recursive: true })
    writeActivationState(userData, Date.now())
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { dentiva?: { invoke?: unknown } }).dentiva?.invoke ===
      'function',
  )

  if (activate) {
    // Dispatcher re-reads the activation file on every dispatch — poll until
    // the gate is genuinely open before any workflow step runs.
    await expect
      .poll(
        async () => {
          const s = (await apiRaw(page, 'app.status', {})) as {
            ok: true
            data: { activated: boolean }
          }
          return s.data.activated
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    // The renderer may have fetched app.status before the file landed; reboot
    // it once so the phase machine observes the activated state.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { dentiva?: { invoke?: unknown } }).dentiva?.invoke ===
        'function',
    )
  }

  return {
    app,
    page,
    userData,
    profileRoot,
    close: async () => {
      await app.close()
    },
  }
}

/* ------------------------------------------------------------------ */
/* Renderer-side helpers                                               */
/* ------------------------------------------------------------------ */

/** A `.field` wrapper by visible label (labels are not always associated). */
export function field(
  scope: Page | ReturnType<Page['locator']>,
  label: string | RegExp,
): ReturnType<Page['locator']> {
  return scope.locator('.field').filter({ hasText: label }).locator('input, textarea, select')
}

export async function expectToast(page: Page, kind: 'success' | 'error', text?: string | RegExp): Promise<void> {
  const toast = page.locator(`.toast.${kind}`).first()
  await expect(toast).toBeVisible({ timeout: 20_000 })
  if (text !== undefined) await expect(toast).toContainText(text)
}

export async function login(page: Page, username: string, password: string): Promise<void> {
  await expect(page.locator('#login-user')).toBeVisible({ timeout: 20_000 })
  await page.fill('#login-user', username)
  await page.fill('#login-pass', password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 20_000 })
}

export async function waitShell(page: Page): Promise<void> {
  await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 20_000 })
}

/** Complete first-run setup through the real IPC service (same payload the wizard sends). */
export async function completeSetup(
  page: Page,
  over: {
    clinicName?: string
    adminName?: string
    username?: string
    password?: string
    autoLockMinutes?: 5 | 10 | 15 | 30
    backupFolder?: string | null
    designations?: string[]
    qualifications?: string[]
  } = {},
): Promise<void> {
  const password = over.password ?? ADMIN_PASSWORD
  await api(page, 'setup.complete', {
    clinic: {
      clinicName: over.clinicName ?? 'E2E Test Dental',
      address: 'House 1, Road 1, Dhaka 1200',
      phone: '01712340001',
      email: 'clinic@example.test',
      website: '',
      registrationInfo: 'Reg-BD-0001',
      operatingHours: 'Sat–Thu 10:00–18:00',
      logoPath: null,
      footerNote: '',
      prescriptionFooter: 'Get well soon.',
      invoiceFooter: 'Thank you.',
    },
    dentists: [
      {
        fullName: over.adminName ?? 'Dr. E2E Test',
        phone: '01712340002',
        email: 'doctor@example.test',
        bio: '',
        designations: over.designations ?? ['BDS', 'FCPS'],
        qualifications: over.qualifications ?? ['MBBS-equivalent DD', 'Cert. Endo'],
      },
    ],
    admin: {
      displayName: over.adminName ?? 'Dr. E2E Test',
      username: over.username ?? 'e2e-admin',
      password,
    },
    autoLockMinutes: over.autoLockMinutes ?? 15,
    backupFolder: over.backupFolder ?? null,
    printerName: null,
    paperSize: 'A4',
    suggestedPrinters: false,
  })
  // The bridge completed setup server-side; re-boot the renderer so its
  // state machine observes the authenticated session.
  await page.reload()
  await waitShell(page)
}

/* ------------------------------------------------------------------ */
/* Direct database assertions (authoritative persisted state)          */
/* ------------------------------------------------------------------ */

export function openDb(userData: string): Database.Database {
  return new Database(join(userData, 'dentiva.db'), { readonly: true })
}

export function all<T = Record<string, unknown>>(
  userData: string,
  sql: string,
  ...params: unknown[]
): T[] {
  const db = openDb(userData)
  try {
    return db.prepare(sql).all(...(params as never[])) as T[]
  } finally {
    db.close()
  }
}

export function one<T = Record<string, unknown>>(
  userData: string,
  sql: string,
  ...params: unknown[]
): T | undefined {
  const db = openDb(userData)
  try {
    return db.prepare(sql).get(...(params as never[])) as T | undefined
  } finally {
    db.close()
  }
}

export function scalar<T = number>(
  userData: string,
  sql: string,
  ...params: unknown[]
): T | undefined {
  const row = one<Record<string, T>>(userData, sql, ...params)
  if (!row) return undefined
  return Object.values(row)[0]
}

/* ------------------------------------------------------------------ */
/* Payload builders — ChannelRequest is the zod OUTPUT type (defaults   */
/* already applied), so callers must supply every defaulted field.      */
/* These keep specs strict-typed without hand-repeating boilerplate.    */
/* ------------------------------------------------------------------ */

type Req<C extends ChannelName> = ChannelRequest<C>

export function newPatient(
  fullName: string,
  phone: string,
  extra: Partial<Req<'patients.create'>> = {},
): Req<'patients.create'> {
  return {
    fullName,
    phone,
    gender: null,
    dob: null,
    ageYears: null,
    bloodGroup: '',
    emergencyPhone: '',
    emergencyContact: '',
    address: '',
    presentingProblem: '',
    previousHistory: '',
    allergies: '',
    medicalHistory: '',
    notes: '',
    preferredLanguage: '',
    ...extra,
  }
}

export function newInvoiceItem(
  name: string,
  unitPricePoisha: number,
  quantity = 1,
): NonNullable<Req<'invoices.create'>['items']>[number] {
  return { treatmentId: null, name, quantity, unitPricePoisha, discountPoisha: 0 }
}

export function newPayment(p: {
  patientId: number
  invoiceId: number | null
  amountPoisha: number
  method: Req<'payments.create'>['method']
  idempotencyKey: string
  reference?: string
  notes?: string
}): Req<'payments.create'> {
  return {
    patientId: p.patientId,
    invoiceId: p.invoiceId,
    amountPoisha: p.amountPoisha,
    method: p.method,
    reference: p.reference ?? '',
    notes: p.notes ?? '',
    idempotencyKey: p.idempotencyKey,
  }
}

export function newRx(
  p: Omit<
    Req<'prescriptions.create'>,
    'notes' | 'visitId' | 'onExamination' | 'restExamination'
  > &
    Partial<Pick<Req<'prescriptions.create'>, 'onExamination' | 'restExamination'>>,
): Req<'prescriptions.create'> {
  return { notes: '', visitId: null, onExamination: '', restExamination: '', ...p }
}

export const TREATMENT_ARGS: Req<'treatments.list'> = { includeInactive: false, search: '' }
export const DENTIST_ARGS: Req<'dentists.list'> = { includeInactive: false }

export function patientsArgs(
  extra: Partial<Req<'patients.list'>> = {},
): Req<'patients.list'> {
  return { search: '', preset: 'all', status: 'active', sort: 'registered_desc', page: 1, pageSize: 25, ...extra }
}

export function newVisit(p: {
  patientId: number
  dentistId: number
  visitedAt?: number
  chiefComplaint?: string
  diagnosis?: string
}): Req<'visits.create'> {
  return {
    patientId: p.patientId,
    dentistId: p.dentistId,
    appointmentId: null,
    visitedAt: p.visitedAt,
    chiefComplaint: p.chiefComplaint ?? '',
    examination: '',
    findings: '',
    diagnosis: p.diagnosis ?? '',
    treatmentPerformed: '',
    treatmentPlan: '',
    advice: '',
    followUpAt: null,
    notes: '',
    clinicalOptions: [],
    treatments: [],
  }
}

export function newTreatment(
  name: string,
  category: string,
  defaultPricePoisha: number,
  code = '',
): Req<'treatments.save'> {
  return {
    id: null,
    code,
    name,
    category,
    defaultPricePoisha,
    description: '',
    durationMinutes: 0,
    isActive: true,
  }
}

export function newAppointment(p: {
  patientId: number
  dentistId: number
  startsAt: number
  endsAt: number
  reason?: string
}): Req<'appointments.create'> {
  return { ...p, reason: p.reason ?? '', notes: '' }
}

export function newChartEntry(p: {
  patientId: number
  fdi: string
  conditionCode: string
  severity?: 'mild' | 'moderate' | 'severe'
  notes?: string
}): Req<'chart.setEntry'> {
  return { ...p, severity: p.severity ?? null, notes: p.notes ?? '', visitId: null }
}

export function newUser(p: {
  username: string
  displayName: string
  roleIds: number[]
  password?: string
}): Req<'users.save'> {
  return {
    id: null,
    username: p.username,
    displayName: p.displayName,
    staffId: null,
    password: p.password,
    isActive: true,
    roleIds: p.roleIds,
  }
}

export function newAdjustment(p: {
  itemId: number
  type: Req<'inventory.adjust'>['type']
  quantity: number
  unitPricePoisha?: number | null
  reference?: string
  note?: string
}): Req<'inventory.adjust'> {
  return {
    itemId: p.itemId,
    type: p.type,
    quantity: p.quantity,
    unitPricePoisha: p.unitPricePoisha ?? null,
    reference: p.reference ?? '',
    note: p.note ?? '',
  }
}

export function newInvoice(p: {
  patientId: number
  invoiceDate: string
  items: NonNullable<Req<'invoices.create'>['items']>
  idempotencyKey: string
  adjustmentPoisha?: number
  notes?: string
  visitId?: number | null
}): Req<'invoices.create'> {
  return {
    patientId: p.patientId,
    invoiceDate: p.invoiceDate,
    items: p.items,
    idempotencyKey: p.idempotencyKey,
    adjustmentPoisha: p.adjustmentPoisha ?? 0,
    notes: p.notes ?? '',
    visitId: p.visitId ?? null,
  }
}
