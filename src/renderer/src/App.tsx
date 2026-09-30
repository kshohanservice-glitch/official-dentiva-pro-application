/**
 * App root: phase detection (activation → setup → login → app), session
 * locking, global overlays, and route table.
 */

import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api';
import { useSession } from './lib/store';
import type { AppStatus, SessionState } from '@shared/types';
import { ToastStack, Loading } from './components/ui';
import ActivationPage from './pages/ActivationPage';
import SetupWizard from './pages/SetupWizard';
import LoginPage from './pages/LoginPage';
import LockScreen from './pages/LockScreen';
import Shell from './Shell';
import DashboardPage from './pages/DashboardPage';
import PatientsPage from './pages/PatientsPage';
import PatientProfilePage from './pages/PatientProfilePage';
import DentalChartPage from './pages/DentalChartPage';
import AppointmentsPage from './pages/AppointmentsPage';
import QueuePage from './pages/QueuePage';
import TreatmentsPage from './pages/TreatmentsPage';
import PrescriptionsPage from './pages/PrescriptionsPage';
import BillingPage from './pages/BillingPage';
import PaymentsPage from './pages/PaymentsPage';
import InventoryPage from './pages/InventoryPage';
import AccountingPage from './pages/AccountingPage';
import ReportsPage from './pages/ReportsPage';
import PeoplePage from './pages/PeoplePage';
import ReferralsPage from './pages/ReferralsPage';
import NotificationsPage from './pages/NotificationsPage';
import AuditPage from './pages/AuditPage';
import BackupPage from './pages/BackupPage';
import PrintersPage from './pages/PrintersPage';
import SettingsPage from './pages/SettingsPage';

export default function App(): JSX.Element {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const setStoreSession = useSession((s) => s.setState);

  const refresh = useCallback(async () => {
    try {
      const st = await api('app.status', {});
      setStatus(st);
      const sess = await api('session.state', {});
      setSession(sess);
      setStoreSession(sess);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start.');
    } finally {
      setBooting(false);
    }
  }, [setStoreSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Push events from main (auto-lock, logout).
  useEffect(() => {
    const off = window.dentiva.onSessionEvent((payload) => {
      if (payload.event === 'locked') {
        useSession.getState().setLocked(true);
        void api('session.state', {}).then((s) => {
          setSession(s);
          setStoreSession(s);
        });
      }
      if (payload.event === 'logged_out') {
        void refresh();
      }
    });
    return off;
  }, [refresh, setStoreSession]);

  // Periodic session heartbeat keeps auto-lock timer alive while active.
  useEffect(() => {
    const id = setInterval(() => {
      if (session?.authenticated && !session.locked) {
        void api('session.activity', {}).catch(() => undefined);
      }
    }, 45_000);
    return () => clearInterval(id);
  }, [session?.authenticated, session?.locked]);

  if (booting) {
    return (
      <div className="loading-center" style={{ height: '100vh' }}>
        <Loading label="Starting Dentiva Pro" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-center" style={{ height: '100vh' }}>
        <div className="card card-pad" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Dentiva Pro could not start</h2>
          <p className="muted">{error}</p>
          <button className="btn btn-primary mt" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) return <Loading />;

  let screen: JSX.Element;
  if (!status.activated) {
    screen = <ActivationPage onActivated={refresh} />;
  } else if (!status.setupComplete) {
    screen = <SetupWizard onComplete={refresh} />;
  } else if (!session?.authenticated) {
    screen = <LoginPage onLogin={refresh} />;
  } else {
    screen = (
      <>
        <Routes>
          <Route path="/" element={<Shell session={session} onSessionChange={setSession} />}>
            <Route index element={<DashboardPage />} />
            <Route path="patients" element={<PatientsPage />} />
            <Route path="patients/:id" element={<PatientProfilePage />} />
            <Route path="patients/:id/chart" element={<DentalChartPage />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="treatments" element={<TreatmentsPage />} />
            <Route path="prescriptions" element={<PrescriptionsPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="billing/invoices/:id" element={<BillingPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="accounting" element={<AccountingPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="referrals" element={<ReferralsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="backup" element={<BackupPage />} />
            <Route path="printers" element={<PrintersPage />} />
            <Route path="settings" element={<SettingsPage session={session} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        {session.locked ? (
          <LockScreen
            username={session.user?.username ?? ''}
            displayName={session.user?.displayName ?? ''}
            onUnlock={(s) => {
              setSession(s);
              setStoreSession(s);
            }}
            onLogout={async () => {
              await api('session.logout', {}).catch(() => undefined);
              await refresh();
            }}
          />
        ) : null}
        <ToastStack />
      </>
    );
  }

  return (
    <>
      {screen}
      <ToastStack />
    </>
  );
}
