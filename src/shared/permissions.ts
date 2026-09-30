/**
 * Permission catalogue and role definitions.
 * Permission checks are enforced in the Electron main process on every IPC channel;
 * UI hiding is cosmetic only.
 */

export const PERMISSIONS = [
  // Patients
  'patient.view',
  'patient.create',
  'patient.edit',
  'patient.delete',
  'patient.export',
  // Clinical
  'clinical.view',
  'clinical.create',
  'clinical.edit',
  'prescription.view',
  'prescription.create',
  'prescription.print',
  // Appointments & queue
  'appointment.view',
  'appointment.create',
  'appointment.edit',
  'appointment.cancel',
  'queue.manage',
  // Treatments
  'treatment.view',
  'treatment.manage',
  // Billing
  'invoice.view',
  'invoice.create',
  'invoice.edit',
  'invoice.void',
  'payment.view',
  'payment.create',
  'payment.void',
  'financial.report.view',
  'accounting.view',
  'accounting.manage',
  // Inventory
  'inventory.view',
  'inventory.manage',
  'supplier.manage',
  // Staff & users
  'staff.view',
  'staff.manage',
  'user.manage',
  'role.manage',
  // Platform
  'attachment.view',
  'attachment.upload',
  'attachment.delete',
  'referral.view',
  'referral.manage',
  'notification.view',
  'audit.view',
  'backup.create',
  'backup.restore',
  'settings.manage',
  'printer.manage',
  'search.global',
  'destructive.actions',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const PERMISSION_GROUPS: ReadonlyArray<{ group: string; permissions: Permission[] }> = [
  { group: 'Patients', permissions: ['patient.view', 'patient.create', 'patient.edit', 'patient.delete', 'patient.export'] },
  {
    group: 'Clinical',
    permissions: [
      'clinical.view',
      'clinical.create',
      'clinical.edit',
      'prescription.view',
      'prescription.create',
      'prescription.print',
    ],
  },
  {
    group: 'Appointments',
    permissions: ['appointment.view', 'appointment.create', 'appointment.edit', 'appointment.cancel', 'queue.manage'],
  },
  { group: 'Treatments', permissions: ['treatment.view', 'treatment.manage'] },
  {
    group: 'Billing & Finance',
    permissions: [
      'invoice.view',
      'invoice.create',
      'invoice.edit',
      'invoice.void',
      'payment.view',
      'payment.create',
      'payment.void',
      'financial.report.view',
      'accounting.view',
      'accounting.manage',
    ],
  },
  { group: 'Inventory', permissions: ['inventory.view', 'inventory.manage', 'supplier.manage'] },
  { group: 'Staff & Users', permissions: ['staff.view', 'staff.manage', 'user.manage', 'role.manage'] },
  {
    group: 'Clinical Records',
    permissions: ['attachment.view', 'attachment.upload', 'attachment.delete', 'referral.view', 'referral.manage'],
  },
  {
    group: 'Administration',
    permissions: [
      'notification.view',
      'audit.view',
      'backup.create',
      'backup.restore',
      'settings.manage',
      'printer.manage',
      'search.global',
      'destructive.actions',
    ],
  },
] as const;

export type BuiltInRoleKey =
  | 'administrator'
  | 'dentist'
  | 'receptionist'
  | 'assistant'
  | 'accountant'
  | 'inventory_manager';

export interface BuiltInRole {
  key: BuiltInRoleKey;
  name: string;
  description: string;
  permissions: Permission[];
}

const ALL: Permission[] = [...PERMISSIONS];

export const BUILT_IN_ROLES: BuiltInRole[] = [
  {
    key: 'administrator',
    name: 'Administrator / Owner',
    description: 'Full access to every module including finance, security, and destructive operations.',
    permissions: ALL,
  },
  {
    key: 'dentist',
    name: 'Dentist',
    description: 'Clinical work, prescriptions, appointments, treatment catalogue, patient records.',
    permissions: [
      'patient.view',
      'patient.create',
      'patient.edit',
      'clinical.view',
      'clinical.create',
      'clinical.edit',
      'prescription.view',
      'prescription.create',
      'prescription.print',
      'appointment.view',
      'appointment.create',
      'appointment.edit',
      'queue.manage',
      'treatment.view',
      'invoice.view',
      'attachment.view',
      'attachment.upload',
      'referral.view',
      'referral.manage',
      'notification.view',
      'search.global',
    ],
  },
  {
    key: 'receptionist',
    name: 'Receptionist / Front Desk',
    description: 'Front-desk operations: patients, appointments, queue, invoices, payments.',
    permissions: [
      'patient.view',
      'patient.create',
      'patient.edit',
      'clinical.view',
      'prescription.view',
      'prescription.print',
      'appointment.view',
      'appointment.create',
      'appointment.edit',
      'appointment.cancel',
      'queue.manage',
      'treatment.view',
      'invoice.view',
      'invoice.create',
      'invoice.edit',
      'payment.view',
      'payment.create',
      'attachment.view',
      'attachment.upload',
      'referral.view',
      'notification.view',
      'search.global',
    ],
  },
  {
    key: 'assistant',
    name: 'Assistant / Nurse',
    description: 'Clinical support: patient lookup, visits entry, queue assistance.',
    permissions: [
      'patient.view',
      'clinical.view',
      'clinical.create',
      'prescription.view',
      'appointment.view',
      'queue.manage',
      'treatment.view',
      'attachment.view',
      'attachment.upload',
      'referral.view',
      'notification.view',
      'search.global',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant / Finance',
    description: 'Invoices, payments, accounting, and financial reports. No clinical records.',
    permissions: [
      'patient.view',
      'invoice.view',
      'invoice.create',
      'invoice.edit',
      'invoice.void',
      'payment.view',
      'payment.create',
      'payment.void',
      'financial.report.view',
      'accounting.view',
      'accounting.manage',
      'inventory.view',
      'staff.view',
      'notification.view',
      'audit.view',
      'search.global',
    ],
  },
  {
    key: 'inventory_manager',
    name: 'Inventory Manager',
    description: 'Stock, suppliers, batches, and related cost visibility.',
    permissions: [
      'inventory.view',
      'inventory.manage',
      'supplier.manage',
      'accounting.view',
      'patient.view',
      'notification.view',
      'search.global',
    ],
  },
];

/** Resolve a set of role permission lists into a de-duplicated permission set. */
export function resolvePermissions(rolePermissionLists: readonly (readonly string[])[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const list of rolePermissionLists) {
    for (const p of list) {
      if (isPermission(p)) out.add(p);
    }
  }
  return out;
}

export function hasPermission(have: ReadonlySet<Permission>, need: Permission): boolean {
  return have.has(need);
}

export function hasAllPermissions(have: ReadonlySet<Permission>, needs: readonly Permission[]): boolean {
  return needs.every((n) => have.has(n));
}
