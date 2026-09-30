/**
 * In-memory session: authentication, lock/unlock, auto-lock timer.
 * Sessions never persist to disk; sensitive channels require a live, unlocked session.
 */

import type { SessionState, SessionUser } from '@shared/types';
import type { Permission } from '@shared/permissions';

export interface SessionEvents {
  onLock?: () => void;
  onLogout?: () => void;
}

export class SessionManager {
  private user: SessionUser | null = null;
  private locked = false;
  private lastActivityAt = Date.now();
  private autoLockMinutes = 15;
  private timer: NodeJS.Timeout | null = null;
  private events: SessionEvents = {};

  configure(events: SessionEvents): void {
    this.events = events;
  }

  setAutoLockMinutes(minutes: number): void {
    this.autoLockMinutes = minutes;
  }

  getAutoLockMinutes(): number {
    return this.autoLockMinutes;
  }

  start(userId: number, username: string, displayName: string, staffId: number | null,
        permissions: Permission[], roleNames: string[]): void {
    this.user = { userId, username, displayName, staffId, permissions, roleNames };
    this.locked = false;
    this.touch();
    this.ensureTimer();
  }

  isAuthenticated(): boolean {
    return this.user !== null;
  }

  isLocked(): boolean {
    return this.locked || this.user === null;
  }

  getUser(): SessionUser | null {
    return this.user;
  }

  can(permissions: Permission[]): boolean {
    const user = this.user;
    if (!user || this.locked) return false;
    return permissions.every((p) => user.permissions.includes(p));
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  /** Returns true if a lock transition occurred due to inactivity. */
  private checkIdle(): void {
    if (!this.user || this.locked) return;
    const limit = this.autoLockMinutes * 60_000;
    if (Date.now() - this.lastActivityAt >= limit) {
      this.lock();
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkIdle(), 5_000);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  lock(): void {
    if (!this.user || this.locked) return;
    this.locked = true;
    this.events.onLock?.();
  }

  /** Unlock with verified password (verification happens in the caller). */
  unlock(): void {
    if (!this.user) return;
    this.locked = false;
    this.touch();
  }

  logout(): void {
    this.user = null;
    this.locked = false;
    this.stopTimer();
    this.events.onLogout?.();
  }

  state(): SessionState {
    return {
      authenticated: this.user !== null,
      locked: this.locked,
      user: this.user,
      lastActivityAt: this.user ? this.lastActivityAt : null,
      autoLockMinutes: this.autoLockMinutes,
    };
  }
}
