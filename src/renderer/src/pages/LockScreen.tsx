/** Full-screen lock overlay shown after auto-lock or manual lock. */

import { useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { SessionState } from '@shared/types';
import { initials } from '../components/ui';

export default function LockScreen(props: {
  username: string;
  displayName: string;
  onUnlock(s: SessionState): void;
  onLogout(): void | Promise<void>;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api('session.unlock', { password });
      setPassword('');
      props.onUnlock(s);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-shell" role="dialog" aria-modal="true" aria-label="Locked">
      <div className="lock-card">
        <span className="avatar lg">{initials(props.displayName || 'U')}</span>
        <h2>{props.displayName || props.username}</h2>
        <p className="muted">
          Dentiva Pro is locked to protect patient and financial data. Enter your password to
          continue where you left off.
        </p>
        <form onSubmit={submit} className="stack" style={{ width: '100%' }}>
          <div className="field">
            <label htmlFor="lock-pass">Password</label>
            <input
              id="lock-pass"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            {error ? <span className="error">{error}</span> : null}
          </div>
          <div className="row gap">
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ flex: 1 }}>
              <Lock size={16} /> Unlock
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void props.onLogout()}
              title="Sign out"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
