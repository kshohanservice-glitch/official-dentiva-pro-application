/** FDI dental chart: adult + pediatric, condition painting, persistence. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eraser, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { ChartEntry } from '@shared/types';
import { Loading, Modal, Field } from '../components/ui';
import { toast } from '../lib/store';

interface Catalog {
  teeth: {
    fdi: string;
    dentition: string;
    quadrant: number;
    position: number;
    universal: string;
    palmer: string;
    label: string;
    region: string;
  }[];
  conditions: {
    id: number;
    code: string;
    label: string;
    category: string;
    color: string;
    isCustom: boolean;
  }[];
}

const ADULT_ORDER = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
];

const PED_ORDER = [
  '55', '54', '53', '52', '51',
  '61', '62', '63', '64', '65',
  '85', '84', '83', '82', '81',
  '71', '72', '73', '74', '75',
];

export default function DentalChartPage(): JSX.Element {
  const { id } = useParams();
  const nav = useNavigate();
  const patientId = Number(id);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [entries, setEntries] = useState<ChartEntry[]>([]);
  const [dentition, setDentition] = useState<'permanent' | 'primary'>('permanent');
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [activeCondition, setActiveCondition] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#e11d48');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api('chart.catalog', {})
      .then(setCatalog)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(() => {
    void api('chart.get', { patientId })
      .then(setEntries)
      .catch((e) => setError(errorMessage(e)));
  }, [patientId]);

  useEffect(() => {
    if (Number.isFinite(patientId)) load();
  }, [patientId, load]);

  const entriesByTooth = useMemo(() => {
    const map = new Map<string, ChartEntry[]>();
    for (const e of entries) {
      const list = map.get(e.fdi) ?? [];
      list.push(e);
      map.set(e.fdi, list);
    }
    return map;
  }, [entries]);

  const order = dentition === 'permanent' ? ADULT_ORDER : PED_ORDER;

  const applyCondition = async (fdi: string, conditionCode: string): Promise<void> => {
    setSaving(true);
    try {
      const created = await api('chart.setEntry', {
        patientId,
        fdi,
        conditionCode,
        severity: null,
        notes: '',
        visitId: null,
      });
      setEntries((list) => {
        const withoutDup = list.filter((e) => !(e.fdi === created.fdi && e.conditionCode === created.conditionCode));
        return [...withoutDup, created];
      });
      toast.success(`Updated ${fdi}`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: ChartEntry): Promise<void> => {
    setSaving(true);
    try {
      await api('chart.clearEntry', { patientId, fdi: entry.fdi, conditionCode: entry.conditionCode });
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      toast.success(`Removed ${entry.conditionLabel} from ${entry.fdi}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const addCondition = async (): Promise<void> => {
    if (!newLabel.trim()) return;
    try {
      const cond = await api('chart.addCondition', {
        label: newLabel.trim(),
        code: newLabel.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60),
        category: 'custom',
        color: newColor,
      });
      setCatalog((c) => (c ? { ...c, conditions: [...c.conditions, cond] } : c));
      setActiveCondition(cond.code);
      setAddOpen(false);
      setNewLabel('');
      toast.success('Condition added to the chart vocabulary.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (error) return <div className="page"><div className="alert danger">{error}</div></div>;
  if (!catalog) return <Loading />;

  const toothToRender = selectedTooth ? order.filter((t) => t === selectedTooth) : order;

  const renderRow = (from: number, to: number): string[] => {
    const perRow = (to - from);
    return toothToRender.slice(from, from + perRow);
  };

  const Tooth = ({ fdi }: { fdi: string }): JSX.Element => {
    const marks = entriesByTooth.get(fdi) ?? [];
    const tooth = catalog.teeth.find((t) => t.fdi === fdi);
    return (
      <button
        className={`tooth${marks.length ? ' marked' : ''}${selectedTooth === fdi ? ' selected' : ''}`}
        onClick={() => setSelectedTooth(selectedTooth === fdi ? null : fdi)}
        aria-label={`Tooth ${fdi}`}
        disabled={saving}
      >
        <span className="fdi">{fdi}</span>
        <span className="glyph">
          {marks.length > 0 ? (
            <span className="mark-stack">
              {marks.slice(0, 3).map((m) => (
                <span key={m.id} className="mark" style={{ background: m.conditionColor }} />
              ))}
            </span>
          ) : (
            <span className="tooth-shape" />
          )}
        </span>
        <span className="fdi subtle">{tooth?.universal ?? ''}</span>
      </button>
    );
  };

  const upper = renderRow(0, 16);
  const lower = renderRow(16, 32);
  const selectedEntries = selectedTooth ? (entriesByTooth.get(selectedTooth) ?? []) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <button className="btn btn-ghost btn-sm mb-sm" onClick={() => nav(`/patients/${patientId}`)}>
            <ArrowLeft size={14} /> Back to patient
          </button>
          <h1>Dental Chart</h1>
          <p>FDI notation · conditions persist to this patient's record</p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="tablist" aria-label="Dentition">
            <button
              className={dentition === 'permanent' ? 'active' : ''}
              onClick={() => { setDentition('permanent'); setSelectedTooth(null); }}
            >
              Adult (permanent)
            </button>
            <button
              className={dentition === 'primary' ? 'active' : ''}
              onClick={() => { setDentition('primary'); setSelectedTooth(null); }}
            >
              Pediatric (primary)
            </button>
          </div>
        </div>
      </div>

      <div className="grid cols-chart-main">
        <div className="card">
          <div className="card-body">
            <div className="odontogram">
              <div className="arch-label">Upper arch</div>
              <div className="tooth-row" style={{ gridTemplateColumns: `repeat(${upper.length}, 1fr)` }}>
                {upper.map((f) => <Tooth key={f} fdi={f} />)}
              </div>
              <div className="arch-divider" />
              <div className="tooth-row" style={{ gridTemplateColumns: `repeat(${lower.length}, 1fr)` }}>
                {lower.map((f) => <Tooth key={f} fdi={f} />)}
              </div>
              <div className="arch-label">Lower arch</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Conditions</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add custom
            </button>
          </div>
          <div className="card-body">
            <div className="cond-grid">
              {catalog.conditions.map((c) => (
                <button
                  key={c.code}
                  className={`cond-chip${activeCondition === c.code ? ' active' : ''}`}
                  style={{ '--cond-color': c.color } as React.CSSProperties}
                  onClick={() => setActiveCondition(activeCondition === c.code ? null : c.code)}
                >
                  <span className="dot" />
                  {c.label}
                  {c.isCustom ? <small>custom</small> : null}
                </button>
              ))}
            </div>

            <div className="mt">
              {activeCondition ? (
                <div className="alert info">
                  <strong>{catalog.conditions.find((c) => c.code === activeCondition)?.label}</strong> selected —
                  click a tooth to {selectedTooth ? 'apply it' : '(choose a tooth first)'}.
                </div>
              ) : (
                <div className="muted">
                  Select a condition, then click teeth to mark them. Click a tooth first to view or remove its marks.
                </div>
              )}
            </div>

            {selectedTooth ? (
              <div className="mt">
                <h4>Tooth {selectedTooth}</h4>
                {selectedEntries.length === 0 ? (
                  <p className="muted">No conditions recorded.</p>
                ) : (
                  <ul className="plain-list">
                    {selectedEntries.map((e) => (
                      <li key={e.id} className="row between">
                        <span className="row gap-sm">
                          <span className="dot" style={{ background: e.conditionColor }} />
                          {e.conditionLabel}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => void removeEntry(e)} disabled={saving}>
                          <Eraser size={14} /> Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {activeCondition ? (
                  <button
                    className="btn btn-primary btn-sm mt-sm"
                    disabled={saving}
                    onClick={() => void applyCondition(selectedTooth, activeCondition)}
                  >
                    Apply condition
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="card-head"><h3>All recorded conditions</h3></div>
        <div className="card-body">
          {entries.length === 0 ? (
            <p className="muted">Nothing charted yet for this patient.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tooth</th><th>Condition</th><th>Category</th><th>Severity</th><th>Recorded</th><th>By</th><th></th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono bold">{e.fdi}</td>
                      <td><span className="dot" style={{ background: e.conditionColor, display: 'inline-block', marginRight: 8 }} />{e.conditionLabel}</td>
                      <td className="muted">{e.conditionCode}</td>
                      <td>{e.severity ?? '—'}</td>
                      <td>{new Date(e.recordedAt).toLocaleDateString('en-GB')}</td>
                      <td>{e.recordedBy}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => void removeEntry(e)} disabled={saving}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {addOpen ? (
        <Modal
          title="Add custom condition"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void addCondition()}>Add condition</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Condition label" required hint="e.g. Implant, Resorption, Hypoplasia">
              <input className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus />
            </Field>
            <Field label="Colour">
              <input type="color" className="input" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
