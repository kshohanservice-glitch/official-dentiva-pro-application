/**
 * End-to-end boot suite — launches the BUILT app (out/ + packaged deps) with
 * Electron and drives the real renderer ⇄ preload ⇄ dispatcher stack.
 *
 * Runs on the Windows CI runner (display + network available) and on any local
 * machine with `npm ci && npm run build` done first. The sandbox uses a fresh
 * temp profile, so it always lands on the activation gate — which lets this
 * suite prove, through the real IPC path, that:
 *   1. the app boots and renders,
 *   2. the sandboxed preload bridge works,
 *   3. `app.status` reports unactivated,
 *   4. data channels are refused with ACTIVATION_REQUIRED (gate before schema).
 *
 * No activation material is present in this file — this suite deliberately
 * stays on the UNACTIVATED gate; activated workflow suites live alongside it
 * (setup-auth, clinical-ops, finance, rbac-inventory, backup-restore,
 * print-validate, session-lock) and write activation through the app's own
 * writeActivationState() with no secret in the repo (see helpers.ts).
 */

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

type BootInvoke = (channel: string, request: unknown) => Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } }
>;

function bridge(page: Page): BootInvoke {
  return ((channel: string, request: unknown) =>
    page.evaluate(
      ([c, r]) =>
        (
          window as unknown as {
            dentiva: { invoke(ch: string, req: unknown): Promise<unknown> };
          }
        ).dentiva.invoke(c, r),
      [channel, request] as [string, unknown],
    )) as BootInvoke;
}

test.describe('bundled app boot', () => {
  let app: ElectronApplication;

  test.beforeAll(async () => {
    const profile = mkdtempSync(join(tmpdir(), 'dentiva-e2e-profile-'));
    const configHome = mkdtempSync(join(tmpdir(), 'dentiva-e2e-config-'));
    app = await electron.launch({
      args: ['.', '--no-sandbox'],
      cwd: ROOT,
      env: {
        ...process.env,
        // Isolated profile: never touch a real user's activation/session state.
        APPDATA: profile,
        XDG_CONFIG_HOME: configHome,
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('window opens and renders the activation gate', async () => {
    const page = await app.firstWindow();
    await expect(page.locator('h2')).toContainText('Activate your license', { timeout: 45_000 });
    const rendered = await page.evaluate(
      () => document.getElementById('root')?.childElementCount ?? 0,
    );
    expect(rendered).toBeGreaterThan(0);
  });

  test('sandboxed preload bridge is exposed', async () => {
    const page = await app.firstWindow();
    const kind = await page.evaluate(
      () => typeof (window as unknown as { dentiva?: unknown }).dentiva,
    );
    expect(kind).toBe('object');
  });

  test('app.status reports the unactivated boot state via real IPC', async () => {
    const page = await app.firstWindow();
    const res = await bridge(page)('app.status', {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const status = res.data as {
        phase: string;
        activated: boolean;
        setupComplete: boolean;
        appVersion: string;
      };
      expect(status.phase).toBe('activation');
      expect(status.activated).toBe(false);
      expect(status.setupComplete).toBe(false);
      expect(status.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test('data channels are refused with ACTIVATION_REQUIRED before schema', async () => {
    const page = await app.firstWindow();
    // Deliberately empty/invalid payload: the activation gate must answer
    // first (ACTIVATION_REQUIRED), proving gate order on the real stack.
    const res = await bridge(page)('patients.list', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ACTIVATION_REQUIRED');
  });

  test('login is also refused before activation', async () => {
    const page = await app.firstWindow();
    const res = await bridge(page)('session.login', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ACTIVATION_REQUIRED');
  });
});
