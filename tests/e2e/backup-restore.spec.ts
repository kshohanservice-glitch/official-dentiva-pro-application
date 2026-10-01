/**
 * Backup/restore validation: manifest + SHA-256 verification of the real
 * archive, corrupt-archive and wrong-confirmation refusal, a genuine restore
 * that rolls data back, and proof the pre-restore safety copy captured the
 * state being replaced.
 */
import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import {
  all,
  api,
  apiExpectError,
  completeSetup,
  launch,
  newPatient,
  one,
  scalar,
} from './helpers'

test.describe('backup & restore', () => {
  test('archive integrity, restore rollback, pre-restore safety copy', async () => {
    const ctx = await launch()
    const page = ctx.page
    await completeSetup(page, { username: 'bk-admin' })

    const folder = join(ctx.profileRoot, 'backups')
    mkdirSync(folder, { recursive: true })
    await api(page, 'settings.set', { key: 'backupFolder', value: folder })

    // Data that must survive the restore.
    await api(page, 'patients.create', newPatient('Pre Backup Patient', '01712345507'))

    const rec = await api(page, 'backup.create', { kind: 'manual' })
    expect(rec.status).toBe('success')
    expect(existsSync(rec.filePath)).toBe(true)
    expect(statSync(rec.filePath).size).toBeGreaterThan(1000)

    // --- Manifest + checksum verification of the produced archive. ---
    const zip = new AdmZip(rec.filePath)
    const manifestEntry = zip.getEntry('manifest.json')
    expect(manifestEntry).not.toBeNull()
    const manifest = JSON.parse(manifestEntry!.getData().toString('utf8')) as {
      version: number
      database: { file: string; sha256: string }
      attachments: unknown[]
      counts: Record<string, number>
    }
    expect(manifest.version).toBe(1)
    expect(manifest.database.file).toBe('dentiva.db')
    const dbBytes = zip.getEntry('dentiva.db')!.getData()
    expect(createHash('sha256').update(dbBytes).digest('hex')).toBe(manifest.database.sha256)
    expect(manifest.counts.patients).toBe(1)
    expect(manifest.attachments).toEqual([]) // no attachments uploaded in this fixture

    // Content check straight from the archive: only the pre-backup patient.
    const dbEntryPath = join(ctx.profileRoot, 'inspect.db')
    writeFileSync(dbEntryPath, dbBytes)
    const { default: BetterSqlite3 } = await import('better-sqlite3')
    const probe = new BetterSqlite3(dbEntryPath, { readonly: true })
    const archivedNames = (
      probe.prepare('SELECT full_name FROM patients ORDER BY full_name').all() as {
        full_name: string
      }[]
    ).map((r) => r.full_name)
    probe.close()
    expect(archivedNames).toEqual(['Pre Backup Patient'])

    // --- Post-backup change (must be rolled back by restore). ---
    await api(page, 'patients.create', newPatient('Post Backup Patient', '01712345508'))
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM patients')).toBe(2)

    // --- Corrupt archive refused before touching anything. ---
    const badPath = join(folder, 'corrupt.zip')
    writeFileSync(badPath, Buffer.from('PK\u0003\u0004 this is not a valid archive'))
    const corrupt = await apiExpectError(page, 'backup.restore', {
      filePath: badPath,
      confirmPhrase: 'RESTORE',
    })
    expect(corrupt.code).toBe('VALIDATION')
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM patients')).toBe(2)

    // --- Wrong confirmation phrase refused (server-side). ---
    const badPhrase = await apiExpectError(page, 'backup.restore', {
      filePath: rec.filePath,
      confirmPhrase: 'yes please',
    })
    expect(badPhrase.code).toBe('VALIDATION')
    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM patients')).toBe(2)

    // --- Real restore. ---
    const out = await api(page, 'backup.restore', {
      filePath: rec.filePath,
      confirmPhrase: 'RESTORE',
    })
    expect(out.restored).toBe(true)
    expect(existsSync(out.preRestorePath)).toBe(true)

    // Rollback verified on the live DB: the post-backup patient is gone.
    const names = all<{ full_name: string }>(
      ctx.userData,
      'SELECT full_name FROM patients ORDER BY full_name',
    ).map((r) => r.full_name)
    expect(names).toEqual(['Pre Backup Patient'])

    // The pre-restore safety copy captured the state being replaced.
    const preZip = new AdmZip(out.preRestorePath)
    const preDbBytes = preZip.getEntry('dentiva.db')!.getData()
    const prePath = join(ctx.profileRoot, 'pre-restore.db')
    writeFileSync(prePath, preDbBytes)
    const preProbe = new BetterSqlite3(prePath, { readonly: true })
    const preNames = (
      preProbe.prepare('SELECT full_name FROM patients ORDER BY full_name').all() as {
        full_name: string
      }[]
    ).map((r) => r.full_name)
    preProbe.close()
    expect(preNames).toEqual(['Post Backup Patient', 'Pre Backup Patient'])

    // Session survived the swap and the restored DB serves requests.
    const dash = await api(page, 'dashboard.get', {})
    expect(dash.today).toBeTruthy()

    // Backup bookkeeping still works on the restored database.
    const again = await api(page, 'backup.create', { kind: 'manual' })
    expect(again.status).toBe('success')
    expect((await api(page, 'backup.records', {})).length).toBeGreaterThanOrEqual(1)

    await ctx.close()

    expect(
      scalar<number>(ctx.userData, "SELECT COUNT(*) FROM audit_logs WHERE action = 'backup.restore'"),
    ).toBeGreaterThanOrEqual(1)
    expect(
      scalar<number>(ctx.userData, "SELECT COUNT(*) FROM backup_records WHERE status = 'success'"),
    ).toBeGreaterThanOrEqual(1)
    expect(one<Record<string, string>>(ctx.userData, 'SELECT value FROM settings WHERE key = ?', 'backupFolder')?.value).toBe(folder)
  })
})
