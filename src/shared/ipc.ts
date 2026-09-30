/**
 * IPC contract: every channel the renderer may call, with its Zod request schema
 * and required permission(s). The main dispatcher validates schema → session →
 * permissions → handler, in that order. The renderer never gains access by
 * bypassing UI: this table is enforced in the trusted process.
 */

import { z } from 'zod';
import type { Permission } from './permissions';
import type {
  AppointmentRecord,
  AttachmentRecord,
  AuditLogRecord,
  BackupRecord,
  BackupStatus,
  ChartEntry,
  ClinicConfig,
  DashboardData,
  DentistRecord,
  ExpenseCategoryRecord,
  ExpenseRecord,
  InventoryItemRecord,
  InventoryTransaction,
  InvoiceRecord,
  MedicineCatalogItem,
  NotificationRecord,
  OtherIncomeRecord,
  Paged,
  PatientRecord,
  PatientSummary,
  PaymentRecord,
  PrescriptionRecord,
  PrinterInfo,
  PrinterProfileRecord,
  QueueEntry,
  RoleSummary,
  SearchResult,
  SessionState,
  StaffRecord,
  SupplierRecord,
  TimelineEvent,
  TreatmentDef,
  UserSummary,
  VisitRecord,
  AppStatus,
  DailyRevenueRow,
  MethodBreakdownRow,
  CategorySpendRow,
  ReportSummary,
} from './types';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const zPhone = z
  .string()
  .trim()
  .regex(/^(?:\+?880|0)?1[3-9]\d{8}$/, 'Enter a valid Bangladeshi phone number (11 digits, e.g. 01712345678)')
  .or(z.literal(''));
export const zMoney = z.number().int('Amount must be an integer number of poisha');
export const zPage = z.number().int().min(1).default(1);
export const zPageSize = z.number().int().min(1).max(200).default(25);

const zPaging = { page: zPage, pageSize: zPageSize };

export interface ChannelDef<Req> {
  request: z.ZodType<Req, z.ZodTypeDef, unknown>;
  permission: Permission[] | null; // null = any authenticated (unlocked) session
}

const chan = <Req>(
  request: z.ZodType<Req, z.ZodTypeDef, unknown>,
  permission: Permission[] | null,
): ChannelDef<Req> => ({ request, permission });

/* ------------------------------------------------------------------ */
/* Channel map                                                         */
/* ------------------------------------------------------------------ */

const zEmpty = z.object({});

export const channelDefs = {
  /* --- system / session / activation / setup ---------------------- */
  'app.status': chan(zEmpty, null),
  'activation.verify': chan(z.object({ code: z.string().min(1).max(128) }), null),
  'setup.complete': chan(
    z.object({
      clinic: z.object({
        clinicName: z.string().trim().min(1).max(160),
        address: z.string().trim().max(500).default(''),
        phone: z.string().trim().max(32).default(''),
        email: z.string().trim().max(120).default(''),
        website: z.string().trim().max(160).default(''),
        registrationInfo: z.string().trim().max(200).default(''),
        operatingHours: z.string().trim().max(200).default(''),
        logoPath: z.string().nullable().default(null),
        footerNote: z.string().trim().max(300).default(''),
        prescriptionFooter: z.string().trim().max(300).default(''),
        invoiceFooter: z.string().trim().max(300).default(''),
      }),
      dentists: z
        .array(
          z.object({
            fullName: z.string().trim().min(1).max(120),
            phone: z.string().trim().max(32).default(''),
            email: z.string().trim().max(120).default(''),
            bio: z.string().trim().max(500).default(''),
            designations: z.array(z.string().trim().min(1).max(120)).max(12),
            qualifications: z.array(z.string().trim().min(1).max(160)).max(20),
          }),
        )
        .min(1)
        .max(50),
      admin: z.object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(40)
          .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may contain letters, digits, dot, dash, underscore'),
        password: z.string().min(8).max(128),
        displayName: z.string().trim().min(1).max(120),
      }),
      autoLockMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
      backupFolder: z.string().nullable().default(null),
      printerName: z.string().nullable().default(null),
      paperSize: z.enum(['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80']).default('A4'),
    }),
    null,
  ),
  'session.state': chan(zEmpty, null),
  'session.login': chan(
    z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }),
    null,
  ),
  'session.unlock': chan(z.object({ password: z.string().min(1).max(128) }), null),
  'session.logout': chan(zEmpty, null),
  'session.lock': chan(zEmpty, null),
  'session.activity': chan(zEmpty, null),
  'session.changePassword': chan(
    z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) }),
    null,
  ),

  /* --- clinic & settings ------------------------------------------ */
  'clinic.get': chan(zEmpty, ['settings.manage']),
  'clinic.update': chan(
    z.object({
      clinicName: z.string().trim().min(1).max(160),
      address: z.string().trim().max(500),
      phone: z.string().trim().max(32),
      email: z.string().trim().max(120),
      website: z.string().trim().max(160),
      registrationInfo: z.string().trim().max(200),
      operatingHours: z.string().trim().max(200),
      footerNote: z.string().trim().max(300),
      prescriptionFooter: z.string().trim().max(300),
      invoiceFooter: z.string().trim().max(300),
    }),
    ['settings.manage'],
  ),
  'clinic.pickLogo': chan(zEmpty, ['settings.manage']),
  'clinic.clearLogo': chan(zEmpty, ['settings.manage']),
  'settings.get': chan(z.object({}), ['settings.manage']),
  'settings.set': chan(
    z.object({
      key: z.enum([
        'autoLockMinutes',
        'backupFolder',
        'backupIntervalDays',
        'defaultPaperSize',
        'notifyAppointments',
        'notifyInventory',
        'notifyFinancial',
        'notifyBackup',
        'lowStockThresholdDefault',
      ]),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    ['settings.manage'],
  ),
  'settings.resetPrescriptionTemplate': chan(zEmpty, ['settings.manage']),
  'settings.resetInvoiceTemplate': chan(zEmpty, ['settings.manage']),

  /* --- patients ----------------------------------------------------- */
  'patients.list': chan(
    z.object({
      search: z.string().max(120).default(''),
      preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'all', 'custom']).default('all'),
      from: zDate.optional(),
      to: zDate.optional(),
      status: z.enum(['active', 'archived', 'all']).default('active'),
      sort: z.enum(['registered_desc', 'registered_asc', 'name_asc', 'last_visit']).default('registered_desc'),
      ...zPaging,
    }),
    ['patient.view'],
  ),
  'patients.get': chan(z.object({ id: z.number().int().positive() }), ['patient.view']),
  'patients.create': chan(
    z.object({
      fullName: z.string().trim().min(1).max(120),
      gender: z.enum(['male', 'female', 'other']).nullable().default(null),
      dob: zDate.nullable().default(null),
      ageYears: z.number().int().min(0).max(120).nullable().default(null),
      bloodGroup: z.string().trim().max(8).default(''),
      phone: zPhone,
      emergencyPhone: z.string().trim().max(32).default(''),
      emergencyContact: z.string().trim().max(120).default(''),
      address: z.string().trim().max(500).default(''),
      presentingProblem: z.string().trim().max(1000).default(''),
      previousHistory: z.string().trim().max(2000).default(''),
      allergies: z.string().trim().max(1000).default(''),
      medicalHistory: z.string().trim().max(2000).default(''),
      notes: z.string().trim().max(4000).default(''),
      preferredLanguage: z.string().trim().max(40).default(''),
    }),
    ['patient.create'],
  ),
  'patients.update': chan(
    z
      .object({
        id: z.number().int().positive(),
        fullName: z.string().trim().min(1).max(120),
        gender: z.enum(['male', 'female', 'other']).nullable(),
        dob: zDate.nullable(),
        ageYears: z.number().int().min(0).max(120).nullable(),
        bloodGroup: z.string().trim().max(8),
        phone: zPhone,
        emergencyPhone: z.string().trim().max(32),
        emergencyContact: z.string().trim().max(120),
        address: z.string().trim().max(500),
        presentingProblem: z.string().trim().max(1000),
        previousHistory: z.string().trim().max(2000),
        allergies: z.string().trim().max(1000),
        medicalHistory: z.string().trim().max(2000),
        notes: z.string().trim().max(4000),
        preferredLanguage: z.string().trim().max(40),
        status: z.enum(['active', 'archived']),
      })
      .partial()
      .extend({ id: z.number().int().positive() }),
    ['patient.edit'],
  ),
  'patients.timeline': chan(
    z.object({ id: z.number().int().positive(), filter: z.string().max(32).default('all'), ...zPaging }),
    ['patient.view'],
  ),
  'patients.export': chan(
    z.object({ ids: z.array(z.number().int().positive()).max(5000).optional() }),
    ['patient.export'],
  ),

  /* --- visits & clinical ------------------------------------------- */
  'visits.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      dentistId: z.number().int().positive(),
      appointmentId: z.number().int().positive().nullable().default(null),
      visitedAt: z.number().int().positive().optional(),
      chiefComplaint: z.string().trim().max(2000).default(''),
      examination: z.string().trim().max(4000).default(''),
      findings: z.string().trim().max(4000).default(''),
      diagnosis: z.string().trim().max(4000).default(''),
      treatmentPerformed: z.string().trim().max(4000).default(''),
      treatmentPlan: z.string().trim().max(4000).default(''),
      advice: z.string().trim().max(4000).default(''),
      followUpAt: z.number().int().positive().nullable().default(null),
      notes: z.string().trim().max(4000).default(''),
      clinicalOptions: z.array(z.string().max(64)).max(60).default([]),
      treatments: z
        .array(z.object({ treatmentId: z.number().int().positive(), quantity: z.number().int().min(1).max(999) }))
        .max(50)
        .default([]),
    }),
    ['clinical.create'],
  ),
  'visits.listByPatient': chan(z.object({ patientId: z.number().int().positive() }), ['clinical.view']),
  'visits.get': chan(z.object({ id: z.number().int().positive() }), ['clinical.view']),
  'clinical.options': chan(z.object({ section: z.enum(['cc', 'oe', 're']) }), ['clinical.view']),
  'clinical.optionsCreate': chan(
    z.object({ section: z.enum(['cc', 'oe', 're']), label: z.string().trim().min(1).max(200) }),
    ['clinical.edit'],
  ),

  /* --- dental chart -------------------------------------------------- */
  'chart.catalog': chan(zEmpty, ['clinical.view']),
  'chart.get': chan(z.object({ patientId: z.number().int().positive() }), ['clinical.view']),
  'chart.setEntry': chan(
    z.object({
      patientId: z.number().int().positive(),
      fdi: z.string().regex(/^\d{2}$/),
      conditionCode: z.string().max(64),
      severity: z.enum(['mild', 'moderate', 'severe']).nullable().default(null),
      notes: z.string().trim().max(1000).default(''),
      visitId: z.number().int().positive().nullable().default(null),
    }),
    ['clinical.create'],
  ),
  'chart.clearEntry': chan(
    z.object({ patientId: z.number().int().positive(), fdi: z.string().regex(/^\d{2}$/), conditionCode: z.string().max(64) }),
    ['clinical.edit'],
  ),
  'chart.addCondition': chan(
    z.object({
      code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
      label: z.string().trim().min(1).max(80),
      category: z.string().trim().min(1).max(60),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    ['clinical.edit'],
  ),

  /* --- treatments ---------------------------------------------------- */
  'treatments.list': chan(z.object({ includeInactive: z.boolean().default(false), search: z.string().max(120).default('') }), ['treatment.view']),
  'treatments.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      code: z.string().trim().max(40).default(''),
      name: z.string().trim().min(1).max(160),
      category: z.string().trim().min(1).max(80),
      defaultPricePoisha: zMoney.min(0),
      description: z.string().trim().max(1000).default(''),
      durationMinutes: z.number().int().min(0).max(600).default(0),
      isActive: z.boolean().default(true),
    }),
    ['treatment.manage'],
  ),

  /* --- appointments --------------------------------------------------- */
  'appointments.list': chan(
    z.object({
      from: zDate,
      to: zDate,
      dentistId: z.number().int().positive().optional(),
      status: z.enum(['scheduled', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled', 'all']).default('all'),
      patientId: z.number().int().positive().optional(),
    }),
    ['appointment.view'],
  ),
  'appointments.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      dentistId: z.number().int().positive(),
      startsAt: z.number().int().positive(),
      endsAt: z.number().int().positive(),
      reason: z.string().trim().max(500).default(''),
      notes: z.string().trim().max(2000).default(''),
    }),
    ['appointment.create'],
  ),
  'appointments.update': chan(
    z.object({
      id: z.number().int().positive(),
      dentistId: z.number().int().positive().optional(),
      startsAt: z.number().int().positive().optional(),
      endsAt: z.number().int().positive().optional(),
      reason: z.string().trim().max(500).optional(),
      notes: z.string().trim().max(2000).optional(),
      status: z.enum(['scheduled', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled']).optional(),
      cancelReason: z.string().trim().max(300).default(''),
    }),
    ['appointment.edit'],
  ),
  'appointments.conflicts': chan(
    z.object({ dentistId: z.number().int().positive(), startsAt: z.number().int().positive(), endsAt: z.number().int().positive(), excludeId: z.number().int().positive().optional() }),
    ['appointment.view'],
  ),

  /* --- queue ------------------------------------------------------------ */
  'queue.list': chan(z.object({ date: zDate, dentistId: z.number().int().positive().optional() }), ['appointment.view']),
  'queue.addWalkIn': chan(
    z.object({ patientId: z.number().int().positive(), dentistId: z.number().int().positive(), date: zDate }),
    ['queue.manage'],
  ),
  'queue.checkIn': chan(z.object({ appointmentId: z.number().int().positive() }), ['queue.manage']),
  'queue.advance': chan(z.object({ id: z.number().int().positive(), action: z.enum(['start', 'complete', 'skip', 'recall']) }), ['queue.manage']),
  'queue.remove': chan(z.object({ id: z.number().int().positive() }), ['queue.manage']),

  /* --- prescriptions ---------------------------------------------------- */
  'prescriptions.list': chan(
    z.object({ patientId: z.number().int().positive().optional(), ...zPaging }),
    ['prescription.view'],
  ),
  'prescriptions.get': chan(z.object({ id: z.number().int().positive() }), ['prescription.view']),
  'prescriptions.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      dentistId: z.number().int().positive(),
      visitId: z.number().int().positive().nullable().default(null),
      issuedAt: z.number().int().positive().optional(),
      chiefComplaint: z.string().trim().max(2000).default(''),
      onExamination: z.string().trim().max(4000).default(''),
      restExamination: z.string().trim().max(4000).default(''),
      advice: z.string().trim().max(4000).default(''),
      notes: z.string().trim().max(4000).default(''),
      items: z
        .array(
          z.object({
            medicineName: z.string().trim().min(1).max(160),
            form: z.string().trim().max(40).default(''),
            strength: z.string().trim().max(40).default(''),
            dose: z.string().trim().max(60).default(''),
            frequency: z.string().trim().max(60).default(''),
            timing: z.string().trim().max(80).default(''),
            beforeAfterFood: z.string().trim().max(40).default(''),
            duration: z.string().trim().max(60).default(''),
            quantity: z.string().trim().max(40).default(''),
            route: z.string().trim().max(40).default(''),
            instructions: z.string().trim().max(400).default(''),
          }),
        )
        .min(1)
        .max(40),
    }),
    ['prescription.create'],
  ),
  'prescriptions.medicines': chan(z.object({ search: z.string().max(120).default('') }), ['prescription.view']),
  'prescriptions.medicineUpsert': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      medicineName: z.string().trim().min(1).max(160),
      form: z.string().trim().max(40).default(''),
      strength: z.string().trim().max(40).default(''),
      defaultInstructions: z.string().trim().max(400).default(''),
    }),
    ['prescription.create'],
  ),

  /* --- invoices ------------------------------------------------------------ */
  'invoices.list': chan(
    z.object({
      search: z.string().max(120).default(''),
      status: z.enum(['unpaid', 'partial', 'paid', 'all']).default('all'),
      preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'all', 'custom']).default('all'),
      from: zDate.optional(),
      to: zDate.optional(),
      patientId: z.number().int().positive().optional(),
      ...zPaging,
    }),
    ['invoice.view'],
  ),
  'invoices.get': chan(z.object({ id: z.number().int().positive() }), ['invoice.view']),
  'invoices.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      visitId: z.number().int().positive().nullable().default(null),
      invoiceDate: zDate,
      adjustmentPoisha: zMoney.default(0),
      notes: z.string().trim().max(1000).default(''),
      items: z
        .array(
          z.object({
            treatmentId: z.number().int().positive().nullable().default(null),
            name: z.string().trim().min(1).max(200),
            quantity: z.number().int().min(1).max(9999),
            unitPricePoisha: zMoney.min(0),
            discountPoisha: zMoney.min(0).default(0),
          }),
        )
        .min(1)
        .max(200),
      idempotencyKey: z.string().min(8).max(64),
    }),
    ['invoice.create'],
  ),
  'invoices.void': chan(
    z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }),
    ['invoice.void'],
  ),

  /* --- payments ----------------------------------------------------------- */
  'payments.list': chan(
    z.object({
      preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'all', 'custom']).default('today'),
      from: zDate.optional(),
      to: zDate.optional(),
      method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other', 'all']).default('all'),
      patientId: z.number().int().positive().optional(),
      includeVoided: z.boolean().default(false),
      ...zPaging,
    }),
    ['payment.view'],
  ),
  'payments.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      invoiceId: z.number().int().positive().nullable(),
      amountPoisha: zMoney.positive(),
      method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']),
      reference: z.string().trim().max(120).default(''),
      paidAt: z.number().int().positive().optional(),
      notes: z.string().trim().max(1000).default(''),
      idempotencyKey: z.string().min(8).max(64),
    }),
    ['payment.create'],
  ),
  'payments.void': chan(
    z.object({ id: z.number().int().positive(), reason: z.string().trim().min(1).max(300) }),
    ['payment.void'],
  ),
  'payments.summary': chan(
    z.object({ preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']), from: zDate.optional(), to: zDate.optional() }),
    ['payment.view'],
  ),

  /* --- inventory ----------------------------------------------------------- */
  'inventory.list': chan(
    z.object({ search: z.string().max(120).default(''), category: z.string().max(80).default('all'), lowStockOnly: z.boolean().default(false), includeInactive: z.boolean().default(false), ...zPaging }),
    ['inventory.view'],
  ),
  'inventory.get': chan(z.object({ id: z.number().int().positive() }), ['inventory.view']),
  'inventory.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      sku: z.string().trim().min(1).max(60),
      name: z.string().trim().min(1).max(160),
      category: z.string().trim().min(1).max(80),
      unit: z.string().trim().min(1).max(40),
      supplierId: z.number().int().positive().nullable().default(null),
      purchasePricePoisha: zMoney.min(0),
      salePricePoisha: zMoney.min(0),
      reorderLevel: z.number().int().min(0).max(1_000_000),
      expiryDate: zDate.nullable().default(null),
      batchNumber: z.string().trim().max(60).default(''),
      isActive: z.boolean().default(true),
      notes: z.string().trim().max(2000).default(''),
    }),
    ['inventory.manage'],
  ),
  'inventory.adjust': chan(
    z.object({
      itemId: z.number().int().positive(),
      type: z.enum(['purchase', 'usage', 'adjustment', 'wastage', 'return']),
      quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Quantity cannot be zero'),
      unitPricePoisha: zMoney.min(0).nullable().default(null),
      reference: z.string().trim().max(120).default(''),
      note: z.string().trim().max(500).default(''),
    }),
    ['inventory.manage'],
  ),
  'inventory.transactions': chan(z.object({ itemId: z.number().int().positive(), ...zPaging }), ['inventory.view']),
  'inventory.alerts': chan(zEmpty, ['inventory.view']),
  'inventory.exportCsv': chan(zEmpty, ['inventory.manage']),

  /* --- suppliers ------------------------------------------------------------ */
  'suppliers.list': chan(zEmpty, ['inventory.view']),
  'suppliers.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(1).max(160),
      contactPerson: z.string().trim().max(120).default(''),
      phone: z.string().trim().max(32).default(''),
      email: z.string().trim().max(120).default(''),
      address: z.string().trim().max(300).default(''),
      notes: z.string().trim().max(1000).default(''),
      isActive: z.boolean().default(true),
    }),
    ['supplier.manage'],
  ),

  /* --- accounting ----------------------------------------------------------- */
  'accounting.expenseCategories': chan(zEmpty, ['accounting.view']),
  'accounting.expenseCategorySave': chan(
    z.object({ id: z.number().int().positive().nullable().default(null), name: z.string().trim().min(1).max(80), isActive: z.boolean().default(true) }),
    ['accounting.manage'],
  ),
  'accounting.expenses': chan(
    z.object({ preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']), from: zDate.optional(), to: zDate.optional(), categoryId: z.number().int().positive().optional(), ...zPaging }),
    ['accounting.view'],
  ),
  'accounting.expenseSave': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      categoryId: z.number().int().positive(),
      amountPoisha: zMoney.positive(),
      spentOn: zDate,
      method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']),
      description: z.string().trim().max(500).default(''),
    }),
    ['accounting.manage'],
  ),
  'accounting.otherIncome': chan(
    z.object({ preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']), from: zDate.optional(), to: zDate.optional(), ...zPaging }),
    ['accounting.view'],
  ),
  'accounting.otherIncomeSave': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      title: z.string().trim().min(1).max(160),
      amountPoisha: zMoney.positive(),
      receivedOn: zDate,
      method: z.enum(['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']),
      notes: z.string().trim().max(500).default(''),
    }),
    ['accounting.manage'],
  ),

  /* --- reports ----------------------------------------------------------------- */
  'reports.range': chan(
    z.object({ preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']), from: zDate.optional(), to: zDate.optional() }),
    ['financial.report.view'],
  ),
  'reports.daily': chan(
    z.object({ from: zDate, to: zDate }),
    ['financial.report.view'],
  ),
  'reports.methods': chan(
    z.object({ preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']), from: zDate.optional(), to: zDate.optional() }),
    ['financial.report.view'],
  ),
  'reports.expenses': chan(
    z.object({ from: zDate, to: zDate }),
    ['financial.report.view'],
  ),
  'reports.treatmentRevenue': chan(
    z.object({ from: zDate, to: zDate }),
    ['financial.report.view'],
  ),

  /* --- staff & users ---------------------------------------------------------- */
  'staff.list': chan(z.object({ includeInactive: z.boolean().default(false) }), ['staff.view']),
  'staff.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      fullName: z.string().trim().min(1).max(120),
      dob: zDate.nullable().default(null),
      gender: z.enum(['male', 'female', 'other']).nullable().default(null),
      bloodGroup: z.string().trim().max(8).default(''),
      address: z.string().trim().max(400).default(''),
      phone: z.string().trim().max(32).default(''),
      idNumber: z.string().trim().max(60).default(''),
      section: z.string().trim().max(80).default(''),
      salaryPoisha: zMoney.min(0).default(0),
      joiningDate: zDate.nullable().default(null),
      status: z.enum(['active', 'inactive']).default('active'),
      notes: z.string().trim().max(2000).default(''),
    }),
    ['staff.manage'],
  ),
  'dentists.list': chan(z.object({ includeInactive: z.boolean().default(false) }), ['staff.view']),
  'dentists.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      fullName: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(32).default(''),
      email: z.string().trim().max(120).default(''),
      bio: z.string().trim().max(500).default(''),
      isActive: z.boolean().default(true),
      designations: z.array(z.string().trim().min(1).max(120)).max(12),
      qualifications: z.array(z.string().trim().min(1).max(160)).max(20),
    }),
    ['staff.manage'],
  ),
  'users.list': chan(zEmpty, ['user.manage']),
  'users.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      username: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may contain letters, digits, dot, dash, underscore'),
      displayName: z.string().trim().min(1).max(120),
      staffId: z.number().int().positive().nullable().default(null),
      password: z.string().min(8).max(128).optional(),
      isActive: z.boolean().default(true),
      roleIds: z.array(z.number().int().positive()).min(1).max(20),
    }),
    ['user.manage'],
  ),
  'users.resetPassword': chan(
    z.object({ id: z.number().int().positive(), newPassword: z.string().min(8).max(128) }),
    ['user.manage'],
  ),
  'roles.list': chan(zEmpty, ['role.manage']),
  'roles.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).default(''),
      permissions: z.array(z.string().max(64)).max(120),
    }),
    ['role.manage'],
  ),

  /* --- referrals ----------------------------------------------------------------- */
  'referrals.list': chan(z.object({ patientId: z.number().int().positive().optional(), ...zPaging }), ['referral.view']),
  'referrals.create': chan(
    z.object({
      patientId: z.number().int().positive(),
      visitId: z.number().int().positive().nullable().default(null),
      referredTo: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(1).max(1000),
      notes: z.string().trim().max(2000).default(''),
      referredOn: zDate,
      followUpOn: zDate.nullable().default(null),
      status: z.enum(['pending', 'completed', 'cancelled']).default('pending'),
    }),
    ['referral.manage'],
  ),
  'referrals.update': chan(
    z.object({ id: z.number().int().positive(), status: z.enum(['pending', 'completed', 'cancelled']), notes: z.string().trim().max(2000).default(''), followUpOn: zDate.nullable().default(null) }),
    ['referral.manage'],
  ),

  /* --- attachments ------------------------------------------------------------------ */
  'attachments.list': chan(z.object({ entityType: z.string().max(40), entityId: z.number().int().positive() }), ['attachment.view']),
  'attachments.pick': chan(
    z.object({ entityType: z.string().max(40), entityId: z.number().int().positive(), patientId: z.number().int().positive().nullable().default(null), description: z.string().trim().max(300).default('') }),
    ['attachment.upload'],
  ),
  'attachments.open': chan(z.object({ id: z.number().int().positive() }), ['attachment.view']),
  'attachments.delete': chan(z.object({ id: z.number().int().positive() }), ['attachment.delete']),

  /* --- dashboard, search, notifications ------------------------------------------------ */
  'dashboard.get': chan(zEmpty, null),
  'search.global': chan(
    z.object({ query: z.string().trim().min(1).max(120), kinds: z.array(z.string().max(24)).max(12).default([]) }),
    ['search.global'],
  ),
  'notifications.list': chan(z.object({ ...zPaging }), ['notification.view']),
  'notifications.markRead': chan(z.object({ id: z.number().int().positive() }), ['notification.view']),
  'notifications.markAllRead': chan(zEmpty, ['notification.view']),

  /* --- audit ---------------------------------------------------------------------------- */
  'audit.list': chan(
    z.object({ search: z.string().max(120).default(''), action: z.string().max(60).default(''), preset: z.enum(['today', 'last7', 'last30', 'last90', 'last365', 'custom']).default('last30'), from: zDate.optional(), to: zDate.optional(), ...zPaging }),
    ['audit.view'],
  ),

  /* --- backup & restore ----------------------------------------------------------------- */
  'backup.status': chan(zEmpty, ['backup.create']),
  'backup.pickFolder': chan(zEmpty, ['settings.manage']),
  'backup.create': chan(z.object({ kind: z.enum(['manual', 'auto']).default('manual') }), ['backup.create']),
  'backup.pickFiles': chan(zEmpty, ['backup.restore']),
  'backup.restore': chan(
    z.object({ filePath: z.string().min(1).max(4096), confirmPhrase: z.string().max(120).default('') }),
    ['backup.restore'],
  ),
  'backup.records': chan(zEmpty, ['backup.create']),

  /* --- printers & profiles ---------------------------------------------------------------- */
  'printers.list': chan(zEmpty, ['prescription.print']),
  'printerProfiles.list': chan(zEmpty, ['settings.manage']),
  'printerProfiles.save': chan(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(1).max(80),
      docType: z.enum(['prescription', 'invoice']),
      printerName: z.string().nullable().default(null),
      paperSize: z.enum(['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80']),
      orientation: z.enum(['portrait', 'landscape']),
      marginTopMm: z.number().min(0).max(50),
      marginBottomMm: z.number().min(0).max(50),
      marginLeftMm: z.number().min(0).max(50),
      marginRightMm: z.number().min(0).max(50),
      scalePercent: z.number().int().min(50).max(150),
      copies: z.number().int().min(1).max(20),
      isDefault: z.boolean().default(false),
    }),
    ['printer.manage'],
  ),
  'printerProfiles.delete': chan(z.object({ id: z.number().int().positive() }), ['printer.manage']),
  'print.run': chan(
    z.object({
      docType: z.enum(['prescription', 'invoice']),
      docId: z.number().int().positive(),
      profileId: z.number().int().positive().nullable().default(null),
      printerName: z.string().nullable().default(null),
      paperSize: z.enum(['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80']).optional(),
      copies: z.number().int().min(1).max(20).optional(),
      scalePercent: z.number().int().min(50).max(150).optional(),
      margins: z
        .object({
          top: z.number().min(0).max(50),
          bottom: z.number().min(0).max(50),
          left: z.number().min(0).max(50),
          right: z.number().min(0).max(50),
        })
        .optional(),
      silent: z.boolean().default(false),
    }),
    ['prescription.print'],
  ),
  'print.preview': chan(
    z.object({ docType: z.enum(['prescription', 'invoice']), docId: z.number().int().positive() }),
    ['prescription.print'],
  ),
  'print.toPdf': chan(
    z.object({
      docType: z.enum(['prescription', 'invoice']),
      docId: z.number().int().positive(),
      paperSize: z.enum(['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80']).default('A4'),
      savePath: z.string().max(4096).optional(),
    }),
    ['prescription.print'],
  ),
} as const satisfies Record<string, ChannelDef<unknown>>;

export type ChannelName = keyof typeof channelDefs;

export type ChannelRequest<C extends ChannelName> = z.infer<(typeof channelDefs)[C]['request']>;

type ResponseMap = {
  'app.status': AppStatus;
  'activation.verify': { activated: boolean };
  'setup.complete': SessionState;
  'session.state': SessionState;
  'session.login': SessionState;
  'session.unlock': SessionState;
  'session.logout': { done: true };
  'session.lock': { done: true };
  'session.activity': { locked: boolean };
  'session.changePassword': { done: true };

  'clinic.get': ClinicConfig;
  'clinic.update': ClinicConfig;
  'clinic.pickLogo': ClinicConfig;
  'clinic.clearLogo': ClinicConfig;
  'settings.get': Record<string, string | number | boolean | null>;
  'settings.set': Record<string, string | number | boolean | null>;
  'settings.resetPrescriptionTemplate': { done: true };
  'settings.resetInvoiceTemplate': { done: true };

  'patients.list': Paged<PatientSummary>;
  'patients.get': PatientRecord;
  'patients.create': PatientRecord;
  'patients.update': PatientRecord;
  'patients.timeline': Paged<TimelineEvent>;
  'patients.export': { path: string; count: number };

  'visits.create': VisitRecord;
  'visits.listByPatient': VisitRecord[];
  'visits.get': VisitRecord;
  'clinical.options': { id: number; code: string; label: string }[];
  'clinical.optionsCreate': { id: number; code: string; label: string };

  'chart.catalog': {
    teeth: { fdi: string; dentition: string; quadrant: number; position: number; universal: string; palmer: string; label: string; region: string }[];
    conditions: { id: number; code: string; label: string; category: string; color: string; isCustom: boolean }[];
  };
  'chart.get': ChartEntry[];
  'chart.setEntry': ChartEntry;
  'chart.clearEntry': { done: true };
  'chart.addCondition': { id: number; code: string; label: string; category: string; color: string; isCustom: boolean };

  'treatments.list': TreatmentDef[];
  'treatments.save': TreatmentDef;

  'appointments.list': AppointmentRecord[];
  'appointments.create': AppointmentRecord;
  'appointments.update': AppointmentRecord;
  'appointments.conflicts': { conflicts: AppointmentRecord[] };

  'queue.list': QueueEntry[];
  'queue.addWalkIn': QueueEntry;
  'queue.checkIn': QueueEntry;
  'queue.advance': { entries: QueueEntry[] };
  'queue.remove': { done: true };

  'prescriptions.list': Paged<PrescriptionRecord>;
  'prescriptions.get': PrescriptionRecord;
  'prescriptions.create': PrescriptionRecord;
  'prescriptions.medicines': MedicineCatalogItem[];
  'prescriptions.medicineUpsert': MedicineCatalogItem;

  'invoices.list': Paged<InvoiceRecord>;
  'invoices.get': InvoiceRecord;
  'invoices.create': InvoiceRecord;
  'invoices.void': InvoiceRecord;

  'payments.list': Paged<PaymentRecord>;
  'payments.create': PaymentRecord;
  'payments.void': PaymentRecord;
  'payments.summary': { totalPoisha: number; byMethod: MethodBreakdownRow[]; count: number };

  'inventory.list': Paged<InventoryItemRecord>;
  'inventory.get': InventoryItemRecord;
  'inventory.save': InventoryItemRecord;
  'inventory.adjust': InventoryItemRecord;
  'inventory.transactions': Paged<InventoryTransaction>;
  'inventory.alerts': { lowStock: InventoryItemRecord[]; expiring: InventoryItemRecord[]; expired: InventoryItemRecord[] };
  'inventory.exportCsv': { path: string; count: number };

  'suppliers.list': SupplierRecord[];
  'suppliers.save': SupplierRecord;

  'accounting.expenseCategories': ExpenseCategoryRecord[];
  'accounting.expenseCategorySave': ExpenseCategoryRecord;
  'accounting.expenses': Paged<ExpenseRecord>;
  'accounting.expenseSave': ExpenseRecord;
  'accounting.otherIncome': Paged<OtherIncomeRecord>;
  'accounting.otherIncomeSave': OtherIncomeRecord;

  'reports.range': ReportSummary;
  'reports.daily': DailyRevenueRow[];
  'reports.methods': MethodBreakdownRow[];
  'reports.expenses': CategorySpendRow[];
  'reports.treatmentRevenue': CategorySpendRow[];

  'staff.list': StaffRecord[];
  'staff.save': StaffRecord;
  'dentists.list': DentistRecord[];
  'dentists.save': DentistRecord;
  'users.list': UserSummary[];
  'users.save': UserSummary;
  'users.resetPassword': { done: true };
  'roles.list': RoleSummary[];
  'roles.save': RoleSummary;

  'referrals.list': Paged<{ id: number; patientId: number; patientName: string; referredTo: string; reason: string; notes: string; referredOn: string; followUpOn: string | null; status: string; createdAt: number }>;
  'referrals.create': { id: number };
  'referrals.update': { done: true };

  'attachments.list': AttachmentRecord[];
  'attachments.pick': AttachmentRecord;
  'attachments.open': { done: true };
  'attachments.delete': { done: true };

  'dashboard.get': DashboardData;
  'search.global': SearchResult[];
  'notifications.list': Paged<NotificationRecord>;
  'notifications.markRead': { done: true };
  'notifications.markAllRead': { done: true };

  'audit.list': Paged<AuditLogRecord>;

  'backup.status': BackupStatus;
  'backup.pickFolder': { folder: string | null };
  'backup.create': BackupRecord;
  'backup.pickFiles': { filePath: string | null };
  'backup.restore': { restored: true; preRestorePath: string };
  'backup.records': BackupRecord[];

  'printers.list': PrinterInfo[];
  'printerProfiles.list': PrinterProfileRecord[];
  'printerProfiles.save': PrinterProfileRecord;
  'printerProfiles.delete': { done: true };
  'print.run': { printed: boolean; message: string };
  'print.preview': { previewHtml: string };
  'print.toPdf': { saved: boolean; path: string | null };
};

export type ChannelResponse<C extends ChannelName> = C extends keyof ResponseMap
  ? ResponseMap[C]
  : never;

/** Compile-time check: every channel must declare a response type (missing → "MISSING"). */
export type AssertAllChannelsResponded = {
  [C in ChannelName]: [ChannelResponse<C>] extends [never] ? 'MISSING_RESPONSE' : true;
};

export const CHANNEL_NAMES = Object.keys(channelDefs) as ChannelName[];
