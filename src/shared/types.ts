/** Domain types shared between main and renderer. All money is integer poisha. */

import type { Permission } from './permissions';

export interface SessionUser {
  userId: number;
  username: string;
  displayName: string;
  staffId: number | null;
  permissions: Permission[];
  roleNames: string[];
}

export interface SessionState {
  authenticated: boolean;
  locked: boolean;
  user: SessionUser | null;
  lastActivityAt: number | null;
  autoLockMinutes: number | null;
}

export type AppPhase = 'activation' | 'setup' | 'login' | 'app';

export interface AppStatus {
  phase: AppPhase;
  activated: boolean;
  setupComplete: boolean;
  userCount: number;
  appVersion: string;
  clinicName: string | null;
}

/* ------------------------------------------------------------------ */
/* Clinic configuration                                                */
/* ------------------------------------------------------------------ */

export interface ClinicConfig {
  id: number;
  clinicName: string;
  logoPath: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationInfo: string;
  operatingHours: string;
  currency: 'BDT';
  footerNote: string;
  prescriptionFooter: string;
  invoiceFooter: string;
}

/* ------------------------------------------------------------------ */
/* Users, roles, staff, dentists                                       */
/* ------------------------------------------------------------------ */

export interface RoleSummary {
  id: number;
  name: string;
  description: string;
  isBuiltIn: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  staffId: number | null;
  staffName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  permissions: Permission[];
  lastLoginAt: number | null;
  createdAt: number;
}

export interface StaffRecord {
  id: number;
  fullName: string;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | null;
  bloodGroup: string | null;
  address: string;
  phone: string;
  idNumber: string;
  photoPath: string | null;
  section: string;
  salaryPoisha: number;
  joiningDate: string | null;
  status: 'active' | 'inactive';
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface DentistRecord {
  id: number;
  fullName: string;
  phone: string;
  email: string;
  bio: string;
  isActive: boolean;
  designations: string[];
  qualifications: string[];
  userId: number | null;
}

/* ------------------------------------------------------------------ */
/* Patients                                                            */
/* ------------------------------------------------------------------ */

export type PatientStatus = 'active' | 'archived';

export interface PatientSummary {
  id: number;
  patientCode: string;
  fullName: string;
  gender: 'male' | 'female' | 'other' | null;
  dob: string | null;
  ageYears: number | null;
  phone: string;
  bloodGroup: string | null;
  status: PatientStatus;
  registeredAt: number;
  lastVisitAt: number | null;
  visitCount: number;
  duePoisha: number;
}

export interface PatientRecord extends PatientSummary {
  emergencyPhone: string;
  emergencyContact: string;
  address: string;
  presentingProblem: string;
  previousHistory: string;
  allergies: string;
  medicalHistory: string;
  notes: string;
  preferredLanguage: string;
  updatedAt: number;
}

export interface PatientAlert {
  id: number;
  kind: 'allergy' | 'condition' | 'other';
  message: string;
}

export type TimelineEventType =
  | 'registration'
  | 'visit'
  | 'finding'
  | 'treatment'
  | 'prescription'
  | 'appointment'
  | 'invoice'
  | 'payment'
  | 'referral'
  | 'attachment'
  | 'note';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  at: number;
  title: string;
  detail: string;
  actor: string | null;
  entityId: string | null;
}

/* ------------------------------------------------------------------ */
/* Clinical                                                            */
/* ------------------------------------------------------------------ */

export interface VisitRecord {
  id: number;
  visitCode: string;
  patientId: number;
  dentistId: number;
  dentistName: string;
  appointmentId: number | null;
  visitedAt: number;
  chiefComplaint: string;
  examination: string;
  findings: string;
  diagnosis: string;
  treatmentPerformed: string;
  treatmentPlan: string;
  advice: string;
  followUpAt: number | null;
  notes: string;
  createdAt: number;
}

export type ToothDentition = 'permanent' | 'primary';

export interface ToothDef {
  fdi: string;
  dentition: ToothDentition;
  quadrant: number;
  position: number;
  universal: string;
  palmer: string;
  label: string;
  region: 'incisor' | 'canine' | 'premolar' | 'molar';
}

export interface ToothConditionDef {
  id: number;
  code: string;
  label: string;
  category: string;
  color: string;
  isCustom: boolean;
}

export interface ChartEntry {
  id: number;
  patientId: number;
  fdi: string;
  conditionCode: string;
  conditionLabel: string;
  conditionColor: string;
  severity: 'mild' | 'moderate' | 'severe' | null;
  notes: string;
  visitId: number | null;
  recordedBy: string;
  recordedAt: number;
}

export interface TreatmentDef {
  id: number;
  code: string;
  name: string;
  category: string;
  defaultPricePoisha: number;
  description: string;
  durationMinutes: number;
  isActive: boolean;
}

export interface ClinicalOption {
  id: number;
  section: 'cc' | 'oe' | 're';
  code: string;
  label: string;
  isBuiltIn: boolean;
}

/* ------------------------------------------------------------------ */
/* Appointments & queue                                                */
/* ------------------------------------------------------------------ */

export type AppointmentStatus =
  | 'scheduled'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled';

export interface AppointmentRecord {
  id: number;
  appointmentCode: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  dentistId: number;
  dentistName: string;
  startsAt: number;
  endsAt: number;
  reason: string;
  notes: string;
  status: AppointmentStatus;
  checkedInAt: number | null;
  cancelReason: string;
  createdAt: number;
}

export type QueueStatus = 'waiting' | 'in_progress' | 'completed' | 'skipped';

export interface QueueEntry {
  id: number;
  queueDate: string;
  position: number;
  patientId: number;
  patientName: string;
  patientCode: string;
  dentistId: number;
  dentistName: string;
  appointmentId: number | null;
  walkIn: boolean;
  status: QueueStatus;
  checkedInAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  waitedMinutes: number;
}

/* ------------------------------------------------------------------ */
/* Prescriptions                                                       */
/* ------------------------------------------------------------------ */

export interface MedicationLine {
  id?: number;
  medicineName: string;
  form: string;
  strength: string;
  dose: string;
  frequency: string;
  timing: string;
  beforeAfterFood: string;
  duration: string;
  quantity: string;
  route: string;
  instructions: string;
}

export interface PrescriptionRecord {
  id: number;
  prescriptionCode: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  dentistId: number;
  dentistName: string;
  issuedAt: number;
  chiefComplaint: string;
  onExamination: string;
  restExamination: string;
  advice: string;
  notes: string;
  visitId: number | null;
  items: MedicationLine[];
  createdAt: number;
}

export interface MedicineCatalogItem {
  id: number;
  medicineName: string;
  form: string;
  strength: string;
  defaultInstructions: string;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export type PaymentMethod =
  | 'cash'
  | 'bank'
  | 'card'
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'upay'
  | 'other';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'upay', label: 'Upay' },
  { value: 'other', label: 'Others' },
];

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

export interface InvoiceItem {
  id?: number;
  treatmentId: number | null;
  name: string;
  quantity: number;
  unitPricePoisha: number;
  discountPoisha: number;
  totalPoisha: number;
}

export interface InvoiceRecord {
  id: number;
  invoiceCode: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  invoiceDate: string;
  items: InvoiceItem[];
  subtotalPoisha: number;
  discountPoisha: number;
  adjustmentPoisha: number;
  totalPoisha: number;
  paidPoisha: number;
  duePoisha: number;
  status: InvoiceStatus;
  notes: string;
  createdAt: number;
  payments: PaymentRecord[];
}

export interface PaymentRecord {
  id: number;
  paymentCode: string;
  patientId: number;
  patientName: string;
  patientCode: string;
  invoiceId: number | null;
  invoiceCode: string | null;
  amountPoisha: number;
  method: PaymentMethod;
  reference: string;
  paidAt: number;
  notes: string;
  receivedBy: string;
  isVoided: boolean;
  voidReason: string;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export interface SupplierRecord {
  id: number;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

export interface InventoryItemRecord {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  supplierId: number | null;
  supplierName: string | null;
  purchasePricePoisha: number;
  salePricePoisha: number;
  openingStock: number;
  receivedQty: number;
  usedQty: number;
  currentStock: number;
  reorderLevel: number;
  expiryDate: string | null;
  batchNumber: string;
  isActive: boolean;
  notes: string;
}

export type InventoryTxnType = 'opening' | 'purchase' | 'usage' | 'adjustment' | 'wastage' | 'return';

export interface InventoryTransaction {
  id: number;
  itemId: number;
  itemName: string;
  type: InventoryTxnType;
  quantity: number;
  unitPricePoisha: number | null;
  reference: string;
  note: string;
  performedBy: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Accounting & reports                                                */
/* ------------------------------------------------------------------ */

export interface ExpenseCategoryRecord {
  id: number;
  name: string;
  isBuiltIn: boolean;
  isActive: boolean;
}

export interface ExpenseRecord {
  id: number;
  categoryId: number;
  categoryName: string;
  amountPoisha: number;
  spentOn: string;
  method: PaymentMethod;
  description: string;
  enteredBy: string;
  createdAt: number;
}

export interface OtherIncomeRecord {
  id: number;
  title: string;
  amountPoisha: number;
  receivedOn: string;
  method: PaymentMethod;
  notes: string;
  enteredBy: string;
  createdAt: number;
}

export interface DailyRevenueRow {
  date: string;
  amountPoisha: number;
  count: number;
}

export interface MethodBreakdownRow {
  method: PaymentMethod;
  label: string;
  amountPoisha: number;
  count: number;
}

export interface CategorySpendRow {
  category: string;
  amountPoisha: number;
}

export interface ReportSummary {
  billedPoisha: number;
  collectedPoisha: number;
  outstandingPoisha: number;
  expensePoisha: number;
  otherIncomePoisha: number;
  netPoisha: number;
}

/* ------------------------------------------------------------------ */
/* Platform: attachments, notifications, audit, backups, printers      */
/* ------------------------------------------------------------------ */

export interface AttachmentRecord {
  id: number;
  entityType: string;
  entityId: number;
  patientId: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  description: string;
  uploadedBy: string;
  createdAt: number;
  missing: boolean;
}

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationCategory =
  | 'appointment'
  | 'inventory'
  | 'financial'
  | 'backup'
  | 'system';

export interface NotificationRecord {
  id: number;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
  permission: Permission | null;
}

export interface AuditLogRecord {
  id: number;
  at: number;
  username: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  beforeJson: string;
  afterJson: string;
}

export interface BackupRecord {
  id: number;
  createdAt: number;
  filePath: string;
  sizeBytes: number;
  kind: 'manual' | 'auto' | 'pre_restore';
  status: 'success' | 'failed';
  error: string;
}

export interface BackupStatus {
  folder: string | null;
  intervalDays: number | null;
  lastSuccessAt: number | null;
  nextDueAt: number | null;
  lastError: string | null;
  recent: BackupRecord[];
}

export interface PrinterProfileRecord {
  id: number;
  name: string;
  docType: 'prescription' | 'invoice';
  printerName: string | null;
  paperSize: 'A4' | 'A5' | 'A6' | 'Letter' | 'thermal58' | 'thermal80';
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  scalePercent: number;
  copies: number;
  isDefault: boolean;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Dashboard & global search                                           */
/* ------------------------------------------------------------------ */

export interface DashboardData {
  today: string;
  appointmentsToday: number;
  checkedIn: number;
  waitingInQueue: number;
  completedVisits: number;
  todayRevenuePoisha: number;
  outstandingPoisha: number;
  missedToday: number;
  upcomingAppointments: AppointmentRecord[];
  recentPatients: PatientSummary[];
  methodBreakdown: MethodBreakdownRow[];
  revenueTrend: DailyRevenueRow[];
  lowStockItems: InventoryItemRecord[];
  alerts: { severity: NotificationSeverity; title: string; body: string }[];
}

export type SearchKind =
  | 'patient'
  | 'appointment'
  | 'invoice'
  | 'prescription'
  | 'visit'
  | 'treatment'
  | 'inventory'
  | 'staff';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  detail: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type IpcErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'LOCKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DB_ERROR'
  | 'IO_ERROR'
  | 'ACTIVATION_REQUIRED'
  | 'INTERNAL';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
  details?: unknown;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };
