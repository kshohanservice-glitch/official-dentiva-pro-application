/** First-run activation gate (offline code verification). */

import { useState } from 'react';
import { KeyRound, ShieldCheck, ArrowRight } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/store';
import { Loading } from '../components/ui';

export default function ActivationPage(props: { onActivated(): void }): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (code.trim().length < 8) {
      setError('Enter your full activation code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api('activation.verify', { code: code.trim() });
      if (res.activated) {
        toast.success('Dentiva Pro activated.');
        setCode('');
        props.onActivated();
      } else {
        setError('That activation code is not valid. Check the code and try again.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loading label="Activating…" />;

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-logo">
          <span className="brand-mark lg">D</span>
          <div>
            <h1>Dentiva Pro</h1>
            <p className="muted">Professional dental clinic management · Fully offline</p>
          </div>
        </div>
        <div className="divider" />
        <div className="auth-heading">
          <h2>Activate your license</h2>
          <p>
            Enter the activation code provided with your Dentiva Pro license. Activation runs
            entirely offline — no internet connection is used.
          </p>
        </div>
        <form onSubmit={submit} className="stack">
          <div className="field">
            <label htmlFor="activation-code">
              <KeyRound size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              Activation code
            </label>
            <input
              id="activation-code"
              className="input input-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter activation code"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {error ? <span className="error">{error}</span> : null}
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            Activate <ArrowRight size={16} />
          </button>
        </form>
        <div className="auth-note">
          <ShieldCheck size={15} />
          <span>
            Your code is stored only as a salted cryptographic proof — never in plain text.
          </span>
        </div>
      </div>
    </div>
  );
}
