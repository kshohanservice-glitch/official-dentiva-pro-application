/** Shared UI primitives used across every page. */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Info,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal(props: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'lg' | 'xl';
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      role="presentation"
    >
      <div
        className={`modal${props.size === 'lg' ? ' modal-lg' : props.size === 'xl' ? ' modal-xl' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div className="modal-header">
          <h2>{props.title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={props.onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <div className="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm(): void | Promise<void>;
  onCancel(): void;
  requirePhrase?: string;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const canConfirm = !props.requirePhrase || phrase === props.requirePhrase;
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy || !canConfirm}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(props.onConfirm()).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{props.body}</div>
        {props.requirePhrase ? (
          <div className="field">
            <label>
              Type <span className="mono bold">{props.requirePhrase}</span> to confirm
            </label>
            <input
              className="input"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts renderer                                                     */
/* ------------------------------------------------------------------ */

import { useToasts } from '../lib/store';

export function ToastStack(): JSX.Element {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? (
            <AlertCircle size={17} />
          ) : t.kind === 'warning' ? (
            <AlertTriangle size={17} />
          ) : t.kind === 'success' ? (
            <CheckCircle2 size={17} />
          ) : (
            <Info size={17} />
          )}
          <span>{t.message}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state & loading                                               */
/* ------------------------------------------------------------------ */

export function EmptyState(props: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon}</div>
      <h3>{props.title}</h3>
      {props.body ? <p>{props.body}</p> : null}
      {props.action ? <div className="mt">{props.action}</div> : null}
    </div>
  );
}

export function Loading({ label }: { label?: string }): JSX.Element {
  return (
    <div className="loading-center">
      <div className="spinner spinner-lg" role="status" aria-label={label ?? 'Loading'} />
    </div>
  );
}

export function PageHead(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="page-head">
      <div className="page-title">
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div className="page-actions">{props.actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination(props: {
  page: number;
  pageSize: number;
  total: number;
  onPage(page: number): void;
}): JSX.Element {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <div className="pagination">
      <button
        className="btn btn-secondary btn-sm"
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="page-indicator">
        Page {props.page} of {pages} · {props.total} records
      </span>
      <button
        className="btn btn-secondary btn-sm"
        disabled={props.page >= pages}
        onClick={() => props.onPage(props.page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search box                                                          */
/* ------------------------------------------------------------------ */

export function SearchInput(props: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  onKeyDown?(e: React.KeyboardEvent<HTMLInputElement>): void;
}): JSX.Element {
  return (
    <div className="search-input">
      <Search className="lucide-search" size={16} />
      <input
        className="input"
        type="search"
        value={props.value}
        placeholder={props.placeholder ?? 'Search…'}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={props.onKeyDown}
        aria-label={props.placeholder ?? 'Search'}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field wrapper                                                       */
/* ------------------------------------------------------------------ */

export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  full?: boolean;
}): JSX.Element {
  return (
    <div className={`field${props.full ? ' full' : ''}`}>
      <label>
        {props.label}
        {props.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
      </label>
      {props.children}
      {props.error ? <span className="error">{props.error}</span> : null}
      {!props.error && props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chip input (multi-value string entry)                               */
/* ------------------------------------------------------------------ */

export function ChipInput(props: {
  values: string[];
  onChange(values: string[]): void;
  placeholder?: string;
  max?: number;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const v = draft.trim();
    if (!v || props.values.includes(v)) {
      setDraft('');
      return;
    }
    if (props.max && props.values.length >= props.max) return;
    props.onChange([...props.values, v]);
    setDraft('');
  };
  return (
    <div className="chip-input">
      {props.values.map((v) => (
        <span className="chip" key={v}>
          {v}
          <button
            type="button"
            onClick={() => props.onChange(props.values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={props.placeholder ?? 'Type and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money display                                                       */
/* ------------------------------------------------------------------ */

import { formatPoisha } from '@shared/money';

export function Money(props: { poisha: number; className?: string }): JSX.Element {
  return <span className={`money ${props.className ?? ''}`}>{formatPoisha(props.poisha)}</span>;
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

export function Badge(props: { tone: string; children: ReactNode }): JSX.Element {
  return <span className={`badge badge-${props.tone}`}>{props.children}</span>;
}

export function statusBadge(status: string): JSX.Element {
  const tones: Record<string, string> = {
    scheduled: 'blue',
    checked_in: 'teal',
    in_progress: 'amber',
    completed: 'green',
    cancelled: 'neutral',
    no_show: 'red',
    waiting: 'blue',
    skipped: 'amber',
    unpaid: 'red',
    partial: 'amber',
    paid: 'green',
    void: 'neutral',
    active: 'green',
    archived: 'neutral',
    inactive: 'neutral',
    pending: 'amber',
    male: 'blue',
    female: 'pink',
    info: 'blue',
    warning: 'amber',
    critical: 'red',
  };
  const tone = tones[status] ?? 'neutral';
  return (
    <Badge tone={tone}>{status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ''}${(parts[parts.length - 1] as string)[0] ?? ''}`.toUpperCase();
}

/** Format epoch ms for display (Dhaka local for display only). */
export function fmtDateTime(epoch: number | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (!epoch) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: opts.seconds ? 'medium' : 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(epoch));
}

export function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(epoch));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Outside-click helper                                                */
/* ------------------------------------------------------------------ */

export function useOutsideClick<T extends HTMLElement>(
  onOutside: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}

export { X };
