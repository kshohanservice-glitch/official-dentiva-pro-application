/**
 * IPC dispatcher: schema validation → session → RBAC → handler → audit hooks.
 * Every channel the renderer can call funnels through here.
 */

import type { ChannelName, ChannelRequest } from '@shared/ipc';
import { channelDefs } from '@shared/ipc';
import type { IpcResult, IpcErrorCode } from '@shared/types';
import type { SessionManager } from '../session';
import type { Logger } from '../logging';

export interface HandlerContext {
  userId: number | null;
  username: string;
}

export type ChannelHandler<C extends ChannelName> = (
  req: ChannelRequest<C>,
  ctx: HandlerContext,
) => Promise<unknown> | unknown;

type AnyHandler = (req: unknown, ctx: HandlerContext) => Promise<unknown> | unknown;

export class IpcDispatcher {
  private handlers = new Map<ChannelName, AnyHandler>();
  /** Channels allowed before login (activation/setup/status only). */
  private preAuthChannels = new Set<ChannelName>([
    'app.status',
    'activation.verify',
    'setup.complete',
    'session.state',
    'session.login',
  ]);
  /**
   * Channels allowed while locked (in addition to pre-auth ones).
   * `session.unlock` must run to verify the password and release the lock;
   * `session.logout` must run so the lock screen's sign-out works.
   * Every other channel stays blocked until unlock.
   */
  private lockExemptChannels = new Set<ChannelName>([
    'session.unlock',
    'session.logout',
  ]);
  /**
   * Channels that work before the license is activated: reporting status,
   * performing activation, and harmless state reads. Everything else —
   * including setup and login — refuses with ACTIVATION_REQUIRED so
   * activation is genuinely enforced by main-process logic, not just UI.
   */
  private preActivationChannels = new Set<ChannelName>([
    'app.status',
    'activation.verify',
    'session.state',
  ]);

  private session: SessionManager;
  private logger: Logger;
  private isActivated: () => boolean;

  constructor(session: SessionManager, logger: Logger, isActivated: () => boolean = () => true) {
    this.session = session;
    this.logger = logger;
    this.isActivated = isActivated;
  }

  register<C extends ChannelName>(channel: C, handler: ChannelHandler<C>): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Duplicate IPC handler: ${channel}`);
    }
    this.handlers.set(channel, handler as AnyHandler);
  }

  async dispatch(channel: string, rawRequest: unknown): Promise<IpcResult<unknown>> {
    const started = Date.now();
    const fail = (code: IpcErrorCode, message: string, details?: unknown): IpcResult<never> => ({
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    });

    if (!channelDefs[channel as ChannelName]) {
      return fail('INTERNAL', 'Unknown channel');
    }
    const name = channel as ChannelName;
    const def = channelDefs[name];
    const handler = this.handlers.get(name);
    if (!handler) return fail('INTERNAL', 'Channel not implemented');

    // 1. License activation gate (setup, login and all data require activation).
    if (!this.isActivated() && !this.preActivationChannels.has(name)) {
      this.logger.warn('ipc.activation_required', { channel: name });
      return fail('ACTIVATION_REQUIRED', 'Dentiva Pro is not activated.');
    }

    // 2. Schema validation — never trust renderer payloads.
    const parsed = def.request.safeParse(rawRequest ?? {});
    if (!parsed.success) {
      this.logger.warn('ipc.validation_failed', { channel: name });
      return fail('VALIDATION', 'Invalid request', parsed.error.issues.slice(0, 5));
    }

    // 3. Session gate.
    const isPreAuth = this.preAuthChannels.has(name);
    if (!isPreAuth) {
      if (!this.session.isAuthenticated()) return fail('UNAUTHENTICATED', 'Please sign in.');
      if (this.session.isLocked() && !this.lockExemptChannels.has(name)) {
        return fail('LOCKED', 'Session locked.');
      }
    }

    // 4. RBAC.
    if (def.permission && def.permission.length > 0) {
      if (!this.session.can(def.permission)) {
        const user = this.session.getUser();
        this.logger.warn('ipc.forbidden', { channel: name, userId: user?.userId });
        return fail('FORBIDDEN', 'You do not have permission to perform this action.');
      }
    }

    const user = this.session.getUser();
    const ctx: HandlerContext = {
      userId: user?.userId ?? null,
      username: user?.username ?? 'system',
    };

    // 5. Handler.
    try {
      const data = await handler(parsed.data, ctx);
      this.logger.debug('ipc.ok', { channel: name, ms: Date.now() - started });
      return { ok: true, data };
    } catch (err) {
      const e = err as { code?: IpcErrorCode; message?: string; details?: unknown };
      const code: IpcErrorCode = e?.code && typeof e.code === 'string' ? e.code : 'INTERNAL';
      const message =
        e?.message && typeof e.message === 'string' ? e.message : 'Unexpected error';
      this.logger.error('ipc.error', { channel: name, code, ms: Date.now() - started });
      if (code === 'INTERNAL') {
        console.error(`[ipc:${name}]`, err);
      }
      return fail(code, message, e?.details);
    }
  }
}

/** Helper for services to throw typed IPC errors. */
export function ipcError(code: IpcErrorCode, message: string, details?: unknown): never {
  const err = new Error(message) as Error & { code: IpcErrorCode; details?: unknown };
  err.code = code;
  if (details !== undefined) err.details = details;
  throw err;
}
