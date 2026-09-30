/**
 * Print validation without a physical printer:
 *  - Bengali A4 prescription preview popup: header/logo, patient/date/doctor
 *    block, C/C · O/E · R/E · Advice sections, multiple medicines, multiple
 *    qualifications, signature space, embedded Bengali font, page-break CSS.
 *  - Invoice preview popup with clinic footer.
 *  - Byte-level PDF output for A4 and 80 mm thermal (real page geometry).
 * Screenshots land in artifacts/e2e/ for human layout review (glyph shape,
 * clipping, overlap, logo distortion must be judged by a person).
 */
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ARTIFACTS,
  DENTIST_ARGS,
  api,
  completeSetup,
  launch,
  newInvoice,
  newInvoiceItem,
  newPatient,
  newRx,
  scalar,
} from './helpers'

/** 1×1 transparent PNG for a deterministic logo fixture. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('print & PDF validation', () => {
  test('Bengali A4 prescription and invoice previews render fully', async () => {
    const ctx = await launch()
    const page = ctx.page
    mkdirSync(ARTIFACTS, { recursive: true })

    await completeSetup(page, {
      username: 'print-admin',
      designations: ['BDS', 'FCPS (Oral Surgery)'],
      qualifications: ['DDS, DU', 'Certified Endodontist'],
    })

    // Clinic identity in Bengali + programmatically imported logo.
    const logoPath = join(ctx.profileRoot, 'clinic-logo.png')
    writeFileSync(logoPath, PNG_1PX)
    await api(page, 'clinic.update', {
      clinicName: 'ডেন্টিভা পরীক্ষা ক্লিনিক',
      address: 'বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা ১২০৫',
      phone: '01712340001',
      email: 'clinic@example.test',
      website: '',
      registrationInfo: 'রেজি. বি-ডি-১২৩৪',
      operatingHours: 'শনি–বৃহস্পতি ১০:০০–১৮:০০',
      footerNote: '',
      prescriptionFooter: 'আরো ভালো থাকুন।',
      invoiceFooter: 'আপনাকে ধন্যবাদ।',
      logoPath,
    })
    expect(
      scalar<string>(ctx.userData, 'SELECT logo_path FROM clinic_config WHERE id = 1'),
    ).toBeTruthy()

    const patient = await api(
      page,
      'patients.create',
      newPatient('করিম আহমেদ', '01712345509', {
        gender: 'male',
        ageYears: 34,
        presentingProblem: 'ডান পাশের দাঁতে দীর্ঘদিন ব্যথা',
      }),
    )
    const dentists = await api(page, 'dentists.list', DENTIST_ARGS)
    const dentistId = dentists[0]!.id

    const longAdvice =
      'দিনে দুইবার সঠিকভাবে ব্রাশ করুন, মিষ্টি জিনিস কমান, ছয় মাস পর পুনরায় পরীক্ষা করান। ' +
      'ভোজনের পর অবশ্যই মাউথওয়াশ ব্যবহার করুন এবং কঠিন খাবার চিবানোর সময় সতর্ক থাকুন। '.repeat(6)

    await api(
      page,
      'prescriptions.create',
      newRx({
        patientId: patient.id,
        dentistId,
        chiefComplaint: 'তীব্র দাঁতের ব্যথা — ডান নিচের মোলার',
        onExamination: '৪৬ নম্বর দাঁতে গভীর ক্ষয়, স্পর্শে ব্যথা, মাড়ি ফোলা।',
        restExamination: 'বাকি মুখগহ্বর স্বাভাবিক, ওআই-এ কোনো অস্বাভাবিকতা নেই।',
        advice: longAdvice,
        items: [
          {
            medicineName: 'অ্যামোক্সিসিলিন',
            form: 'ক্যাপসুল',
            strength: '500mg',
            dose: '১ ক্যাপসুল',
            frequency: 'দিনে ৩ বার',
            timing: 'খাবারের পরে',
            beforeAfterFood: 'after',
            duration: '৫ দিন',
            quantity: '১৫টি',
            route: 'oral',
            instructions: 'পূর্ণ কোর্স শেষ করুন।',
          },
          {
            medicineName: 'মেট্রোনিডাজল',
            form: 'ট্যাবলেট',
            strength: '400mg',
            dose: '১ ট্যাবলেট',
            frequency: 'দিনে ৩ বার',
            timing: 'খাবারের পরে',
            beforeAfterFood: 'after',
            duration: '৫ দিন',
            quantity: '১৫টি',
            route: 'oral',
            instructions: '',
          },
          {
            medicineName: 'আইবুপ্রোফেন',
            form: 'ট্যাবলেট',
            strength: '400mg',
            dose: '১ ট্যাবলেট',
            frequency: 'প্রয়োজনে',
            timing: 'ব্যথা হলে',
            beforeAfterFood: 'before',
            duration: '৩ দিন',
            quantity: '৬টি',
            route: 'oral',
            instructions: 'খালি পেটে নেবেন না।',
          },
        ],
      }),
    )

    // --- Prescription preview popup (real window.open path). ---
    await page.getByRole('link', { name: 'Prescriptions' }).click()
    const popupPromise = page.waitForEvent('popup')
    await page.getByTitle('Preview').first().click()
    const popup = await popupPromise

    await expect(popup.locator('.rx-sign')).toBeVisible({ timeout: 20_000 })
    await expect(popup.locator('img').first()).toBeVisible() // logo rendered
    const html = await popup.content()
    expect(html).toContain('ডেন্টিভা পরীক্ষা ক্লিনিক') // Bengali clinic header
    expect(html).toContain('করিম আহমেদ') // patient
    expect(html).toContain('তীব্র দাঁতের ব্যথা') // C/C section
    expect(html).toContain('On Examination') // O/E section present
    expect(html).toContain('Rest Examination') // R/E section present
    expect(html).toContain('Advice')
    expect(html).toContain('অ্যামোক্সিসিলিন')
    expect(html).toContain('মেট্রোনিডাজল')
    expect(html).toContain('আইবুপ্রোফেন')
    expect(html).toContain('FCPS (Oral Surgery)') // multiple designations
    expect(html).toContain('Certified Endodontist') // multiple qualifications
    expect(html).toContain('Signature') // signature line present
    expect(html).toContain('Dentiva Print Bengali') // embedded Bengali font face
    expect(html).toContain('@font-face')
    expect(html).toMatch(/page-break-inside:\s*avoid/)
    expect(html).toContain('url(data:font/woff2') // fonts inlined, no network
    expect(html).not.toContain('http://') // offline document
    expect(html).not.toContain('https://')
    await popup.screenshot({ path: join(ARTIFACTS, 'prescription-a4-bengali.png'), fullPage: true })
    await popup.close()

    // --- Invoice created through the bridge; previewed through the UI. ---
    const inv = await api(
      page,
      'invoices.create',
      newInvoice({
        patientId: patient.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [newInvoiceItem('ফিলিং (কমপোজিট)', 250_000), newInvoiceItem('স্কেলিং', 150_000)],
        idempotencyKey: 'e2e-print-inv-01',
      }),
    )
    await page.getByRole('link', { name: 'Invoice' }).click()
    await page.getByRole('button', { name: 'Open' }).first().click()
    await expect(page.getByText(inv.invoiceCode).first()).toBeVisible({ timeout: 15_000 })

    const invPopupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Preview' }).click()
    const invPopup = await invPopupPromise
    await expect(invPopup.locator('table').first()).toBeVisible({ timeout: 20_000 })
    const invHtml = await invPopup.content()
    expect(invHtml).toContain('ডেন্টিভা পরীক্ষা ক্লিনিক')
    expect(invHtml).toContain('করিম আহমেদ')
    expect(invHtml).toContain('ফিলিং (কমপোজিট)')
    expect(invHtml).toContain('স্কেলিং')
    expect(invHtml).toContain('আপনাকে ধন্যবাদ।')
    expect(invHtml).toContain(inv.invoiceCode)
    await invPopup.screenshot({ path: join(ARTIFACTS, 'invoice-a4-bengali.png'), fullPage: true })
    await invPopup.close()

    await ctx.close()

    expect(scalar<number>(ctx.userData, 'SELECT COUNT(*) FROM prescriptions')).toBe(1)
    expect(statSync(join(ARTIFACTS, 'prescription-a4-bengali.png')).size).toBeGreaterThan(5_000)
  })

  test('PDF export produces valid A4 and 80 mm thermal files', async () => {
    const ctx = await launch()
    const page = ctx.page
    mkdirSync(ARTIFACTS, { recursive: true })

    await completeSetup(page, { username: 'pdf-admin' })
    const patient = await api(page, 'patients.create', newPatient('PDF Test Patient', '01712345510'))
    const dentists = await api(page, 'dentists.list', DENTIST_ARGS)
    const rx = await api(
      page,
      'prescriptions.create',
      newRx({
        patientId: patient.id,
        dentistId: dentists[0]!.id,
        chiefComplaint: 'Check-up',
        advice: 'Six-month recall. Brush twice daily.',
        items: [
          {
            medicineName: 'Fluoride Toothpaste',
            form: 'paste',
            strength: '',
            dose: 'pea size',
            frequency: 'twice daily',
            timing: '',
            beforeAfterFood: '',
            duration: 'ongoing',
            quantity: '',
            route: 'topical',
            instructions: '',
          },
        ],
      }),
    )

    // A4 prescription PDF.
    const a4Path = join(ARTIFACTS, 'prescription-a4.pdf')
    const a4 = await api(page, 'print.toPdf', {
      docType: 'prescription',
      docId: rx.id,
      paperSize: 'A4',
      savePath: a4Path,
    })
    expect(a4.saved).toBe(true)
    expect(existsSync(a4Path)).toBe(true)
    const a4Bytes = readFileSync(a4Path)
    expect(a4Bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(a4Bytes.length).toBeGreaterThan(2_000)
    expect(a4Bytes.toString('latin1')).toContain('/Type')

    // 80 mm thermal receipt PDF — genuine thermal page geometry.
    const thPath = join(ARTIFACTS, 'prescription-thermal80.pdf')
    const th = await api(page, 'print.toPdf', {
      docType: 'prescription',
      docId: rx.id,
      paperSize: 'thermal80',
      savePath: thPath,
    })
    expect(th.saved).toBe(true)
    const thBytes = readFileSync(thPath)
    expect(thBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(
      thBytes.toString('latin1'),
    )
    expect(mediaBox).not.toBeNull()
    const widthPts = Number(mediaBox![3]) - Number(mediaBox![1])
    // 80 mm = 226.77 pt (±6 pt for rounding).
    expect(widthPts).toBeGreaterThan(220)
    expect(widthPts).toBeLessThan(233)

    // Invoice PDF too.
    const inv = await api(
      page,
      'invoices.create',
      newInvoice({
        patientId: patient.id,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [newInvoiceItem('Consultation', 50_000)],
        idempotencyKey: 'e2e-pdf-inv-01',
      }),
    )
    const invPath = join(ARTIFACTS, 'invoice-a4.pdf')
    const invPdf = await api(page, 'print.toPdf', {
      docType: 'invoice',
      docId: inv.id,
      paperSize: 'A4',
      savePath: invPath,
    })
    expect(invPdf.saved).toBe(true)
    expect(readFileSync(invPath).subarray(0, 5).toString('latin1')).toBe('%PDF-')

    await ctx.close()
  })
})
