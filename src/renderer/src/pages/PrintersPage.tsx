/** Printer profiles: A4/A5/thermal, system printers, preview, PDF workflow. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Printer, FileDown, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { PrinterInfo, PrinterProfileRecord } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  PageHead,
  ConfirmDialog,
} from '../components/ui';
import { toast } from '../lib/store';

const PAPER_LABELS: Record<PrinterProfileRecord['paperSize'], string> = {
  A4: 'A4 (210 × 297 mm)',
  A5: 'A5 (148 × 210 mm)',
  A6: 'A6 (105 × 148 mm)',
  Letter: 'Letter (216 × 279 mm)',
  thermal58: 'Thermal 58 mm',
  thermal80: 'Thermal 80 mm',
};

const blankProfile = (): Parameters<typeof saveProfile>[0] => ({
  id: null,
  name: '',
  docType: 'prescription',
  printerName: null,
  paperSize: 'A4',
  orientation: 'portrait',
  marginTopMm: 12,
  marginBottomMm: 12,
  marginLeftMm: 12,
  marginRightMm: 12,
  scalePercent: 100,
  copies: 1,
  isDefault: false,
});

interface ProfileDraft {
  id: number | null;
  name: string;
  docType: 'prescription' | 'invoice';
  printerName: string | null;
  paperSize: PrinterProfileRecord['paperSize'];
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  scalePercent: number;
  copies: number;
  isDefault: boolean;
}

async function saveProfile(draft: ProfileDraft): Promise<PrinterProfileRecord> {
  return api('printerProfiles.save', draft);
}

export default function PrintersPage(): JSX.Element {
  const [profiles, setProfiles] = useState<PrinterProfileRecord[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PrinterProfileRecord | null>(null);
  const [preview, setPreview] = useState<{ html: string; title: string } | null>(null);
  const previewRef = useRef<HTMLIFrameElement | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, sys] = await Promise.all([
        api('printerProfiles.list', {}),
        api('printers.list', {}).catch(() => [] as PrinterInfo[]),
      ]);
      setProfiles(p);
      setPrinters(sys);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api('session.state', {}).then((s) => {
      const perms = new Set(s.user?.permissions ?? []);
      setCanManage(perms.has('printer.manage'));
      setCanPrint(perms.has('prescription.print'));
    });
    void load();
  }, [load]);

  const refreshPrinters = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const sys = await api('printers.list', {});
      setPrinters(sys);
      toast.success(`Found ${sys.length} printer(s).`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Profile name is required.');
      return;
    }
    try {
      await saveProfile(draft);
      toast.success('Profile saved.');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const showPreview = async (docType: 'prescription' | 'invoice'): Promise<void> => {
    try {
      // Preview the most recent document of this type as a format sample.
      const list = docType === 'prescription'
        ? await api('prescriptions.list', { page: 1, pageSize: 1 })
        : await api('invoices.list', { status: 'all', search: '', preset: 'all', page: 1, pageSize: 1 });
      const id = docType === 'prescription'
        ? (list.items[0]?.id ?? null)
        : (list.items[0]?.id ?? null);
      if (!id) {
        toast.warning(`Create a ${docType} first to preview its print layout.`);
        return;
      }
      const res = await api('print.preview', { docType, docId: id });
      setPreview({ html: res.previewHtml, title: `${docType} print preview` });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const previewFrame = (html: string): JSX.Element => (
    <iframe
      ref={previewRef}
      title="Print preview"
      srcDoc={html}
      style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8, background: 'white' }}
    />
  );

  const printPreview = (): void => {
    const frame = previewRef.current;
    if (frame?.contentWindow) frame.contentWindow.focus();
    frame?.contentWindow?.print();
  };

  return (
    <div className="page">
      <PageHead
        title="Printer Profiles"
        subtitle="Paper size, margins, scale and copies per document type"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => void refreshPrinters()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh printers
            </button>
            {canManage ? (
              <button className="btn btn-primary" onClick={() => setDraft(blankProfile())}>
                <Plus size={16} /> New profile
              </button>
            ) : null}
          </>
        }
      />

      <div className="alert info">
        <Printer size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
        Printing uses the Windows printer subsystem with dynamic paper-size adaptation — layouts
        reflow for A4, A5 and thermal rolls automatically. For PDF, choose “Microsoft Print to PDF”
        (or use the Save-as-PDF button on documents) and the layout adapts to that paper size.
      </div>

      {error ? <div className="alert danger">{error}</div> : null}

      <div className="grid cols-2 mt">
        <div className="card">
          <div className="card-head"><h3>Profiles</h3></div>
          <div className="card-body">
            {loading ? (
              <Loading />
            ) : profiles.length === 0 ? (
              <p className="muted">No profiles yet. Suggested defaults are created during setup.</p>
            ) : (
              <div className="stack">
                {profiles.map((p) => (
                  <div className="card card-pad" key={p.id}>
                    <div className="row between mb-sm">
                      <div>
                        <strong>{p.name}</strong>
                        {p.isDefault ? <span className="badge badge-teal" style={{ marginLeft: 8 }}>default</span> : null}
                        <div className="muted">
                          {p.docType} · {PAPER_LABELS[p.paperSize]} · {p.orientation} · scale {p.scalePercent}%
                          {p.copies > 1 ? ` · ${p.copies} copies` : ''}
                        </div>
                        <div className="muted">
                          Margins T{p.marginTopMm} B{p.marginBottomMm} L{p.marginLeftMm} R{p.marginRightMm} mm ·
                          printer: {p.printerName ?? 'system default'}
                        </div>
                      </div>
                      {canManage ? (
                        <div className="row gap-sm">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setDraft({
                                id: p.id,
                                name: p.name,
                                docType: p.docType,
                                printerName: p.printerName,
                                paperSize: p.paperSize,
                                orientation: p.orientation,
                                marginTopMm: p.marginTopMm,
                                marginBottomMm: p.marginBottomMm,
                                marginLeftMm: p.marginLeftMm,
                                marginRightMm: p.marginRightMm,
                                scalePercent: p.scalePercent,
                                copies: p.copies,
                                isDefault: p.isDefault,
                              })
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(p)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="row gap-sm">
                      <button className="btn btn-secondary btn-sm" onClick={() => void showPreview('prescription')}>
                        Preview prescription
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => void showPreview('invoice')}>
                        Preview invoice
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Installed printers</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => void refreshPrinters()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="card-body">
            {printers.length === 0 ? (
              <p className="muted">No printers reported by Windows. Attach a printer or install “Microsoft Print to PDF”.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Status</th><th>Default</th></tr></thead>
                  <tbody>
                    {printers.map((p) => (
                      <tr key={p.name}>
                        <td>
                          <div className="bold">{p.displayName || p.name}</div>
                          <small className="muted">{p.description}</small>
                        </td>
                        <td>{p.status}</td>
                        <td>{p.isDefault ? <span className="badge badge-teal">default</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt">
              <button
                className="btn btn-secondary btn-sm"
                disabled={!canPrint}
                onClick={() => void showPreview('prescription')}
              >
                <FileDown size={14} /> Test print preview
              </button>
            </div>
          </div>
        </div>
      </div>

      {draft ? (
        <Modal
          title={draft.id ? `Edit profile · ${draft.name}` : 'New printer profile'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save profile</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="Profile name" required full>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Document type" required>
              <select className="select" value={draft.docType} onChange={(e) => setDraft({ ...draft, docType: e.target.value as 'prescription' | 'invoice' })}>
                <option value="prescription">Prescription</option>
                <option value="invoice">Invoice</option>
              </select>
            </Field>
            <Field label="Paper size" required>
              <select className="select" value={draft.paperSize} onChange={(e) => setDraft({ ...draft, paperSize: e.target.value as PrinterProfileRecord['paperSize'] })}>
                {(Object.keys(PAPER_LABELS) as PrinterProfileRecord['paperSize'][]).map((k) => (
                  <option key={k} value={k}>{PAPER_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Printer" hint="Leave as system default to use Windows default printer">
              <select className="select" value={draft.printerName ?? ''} onChange={(e) => setDraft({ ...draft, printerName: e.target.value || null })}>
                <option value="">System default</option>
                {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}
              </select>
            </Field>
            <Field label="Orientation">
              <select className="select" value={draft.orientation} onChange={(e) => setDraft({ ...draft, orientation: e.target.value as 'portrait' | 'landscape' })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </Field>
            <Field label="Margin top (mm)"><input className="input" type="number" min={0} max={50} value={draft.marginTopMm} onChange={(e) => setDraft({ ...draft, marginTopMm: Number(e.target.value) })} /></Field>
            <Field label="Margin bottom (mm)"><input className="input" type="number" min={0} max={50} value={draft.marginBottomMm} onChange={(e) => setDraft({ ...draft, marginBottomMm: Number(e.target.value) })} /></Field>
            <Field label="Margin left (mm)"><input className="input" type="number" min={0} max={50} value={draft.marginLeftMm} onChange={(e) => setDraft({ ...draft, marginLeftMm: Number(e.target.value) })} /></Field>
            <Field label="Margin right (mm)"><input className="input" type="number" min={0} max={50} value={draft.marginRightMm} onChange={(e) => setDraft({ ...draft, marginRightMm: Number(e.target.value) })} /></Field>
            <Field label="Scale (%)"><input className="input" type="number" min={50} max={150} value={draft.scalePercent} onChange={(e) => setDraft({ ...draft, scalePercent: Number(e.target.value) })} /></Field>
            <Field label="Copies"><input className="input" type="number" min={1} max={20} value={draft.copies} onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value) })} /></Field>
            <label className="check-row" style={{ gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
              <span>Default profile for this document type</span>
            </label>
          </div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete profile"
          danger
          confirmLabel="Delete"
          body={<p>Delete printer profile <strong>{deleteTarget.name}</strong>? Documents fall back to the default profile.</p>}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            try {
              await api('printerProfiles.delete', { id: deleteTarget.id });
              toast.success('Profile deleted.');
              setDeleteTarget(null);
              await load();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      ) : null}

      {preview ? (
        <Modal
          title={preview.title}
          onClose={() => setPreview(null)}
          size="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Close</button>
              <button className="btn btn-primary" onClick={printPreview}>
                Print this preview
              </button>
            </>
          }
        >
          {previewFrame(preview.html)}
        </Modal>
      ) : null}
    </div>
  );
}
