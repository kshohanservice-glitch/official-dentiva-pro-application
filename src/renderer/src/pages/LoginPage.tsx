/** Sign-in page (username or email + password). */

import { useEffect, useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/store';
import { Loading } from '../components/ui';

export default function LoginPage(props: { onLogin(): void }): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clinic, setClinic] = useState<string>('Dentiva Pro');

  useEffect(() => {
    void api('app.status', {})
      .then((st) => {
        if (st.clinicName) setClinic(st.clinicName);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('session.login', { username: username.trim(), password });
      toast.success('Welcome back.');
      props.onLogin();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loading label="Signing in…" />;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="brand-mark lg">D</span>
          <div>
            <h1>Dentiva Pro</h1>
            <p className="muted">{clinic}</p>
          </div>
        </div>
        <div className="divider" />
        <div className="auth-heading">
          <h2>Sign in</h2>
          <p>Use your clinic account to continue.</p>
        </div>
        <form onSubmit={submit} className="stack">
          <div className="field">
            <label htmlFor="login-user">Username or email</label>
            <input
              id="login-user"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label htmlFor="login-pass">Password</label>
            <input
              id="login-pass"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error ? <span className="error">{error}</span> : null}
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            <LogIn size={16} /> Sign in
          </button>
        </form>
        <div className="auth-note">
          <ShieldCheck size={15} />
          <span>Protected by Argon2id password hashing and automatic session locking.</span>
        </div>
      </div>
    </div>
  );
}
