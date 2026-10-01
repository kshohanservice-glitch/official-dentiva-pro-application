/** Dashboard: today's stats, revenue trend, queue snapshot, alerts. */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ListOrdered,
  Stethoscope,
  Wallet,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { DashboardData } from '@shared/types';
import { Money, PageHead, statusBadge, EmptyState, fmtDateTime, Loading } from '../components/ui';

export default function DashboardPage(): JSX.Element {
  const nav = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api('dashboard.get', {})
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) {
    return (
      <div className="page">
        <div className="alert danger">{error}</div>
      </div>
    );
  }
  if (!data) return <Loading />;

  const maxTrend = Math.max(1, ...data.revenueTrend.map((r) => r.amountPoisha));

  return (
    <div className="page">
      <PageHead
        title="Dashboard"
        subtitle={data.today}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => nav('/appointments')}>
              <CalendarDays size={16} /> Appointments
            </button>
            <button className="btn btn-primary" onClick={() => nav('/queue')}>
              <ListOrdered size={16} /> Open queue
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <button className="stat-tile" onClick={() => nav('/appointments')}>
          <span className="stat-icon"><CalendarDays size={18} /></span>
          <span className="stat-label">Appointments today</span>
          <span className="stat-value">{data.appointmentsToday}</span>
          <span className="stat-sub">{data.missedToday > 0 ? `${data.missedToday} missed` : 'none missed'}</span>
        </button>
        <button className="stat-tile" onClick={() => nav('/queue')}>
          <span className="stat-icon"><ListOrdered size={18} /></span>
          <span className="stat-label">In queue</span>
          <span className="stat-value">{data.waitingInQueue}</span>
          <span className="stat-sub">{data.checkedIn} checked in</span>
        </button>
        <button className="stat-tile" onClick={() => nav('/patients')}>
          <span className="stat-icon"><Stethoscope size={18} /></span>
          <span className="stat-label">Visits completed</span>
          <span className="stat-value">{data.completedVisits}</span>
          <span className="stat-sub">today</span>
        </button>
        <button className="stat-tile" onClick={() => nav('/payments')}>
          <span className="stat-icon"><Wallet size={18} /></span>
          <span className="stat-label">Revenue today</span>
          <span className="stat-value"><Money poisha={data.todayRevenuePoisha} /></span>
          <span className="stat-sub">outstanding <Money poisha={data.outstandingPoisha} /></span>
        </button>
      </div>

      <div className="grid cols-2-1 mt">
        <div className="card">
          <div className="card-head">
            <h3>Revenue · last 14 days</h3>
          </div>
          <div className="card-body">
            {data.revenueTrend.length === 0 ? (
              <EmptyState icon={<Wallet size={24} />} title="No revenue yet" body="Collected payments will chart here." />
            ) : (
              <div className="bar-chart" role="img" aria-label="Daily revenue chart">
                {data.revenueTrend.map((r) => (
                  <div className="bar-col" key={r.date} title={`${r.date}: ${r.count} payment(s)`}>
                    <div
                      className="bar"
                      style={{ height: `${Math.max(4, Math.round((r.amountPoisha / maxTrend) * 100))}%` }}
                    />
                    <span className="bar-label">{r.date.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Alerts</h3>
          </div>
          <div className="card-body stack">
            {data.alerts.length === 0 && data.lowStockItems.length === 0 ? (
              <EmptyState icon={<AlertTriangle size={24} />} title="All clear" body="No alerts right now." />
            ) : (
              <>
                {data.alerts.map((a, i) => (
                  <div key={i} className={`alert ${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}`}>
                    <strong>{a.title}</strong>
                    <div className="muted">{a.body}</div>
                  </div>
                ))}
                {data.lowStockItems.slice(0, 4).map((it) => (
                  <div className="alert warning" key={it.id}>
                    <strong>Low stock: {it.name}</strong>
                    <div className="muted">{it.currentStock} {it.unit} left · reorder at {it.reorderLevel}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2 mt">
        <div className="card">
          <div className="card-head">
            <h3>Upcoming appointments</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/appointments')}>View all</button>
          </div>
          <div className="card-body">
            {data.upcomingAppointments.length === 0 ? (
              <EmptyState icon={<CalendarDays size={24} />} title="Nothing scheduled" body="Book an appointment to get started." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Time</th><th>Patient</th><th>Dentist</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.upcomingAppointments.map((a) => (
                      <tr key={a.id}>
                        <td className="nowrap">{fmtDateTime(a.startsAt)}</td>
                        <td className="bold">{a.patientName}</td>
                        <td>{a.dentistName}</td>
                        <td>{statusBadge(a.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recently registered patients</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/patients')}>View all</button>
          </div>
          <div className="card-body">
            {data.recentPatients.length === 0 ? (
              <EmptyState icon={<Users size={24} />} title="No patients yet" action={
                <button className="btn btn-primary" onClick={() => nav('/patients')}>Add patient</button>
              } />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Code</th><th>Name</th><th>Phone</th><th>Due</th></tr>
                  </thead>
                  <tbody>
                    {data.recentPatients.map((p) => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/patients/${p.id}`)}>
                        <td className="mono">{p.patientCode}</td>
                        <td className="bold">{p.fullName}</td>
                        <td>{p.phone || '—'}</td>
                        <td>{p.duePoisha > 0 ? <Money poisha={p.duePoisha} className="danger-text" /> : <span className="muted">settled</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="card-head">
          <h3>Payment methods · today</h3>
        </div>
        <div className="card-body">
          {data.methodBreakdown.length === 0 ? (
            <p className="muted">No collections recorded today.</p>
          ) : (
            <div className="badge-row">
              {data.methodBreakdown.map((m) => (
                <span className="badge badge-teal" key={m.method}>
                  {m.label}: <Money poisha={m.amountPoisha} /> ({m.count})
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
