/** People: staff, dentists (designations/qualifications), users, roles — schema-aligned. */

import type { ServiceContext } from './context';
import { audit, requireUser } from './context';
import { ipcError } from '../ipc/dispatcher';
import { hashPassword, checkPasswordStrength, verifyPassword, lockoutDurationFor } from '../security/passwords';
import type { Permission, BuiltInRoleKey } from '@shared/permissions';
import type { DentistRecord, RoleSummary, StaffRecord, UserSummary } from '@shared/types';

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

function mapStaff(r: Record<string, unknown>): StaffRecord {
  return {
    id: r.id as number,
    fullName: r.full_name as string,
    dob: (r.dob as string | null) ?? null,
    gender: (r.gender as StaffRecord['gender']) ?? null,
    bloodGroup: (r.blood_group as string | null) ?? null,
    address: (r.address as string) ?? '',
    phone: (r.phone as string) ?? '',
    idNumber: (r.id_number as string) ?? '',
    photoPath: (r.photo_path as string | null) ?? null,
    section: (r.section as string) ?? '',
    salaryPoisha: (r.salary_poisha as number) ?? 0,
    joiningDate: (r.joining_date as string | null) ?? null,
    status: r.status as StaffRecord['status'],
    notes: (r.notes as string) ?? '',
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function listStaff(sc: ServiceContext, includeInactive: boolean): StaffRecord[] {
  const where = includeInactive ? '' : "WHERE status = 'active'";
  const rows = sc.db
    .prepare(`SELECT * FROM staff ${where} ORDER BY full_name COLLATE NOCASE`)
    .all() as Record<string, unknown>[];
  return rows.map(mapStaff);
}

export type StaffSave = {
  id: number | null;
  fullName: string;
  dob: string | null;
  gender: 'male' | 'female' | 'other' | null;
  bloodGroup: string;
  address: string;
  phone: string;
  idNumber: string;
  section: string;
  salaryPoisha: number;
  joiningDate: string | null;
  status: 'active' | 'inactive';
  notes: string;
};

export function saveStaff(sc: ServiceContext, p: StaffSave): StaffRecord {
  const now = sc.now();
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM staff WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Staff member not found.');
      sc.db
        .prepare(
          `UPDATE staff SET full_name=?, dob=?, gender=?, blood_group=?, address=?, phone=?,
                  id_number=?, section=?, salary_poisha=?, joining_date=?, status=?, notes=?,
                  updated_at=? WHERE id=?`,
        )
        .run(
          p.fullName, p.dob, p.gender, p.bloodGroup, p.address, p.phone,
          p.idNumber, p.section, p.salaryPoisha, p.joiningDate, p.status, p.notes,
          now, p.id,
        );
      return p.id;
    }
    const info = sc.db
      .prepare(
        `INSERT INTO staff (full_name, dob, gender, blood_group, address, phone, id_number,
                            section, salary_poisha, joining_date, status, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.fullName, p.dob, p.gender, p.bloodGroup, p.address, p.phone,
        p.idNumber, p.section, p.salaryPoisha, p.joiningDate, p.status, p.notes,
        now, now,
      );
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'staff.update' : 'staff.create',
    entityType: 'staff',
    entityId: id,
    summary: `${p.id ? 'Updated' : 'Created'} staff record: ${p.fullName}`,
  });
  const row = sc.db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as Record<string, unknown>;
  return mapStaff(row);
}

/* ------------------------------------------------------------------ */
/* Dentists                                                            */
/* ------------------------------------------------------------------ */

function designationsFor(db: ServiceContext['db'], dentistId: number): string[] {
  return (
    db
      .prepare(
        'SELECT designation FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order, id',
      )
      .all(dentistId) as { designation: string }[]
  ).map((r) => r.designation);
}

function qualificationsFor(db: ServiceContext['db'], dentistId: number): string[] {
  return (
    db
      .prepare(
        'SELECT qualification FROM dentist_qualifications WHERE dentist_id = ? ORDER BY sort_order, id',
      )
      .all(dentistId) as { qualification: string }[]
  ).map((r) => r.qualification);
}

function mapDentist(db: ServiceContext['db'], r: Record<string, unknown>): DentistRecord {
  const id = r.id as number;
  return {
    id,
    fullName: r.full_name as string,
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    bio: (r.bio as string) ?? '',
    isActive: r.is_active === 1,
    designations: designationsFor(db, id),
    qualifications: qualificationsFor(db, id),
    userId: (r.user_id as number | null) ?? null,
  };
}

export function listDentists(sc: ServiceContext, includeInactive: boolean): DentistRecord[] {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  const rows = sc.db
    .prepare(`SELECT * FROM dentists ${where} ORDER BY full_name COLLATE NOCASE`)
    .all() as Record<string, unknown>[];
  return rows.map((r) => mapDentist(sc.db, r));
}

export type DentistSave = {
  id: number | null;
  fullName: string;
  phone: string;
  email: string;
  bio: string;
  isActive: boolean;
  designations: string[];
  qualifications: string[];
};

export function saveDentist(sc: ServiceContext, p: DentistSave): DentistRecord {
  const now = sc.now();
  const id = sc.db.transaction(() => {
    let dentistId: number;
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM dentists WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Dentist not found.');
      sc.db
        .prepare(
          `UPDATE dentists SET full_name=?, phone=?, email=?, bio=?, is_active=?, updated_at=? WHERE id=?`,
        )
        .run(p.fullName, p.phone, p.email, p.bio, p.isActive ? 1 : 0, now, p.id);
      dentistId = p.id;
      sc.db.prepare('DELETE FROM dentist_designations WHERE dentist_id = ?').run(dentistId);
      sc.db.prepare('DELETE FROM dentist_qualifications WHERE dentist_id = ?').run(dentistId);
    } else {
      const info = sc.db
        .prepare(
          `INSERT INTO dentists (staff_id, full_name, phone, email, bio, is_active, created_at, updated_at)
           VALUES (NULL,?,?,?,?,?,?,?)`,
        )
        .run(p.fullName, p.phone, p.email, p.bio, p.isActive ? 1 : 0, now, now);
      dentistId = Number(info.lastInsertRowid);
    }
    const dIns = sc.db.prepare(
      'INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?, ?, ?)',
    );
    p.designations.filter((x) => x.trim()).forEach((d, i) => dIns.run(dentistId, d.trim(), i));
    const qIns = sc.db.prepare(
      'INSERT INTO dentist_qualifications (dentist_id, qualification, sort_order) VALUES (?, ?, ?)',
    );
    p.qualifications.filter((x) => x.trim()).forEach((q, i) => qIns.run(dentistId, q.trim(), i));
    return dentistId;
  })();
  audit(sc, {
    action: p.id ? 'dentist.update' : 'dentist.create',
    entityType: 'dentist',
    entityId: id,
    summary: `${p.id ? 'Updated' : 'Created'} dentist: ${p.fullName}`,
  });
  const row = sc.db.prepare('SELECT * FROM dentists WHERE id = ?').get(id) as Record<string, unknown>;
  return mapDentist(sc.db, row);
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

function rolesAndPermsFor(
  db: ServiceContext['db'],
  userId: number,
): { roles: string[]; permissions: Permission[] } {
  const rows = db
    .prepare(
      `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
    )
    .all(userId) as { name: string }[];
  const permRows = db
    .prepare(
      `SELECT DISTINCT rp.permission_code FROM role_permissions rp
       JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?`,
    )
    .all(userId) as { permission_code: string }[];
  return {
    roles: rows.map((r) => r.name),
    permissions: permRows.map((r) => r.permission_code) as Permission[],
  };
}

function mapUser(db: ServiceContext['db'], r: Record<string, unknown>): UserSummary {
  const { roles, permissions } = rolesAndPermsFor(db, r.id as number);
  const staffId = (r.staff_id as number | null) ?? null;
  const staffName = staffId
    ? ((db.prepare('SELECT full_name FROM staff WHERE id = ?').get(staffId) as
        | { full_name: string }
        | undefined)?.full_name ?? null)
    : null;
  return {
    id: r.id as number,
    username: r.username as string,
    displayName: r.display_name as string,
    staffId,
    staffName,
    isActive: r.is_active === 1,
    mustChangePassword: r.must_change_password === 1,
    roles,
    permissions,
    lastLoginAt: (r.last_login_at as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}

export function listUsers(sc: ServiceContext): UserSummary[] {
  const rows = sc.db
    .prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE')
    .all() as Record<string, unknown>[];
  return rows.map((r) => mapUser(sc.db, r));
}

export type UserSave = {
  id: number | null;
  username: string;
  displayName: string;
  staffId: number | null;
  password?: string;
  isActive: boolean;
  roleIds: number[];
};

export function saveUser(sc: ServiceContext, p: UserSave): UserSummary {
  if (p.roleIds.length === 0) ipcError('VALIDATION', 'Assign at least one role.');
  const now = sc.now();

  // Guard: never deactivate/demote the last active administrator.
  if (p.id) {
    const target = sc.db.prepare('SELECT * FROM users WHERE id = ?').get(p.id) as
      | Record<string, unknown>
      | undefined;
    if (!target) ipcError('NOT_FOUND', 'User not found.');
    const targetIsAdmin = rolesAndPermsFor(sc.db, p.id).roles.some(
      (r) => r === 'Administrator / Owner',
    );
    const newRoleNames = (
      sc.db
        .prepare(`SELECT name FROM roles WHERE id IN (${p.roleIds.map(() => '?').join(',')})`)
        .all(...p.roleIds) as { name: string }[]
    ).map((r) => r.name);
    const newIsAdmin = newRoleNames.includes('Administrator / Owner');
    if (targetIsAdmin && (!p.isActive || !newIsAdmin)) {
      const adminCount = (
        sc.db
          .prepare(
            `SELECT COUNT(DISTINCT u.id) AS n FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE r.name = 'Administrator / Owner' AND u.is_active = 1`,
          )
          .get() as { n: number }
      ).n;
      if (adminCount <= 1) ipcError('CONFLICT', 'At least one active administrator must remain.');
      if (p.id === sc.ctx.userId) {
        ipcError('CONFLICT', 'You cannot remove your own administrator access.');
      }
    }
  }

  const id = sc.db.transaction(() => {
    let userId: number;
    if (p.id) {
      sc.db
        .prepare(
          `UPDATE users SET display_name=?, staff_id=?, is_active=?, updated_at=? WHERE id=?`,
        )
        .run(p.displayName, p.staffId, p.isActive ? 1 : 0, now, p.id);
      if (p.username) {
        const dup = sc.db
          .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?')
          .get(p.username, p.id);
        if (dup) ipcError('CONFLICT', 'That username is already taken.');
        sc.db.prepare('UPDATE users SET username = ? WHERE id = ?').run(p.username, p.id);
      }
      userId = p.id;
      sc.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    } else {
      if (!p.password) ipcError('VALIDATION', 'Password is required for a new user.');
      const strength = checkPasswordStrength(p.password);
      if (!strength.ok) ipcError('VALIDATION', strength.errors.join(' '));
      const dup = sc.db.prepare('SELECT id FROM users WHERE username = ?').get(p.username);
      if (dup) ipcError('CONFLICT', 'That username is already taken.');
      const info = sc.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, staff_id, is_active,
                              must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?,?,?,?,?,1,0,?,?)`,
        )
        .run(
          p.username, p.displayName, hashPassword(p.password), p.staffId,
          p.isActive ? 1 : 0, now, now,
        );
      userId = Number(info.lastInsertRowid);
    }
    const ins = sc.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const rid of p.roleIds) ins.run(userId, rid);
    if (p.password && p.id) {
      const strength = checkPasswordStrength(p.password);
      if (!strength.ok) ipcError('VALIDATION', strength.errors.join(' '));
      sc.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
        .run(hashPassword(p.password), p.id);
    }
    return userId;
  })();

  audit(sc, {
    action: p.id ? 'user.update' : 'user.create',
    entityType: 'user',
    entityId: id,
    summary: `${p.id ? 'Updated' : 'Created'} user ${p.username || `#${id}`}${p.password && p.id ? ' (password reset)' : ''}`,
  });
  const row = sc.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  return mapUser(sc.db, row);
}

export function resetUserPassword(
  sc: ServiceContext,
  p: { id: number; newPassword: string },
): { done: true } {
  const strength = checkPasswordStrength(p.newPassword);
  if (!strength.ok) ipcError('VALIDATION', strength.errors.join(' '));
  const target = sc.db.prepare('SELECT id FROM users WHERE id = ?').get(p.id);
  if (!target) ipcError('NOT_FOUND', 'User not found.');
  sc.db
    .prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    )
    .run(hashPassword(p.newPassword), sc.now(), p.id);
  audit(sc, {
    action: 'user.reset_password',
    entityType: 'user',
    entityId: p.id,
    summary: 'Reset user password',
  });
  return { done: true };
}

export function changeOwnPassword(
  sc: ServiceContext,
  p: { currentPassword: string; newPassword: string },
): { done: true } {
  const user = requireUser(sc);
  const row = sc.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
    | { password_hash: string }
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'User not found.');
  if (!verifyPassword(p.currentPassword, row.password_hash)) {
    ipcError('VALIDATION', 'Current password is incorrect.');
  }
  const strength = checkPasswordStrength(p.newPassword);
  if (!strength.ok) ipcError('VALIDATION', strength.errors.join(' '));
  if (p.currentPassword === p.newPassword) {
    ipcError('VALIDATION', 'New password must differ from the current one.');
  }
  sc.db
    .prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
    )
    .run(hashPassword(p.newPassword), sc.now(), user.id);
  audit(sc, {
    action: 'user.password_change',
    entityType: 'user',
    entityId: user.id,
    summary: 'Changed own password',
  });
  return { done: true };
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export function listRoles(sc: ServiceContext): RoleSummary[] {
  const rows = sc.db
    .prepare('SELECT * FROM roles ORDER BY name COLLATE NOCASE')
    .all() as Record<string, unknown>[];
  return rows.map((r) => {
    const permissions = (
      sc.db
        .prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?')
        .all(r.id) as { permission_code: string }[]
    ).map((x) => x.permission_code) as Permission[];
    const userCount = (
      sc.db.prepare('SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?').get(r.id) as {
        n: number;
      }
    ).n;
    return {
      id: r.id as number,
      name: r.name as string,
      description: (r.description as string) ?? '',
      isBuiltIn: r.is_builtin === 1,
      permissions,
      userCount,
    };
  });
}

export type RoleSave = {
  id: number | null;
  name: string;
  description: string;
  permissions: string[];
};

export function saveRole(sc: ServiceContext, p: RoleSave): RoleSummary {
  if (p.permissions.length === 0) ipcError('VALIDATION', 'Select at least one permission.');
  const now = sc.now();
  const id = sc.db.transaction(() => {
    let roleId: number;
    if (p.id) {
      const existing = sc.db.prepare('SELECT name, is_builtin FROM roles WHERE id = ?').get(p.id) as
        | { name: string; is_builtin: number }
        | undefined;
      if (!existing) ipcError('NOT_FOUND', 'Role not found.');
      // Built-in roles: permissions & description editable; stable name preserved.
      const nextName = existing.is_builtin === 1 ? existing.name : p.name;
      sc.db
        .prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?')
        .run(nextName, p.description, p.id);
      sc.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(p.id);
      roleId = p.id;
    } else {
      const dup = sc.db.prepare('SELECT id FROM roles WHERE name = ?').get(p.name);
      if (dup) ipcError('CONFLICT', 'A role with that name already exists.');
      const info = sc.db
        .prepare('INSERT INTO roles (name, description, is_builtin, created_at) VALUES (?,?,0,?)')
        .run(p.name, p.description, now);
      roleId = Number(info.lastInsertRowid);
    }
    const ins = sc.db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)',
    );
    for (const code of p.permissions) ins.run(roleId, code);
    return roleId;
  })();
  audit(sc, {
    action: p.id ? 'role.update' : 'role.create',
    entityType: 'role',
    entityId: id,
    summary: `Saved role (${p.permissions.length} permissions)`,
  });
  const found = listRoles(sc).find((r) => r.id === id);
  if (!found) ipcError('INTERNAL', 'Role missing after save.');
  return found;
}

export { lockoutDurationFor };
export type { BuiltInRoleKey };
