/** Notifications center: appointments, inventory, financial & backup alerts. */

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { NotificationRecord } from '@shared/types';
import { Loading, PageHead, Pagination, EmptyState, fmtDateTime } from '../components/ui';
import { toast } from '../lib/store';

const PAGE_SIZE = 50;

export default function NotificationsPage(): JSX.Element {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showRead, setShowRead] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('notifications.list', { page, pageSize: PAGE_SIZE });
      setItems(showRead ? res.items : res.items.filter((n) => n.readAt === null));
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, showRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: number): Promise<void> => {
    try {
      await api('notifications.markRead', { id });
      setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: Date.now() } : n)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const markAll = async (): Promise<void> => {
    try {
      await api('notifications.markAllRead', {});
      void load();
      toast.success('All notifications marked as read.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const unread = items.filter((n) => n.readAt === null).length;

  return (
    <div className="page">
      <PageHead
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        actions={
          <button className="btn btn-secondary" onClick={() => void markAll()} disabled={unread === 0}>
            <CheckCheck size={16} /> Mark all read
          </button>
        }
      />

      <div className="filters">
        <label className="check-row inline">
          <input type="checkbox" checked={showRead} onChange={(e) => setShowRead(e.target.checked)} />
          <span>Show read items</span>
        </label>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell size={26} />}
            title="No notifications"
            body="Appointment reminders, low-stock warnings, backup failures and financial alerts appear here."
          />
        ) : (
          <>
            <div className="notif-list">
              {items.map((n) => (
                <button
                  key={n.id}
                  className={`notif-row severity-${n.severity}${n.readAt === null ? ' unread' : ''}`}
                  onClick={() => void markRead(n.id)}
                >
                  <span className={`notif-dot ${n.severity}`} />
                  <span className="notif-body">
                    <span className="row gap-sm">
                      <strong>{n.title}</strong>
                      <span className="badge badge-neutral">{n.category}</span>
                      {n.readAt === null ? <span className="badge badge-blue">new</span> : null}
                    </span>
                    <span className="muted">{n.body}</span>
                  </span>
                  <span className="muted nowrap">{fmtDateTime(n.createdAt)}</span>
                </button>
              ))}
            </div>
            <div style={{ padding: '10px 16px' }}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
