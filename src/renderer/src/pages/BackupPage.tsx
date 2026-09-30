/** Backup & restore: timestamped checksummed ZIPs, schedules, pre-restore safety. */

import { useCallback, useEffect, useState } from 'react';
import { HardDrive, FolderOpen, RefreshCw, ShieldAlert, Archive } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { BackupRecord, BackupStatus } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  PageHead,
  ConfirmDialog,
  fmtDateTime,
  fmtBytes,
} from '../components/ui';
import { toast } from '../lib/store';

export default function BackupPage(): JSX.Element {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, recs] = await Promise.all([
        api('backup.status', {}),
        api('backup.records', {}),
      ]);
      setStatus(st);
      setRecords(recs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createBackup = async (): Promise<void> => {
    setCreating(true);
    try {
      const rec = await api('backup.create', { kind: 'manual' });
      if (rec.status === 'success') {
        toast.success(`Backup created: ${rec.filePath}`);
      } else {
        toast.error(`Backup failed: ${rec.error}`);
      }
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const pickFolder = async (): Promise<void> => {
    try {
      const res = await api('backup.pickFolder', {});
      if (res.folder) {
        await api('settings.set', { key: 'backupFolder', value: res.folder });
        toast.success('Backup folder updated.');
        await load();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (loading) return <div className="page"><Loading /></div>;

  return (
    <div className="page">
      <PageHead
        title="Backup & Restore"
        subtitle="Every backup is a timestamped ZIP with a SHA-256 checksum"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => void pickFolder()} disabled={!perms.has('settings.manage')}>
              <FolderOpen size={16} /> Choose folder
            </button>
            <button className="btn btn-primary" onClick={() => void createBackup()} disabled={creating || !perms.has('backup.create')}>
              <RefreshCw size={16} className={creating ? 'spin' : ''} /> {creating ? 'Backing up…' : 'Back up now'}
            </button>
          </>
        }
      />

      {error ? <div className="alert danger">{error}</div> : null}

      {status ? (
        <div className="stat-grid">
          <div className="stat-tile static">
            <span className="stat-label">Backup folder</span>
            <span className="stat-value mono" style={{ fontSize: 14 }}>{status.folder ?? 'Not set'}</span>
          </div>
          <div className="stat-tile static">
            <span className="stat-label">Auto schedule</span>
            <span className="stat-value">{status.intervalDays ? `Every ${status.intervalDays} days` : 'Off'}</span>
          </div>
          <div className="stat-tile static">
            <span className="stat-label">Last success</span>
            <span className="stat-value" style={{ fontSize: 14 }}>{status.lastSuccessAt ? fmtDateTime(status.lastSuccessAt) : 'Never'}</span>
          </div>
          <div className="stat-tile static">
            <span className="stat-label">Next due</span>
            <span className="stat-value" style={{ fontSize: 14 }}>{status.nextDueAt ? fmtDateTime(status.nextDueAt) : '—'}</span>
          </div>
        </div>
      ) : null}

      {status?.lastError ? <div className="alert danger mt">Last error: {status.lastError}</div> : null}

      <div className="grid cols-2 mt">
        <div className="card">
          <div className="card-head"><h3><Archive size={16} /> Recent backups</h3></div>
          <div className="card-body">
            {records.length === 0 ? (
              <div className="empty">
                <div className="empty-icon"><HardDrive size={24} /></div>
                <h3>No backups yet</h3>
                <p>Create your first backup now — it stores the full database, attachments, and settings.</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table className="table">
                  <thead><tr><th>Created</th><th>Type</th><th>Size</th><th>Status</th></tr></thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} title={r.filePath}>
                        <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                        <td><span className="badge badge-neutral">{r.kind.replace('_', ' ')}</span></td>
                        <td>{fmtBytes(r.sizeBytes)}</td>
                        <td>
                          {r.status === 'success' ? (
                            <span className="badge badge-green">ok</span>
                          ) : (
                            <span className="badge badge-red" title={r.error}>failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Schedule</h3></div>
            <div className="card-body">
              <p className="muted">
                Automatic backups run while the app is open at the configured interval. Configure the
                interval and folder in <strong>Settings → Backup</strong>. Keep the folder on a
                different drive from the database for real protection.
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3><ShieldAlert size={16} /> Restore</h3></div>
            <div className="card-body stack">
              <div className="alert warning">
                Restoring replaces ALL current data. A safety backup of the current state is taken
                automatically before anything changes, and the ZIP checksum is verified first.
              </div>
              <button
                className="btn btn-danger"
                disabled={!perms.has('backup.restore')}
                onClick={() => setRestoreOpen(true)}
              >
                Restore from backup file…
              </button>
              {!perms.has('backup.restore') ? (
                <p className="muted">Your account lacks the <span className="mono">backup.restore</span> permission.</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {restoreOpen ? (
        <RestoreFlow
          onClose={() => setRestoreOpen(false)}
          onRestored={() => {
            setRestoreOpen(false);
            toast.success('Restore complete. The app will now restart.');
          }}
        />
      ) : null}
    </div>
  );
}

function RestoreFlow(props: { onClose(): void; onRestored(): void }): JSX.Element {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickFile = async (): Promise<void> => {
    setErr(null);
    try {
      const res = await api('backup.pickFiles', {});
      if (res.filePath) setFilePath(res.filePath);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const restore = async (): Promise<void> => {
    if (!filePath) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api('backup.restore', { filePath, confirmPhrase: 'RESTORE' });
      toast.success(`Restored. Pre-restore safety backup: ${res.preRestorePath}`);
      props.onRestored();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title="Restore from backup"
        onClose={props.onClose}
        footer={
          <>
            <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
            <button className="btn btn-secondary" onClick={() => void pickFile()} disabled={busy}>
              <FolderOpen size={15} /> Choose backup ZIP…
            </button>
            <button
              className="btn btn-danger"
              disabled={!filePath || busy}
              onClick={() => setConfirming(true)}
            >
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </>
        }
      >
        <div className="stack">
          {err ? <div className="alert danger">{err}</div> : null}
          <div className="alert warning">
            Restoring replaces patients, appointments, invoices, everything. You will be signed out.
            A safety backup of the current database is created first.
          </div>
          <Field label="Selected backup file">
            <div className="row gap">
              <input className="input mono" readOnly value={filePath ?? 'No file chosen'} />
            </div>
          </Field>
          <p className="muted">
            The file&apos;s SHA-256 checksum is verified against the manifest inside the ZIP before
            any data is touched.
          </p>
        </div>
      </Modal>

      {confirming ? (
        <ConfirmDialog
          title="Confirm restore"
          danger
          confirmLabel="Restore now"
          requirePhrase="RESTORE"
          body={
            <div className="stack">
              <p>
                You are about to restore from:
                <br />
                <span className="mono">{filePath}</span>
              </p>
              <div className="alert danger">
                All current data will be replaced. This cannot be undone (a pre-restore backup is
                taken automatically).
              </div>
            </div>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await restore();
          }}
        />
      ) : null}
    </>
  );
}
