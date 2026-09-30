/**
 * Registers every IPC channel from the shared contract with its handler.
 * Contract: src/shared/ipc.ts (channelDefs) — keep this file in exact sync.
 */

import { app, dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { IpcDispatcher } from './dispatcher';
import type { ServiceContext } from '../services/context';
import * as patients from '../services/patients';
import * as clinical from '../services/clinical';
import * as appointments from '../services/appointments';
import * as prescriptions from '../services/prescriptions';
import * as billing from '../services/billing';
import * as inventory from '../services/inventory';
import * as accounting from '../services/accounting';
import * as people from '../services/people';
import * as platform from '../services/platform';
import * as backupSvc from '../services/backup';
import * as printingSvc from '../services/printing';
import { audit } from '../services/context';
import { verifyPassword, hashPassword, lockoutDurationFor } from '../security/passwords';
import { ensureActivated } from '../security/activation';
import { integrityCheck, openDatabase, type DB } from '../db/database';
import { seedReferenceData } from '../db/seed';
import type { SessionManager } from '../session';
import type { Logger } from '../logging';
import type { ChannelRequest } from '@shared/ipc';
import type { AppStatus, SessionState } from '@shared/types';

export interface RegistrarDeps {
  dispatcher: IpcDispatcher;
  session: SessionManager;
  logger: Logger;
  userDataDir: string;
  dbPath: string;
  getWindow(): BrowserWindow | null;
  getDb(): DB;
  setDb(db: DB): void;
  onSettingsChanged(): void;
  requirePassword(password: string): boolean;
}

export function registerAllChannels(deps: RegistrarDeps): void {
  const { dispatcher } = deps;

  const sc = (handlerCtx: { userId: number | null; username: string }): ServiceContext => ({
    db: deps.getDb(),
    logger: deps.logger,
    session: deps.session,
    userDataDir: deps.userDataDir,
    ctx: handlerCtx,
    now: () => Date.now(),
  });

  /* ---------------- system / activation / setup ---------------- */

  dispatcher.register('app.status', () => {
    const db = deps.getDb();
    const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const dentistCount = (
      db.prepare('SELECT COUNT(*) AS n FROM dentists WHERE is_active = 1').get() as { n: number }
    ).n;
    const activation = ensureActivated(deps.userDataDir);
    const clinic = platform.getClinicConfig(sc({ userId: null, username: 'system' }));
    const setupComplete = userCount > 0 && dentistCount > 0;
    const phase: AppStatus['phase'] = !activation.activated
      ? 'activation'
      : !setupComplete
        ? 'setup'
        : deps.session.isAuthenticated()
          ? 'app'
          : 'login';
    const status: AppStatus = {
      phase,
      activated: activation.activated,
      setupComplete,
      userCount,
      appVersion: app.getVersion(),
      clinicName: clinic.clinicName || null,
    };
    return status;
  });

  dispatcher.register('activation.verify', (req) => {
    const r = req as ChannelRequest<'activation.verify'>;
    const result = ensureActivated(deps.userDataDir, r.code);
    const ctx = { userId: null, username: 'system' };
    if (result.activated) {
      audit(sc(ctx), {
        action: 'activation.success',
        entityType: 'activation',
        summary: 'License activated',
      });
    } else {
      audit(sc(ctx), {
        action: 'activation.failed',
        entityType: 'activation',
        summary: 'Activation attempt rejected',
      });
    }
    return { activated: result.activated };
  });

  dispatcher.register('setup.complete', (req, handlerCtx) => {
    const r = req as ChannelRequest<'setup.complete'>;
    const db = deps.getDb();
    const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (existing.n > 0) {
      return deps.session.state();
    }
    const now = Date.now();
    const svcCtx = sc(handlerCtx);
    db.transaction(() => {
      platform.updateClinicConfig(svcCtx, {
        clinicName: r.clinic.clinicName,
        address: r.clinic.address,
        phone: r.clinic.phone,
        email: r.clinic.email,
        website: r.clinic.website,
        registrationInfo: r.clinic.registrationInfo,
        operatingHours: r.clinic.operatingHours,
        footerNote: r.clinic.footerNote,
        prescriptionFooter: r.clinic.prescriptionFooter,
        invoiceFooter: r.clinic.invoiceFooter,
      });
      if (r.clinic.logoPath) {
        platform.setClinicLogo(svcCtx, r.clinic.logoPath);
      }
      for (const d of r.dentists) {
        people.saveDentist(svcCtx, {
          id: null,
          fullName: d.fullName,
          phone: d.phone,
          email: d.email,
          bio: d.bio,
          isActive: true,
          designations: d.designations,
          qualifications: d.qualifications,
        });
      }
      const adminRole = db.prepare(`SELECT id FROM roles WHERE name = 'Administrator / Owner'`).get() as
        | { id: number }
        | undefined;
      if (!adminRole) throw new Error('Administrator role missing — seed did not run.');
      const info = db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, staff_id, is_active,
                              must_change_password, failed_attempts, created_at, updated_at)
           VALUES (?,?,?,NULL,1,0,0,?,?)`,
        )
        .run(
          r.admin.username,
          r.admin.displayName,
          hashPassword(r.admin.password),
          now,
          now,
        );
      const userId = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, adminRole.id);
      // Settings from wizard.
      const setSetting = (key: string, value: string): void => {
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(key, value, now);
      };
      setSetting('autoLockMinutes', String(r.autoLockMinutes));
      if (r.backupFolder) setSetting('backupFolder', r.backupFolder);
      setSetting('defaultPaperSize', r.paperSize);
      if (r.printerName) {
        db.prepare('UPDATE printer_profiles SET printer_name = ? WHERE is_default = 1').run(r.printerName);
      }
      // Sign the new admin in.
      const roleRows = db
        .prepare(
          `SELECT r.id FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
        )
        .all(userId) as { id: number }[];
      const permSet = new Set<string>();
      for (const role of roleRows) {
        const perms = db
          .prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?')
          .all(role.id) as { permission_code: string }[];
        for (const p of perms) permSet.add(p.permission_code);
      }
      deps.session.start(
        userId,
        r.admin.username,
        r.admin.displayName,
        null,
        [...permSet] as never,
        ['Administrator / Owner'],
      );
      deps.session.setAutoLockMinutes(r.autoLockMinutes);
    })();
    audit(sc(handlerCtx), {
      action: 'setup.complete',
      entityType: 'setup',
      summary: 'First-run setup completed',
    });
    return deps.session.state();
  });

  /* ---------------- session ---------------- */

  dispatcher.register('session.state', () => deps.session.state());

  dispatcher.register('session.login', (req, handlerCtx) => {
    const r = req as ChannelRequest<'session.login'>;
    const db = deps.getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(r.username) as
      | Record<string, unknown>
      | undefined;
    const svcCtx = sc(handlerCtx);
    if (!user || user.is_active !== 1) {
      // Constant-ish work to avoid trivial timing oracle.
      verifyPassword(r.password, '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAA=$AAAAAAA=');
      throw Object.assign(new Error('Invalid username or password.'), { code: 'VALIDATION' });
    }
    // Lockout check before verifying.
    const fails = (user.failed_attempts as number) ?? 0;
    const lockedUntil = (user.locked_until as number | null) ?? 0;
    if (lockedUntil > Date.now()) {
      throw Object.assign(
        new Error(`Too many failed attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`),
        { code: 'CONFLICT' },
      );
    }
    if (!verifyPassword(r.password, user.password_hash as string)) {
      const nextFails = fails + 1;
      const wait = lockoutDurationFor(nextFails);
      const until = wait > 0 ? Date.now() + wait : null;
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
        nextFails,
        until,
        Date.now(),
        user.id,
      );
      audit(svcCtx && {
        ...svcCtx,
        ctx: { userId: user.id as number, username: user.username as string },
      } as ServiceContext, {
        action: 'session.login_failed',
        entityType: 'user',
        entityId: user.id as number,
        summary: 'Failed login',
      });
      if (until) {
        throw Object.assign(
          new Error(`Too many failed attempts. Try again in ${Math.ceil(wait / 1000)}s.`),
          { code: 'CONFLICT' },
        );
      }
      throw Object.assign(new Error('Invalid username or password.'), { code: 'VALIDATION' });
    }
    db.prepare(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    ).run(Date.now(), Date.now(), user.id);

    const roleRows = db
      .prepare(`SELECT r.id, r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`)
      .all(user.id) as { id: number; name: string }[];
    const permSet = new Set<string>();
    const roleNames: string[] = [];
    for (const role of roleRows) {
      roleNames.push(role.name);
      const perms = db
        .prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?')
        .all(role.id) as { permission_code: string }[];
      for (const p of perms) permSet.add(p.permission_code);
    }
    deps.session.start(
      user.id as number,
      user.username as string,
      user.display_name as string,
      (user.staff_id as number | null) ?? null,
      [...permSet] as never,
      roleNames,
    );
    const lockRow = db.prepare(`SELECT value FROM settings WHERE key = 'autoLockMinutes'`).get() as
      | { value: string }
      | undefined;
    if (lockRow) deps.session.setAutoLockMinutes(Number(lockRow.value) || 15);
    audit(
      sc({ userId: user.id as number, username: user.username as string }),
      { action: 'session.login', entityType: 'user', entityId: user.id as number, summary: 'Signed in' },
    );
    return deps.session.state();
  });

  dispatcher.register('session.unlock', (req) => {
    const r = req as ChannelRequest<'session.unlock'>;
    if (!deps.requirePassword(r.password)) {
      throw Object.assign(new Error('Incorrect password.'), { code: 'VALIDATION' });
    }
    deps.session.unlock();
    return deps.session.state();
  });

  dispatcher.register('session.logout', (_req, handlerCtx) => {
    if (handlerCtx.userId !== null) {
      audit(sc(handlerCtx), { action: 'session.logout', entityType: 'user', summary: 'Signed out' });
    }
    deps.session.logout();
    return { done: true as const };
  });

  dispatcher.register('session.lock', (_req, handlerCtx) => {
    audit(sc(handlerCtx), { action: 'session.lock', entityType: 'user', summary: 'Locked session' });
    deps.session.lock();
    return { done: true as const };
  });

  dispatcher.register('session.activity', () => {
    deps.session.touch();
    return { locked: deps.session.isLocked() };
  });

  dispatcher.register('session.changePassword', (req, handlerCtx) =>
    people.changeOwnPassword(sc(handlerCtx), req as ChannelRequest<'session.changePassword'>),
  );

  /* ---------------- clinic & settings ---------------- */

  dispatcher.register('clinic.get', (_req, c) => platform.getClinicConfig(sc(c)));
  dispatcher.register('clinic.update', (req, c) =>
    platform.updateClinicConfig(sc(c), req as ChannelRequest<'clinic.update'>),
  );
  dispatcher.register('clinic.pickLogo', async (_req, c) => {
    const win = deps.getWindow();
    if (!win) return platform.getClinicConfig(sc(c));
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose clinic logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    });
    if (res.canceled || !res.filePaths[0]) return platform.getClinicConfig(sc(c));
    return platform.setClinicLogo(sc(c), res.filePaths[0]);
  });
  dispatcher.register('clinic.clearLogo', (_req, c) => platform.setClinicLogo(sc(c), null));

  dispatcher.register('settings.get', (_req, c) => platform.getAllSettings(sc(c)));
  dispatcher.register('settings.set', (req, c) => {
    const r = req as ChannelRequest<'settings.set'>;
    return platform.setSetting(sc(c), r.key, r.value);
  });
  dispatcher.register('settings.resetPrescriptionTemplate', (_req, c) =>
    platform.resetTemplateSetting(sc(c), 'prescription'),
  );
  dispatcher.register('settings.resetInvoiceTemplate', (_req, c) =>
    platform.resetTemplateSetting(sc(c), 'invoice'),
  );

  /* ---------------- patients ---------------- */

  dispatcher.register('patients.list', (req, c) => patients.listPatients(sc(c), req as never));
  dispatcher.register('patients.get', (req, c) =>
    patients.getPatient(sc(c), (req as ChannelRequest<'patients.get'>).id),
  );
  dispatcher.register('patients.create', (req, c) => patients.createPatient(sc(c), req as never));
  dispatcher.register('patients.update', (req, c) => patients.updatePatient(sc(c), req as never));
  dispatcher.register('patients.timeline', (req, c) => patients.patientTimeline(sc(c), req as never));
  dispatcher.register('patients.export', (req, c) => {
    const r = req as ChannelRequest<'patients.export'>;
    return patients.exportPatients(sc(c), { ids: r.ids });
  });

  /* ---------------- visits & clinical ---------------- */

  dispatcher.register('visits.create', (req, c) => clinical.createVisit(sc(c), req as never));
  dispatcher.register('visits.listByPatient', (req, c) =>
    clinical.listVisitsByPatient(sc(c), (req as ChannelRequest<'visits.listByPatient'>).patientId),
  );
  dispatcher.register('visits.get', (req, c) =>
    clinical.getVisit(sc(c), (req as ChannelRequest<'visits.get'>).id),
  );
  dispatcher.register('clinical.options', (req, c) =>
    clinical.listClinicalOptions(sc(c), (req as ChannelRequest<'clinical.options'>).section),
  );
  dispatcher.register('clinical.optionsCreate', (req, c) =>
    clinical.createClinicalOption(sc(c), req as never),
  );

  /* ---------------- dental chart ---------------- */

  dispatcher.register('chart.catalog', (_req, c) => clinical.getChartCatalog(sc(c)));
  dispatcher.register('chart.get', (req, c) =>
    clinical.getChart(sc(c), (req as ChannelRequest<'chart.get'>).patientId),
  );
  dispatcher.register('chart.setEntry', (req, c) => clinical.setChartEntry(sc(c), req as never));
  dispatcher.register('chart.clearEntry', (req, c) => clinical.clearChartEntry(sc(c), req as never));
  dispatcher.register('chart.addCondition', (req, c) =>
    clinical.addToothCondition(sc(c), req as never),
  );

  /* ---------------- treatments ---------------- */

  dispatcher.register('treatments.list', (req, c) => clinical.listTreatments(sc(c), req as never));
  dispatcher.register('treatments.save', (req, c) => clinical.saveTreatment(sc(c), req as never));

  /* ---------------- appointments & queue ---------------- */

  dispatcher.register('appointments.list', (req, c) => appointments.listAppointments(sc(c), req as never));
  dispatcher.register('appointments.create', (req, c) => appointments.createAppointment(sc(c), req as never));
  dispatcher.register('appointments.update', (req, c) => appointments.updateAppointment(sc(c), req as never));
  dispatcher.register('appointments.conflicts', (req, c) => appointments.findConflicts(sc(c), req as never));
  dispatcher.register('queue.list', (req, c) => appointments.listQueue(sc(c), req as never));
  dispatcher.register('queue.addWalkIn', (req, c) => appointments.addWalkIn(sc(c), req as never));
  dispatcher.register('queue.checkIn', (req, c) =>
    appointments.checkIn(sc(c), (req as ChannelRequest<'queue.checkIn'>).appointmentId),
  );
  dispatcher.register('queue.advance', (req, c) => appointments.advanceQueue(sc(c), req as never));
  dispatcher.register('queue.remove', (req, c) =>
    appointments.removeQueueEntry(sc(c), (req as ChannelRequest<'queue.remove'>).id),
  );

  /* ---------------- prescriptions ---------------- */

  dispatcher.register('prescriptions.list', (req, c) => prescriptions.listPrescriptions(sc(c), req as never));
  dispatcher.register('prescriptions.get', (req, c) =>
    prescriptions.getPrescription(sc(c), (req as ChannelRequest<'prescriptions.get'>).id),
  );
  dispatcher.register('prescriptions.create', (req, c) =>
    prescriptions.createPrescription(sc(c), req as never),
  );
  dispatcher.register('prescriptions.medicines', (req, c) =>
    prescriptions.listMedicines(sc(c), (req as ChannelRequest<'prescriptions.medicines'>).search),
  );
  dispatcher.register('prescriptions.medicineUpsert', (req, c) =>
    prescriptions.upsertMedicine(sc(c), req as never),
  );

  /* ---------------- invoices & payments ---------------- */

  dispatcher.register('invoices.list', (req, c) => billing.listInvoices(sc(c), req as never));
  dispatcher.register('invoices.get', (req, c) =>
    billing.getInvoice(sc(c), (req as ChannelRequest<'invoices.get'>).id),
  );
  dispatcher.register('invoices.create', (req, c) => billing.createInvoice(sc(c), req as never));
  dispatcher.register('invoices.void', (req, c) => billing.voidInvoice(sc(c), req as never));
  dispatcher.register('payments.list', (req, c) => billing.listPayments(sc(c), req as never));
  dispatcher.register('payments.create', (req, c) => billing.createPayment(sc(c), req as never));
  dispatcher.register('payments.void', (req, c) => billing.voidPayment(sc(c), req as never));
  dispatcher.register('payments.summary', (req, c) => billing.paymentSummary(sc(c), req as never));

  /* ---------------- inventory & suppliers ---------------- */

  dispatcher.register('inventory.list', (req, c) => inventory.listItems(sc(c), req as never));
  dispatcher.register('inventory.get', (req, c) =>
    inventory.getItem(sc(c), (req as ChannelRequest<'inventory.get'>).id),
  );
  dispatcher.register('inventory.save', (req, c) => inventory.saveItem(sc(c), req as never));
  dispatcher.register('inventory.adjust', (req, c) => inventory.adjustStock(sc(c), req as never));
  dispatcher.register('inventory.transactions', (req, c) =>
    inventory.listTransactions(sc(c), req as never),
  );
  dispatcher.register('inventory.alerts', (_req, c) => inventory.stockAlerts(sc(c)));
  dispatcher.register('inventory.exportCsv', (_req, c) => inventory.exportCsv(sc(c)));
  dispatcher.register('suppliers.list', (_req, c) => inventory.listSuppliers(sc(c)));
  dispatcher.register('suppliers.save', (req, c) => inventory.saveSupplier(sc(c), req as never));

  /* ---------------- accounting ---------------- */

  dispatcher.register('accounting.expenseCategories', (_req, c) => accounting.listCategories(sc(c)));
  dispatcher.register('accounting.expenseCategorySave', (req, c) =>
    accounting.saveCategory(sc(c), req as never),
  );
  dispatcher.register('accounting.expenses', (req, c) => accounting.listExpenses(sc(c), req as never));
  dispatcher.register('accounting.expenseSave', (req, c) => accounting.saveExpense(sc(c), req as never));
  dispatcher.register('accounting.otherIncome', (req, c) => accounting.listOtherIncome(sc(c), req as never));
  dispatcher.register('accounting.otherIncomeSave', (req, c) =>
    accounting.saveOtherIncome(sc(c), req as never),
  );

  /* ---------------- reports ---------------- */

  dispatcher.register('reports.range', (req, c) => accounting.reportSummary(sc(c), req as never));
  dispatcher.register('reports.daily', (req, c) => accounting.dailyRevenue(sc(c), req as never));
  dispatcher.register('reports.methods', (req, c) => accounting.methodBreakdown(sc(c), req as never));
  dispatcher.register('reports.expenses', (req, c) => accounting.expensesByCategory(sc(c), req as never));
  dispatcher.register('reports.treatmentRevenue', (req, c) =>
    accounting.treatmentRevenue(sc(c), req as never),
  );

  /* ---------------- staff, users, roles ---------------- */

  dispatcher.register('staff.list', (req, c) =>
    people.listStaff(sc(c), (req as ChannelRequest<'staff.list'>).includeInactive),
  );
  dispatcher.register('staff.save', (req, c) => people.saveStaff(sc(c), req as never));
  dispatcher.register('dentists.list', (req, c) =>
    people.listDentists(sc(c), (req as ChannelRequest<'dentists.list'>).includeInactive),
  );
  dispatcher.register('dentists.save', (req, c) => people.saveDentist(sc(c), req as never));
  dispatcher.register('users.list', (_req, c) => people.listUsers(sc(c)));
  dispatcher.register('users.save', (req, c) => people.saveUser(sc(c), req as never));
  dispatcher.register('users.resetPassword', (req, c) =>
    people.resetUserPassword(sc(c), req as never),
  );
  dispatcher.register('roles.list', (_req, c) => people.listRoles(sc(c)));
  dispatcher.register('roles.save', (req, c) => people.saveRole(sc(c), req as never));

  /* ---------------- referrals ---------------- */

  dispatcher.register('referrals.list', (req, c) => platform.listReferrals(sc(c), req as never));
  dispatcher.register('referrals.create', (req, c) => platform.createReferral(sc(c), req as never));
  dispatcher.register('referrals.update', (req, c) => platform.updateReferral(sc(c), req as never));

  /* ---------------- attachments ---------------- */

  dispatcher.register('attachments.list', (req, c) =>
    platform.listAttachments(sc(c), req as never),
  );
  dispatcher.register('attachments.pick', async (req, c) => {
    const r = req as ChannelRequest<'attachments.pick'>;
    const win = deps.getWindow();
    if (!win) throw Object.assign(new Error('No window available.'), { code: 'INTERNAL' });
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Attachments',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'docx', 'xlsx'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) {
      throw Object.assign(new Error('No file selected.'), { code: 'CANCELLED' as never });
    }
    return platform.pickAttachment(sc(c), r, res.filePaths[0]);
  });
  dispatcher.register('attachments.open', async (req, c) => {
    const r = req as ChannelRequest<'attachments.open'>;
    const path = platform.attachmentStoredPath(sc(c), r.id);
    await shell.openPath(path);
    return { done: true as const };
  });
  dispatcher.register('attachments.delete', (req, c) =>
    platform.deleteAttachment(sc(c), (req as ChannelRequest<'attachments.delete'>).id),
  );

  /* ---------------- dashboard / search / notifications / audit ---------------- */

  dispatcher.register('dashboard.get', (_req, c) => platform.dashboard(sc(c)));
  dispatcher.register('search.global', (req, c) => {
    const r = req as ChannelRequest<'search.global'>;
    return platform.globalSearch(sc(c), r.query, r.kinds);
  });
  dispatcher.register('notifications.list', (req, c) => platform.listNotifications(sc(c), req as never));
  dispatcher.register('notifications.markRead', (req, c) =>
    platform.markNotificationRead(sc(c), (req as ChannelRequest<'notifications.markRead'>).id),
  );
  dispatcher.register('notifications.markAllRead', (_req, c) =>
    platform.markAllNotificationsRead(sc(c)),
  );
  dispatcher.register('audit.list', (req, c) => platform.listAudit(sc(c), req as never));

  /* ---------------- backup ---------------- */

  dispatcher.register('backup.status', (_req, c) => backupSvc.backupStatus(sc(c)));
  dispatcher.register('backup.pickFolder', async (_req, c) => {
    const win = deps.getWindow();
    if (!win) return { folder: null };
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { folder: null };
    const folder = res.filePaths[0];
    platform.setSetting(sc(c), 'backupFolder', folder);
    deps.onSettingsChanged();
    return { folder };
  });
  dispatcher.register('backup.create', async (req, c) => {
    const r = req as ChannelRequest<'backup.create'>;
    const rec = await backupSvc.createBackup(sc(c), {
      kind: r.kind === 'auto' ? 'auto' : 'manual',
      dbPath: deps.dbPath,
    });
    deps.onSettingsChanged();
    return rec;
  });
  dispatcher.register('backup.pickFiles', async () => {
    const win = deps.getWindow();
    if (!win) return { filePath: null };
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose backup archive',
      properties: ['openFile'],
      filters: [{ name: 'Dentiva backup', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { filePath: null };
    return { filePath: res.filePaths[0] };
  });
  dispatcher.register('backup.restore', async (req, c) => {
    const r = req as ChannelRequest<'backup.restore'>;
    // Server-side double-confirm: the UI asks the operator to type the phrase,
    // and the main process refuses without it even if a renderer is compromised.
    if (r.confirmPhrase !== 'RESTORE') {
      throw Object.assign(new Error('Confirmation phrase required to restore.'), {
        code: 'VALIDATION' as const,
      });
    }
    const verify = backupSvc.verifyArchive(r.filePath);
    if (!verify.valid) {
      throw Object.assign(
        new Error(`Backup failed verification: ${verify.problems.join('; ')}`),
        { code: 'VALIDATION' },
      );
    }
    // Close live DB, restore, reopen.
    deps.getDb().close();
    let preRestorePath = '';
    try {
      const outcome = await backupSvc.restoreBackup(sc(c), {
        filePath: r.filePath,
        dbPath: deps.dbPath,
        attachmentsDir: `${deps.userDataDir}/attachments`,
      });
      preRestorePath = outcome.preRestorePath;
    } catch (err) {
      try {
        deps.setDb(openDatabase({ path: deps.dbPath }));
      } catch {
        /* fatal — surfaced below */
      }
      throw err;
    }
    deps.setDb(openDatabase({ path: deps.dbPath }));
    audit(sc(c), {
      action: 'backup.restore',
      entityType: 'backup',
      entityId: r.filePath,
      summary: 'Database restored from backup',
    });
    return { restored: true as const, preRestorePath };
  });
  dispatcher.register('backup.records', (_req, c) => backupSvc.listBackups(sc(c)));

  /* ---------------- printers & profiles ---------------- */

  dispatcher.register('printers.list', async () => {
    const win = deps.getWindow();
    if (!win) return [];
    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers.map((p) => {
        const opts = (p.options ?? {}) as Record<string, unknown>;
        const isDefault =
          opts.is_default === true ||
          opts.isDefault === true ||
          opts.default === true;
        const status =
          typeof opts.printer_status === 'string'
            ? opts.printer_status
            : typeof opts.status === 'string'
              ? opts.status
              : 'ready';
        return {
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          isDefault,
          status,
        };
      });
    } catch {
      return [];
    }
  });
  dispatcher.register('printerProfiles.list', (_req, c) => printingSvc.listProfiles(sc(c)));
  dispatcher.register('printerProfiles.save', (req, c) => printingSvc.saveProfile(sc(c), req as never));
  dispatcher.register('printerProfiles.delete', (req, c) =>
    printingSvc.deleteProfile(sc(c), (req as ChannelRequest<'printerProfiles.delete'>).id),
  );

  /* ---------------- print jobs ---------------- */

  dispatcher.register('print.run', async (req, c) => {
    const r = req as ChannelRequest<'print.run'>;
    const win = deps.getWindow();
    if (!win) throw Object.assign(new Error('No window.'), { code: 'INTERNAL' });
    const payload = buildDocPayload(deps.getDb(), r.docType, r.docId) as printingSvc.PrintPayload;
    const profile = r.profileId ? printingSvc.getProfile(sc(c), r.profileId) : null;
    const result = await printingSvc.runPrint(win, {
      docType: r.docType,
      payload,
      printerName: r.printerName ?? profile?.printerName ?? null,
      silent: r.silent,
      copies: r.copies ?? profile?.copies ?? 1,
      paperSize: r.paperSize ?? profile?.paperSize ?? 'A4',
      orientation: profile?.orientation ?? 'portrait',
      margins: r.margins ?? (profile ? printingSvc.profileMargins(profile) : null),
      scalePercent: r.scalePercent ?? profile?.scalePercent ?? 100,
    });
    if (result.printed) {
      audit(sc(c), {
        action: 'print.run',
        entityType: r.docType,
        entityId: r.docId,
        summary: `Printed ${r.docType}${result.printerUsed ? ` on ${result.printerUsed}` : ''}`,
      });
    }
    return { printed: result.printed, message: result.message };
  });

  dispatcher.register('print.preview', (req) => {
    const r = req as ChannelRequest<'print.preview'>;
    const payload = buildDocPayload(deps.getDb(), r.docType, r.docId) as printingSvc.PrintPayload;
    const html = printingSvc.buildPrintHtml(payload);
    return { previewHtml: html };
  });

  dispatcher.register('print.toPdf', async (req, c) => {
    const r = req as ChannelRequest<'print.toPdf'>;
    const win = deps.getWindow();
    if (!win) throw Object.assign(new Error('No window.'), { code: 'INTERNAL' });
    const payload = buildDocPayload(deps.getDb(), r.docType, r.docId) as printingSvc.PrintPayload;
    const result = await printingSvc.saveAsPdf(win, {
      docType: r.docType,
      payload,
      pageSize: r.paperSize,
      savePath: r.savePath,
    });
    if (result.saved) {
      audit(sc(c), {
        action: 'print.pdf',
        entityType: r.docType,
        entityId: r.docId,
        summary: `Exported ${r.docType} to PDF`,
      });
    }
    return { saved: result.saved, path: result.path };
  });

  void ipcMain;
  void seedReferenceData;
  void integrityCheck;
}

export type DocPayload = ReturnType<typeof buildDocPayload>;

function logoDataUrlFromRow(row: Record<string, unknown> | undefined): string | null {
  const logoPath = row?.logo_path as string | undefined;
  if (!logoPath || !existsSync(logoPath)) return null;
  try {
    const buf = readFileSync(logoPath);
    if (buf.length > 1_000_000) return null;
    const ext = extname(logoPath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function buildDocPayload(db: DB, docType: 'prescription' | 'invoice', docId: number): unknown {
  const clinicRows = db.prepare('SELECT key, value FROM clinic_config').all() as {
    key: string;
    value: unknown;
  }[];
  void clinicRows;
  const clinicRow = db.prepare('SELECT * FROM clinic_config WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;
  const config = {
    ...platform.clinicRowToConfig(clinicRow),
    logo_data_url: logoDataUrlFromRow(clinicRow),
  } as Record<string, unknown>;

  if (docType === 'prescription') {
    const row = db
      .prepare(
        `SELECT r.*, p.full_name AS patient_name, p.patient_code, p.age_years, p.gender,
                p.address, p.phone AS patient_phone, p.blood_group,
                d.full_name AS dentist_name
         FROM prescriptions r
         JOIN patients p ON p.id = r.patient_id
         JOIN dentists d ON d.id = r.dentist_id
         WHERE r.id = ?`,
      )
      .get(docId) as Record<string, unknown> | undefined;
    if (!row) throw Object.assign(new Error('Prescription not found.'), { code: 'NOT_FOUND' });
    const items = db
      .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY seq')
      .all(docId) as Record<string, unknown>[];
    const designations = row.dentist_id
      ? (
          db
            .prepare('SELECT designation FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order')
            .all(row.dentist_id) as { designation: string }[]
        ).map((d) => d.designation)
      : [];
    const qualifications = row.dentist_id
      ? (
          db
            .prepare('SELECT qualification FROM dentist_qualifications WHERE dentist_id = ? ORDER BY sort_order')
            .all(row.dentist_id) as { qualification: string }[]
        ).map((q) => q.qualification)
      : [];
    return { kind: 'prescription', doc: row, items, config, designations, qualifications };
  }
  const row = db
    .prepare(
      `SELECT i.*, p.full_name AS patient_name, p.patient_code, p.age_years, p.gender,
              p.phone AS patient_phone, p.blood_group
       FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`,
    )
    .get(docId) as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error('Invoice not found.'), { code: 'NOT_FOUND' });
  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY seq')
    .all(docId) as Record<string, unknown>[];
  const paid = db
    .prepare(
      'SELECT COALESCE(SUM(amount_poisha), 0) AS paid FROM payments WHERE invoice_id = ? AND is_voided = 0',
    )
    .get(docId) as { paid: number };
  return { kind: 'invoice', doc: row, items, paid: paid.paid, config };
}

export function seedIfNeeded(db: DB): void {
  seedReferenceData(db, Date.now());
}

export type { SessionState };
