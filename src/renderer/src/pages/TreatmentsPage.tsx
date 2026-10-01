/** Treatment catalog: prices in poisha, historical snapshots preserved. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Stethoscope } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { TreatmentDef } from '@shared/types';
import { Loading, Modal, Field, PageHead, SearchInput, EmptyState } from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha, formatPoisha } from '@shared/money';

const emptyDraft = {
  id: null as number | null,
  code: '',
  name: '',
  category: '',
  defaultPrice: '',
  description: '',
  durationMinutes: 30,
  isActive: true,
};

export default function TreatmentsPage(): JSX.Element {
  const [items, setItems] = useState<TreatmentDef[]>([]);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    void api('session.state', {}).then((s) =>
      setCanManage((s.user?.permissions ?? []).includes('treatment.manage')),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('treatments.list', { includeInactive, search });
      setItems(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [includeInactive, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.category.trim()) {
      toast.error('Name and category are required.');
      return;
    }
    let price: number;
    try {
      price = draft.defaultPrice.trim() === '' ? 0 : parseMoneyToPoisha(draft.defaultPrice);
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    try {
      await api('treatments.save', {
        id: draft.id,
        code: draft.code.trim(),
        name: draft.name.trim(),
        category: draft.category.trim(),
        defaultPricePoisha: price,
        description: draft.description.trim(),
        durationMinutes: Number(draft.durationMinutes) || 0,
        isActive: draft.isActive,
      });
      toast.success('Treatment saved.');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const categories = Array.from(new Set(items.map((i) => i.category))).sort();

  return (
    <div className="page">
      <PageHead
        title="Treatment Catalog"
        subtitle={`${items.length} treatments${categories.length ? ` · ${categories.length} categories` : ''}`}
        actions={
          canManage ? (
            <button className="btn btn-primary" onClick={() => setDraft({ ...emptyDraft })}>
              <Plus size={16} /> Add treatment
            </button>
          ) : null
        }
      />

      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Search treatments…" />
        <label className="check-row inline">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Stethoscope size={26} />}
            title="No treatments"
            body="Add the procedures your clinic offers. Invoices reuse these prices but always store a historical price snapshot per line."
            action={
              canManage ? (
                <button className="btn btn-primary" onClick={() => setDraft({ ...emptyDraft })}>Add treatment</button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Default price</th>
                  <th>Duration</th>
                  <th>Status</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.code || '—'}</td>
                    <td className="bold">{t.name}</td>
                    <td>{t.category}</td>
                    <td>{formatPoisha(t.defaultPricePoisha)}</td>
                    <td>{t.durationMinutes ? `${t.durationMinutes} min` : '—'}</td>
                    <td>
                      <span className={`badge badge-${t.isActive ? 'green' : 'neutral'}`}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage ? (
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setDraft({
                              id: t.id,
                              code: t.code,
                              name: t.name,
                              category: t.category,
                              defaultPrice: (t.defaultPricePoisha / 100).toFixed(2),
                              description: t.description,
                              durationMinutes: t.durationMinutes,
                              isActive: t.isActive,
                            })
                          }
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? 'Edit treatment' : 'Add treatment'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save treatment</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="Name" required full>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Code" hint="Short internal code">
              <input className="input" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
            </Field>
            <Field label="Category" required>
              <input className="input" list="treatment-categories" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
              <datalist id="treatment-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Default price (৳)" required hint="Used to prefill invoices; snapshots keep history exact">
              <input className="input" inputMode="decimal" value={draft.defaultPrice} onChange={(e) => setDraft({ ...draft, defaultPrice: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Duration (minutes)">
              <input className="input" type="number" min={0} max={600} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Description" full>
              <textarea className="textarea" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              <span>Active (available on invoices)</span>
            </label>
            {draft.id ? (
              <div className="alert info" style={{ gridColumn: '1 / -1' }}>
                Editing prices only affects <em>future</em> invoices — existing invoice lines keep their historical price snapshot.
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
