/** Audit log: immutable trail of sensitive actions (view-only by design). */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Eye } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { AuditLogRecord } from '@shared/types';
import {
  Loading,
  Modal,
  PageHead,
  Pagination,
  SearchInput,
  EmptyState,
  fmtDateTime,
} from '../components/ui';
import { todayDhaka } from '@shared/datetime';

type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';

const PAGE_SIZE = 50;

export default function AuditPage(): JSX.Element {
  const [items, setItems] = useState<AuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [preset, setPreset] = useState<RangePreset>('last30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditLogRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('audit.list', {
        search,
        action,
        preset,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [search, action, preset, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div className="page">
      <PageHead
        title="Audit Log"
        subtitle={`${total} entries · immutable record of sensitive actions`}
      />

      <div className="alert info">
        <ShieldCheck size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
        Entries are append-only: no interface or account (including administrator) can edit or delete
        audit history. Failed logins, permission denials, money changes, voids, restores and setup
        events are recorded here.
      </div>

      <div className="filters">
        <SearchInput value={search} onChange={(v) => { setPage(1); setSearch(v); }} placeholder="Search summary, entity, user…" />
        <input
          className="input"
          value={action}
          placeholder="Action filter e.g. payment.create"
          onChange={(e) => { setPage(1); setAction(e.target.value); }}
          style={{ maxWidth: 260 }}
          aria-label="Action filter"
        />
        <select className="select" value={preset} onChange={(e) => { setPage(1); setPreset(e.target.value as RangePreset); }} aria-label="Range">
          <option value="today">Today</option>
          <option value="last7">Last 7 days</option>
          <option value="last30">Last 30 days</option>
          <option value="last90">Last 90 days</option>
          <option value="last365">Last 365 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={26} />} title="No audit entries" body={`Nothing for this range (${todayDhaka()}).`} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDateTime(a.at)}</td>
                      <td>{a.username}</td>
                      <td className="mono">{a.action}</td>
                      <td>{a.entityType}{a.entityId ? `#${a.entityId}` : ''}</td>
                      <td className="truncate">{a.summary}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetail(a)}>
                          <Eye size={14} /> Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px' }}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            </div>
          </>
        )}
      </div>

      {detail ? (
        <Modal
          title={`Audit entry #${detail.id}`}
          onClose={() => setDetail(null)}
          size="lg"
          footer={<button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>}
        >
          <div className="stack">
            <dl className="def-grid">
              <dt>When</dt><dd>{fmtDateTime(detail.at, { seconds: true })}</dd>
              <dt>User</dt><dd>{detail.username}</dd>
              <dt>Action</dt><dd className="mono">{detail.action}</dd>
              <dt>Entity</dt><dd className="mono">{detail.entityType} {detail.entityId}</dd>
              <dt>Summary</dt><dd>{detail.summary}</dd>
            </dl>
            <div>
              <h4>Before</h4>
              <pre className="code-block">{formatJson(detail.beforeJson)}</pre>
            </div>
            <div>
              <h4>After</h4>
              <pre className="code-block">{formatJson(detail.afterJson)}</pre>
            </div>
            <div className="alert info">Audit entries are read-only. There is no edit or delete path.</div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function formatJson(raw: string): string {
  if (!raw) return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
