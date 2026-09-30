/**
 * Dispatcher gate tests: schema → session → lock → RBAC ordering.
 *
 * Regression: `session.unlock` and `session.logout` must work while locked,
 * while every data channel must refuse with LOCKED.
 */

import { describe, expect, it, vi } from 'vitest';
import { IpcDispatcher } from '../../src/main/ipc/dispatcher';
import type { SessionManager } from '../../src/main/session';
import type { Logger } from '../../src/main/logging';
import type { Permission } from '../../src/shared/permissions';

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

interface FakeSession {
  authed: boolean;
  locked: boolean;
  permissions: Set<Permission>;
}

function makeSession(): { session: SessionManager; state: FakeSession } {
  const state: FakeSession = { authed: true, locked: false, permissions: new Set<Permission>() };
  const session = {
    isAuthenticated: () => state.authed,
    isLocked: () => state.locked,
    can: (perms: Permission[]) => perms.every((p) => state.permissions.has(p)),
    getUser: () =>
      state.authed
        ? {
            userId: 1,
            username: 'auditor',
            displayName: 'Auditor',
            staffId: null,
            permissions: [...state.permissions],
            roleNames: ['Test'],
          }
        : null,
  } as unknown as SessionManager;
  return { session, state };
}

function makeDispatcher(): {
  dispatcher: IpcDispatcher;
  state: FakeSession;
  called: string[];
} {
  const { session, state } = makeSession();
  const dispatcher = new IpcDispatcher(session, makeLogger());
  const called: string[] = [];
  // Register a data channel and the session channels we exercise.
  dispatcher.register('patients.list', () => {
    called.push('patients.list');
    return { items: [], total: 0, page: 1, pageSize: 25 };
  });
  dispatcher.register('session.unlock', () => {
    called.push('session.unlock');
    state.locked = false;
    return { authenticated: true, locked: false, user: null, lastActivityAt: Date.now(), autoLockMinutes: 15 };
  });
  dispatcher.register('session.logout', () => {
    called.push('session.logout');
    state.authed = false;
    state.locked = false;
    return { done: true as const };
  });
  dispatcher.register('dashboard.get', () => {
    called.push('dashboard.get');
    return {};
  });
  return { dispatcher, state, called };
}

describe('dispatcher license activation gate', () => {
  function makeUnactivatedDispatcher(): IpcDispatcher {
    const { session } = makeSession();
    const dispatcher = new IpcDispatcher(session, makeLogger(), () => false);
    dispatcher.register('setup.complete', () => ({ done: true as const }));
    dispatcher.register('session.login', () => ({
      authenticated: true,
      locked: false,
      user: null,
      lastActivityAt: Date.now(),
      autoLockMinutes: 15,
    }));
    dispatcher.register('patients.list', () => ({ items: [], total: 0, page: 1, pageSize: 25 }));
    dispatcher.register('activation.verify', () => ({ activated: false }));
    dispatcher.register('app.status', () => ({
      phase: 'activation' as const,
      activated: false,
      setupComplete: false,
      userCount: 0,
      appVersion: '1.0.0',
      clinicName: null,
    }));
    return dispatcher;
  }

  it('blocks setup.complete before activation', async () => {
    const res = await makeUnactivatedDispatcher().dispatch('setup.complete', {} as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ACTIVATION_REQUIRED');
  });

  it('blocks session.login before activation', async () => {
    const res = await makeUnactivatedDispatcher().dispatch('session.login', {
      username: 'admin',
      password: 'x',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ACTIVATION_REQUIRED');
  });

  it('blocks data channels before activation', async () => {
    const res = await makeUnactivatedDispatcher().dispatch('patients.list', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ACTIVATION_REQUIRED');
  });

  it('still allows status reporting and activation itself', async () => {
    const d = makeUnactivatedDispatcher();
    const status = await d.dispatch('app.status', {});
    expect(status.ok).toBe(true);
    const verify = await d.dispatch('activation.verify', { code: 'attempt' });
    expect(verify.ok).toBe(true);
  });
});

describe('dispatcher session/lock gates', () => {
  it('blocks data channels while locked with LOCKED', async () => {
    const { dispatcher, state, called } = makeDispatcher();
    state.locked = true;

    const res = await dispatcher.dispatch('patients.list', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('LOCKED');
    expect(called).not.toContain('patients.list');
  });

  it('still blocks dashboard.get (permission-free) while locked', async () => {
    const { dispatcher, state } = makeDispatcher();
    state.locked = true;
    const res = await dispatcher.dispatch('dashboard.get', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('LOCKED');
  });

  it('allows session.unlock while locked', async () => {
    const { dispatcher, state, called } = makeDispatcher();
    state.locked = true;

    const res = await dispatcher.dispatch('session.unlock', { password: 'x' });
    expect(res.ok).toBe(true);
    expect(called).toContain('session.unlock');
    expect(state.locked).toBe(false);
  });

  it('allows session.logout while locked', async () => {
    const { dispatcher, state, called } = makeDispatcher();
    state.locked = true;

    const res = await dispatcher.dispatch('session.logout', {});
    expect(res.ok).toBe(true);
    expect(called).toContain('session.logout');
    expect(state.authed).toBe(false);
  });

  it('rejects everything with UNAUTHENTICATED after logout', async () => {
    const { dispatcher, state } = makeDispatcher();
    state.authed = false;

    const res = await dispatcher.dispatch('patients.list', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNAUTHENTICATED');
  });

  it('validates request schema before touching the session', async () => {
    const { dispatcher, state } = makeDispatcher();
    state.locked = true; // would otherwise return LOCKED
    const res = await dispatcher.dispatch('session.unlock', { password: 12345 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('enforces RBAC after the session gate', async () => {
    const { dispatcher, state } = makeDispatcher();
    state.permissions.clear(); // no permissions at all
    const res = await dispatcher.dispatch('patients.list', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('FORBIDDEN');
  });

  it('rejects unknown channels', async () => {
    const { dispatcher } = makeDispatcher();
    const res = await dispatcher.dispatch('not.a.channel', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INTERNAL');
  });
});
