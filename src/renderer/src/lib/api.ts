/** Typed IPC client for the sandboxed renderer. */

import type { ChannelName, ChannelRequest, ChannelResponse } from '@shared/ipc';
import type { IpcError, IpcResult } from '@shared/types';

declare global {
  interface Window {
    dentiva: {
      invoke<C extends ChannelName>(
        channel: C,
        request: ChannelRequest<C>,
      ): Promise<IpcResult<ChannelResponse<C>>>;
      onSessionEvent(handler: (payload: { event: string }) => void): () => void;
      platform: string;
    };
  }
}

export class ApiError extends Error {
  code: IpcError['code'];
  details?: unknown;
  constructor(error: IpcError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
  }
}

/** Invoke a channel; throws ApiError on failure so pages can use try/catch. */
export async function api<C extends ChannelName>(
  channel: C,
  request: ChannelRequest<C>,
): Promise<ChannelResponse<C>> {
  const result = (await window.dentiva.invoke(channel, request)) as IpcResult<
    ChannelResponse<C>
  >;
  if (!result.ok) throw new ApiError(result.error);
  return result.data;
}

/** Invoke returning null instead of throwing (for optional loads). */
export async function apiOrNull<C extends ChannelName>(
  channel: C,
  request: ChannelRequest<C>,
): Promise<ChannelResponse<C> | null> {
  try {
    return await api(channel, request);
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
