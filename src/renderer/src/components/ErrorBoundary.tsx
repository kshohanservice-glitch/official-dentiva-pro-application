/**
 * Top-level error boundary: a render crash shows a readable fallback
 * instead of a blank window (spec: error boundaries).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Renderer has no file logger; surface in devtools console only.
    console.error('[dentiva] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading-center" style={{ height: '100vh', padding: 24 }}>
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-head">
            <h3>Something went wrong</h3>
          </div>
          <div className="card-body stack">
            <p className="muted">
              Dentiva Pro hit an unexpected error while rendering. Your data is stored safely in
              the local database. Reload the app to continue; if the problem persists, check the
              logs or contact support.
            </p>
            <p className="mono" style={{ fontSize: 12, wordBreak: 'break-word' }}>
              {this.state.error.message}
            </p>
            <div className="row gap">
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload app
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
