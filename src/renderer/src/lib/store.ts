/** Small React stores and hooks (zustand for toasts/session overlay). */

import { create } from 'zustand';
import type { SessionState } from '@shared/types';

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push(kind: Toast['kind'], message: string): void;
  dismiss(id: number): void;
}

let toastSeq = 0;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push(kind, message) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, kind === 'error' ? 7000 : 4500);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (m: string): void => useToasts.getState().push('info', m),
  success: (m: string): void => useToasts.getState().push('success', m),
  warning: (m: string): void => useToasts.getState().push('warning', m),
  error: (m: string): void => useToasts.getState().push('error', m),
};

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

interface SessionStore {
  state: SessionState | null;
  locked: boolean;
  setState(s: SessionState): void;
  setLocked(locked: boolean): void;
}

export const useSession = create<SessionStore>((set) => ({
  state: null,
  locked: false,
  setState(s) {
    set({ state: s, locked: s.locked });
  },
  setLocked(locked) {
    set({ locked });
  },
}));

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */
