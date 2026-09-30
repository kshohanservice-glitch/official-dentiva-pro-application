/** Financial reports: revenue vs expenses vs other income, breakdowns. */

import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { CategorySpendRow, DailyRevenueRow, MethodBreakdownRow, ReportSummary } from '@shared/types';
import { Loading, Money, PageHead } from '../components/ui';
import { toast } from '../lib/store';
import { todayDhaka } from '@shared/datetime';

type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';

export default function ReportsPage(): JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('last30');
  const [from, setFrom] = useState(todayDhaka());
  const [to, setTo] = useState(todayDhaka());
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [daily, setDaily] = useState<DailyRevenueRow[]>([]);
  const [methods, setMethods] = useState<MethodBreakdownRow[]>([]);
  const [expenses, setExpenses] = useState<CategorySpendRow[]>([]);
  const [treatments, setTreatments] = useState<CategorySpendRow[]>([]);
  const [purchases, setPurchases] = useState<{ amountPoisha: number; txnCount: number } | null>(null);
  const [salaries, setSalaries] = useState<{ amountPoisha: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCustom: boolean = preset === 'custom';

  const load = useCallback(async () => {
    const range: { preset: RangePreset; from?: string; to?: string } = isCustom
      ? { preset, from, to }
      : { preset };
    setLoading(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([
        api('reports.range', range),
        api('reports.methods', range),
      ]);
      setSummary(s);
      setMethods(m);
      if (isCustom) {
        const [d, e, t, pc, sal] = await Promise.all([
          api('reports.daily', { from, to }),
          api('reports.expenses', { from, to }),
          api('reports.treatmentRevenue', { from, to }),
          api('reports.purchases', { from, to }),
          api('reports.salaries', { from, to }),
        ]);
        setDaily(d);
        setExpenses(e);
        setTreatments(t);
        setPurchases(pc);
        setSalaries(sal);
      } else {
        const span = presetSpan(preset);
        const f = new Date(Date.now() - span * 86_400_000).toISOString().slice(0, 10);
        const t2 = todayDhaka();
        const [d, e, t, pc, sal] = await Promise.all([
          api('reports.daily', { from: f, to: t2 }),
          api('reports.expenses', { from: f, to: t2 }),
          api('reports.treatmentRevenue', { from: f, to: t2 }),
          api('reports.purchases', { from: f, to: t2 }),
          api('reports.salaries', { from: f, to: t2 }),
        ]);
        setDaily(d);
        setExpenses(e);
        setTreatments(t);
        setPurchases(pc);
        setSalaries(sal);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [preset, from, to, isCustom]);

  useEffect(() => {
    void load();
  }, [load]);


  return (
    <div className="page">
      <PageHead
        title="Reports"
        subtitle="Collected revenue, outstanding dues, expenses and net position"
        actions={
          <div className="row gap-sm">
            <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} aria-label="Range">
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="last90">Last 90 days</option>
              <option value="last365">Last 365 days</option>
              <option value="custom">Custom</option>
            </select>
            {isCustom ? (
              <>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </>
            ) : null}
            <button className="btn btn-secondary" onClick={() => void toast.success('Use your browser print (Ctrl+P) on this page for a printable report.')}>
              <FileText size={16} /> Print report
            </button>
          </div>
        }
      />

      {error ? <div className="alert danger">{error}</div> : null}
      {loading || !summary ? (
        <Loading />
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-tile static">
              <span className="stat-label">Billed</span>
              <span className="stat-value"><Money poisha={summary.billedPoisha} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Collected</span>
              <span className="stat-value"><Money poisha={summary.collectedPoisha} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Outstanding</span>
              <span className="stat-value"><Money poisha={summary.outstandingPoisha} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Expenses</span>
              <span className="stat-value"><Money poisha={summary.expensePoisha} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Other income</span>
              <span className="stat-value"><Money poisha={summary.otherIncomePoisha} /></span>
            </div>
            <div className={`stat-tile static ${summary.netPoisha < 0 ? 'negative' : ''}`}>
              <span className="stat-label">Net (collected + other − expenses)</span>
              <span className="stat-value"><Money poisha={summary.netPoisha} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Purchase costs (stock)</span>
              <span className="stat-value"><Money poisha={purchases?.amountPoisha ?? 0} /></span>
            </div>
            <div className="stat-tile static">
              <span className="stat-label">Salaries (expenses)</span>
              <span className="stat-value"><Money poisha={salaries?.amountPoisha ?? 0} /></span>
            </div>
          </div>

          <div className="grid cols-2 mt">
            <div className="card">
              <div className="card-head"><h3>Daily collections</h3></div>
              <div className="card-body">
                {daily.length === 0 ? (
                  <p className="muted">No collections in this range.</p>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 360 }}>
                    <table className="table">
                      <thead><tr><th>Date</th><th>Payments</th><th>Amount</th></tr></thead>
                      <tbody>
                        {daily.map((d) => (
                          <tr key={d.date}>
                            <td>{d.date}</td>
                            <td>{d.count}</td>
                            <td><Money poisha={d.amountPoisha} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-head"><h3>By payment method</h3></div>
                <div className="card-body">
                  {methods.length === 0 ? (
                    <p className="muted">Nothing collected in range.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>Method</th><th>Count</th><th>Amount</th></tr></thead>
                        <tbody>
                          {methods.map((m) => (
                            <tr key={m.method}>
                              <td>{m.label}</td>
                              <td>{m.count}</td>
                              <td><Money poisha={m.amountPoisha} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>Expenses by category</h3></div>
                <div className="card-body">
                  {expenses.length === 0 ? (
                    <p className="muted">No expenses in range.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                        <tbody>
                          {expenses.map((e) => (
                            <tr key={e.category}>
                              <td>{e.category}</td>
                              <td><Money poisha={e.amountPoisha} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card mt">
            <div className="card-head"><h3>Treatment revenue</h3></div>
            <div className="card-body">
              {treatments.length === 0 ? (
                <p className="muted">No billed treatments in range.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Treatment</th><th>Billed</th></tr></thead>
                    <tbody>
                      {treatments.map((t) => (
                        <tr key={t.category}>
                          <td className="bold">{t.category}</td>
                          <td><Money poisha={t.amountPoisha} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function presetSpan(preset: RangePreset): number {
  switch (preset) {
    case 'today': return 0;
    case 'last7': return 7;
    case 'last30': return 30;
    case 'last90': return 90;
    case 'last365': return 365;
    default: return 30;
  }
}
