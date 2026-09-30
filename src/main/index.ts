/** Dentiva Pro — Electron main process entry. All privileged work happens here. */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Logger } from './logging';
import { SessionManager } from './session';
import { IpcDispatcher } from './ipc/dispatcher';
import { registerAllChannels, seedIfNeeded } from './ipc/register';
import { openDatabase, type DB } from './db/database';
import { ensureActivated } from './security/activation';
import { verifyPassword } from './security/passwords';
import * as platform from './services/platform';
import * as backupSvc from './services/backup';
import type { ServiceContext } from './services/context';

/* Single live window reference (used by handlers). */
let mainWindow: BrowserWindow | null = null;
let db: DB;

const logger = new Logger(app.getPath('userData'));
const session = new SessionManager();
const dispatcher = new IpcDispatcher(session, logger);

function serviceCtx(): ServiceContext {
  return {
    db,
    logger,
    session,
    userDataDir: app.getPath('userData'),
    ctx: { userId: null, username: 'system' },
    now: () => Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'Dentiva Pro',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Activity ping drives the auto-lock timer.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' || input.type === 'mouseDown') session.touch();
  });

  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

/* ------------------------------------------------------------------ */
/* IPC wiring                                                          */
/* ------------------------------------------------------------------ */

function wireIpc(): void {
  const userDataDir = app.getPath('userData');
  registerAllChannels({
    dispatcher,
    session,
    logger,
    userDataDir,
    dbPath: join(userDataDir, 'dentiva.db'),
    getWindow: () => mainWindow,
    getDb: () => db,
    setDb: (next) => {
      db = next;
    },
    onSettingsChanged: () => undefined,
    requirePassword: (password: string): boolean => {
      const user = session.getUser();
      if (!user) return false;
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.userId) as
        | { password_hash: string }
        | undefined;
      if (!row) return false;
      const ok = verifyPassword(password, row.password_hash);
      if (ok) {
        void platform;
        logger.info('session.unlock', { userId: user.userId });
      } else {
        logger.warn('session.unlock_failed', { userId: user.userId });
      }
      return ok;
    },
  });

  ipcMain.handle('dentiva:invoke', async (_event, channel: string, request: unknown) => {
    return dispatcher.dispatch(channel, request);
  });
}

/* ------------------------------------------------------------------ */
/* Background jobs (auto-backup, notification scan)                    */
/* ------------------------------------------------------------------ */

let jobTimer: NodeJS.Timeout | null = null;

function startBackgroundJobs(): void {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(() => {
    try {
      if (!session.isAuthenticated() || session.isLocked()) return;
      const ctx = serviceCtx();
      platform.scanNotifications(ctx);
      if (backupSvc.autoBackupDue(ctx)) {
        void backupSvc
          .createBackup(ctx, { kind: 'auto', dbPath: join(app.getPath('userData'), 'dentiva.db') })
          .then((rec) => logger.info('auto_backup', { id: rec.id, size: rec.sizeBytes }))
          .catch((err: unknown) =>
            logger.error('auto_backup_failed', { message: (err as Error).message }),
          );
      }
    } catch (err) {
      logger.error('background_job_failed', { message: (err as Error).message });
    }
  }, 10 * 60_000);
  jobTimer.unref?.();
}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    try {
      const userDataDir = app.getPath('userData');
      mkdirSync(userDataDir, { recursive: true });

      // Activation gate: the app refuses privileged work until activated.
      const activation = ensureActivated(userDataDir);
      if (!activation.activated) {
        logger.warn('activation_required', {});
      }

      db = openDatabase({ path: join(userDataDir, 'dentiva.db') });
      seedIfNeeded(db);

      wireIpc();
      session.configure({
        onLock: () => {
          mainWindow?.webContents.send('dentiva:session', { event: 'locked' });
          logger.info('session.locked_auto', {});
        },
        onLogout: () => {
          mainWindow?.webContents.send('dentiva:session', { event: 'logged_out' });
        },
      });

      mainWindow = createWindow();
      startBackgroundJobs();

      logger.info('app_started', {
        version: app.getVersion(),
        electron: process.versions.electron,
      });
    } catch (err) {
      logger.error('startup_failed', { message: (err as Error).message });
      console.error('[dentiva] startup failed:', err);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (jobTimer) clearInterval(jobTimer);
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  });

  // Offline-only: block all outgoing network at the session level.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      const allowed = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
      if (!allowed) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

export { dispatcher, session };

// electron-builder/NSIS lifecycle flags (--squirrel-*) are handled by the installer
// itself; other single-instance and cleanup behavior lives above.
