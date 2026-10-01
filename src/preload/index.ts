/**
 * Preload: the ONLY bridge between the sandboxed renderer and the main
 * process. Exposes a typed invoke wrapper over the validated IPC contract and
 * session push events — nothing else.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ChannelName, ChannelRequest, ChannelResponse } from '@shared/ipc';
import type { IpcResult } from '@shared/types';

export interface DentivaApi {
  invoke<C extends ChannelName>(
    channel: C,
    request: ChannelRequest<C>,
  ): Promise<IpcResult<ChannelResponse<C>>>;
  onSessionEvent(handler: (payload: { event: string }) => void): () => void;
  platform: string;
}

const api: DentivaApi = {
  invoke<C extends ChannelName>(
    channel: C,
    request: ChannelRequest<C>,
  ): Promise<IpcResult<ChannelResponse<C>>> {
    return ipcRenderer.invoke('dentiva:invoke', channel, request) as Promise<
      IpcResult<ChannelResponse<C>>
    >;
  },
  onSessionEvent(handler: (payload: { event: string }) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: { event: string }): void =>
      handler(payload);
    ipcRenderer.on('dentiva:session', listener);
    return () => ipcRenderer.removeListener('dentiva:session', listener);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('dentiva', api);
