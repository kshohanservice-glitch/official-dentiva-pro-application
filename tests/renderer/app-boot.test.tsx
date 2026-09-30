// @vitest-environment jsdom
/**
 * Renderer boot smoke tests: activation gate → setup → login routing,
 * driven through the typed preload contract with a mocked bridge.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChannelName, ChannelResponse, ChannelRequest } from '@shared/ipc';
import type { IpcResult } from '@shared/types';

type Handler = (req: never) => unknown;

const handlers = new Map<ChannelName, Handler>();

function setResult<C extends ChannelName>(channel: C, data: ChannelResponse<C>): void {
  handlers.set(channel, (() => data) as Handler);
}

function installBridge(): void {
  Object.defineProperty(window, 'dentiva', {
    configurable: true,
    value: {
      invoke: async <C extends ChannelName>(
        channel: C,
        request: ChannelRequest<C>,
      ): Promise<IpcResult<ChannelResponse<C>>> => {
        const handler = handlers.get(channel);
        if (!handler) {
          return {
            ok: false,
            error: { code: 'INTERNAL', message: `no mock for ${channel}` },
          } as IpcResult<ChannelResponse<C>>;
        }
        return { ok: true, data: handler(request as never) as ChannelResponse<C> } as IpcResult<
          ChannelResponse<C>
        >;
      },
      onSessionEvent: () => () => undefined,
      platform: 'win32',
    },
  });
}

async function renderApp(initialPath = '/'): Promise<void> {
  const { default: App } = await import('../../src/renderer/src/App');
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe('renderer boot phases', () => {
  beforeEach(() => {
    cleanup();
    handlers.clear();
    installBridge();
    vi.resetModules();
  });

  it('shows the activation gate when the app is not activated', async () => {
    setResult('app.status', {
      phase: 'activation',
      activated: false,
      setupComplete: false,
      userCount: 0,
      appVersion: '1.0.0',
      clinicName: null,
    });
    setResult('session.state', {
      authenticated: false,
      locked: false,
      user: null,
      lastActivityAt: null,
      autoLockMinutes: null,
    });

    await renderApp();

    expect(await screen.findByText('Activate your license')).toBeTruthy();
    expect(screen.getByLabelText(/activation code/i)).toBeTruthy();
  });

  it('shows the login screen when activated but nobody signed in', async () => {
    setResult('app.status', {
      phase: 'login',
      activated: true,
      setupComplete: true,
      userCount: 1,
      appVersion: '1.0.0',
      clinicName: 'Smile Dental Care',
    });
    setResult('session.state', {
      authenticated: false,
      locked: false,
      user: null,
      lastActivityAt: null,
      autoLockMinutes: null,
    });

    await renderApp();

    const headings = await screen.findAllByText('Sign in');
    expect(headings.length).toBeGreaterThan(0);
    expect(await screen.findByText('Smile Dental Care')).toBeTruthy();
  });

  it('routes to the setup wizard when activation succeeded but setup is incomplete', async () => {
    setResult('app.status', {
      phase: 'setup',
      activated: true,
      setupComplete: false,
      userCount: 0,
      appVersion: '1.0.0',
      clinicName: null,
    });
    setResult('session.state', {
      authenticated: false,
      locked: false,
      user: null,
      lastActivityAt: null,
      autoLockMinutes: null,
    });

    await renderApp();

    expect(await screen.findByText('Welcome to Dentiva Pro')).toBeTruthy();
    expect(screen.getByText('Clinic information')).toBeTruthy();
  });
});
