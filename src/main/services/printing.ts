/**
 * Printing service: printer profiles (DB), print-document HTML generation
 * (Bengali-safe), hidden BrowserWindow print / printToPDF execution.
 */

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import type { PrinterProfileRecord, PrinterInfo } from '@shared/types';

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function mapProfile(r: Record<string, unknown>): PrinterProfileRecord {
  return {
    id: r.id as number,
    name: r.name as string,
    docType: r.doc_type as PrinterProfileRecord['docType'],
    printerName: (r.printer_name as string | null) ?? null,
    paperSize: r.paper_size as PrinterProfileRecord['paperSize'],
    orientation: r.orientation as PrinterProfileRecord['orientation'],
    marginTopMm: r.margin_top_mm as number,
    marginBottomMm: r.margin_bottom_mm as number,
    marginLeftMm: r.margin_left_mm as number,
    marginRightMm: r.margin_right_mm as number,
    scalePercent: r.scale_percent as number,
    copies: r.copies as number,
    isDefault: r.is_default === 1,
  };
}

export function listProfiles(sc: ServiceContext): PrinterProfileRecord[] {
  const rows = sc.db
    .prepare('SELECT * FROM printer_profiles ORDER BY doc_type, is_default DESC, name')
    .all() as Record<string, unknown>[];
  return rows.map(mapProfile);
}

export function getProfile(sc: ServiceContext, id: number): PrinterProfileRecord {
  const row = sc.db.prepare('SELECT * FROM printer_profiles WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Printer profile not found.');
  return mapProfile(row);
}

export type ProfileSave = {
  id: number | null;
  name: string;
  docType: 'prescription' | 'invoice';
  printerName: string | null;
  paperSize: PrinterProfileRecord['paperSize'];
  orientation: PrinterProfileRecord['orientation'];
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  scalePercent: number;
  copies: number;
  isDefault: boolean;
};

export function saveProfile(sc: ServiceContext, p: ProfileSave): PrinterProfileRecord {
  const id = sc.db.transaction(() => {
    if (p.isDefault) {
      sc.db.prepare('UPDATE printer_profiles SET is_default = 0 WHERE doc_type = ?').run(p.docType);
    }
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM printer_profiles WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Printer profile not found.');
      sc.db
        .prepare(
          `UPDATE printer_profiles SET name=?, doc_type=?, printer_name=?, paper_size=?, orientation=?,
                  margin_top_mm=?, margin_bottom_mm=?, margin_left_mm=?, margin_right_mm=?,
                  scale_percent=?, copies=?, is_default=? WHERE id=?`,
        )
        .run(
          p.name, p.docType, p.printerName, p.paperSize, p.orientation,
          p.marginTopMm, p.marginBottomMm, p.marginLeftMm, p.marginRightMm,
          p.scalePercent, p.copies, p.isDefault ? 1 : 0, p.id,
        );
      return p.id;
    }
    const dup = sc.db.prepare('SELECT id FROM printer_profiles WHERE name = ?').get(p.name);
    if (dup) ipcError('CONFLICT', 'A profile with that name already exists.');
    const info = sc.db
      .prepare(
        `INSERT INTO printer_profiles (name, doc_type, printer_name, paper_size, orientation,
            margin_top_mm, margin_bottom_mm, margin_left_mm, margin_right_mm, scale_percent,
            copies, is_default)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.name, p.docType, p.printerName, p.paperSize, p.orientation,
        p.marginTopMm, p.marginBottomMm, p.marginLeftMm, p.marginRightMm,
        p.scalePercent, p.copies, p.isDefault ? 1 : 0,
      );
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'printer_profile.update' : 'printer_profile.create',
    entityType: 'printer_profile',
    entityId: id,
    summary: `Saved printer profile ${p.name}`,
  });
  return getProfile(sc, id);
}

export function deleteProfile(sc: ServiceContext, id: number): { done: true } {
  const count = (sc.db.prepare('SELECT COUNT(*) AS n FROM printer_profiles').get() as { n: number }).n;
  if (count <= 1) ipcError('CONFLICT', 'Keep at least one printer profile.');
  sc.db.prepare('DELETE FROM printer_profiles WHERE id = ?').run(id);
  audit(sc, {
    action: 'printer_profile.delete',
    entityType: 'printer_profile',
    entityId: id,
    summary: 'Deleted printer profile',
  });
  return { done: true };
}

export function profileMargins(p: PrinterProfileRecord): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  return {
    top: p.marginTopMm,
    bottom: p.marginBottomMm,
    left: p.marginLeftMm,
    right: p.marginRightMm,
  };
}

/* ------------------------------------------------------------------ */
/* Print document HTML                                                 */
/* ------------------------------------------------------------------ */

export type PrintPayload =
  | {
      kind: 'prescription';
      doc: Record<string, unknown>;
      items: Record<string, unknown>[];
      config: Record<string, unknown>;
      designations: string[];
      qualifications: string[];
    }
  | {
      kind: 'invoice';
      doc: Record<string, unknown>;
      items: Record<string, unknown>[];
      paid: number;
      config: Record<string, unknown>;
    };

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function bdt(poisha: number): string {
  const n = Number(poisha || 0) / 100;
  const [intPart, dec] = n.toFixed(2).split('.');
  const s = intPart as string;
  let grouped: string;
  if (s.length <= 3) grouped = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const parts: string[] = [];
    for (let i = rest.length; i > 0; i -= 2) parts.unshift(rest.slice(Math.max(0, i - 2), i));
    grouped = `${parts.join(',')},${last3}`;
  }
  return `৳${grouped}.${dec}`;
}

function dhakaDate(ms: number | string | null | undefined): string {
  if (!ms) return '';
  const n = typeof ms === 'string' ? Date.parse(ms) : ms;
  if (Number.isNaN(n)) return String(ms);
  return new Date(n + 6 * 3600_000).toISOString().slice(0, 10);
}

const PAGE_CSS: Record<string, string> = {
  A4: '@page { size: A4; margin: 0; }',
  A5: '@page { size: A5; margin: 0; }',
  A6: '@page { size: A6; margin: 0; }',
  Letter: '@page { size: Letter; margin: 0; }',
  thermal58: '@page { size: 58mm auto; margin: 0; }',
  thermal80: '@page { size: 80mm auto; margin: 0; }',
};

export interface HtmlOptions {
  paperSize?: PrinterProfileRecord['paperSize'];
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  scalePercent?: number;
}

function shellHtml(title: string, bodyCss: string, body: string, opts: HtmlOptions): string {
  const paper = opts.paperSize ?? 'A4';
  const mt = opts.marginTopMm ?? 14;
  const mb = opts.marginBottomMm ?? 14;
  const ml = opts.marginLeftMm ?? 14;
  const mr = opts.marginRightMm ?? 14;
  const scale = (opts.scalePercent ?? 100) / 100;
  const thermal = paper === 'thermal58' || paper === 'thermal80';
  const widthMm = paper === 'thermal58' ? 58 : paper === 'thermal80' ? 80 : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
${PAGE_CSS[paper] ?? PAGE_CSS.A4}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Inter', 'Noto Sans Bengali', system-ui, sans-serif;
  color: #0f172a;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page {
  width: ${widthMm ? `${widthMm}mm` : 'auto'};
  max-width: ${widthMm ? `${widthMm}mm` : '210mm'};
  margin: 0 auto;
  padding: ${thermal ? '4mm' : `${mt}mm ${mr}mm ${mb}mm ${ml}mm`};
  transform: scale(${scale});
  transform-origin: top center;
}
${bodyCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const RX_CSS = `
.rx-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2.5px solid #0e7c7b; padding-bottom: 8px; margin-bottom: 10px; }
.rx-header .clinic h1 { font-size: 20px; margin: 0; color: #0e7c7b; }
.rx-header .clinic .addr { font-size: 11px; color: #475569; line-height: 1.5; }
.rx-header .meta { text-align: right; font-size: 11px; color: #475569; }
.rx-logo { max-height: 48px; max-width: 140px; margin-bottom: 4px; }
.rx-patient { display: flex; gap: 18px; font-size: 12.5px; margin-bottom: 8px; flex-wrap: wrap; }
.rx-patient b { color: #0e7c7b; }
.rx-section { margin: 9px 0; }
.rx-section h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #0e7c7b; margin: 0 0 3px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 2px; }
.rx-section p { margin: 0; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; }
.rx-meds { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
.rx-meds th { background: #ecfeff; color: #0e7c7b; text-align: left; padding: 5px 6px; border: 1px solid #bae6fd; font-size: 11px; }
.rx-meds td { padding: 5px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
.rx-meds .num { width: 24px; text-align: center; color: #64748b; }
.rx-footer { margin-top: 22px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #475569; }
.rx-sign { text-align: center; min-width: 160px; }
.rx-sign .line { border-top: 1.5px solid #334155; margin-top: 46px; padding-top: 4px; }
.rx-sign .who { font-weight: 600; color: #0f172a; font-size: 12px; }
.rx-sign .qual { color: #64748b; }
.rx-note { margin-top: 8px; font-size: 10.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; }
`;

const INV_CSS = `
.inv-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0e7c7b; padding-bottom: 8px; margin-bottom: 10px; }
.inv-header h1 { font-size: 20px; margin: 0; color: #0e7c7b; }
.inv-header .addr { font-size: 11px; color: #475569; line-height: 1.5; }
.inv-header .meta { text-align: right; font-size: 12px; color: #475569; }
.inv-patient { font-size: 12.5px; margin-bottom: 10px; }
.inv-patient b { color: #0e7c7b; }
.inv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.inv-table th { background: #ecfeff; color: #0e7c7b; text-align: left; padding: 6px; border: 1px solid #bae6fd; font-size: 11px; }
.inv-table td { padding: 6px; border: 1px solid #e2e8f0; }
.inv-table .r { text-align: right; }
.inv-table .c { text-align: center; }
.inv-totals { margin-top: 10px; margin-left: auto; width: 260px; font-size: 13px; }
.inv-totals .row { display: flex; justify-content: space-between; padding: 3px 6px; }
.inv-totals .row.total { border-top: 2px solid #0e7c7b; font-weight: 700; font-size: 15px; color: #0e7c7b; margin-top: 3px; padding-top: 6px; }
.inv-totals .row.paid { color: #15803d; }
.inv-totals .row.due { color: #b91c1c; font-weight: 600; }
.inv-footer { margin-top: 18px; font-size: 10.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; }
`;

export function buildPrintHtml(payload: PrintPayload, opts: HtmlOptions = {}): string {
  if (payload.kind === 'prescription') return buildRxHtml(payload, opts);
  return buildInvHtml(payload, opts);
}

function buildRxHtml(p: Extract<PrintPayload, { kind: 'prescription' }>, opts: HtmlOptions): string {
  const d = p.doc;
  const c = p.config;
  const cfg = (k: string): string => String(c[k] ?? '');
  const clinicLines = [
    cfg('clinic_name'),
    cfg('address'),
    [cfg('phone') && `Phone: ${cfg('phone')}`, cfg('email')].filter(Boolean).join(' · '),
    cfg('website'),
    cfg('operating_hours'),
  ].filter(Boolean);
  const qualLine = [...p.qualifications, ...p.designations].join(', ');
  const patientBits = [
    `<span><b>Patient:</b> ${esc(d.patient_name)} (${esc(d.patient_code)})</span>`,
    `<span><b>Date:</b> ${dhakaDate(d.issued_at as number)}</span>`,
    d.age_years != null ? `<span><b>Age:</b> ${esc(d.age_years)}</span>` : '',
    d.gender ? `<span><b>Sex:</b> ${esc(d.gender)}</span>` : '',
    d.blood_group ? `<span><b>Blood:</b> ${esc(d.blood_group)}</span>` : '',
    d.patient_phone ? `<span><b>Phone:</b> ${esc(d.patient_phone)}</span>` : '',
  ].filter(Boolean);

  const sections: string[] = [];
  if (d.chief_complaint) {
    sections.push(`<div class="rx-section"><h3>Chief Complaint (C/C)</h3><p>${esc(d.chief_complaint)}</p></div>`);
  }
  if (d.on_examination) {
    sections.push(`<div class="rx-section"><h3>On Examination (O/E)</h3><p>${esc(d.on_examination)}</p></div>`);
  }
  if (d.rest_examination) {
    sections.push(`<div class="rx-section"><h3>Rest Examination (R/E)</h3><p>${esc(d.rest_examination)}</p></div>`);
  }
  if (d.advice) {
    sections.push(`<div class="rx-section"><h3>Advice</h3><p>${esc(d.advice)}</p></div>`);
  }
  if (d.notes) {
    sections.push(`<div class="rx-section"><h3>Notes</h3><p>${esc(d.notes)}</p></div>`);
  }

  const medRows = p.items
    .map((it, i) => {
      const sig = [
        [it.dose, it.strength && `(${it.strength})`].filter(Boolean).join(' '),
        it.frequency,
        it.timing,
        it.before_after_food,
        it.duration && `× ${it.duration}`,
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><strong>${esc(it.medicine_name)}</strong>${it.form ? ` <span style="color:#64748b">(${esc(it.form)})</span>` : ''}<br/>
            <span style="color:#475569">${esc(sig)}</span>${it.instructions ? `<br/><span style="font-size:10.5px;color:#64748b">${esc(it.instructions)}</span>` : ''}</td>
        <td>${esc(it.quantity)}</td>
        <td>${esc(it.route)}</td>
      </tr>`;
    })
    .join('');

  const body = `
<div class="page">
  <div class="rx-header">
    <div class="clinic">
      ${c.logo_data_url ? `<img class="rx-logo" src="${c.logo_data_url}" alt="" />` : ''}
      <h1>${esc(cfg('clinic_name') || 'Dental Practice')}</h1>
      <div class="addr">${clinicLines.slice(1).map(esc).join('<br/>')}</div>
    </div>
    <div class="meta">
      <div><strong>Prescription</strong></div>
      <div>${esc(d.prescription_code)}</div>
      <div>${dhakaDate(d.issued_at as number)}</div>
    </div>
  </div>
  <div class="rx-patient">${patientBits.join('')}</div>
  ${sections.join('')}
  <div class="rx-section">
    <h3>Medications</h3>
    <table class="rx-meds">
      <thead><tr><th class="num">#</th><th>Medicine &amp; signature</th><th>Qty</th><th>Route</th></tr></thead>
      <tbody>${medRows || '<tr><td colspan="4">No medications</td></tr>'}</tbody>
    </table>
  </div>
  <div class="rx-footer">
    <div class="rx-note">${esc(cfg('prescription_footer'))}</div>
    <div class="rx-sign">
      <div class="line">
        <div class="who">${esc(d.dentist_name)}</div>
        ${qualLine ? `<div class="qual">${esc(qualLine)}</div>` : ''}
        <div class="qual">Signature</div>
      </div>
    </div>
  </div>
</div>`;
  return shellHtml(`Prescription ${String(d.prescription_code)}`, RX_CSS, body, opts);
}

function buildInvHtml(p: Extract<PrintPayload, { kind: 'invoice' }>, opts: HtmlOptions): string {
  const d = p.doc;
  const c = p.config;
  const cfg = (k: string): string => String(c[k] ?? '');
  const clinicLines = [
    cfg('clinic_name'),
    cfg('address'),
    [cfg('phone') && `Phone: ${cfg('phone')}`, cfg('email')].filter(Boolean).join(' · '),
  ].filter(Boolean);
  const total = d.total_poisha as number;
  const paid = p.paid;
  const due = Math.max(0, total - paid);

  const rows = p.items
    .map(
      (it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c">${esc(it.quantity)}</td>
      <td class="r">${bdt(it.unit_price_poisha as number)}</td>
      <td class="r">${bdt(it.discount_poisha as number)}</td>
      <td class="r">${bdt(it.total_poisha as number)}</td>
    </tr>`,
    )
    .join('');

  const body = `
<div class="page">
  <div class="inv-header">
    <div>
      ${c.logo_data_url ? `<img class="rx-logo" src="${c.logo_data_url}" alt="" />` : ''}
      <h1>${esc(cfg('clinic_name') || 'Dental Practice')}</h1>
      <div class="addr">${clinicLines.slice(1).map(esc).join('<br/>')}</div>
    </div>
    <div class="meta">
      <div style="font-size:16px;font-weight:700;color:#0e7c7b">INVOICE</div>
      <div><strong>${esc(d.invoice_code)}</strong></div>
      <div>Date: ${esc(d.invoice_date)}</div>
    </div>
  </div>
  <div class="inv-patient">
    <b>Patient:</b> ${esc(d.patient_name)} (${esc(d.patient_code)})${d.patient_phone ? ` · <b>Phone:</b> ${esc(d.patient_phone)}` : ''}
  </div>
  <table class="inv-table">
    <thead><tr><th class="c">#</th><th>Treatment / Item</th><th class="c">Qty</th><th class="r">Unit</th><th class="r">Discount</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="inv-totals">
    <div class="row"><span>Subtotal</span><span>${bdt(d.subtotal_poisha as number)}</span></div>
    <div class="row"><span>Discount</span><span>-${bdt(d.discount_poisha as number)}</span></div>
    ${(d.adjustment_poisha as number) !== 0 ? `<div class="row"><span>Adjustment</span><span>${bdt(d.adjustment_poisha as number)}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${bdt(total)}</span></div>
    <div class="row paid"><span>Paid</span><span>${bdt(paid)}</span></div>
    <div class="row due"><span>Due</span><span>${bdt(due)}</span></div>
  </div>
  <div class="inv-footer">${esc(cfg('invoice_footer') || cfg('footer_note'))}</div>
</div>`;
  return shellHtml(`Invoice ${String(d.invoice_code)}`, INV_CSS, body, opts);
}

/* ------------------------------------------------------------------ */
/* Execution: print window / PDF                                       */
/* ------------------------------------------------------------------ */

export interface PrintRunOptions {
  docType: 'prescription' | 'invoice';
  payload: PrintPayload;
  printerName: string | null;
  silent: boolean;
  copies: number;
  paperSize: PrinterProfileRecord['paperSize'];
  orientation: 'portrait' | 'landscape';
  margins: { top: number; bottom: number; left: number; right: number } | null;
  scalePercent: number;
}

export interface PrintRunResult {
  printed: boolean;
  message: string;
  printerUsed?: string;
}

async function makePrintWindow(html: string, docId: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const dir = join(tmpdir(), `dentiva-print-${docId}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'document.html');
  writeFileSync(file, html, 'utf8');
  await win.loadFile(file);
  return win;
}

export async function runPrint(
  hostWindow: BrowserWindow,
  opts: PrintRunOptions,
): Promise<PrintRunResult> {
  const html = buildPrintHtml(opts.payload, {
    paperSize: opts.paperSize,
    marginTopMm: opts.margins?.top ?? 14,
    marginBottomMm: opts.margins?.bottom ?? 14,
    marginLeftMm: opts.margins?.left ?? 14,
    marginRightMm: opts.margins?.right ?? 14,
    scalePercent: opts.scalePercent,
  });
  const docId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const printWin = await makePrintWindow(html, docId);
  try {
    // Allow fonts/layout to settle.
    await new Promise((r) => setTimeout(r, 250));
    const settings = {
      silent: opts.silent,
      deviceName: opts.printerName ?? undefined,
      copies: Math.max(1, Math.min(20, Math.round(opts.copies))),
      printBackground: true,
      color: true,
      landscape: opts.orientation === 'landscape',
      margins: { marginType: 'custom' as const, top: 1, bottom: 1, left: 1, right: 1 },
      scaleFactor: opts.scalePercent,
    };
    const ok = await new Promise<boolean>((resolve) => {
      printWin.webContents.print(settings, (success, reason) => {
        if (!success) console.error('[print] rejected:', reason);
        resolve(success);
      });
    });
    return ok
      ? {
          printed: true,
          message: opts.silent ? 'Sent to printer.' : 'Print job completed.',
          ...(opts.printerName ? { printerUsed: opts.printerName } : {}),
        }
      : { printed: false, message: 'Printing was cancelled or failed.' };
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
    void hostWindow;
    try {
      rmSync(join(tmpdir(), `dentiva-print-${docId}`), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export interface PdfOptions {
  docType: 'prescription' | 'invoice';
  payload: PrintPayload;
  pageSize: PrinterProfileRecord['paperSize'];
  savePath?: string;
}

export interface PdfResult {
  saved: boolean;
  path: string | null;
}

/* printToPDF pageSize custom objects are in inches. */
const PAPER_TO_PDF: Record<string, 'A4' | 'A5' | 'A6' | 'Letter' | { width: number; height: number }> = {
  A4: 'A4',
  A5: 'A5',
  A6: 'A6',
  Letter: 'Letter',
  thermal58: { width: 58 / 25.4, height: 120 / 25.4 },
  thermal80: { width: 80 / 25.4, height: 120 / 25.4 },
};

export async function saveAsPdf(hostWindow: BrowserWindow, opts: PdfOptions): Promise<PdfResult> {
  const { dialog } = await import('electron');
  let target = opts.savePath;
  if (!target) {
    const res = await dialog.showSaveDialog(hostWindow, {
      title: 'Save as PDF',
      defaultPath: `${opts.docType}-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false, path: null };
    target = res.filePath;
  }
  const html = buildPrintHtml(opts.payload, { paperSize: opts.pageSize });
  const docId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const printWin = await makePrintWindow(html, docId);
  try {
    await new Promise((r) => setTimeout(r, 250));
    const data = await printWin.webContents.printToPDF({
      pageSize: PAPER_TO_PDF[opts.pageSize] ?? 'A4',
      printBackground: true,
      margins: { top: 0.31, bottom: 0.31, left: 0.31, right: 0.31 },
      scale: 1,
    });
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, data);
    return { saved: true, path: target };
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
    void hostWindow;
    try {
      rmSync(join(tmpdir(), `dentiva-print-${docId}`), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export { existsSync };
export type { PrinterInfo };
