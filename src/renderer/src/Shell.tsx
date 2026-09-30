/** Authenticated app shell: sidebar navigation + header + outlet. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  ListOrdered,
  Stethoscope,
  FileText,
  Receipt,
  Wallet,
  Package,
  BookOpen,
  UserCog,
  Bell,
  HardDrive,
  Info,
  Settings,
  LogOut,
  Lock,
  CircleHelp,
} from 'lucide-react';
import { api } from './lib/api';
import { toast, useSession } from './lib/store';
import type { SessionState } from '@shared/types';
import { ConfirmDialog, SearchInput, initials } from './components/ui';

interface NavGroup {
  label: string;
  items: { to: string; label: string; icon: JSX.Element }[];
}

const NAV: NavGroup[] = [
  {
    label: 'Practice',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
      { to: '/patients', label: 'Patients', icon: <Users size={17} /> },
      { to: '/appointments', label: 'Appointments', icon: <CalendarDays size={17} /> },
      { to: '/queue', label: 'Queue', icon: <ListOrdered size={17} /> },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { to: '/treatments', label: 'Treatments', icon: <Stethoscope size={17} /> },
      { to: '/prescriptions', label: 'Prescriptions', icon: <FileText size={17} /> },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/billing', label: 'Invoice', icon: <Receipt size={17} /> },
      { to: '/payments', label: 'Payments', icon: <Wallet size={17} /> },
      { to: '/inventory', label: 'Inventory', icon: <Package size={17} /> },
      { to: '/accounting', label: 'Accounting', icon: <BookOpen size={17} /> },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/people', label: 'Staff & Users', icon: <UserCog size={17} /> },
      { to: '/backup', label: 'Backup & Restore', icon: <HardDrive size={17} /> },
      { to: '/settings', label: 'Settings', icon: <Settings size={17} /> },
      { to: '/about', label: 'About', icon: <Info size={17} /> },
    ],
  },
];

type GlobalResult = {
  kind: string;
  id: string;
  title: string;
  subtitle: string;
  detail: string;
};

export default function Shell(props: {
  session: SessionState;
  onSessionChange(s: SessionState): void;
}): JSX.Element {
  const nav = useNavigate();
  const location = useLocation();
  const setLocked = useSession((s) => s.setLocked);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalResult[]>([]);
  const [showLogout, setShowLogout] = useState(false);
  const [notifications, setNotifications] = useState(0);
  const [clinicName, setClinicName] = useState<string>('Dentiva Pro');

  const perms = useMemo<Set<string>>(
    () => new Set<string>(props.session.user?.permissions ?? []),
    [props.session.user],
  );
  const can = useCallback(
    (code: string): boolean => perms.has(code) || perms.has('*'),
    [perms],
  );

  useEffect(() => {
    void api('app.status', {}).then((st) => {
      if (st.clinicName) setClinicName(st.clinicName);
    }).catch(() => undefined);
  }, []);

  // Unread notification count.
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void api('notifications.list', { page: 1, pageSize: 50 })
        .then((r) => {
          if (alive) setNotifications(r.items.filter((n) => n.readAt === null).length);
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [location.pathname]);

  // Ctrl+K focuses global search (the placeholder promises it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.header-search input');
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Global search (debounced).
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void api('search.global', { query: query.trim(), kinds: [] })
        .then((r) => setResults(r))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const toggleLock = (): void => {
    void api('session.lock', {})
      .then(() => {
        setLocked(true);
        void api('session.state', {}).then((st) => props.onSessionChange(st));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not lock.'));
  };

  const doLogout = async (): Promise<void> => {
    try {
      await api('session.logout', {});
      nav('/', { replace: true });
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logout failed.');
    }
  };

  const goResult = (r: GlobalResult): void => {
    setQuery('');
    if (r.kind === 'patient') nav(`/patients/${r.id}`);
    else if (r.kind === 'invoice') nav(`/billing/invoices/${r.id}`);
    else if (r.kind === 'appointment') nav('/appointments');
    else if (r.kind === 'treatment') nav('/treatments');
    else if (r.kind === 'staff') nav('/people');
    else nav('/');
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">D</span>
          <div>
            <strong>Dentiva Pro</strong>
            <small>{clinicName}</small>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV.map((group) => {
            const items = group.items.filter((it) => {
              if (it.to === '/people')
                return can('staff.view') || can('user.manage') || can('role.manage');
              if (it.to === '/backup') return can('backup.create') || can('backup.restore');
              if (it.to === '/accounting') return can('accounting.view');
              if (it.to === '/treatments') return can('treatment.view');
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    {it.icon}
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar">{initials(props.session.user?.displayName ?? 'U')}</span>
            <div className="user-chip-meta">
              <strong>{props.session.user?.displayName ?? ''}</strong>
              <small>{(props.session.user?.roleNames ?? []).join(', ')}</small>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="app-header">
          <button
            className="btn btn-ghost btn-icon sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div className="header-search">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search patients, invoices, appointments… (Ctrl+K)"
            />
            {results.length > 0 ? (
              <div className="search-results" role="listbox">
                {results.map((r) => (
                  <button key={`${r.kind}:${r.id}`} className="search-result" onClick={() => goResult(r)}>
                    <span className="kind">{r.kind}</span>
                    <span className="primary">{r.title}</span>
                    {r.subtitle ? <span className="secondary">{r.subtitle}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="header-actions">
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => nav('/notifications')}
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={17} />
              {notifications > 0 ? <span className="dot-badge">{notifications}</span> : null}
            </button>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => nav('/about')}
              aria-label="Help"
              title="Help"
            >
              <CircleHelp size={17} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={toggleLock} aria-label="Lock now" title="Lock now">
              <Lock size={17} />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setShowLogout(true)}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main className="page-scroll" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      {showLogout ? (
        <ConfirmDialog
          title="Sign out"
          body="Are you sure you want to sign out of Dentiva Pro?"
          confirmLabel="Sign out"
          onCancel={() => setShowLogout(false)}
          onConfirm={async () => {
            setShowLogout(false);
            await doLogout();
          }}
        />
      ) : null}
    </div>
  );
}

