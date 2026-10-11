// Phase 5: receipts and marksheets embed the Noto Sans Devanagari faces (Latin and Devanagari text both print).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReceiptPdf } from '../src/services/fees/receiptPdf.js';
import { renderMarksheetPdf } from '../src/services/exams/marksheetPdf.js';
import { registerPdfFonts, FONT_DIR } from '../src/services/pdf/fonts.js';
import fs from 'fs';
import path from 'path';

const NEPALI_SCHOOL = 'श्री सरस्वती माध्यमिक विद्यालय';
const NEPALI_STUDENT = 'आशा शर्मा';

test('font files are present and are TrueType', () => {
  for (const f of ['NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf']) {
    const p = path.join(FONT_DIR, f);
    assert.ok(fs.existsSync(p), p);
    const head = fs.readFileSync(p).subarray(0, 4).toString('hex');
    assert.equal(head, '00010000', `${f} is a TrueType font`);
  }
  assert.ok(fs.existsSync(path.join(FONT_DIR, 'OFL.txt')), 'licence file ships with the fonts');
});

test('receipt PDF: Latin labels stay in Helvetica, Devanagari runs use Noto', async () => {
  const buf = await renderReceiptPdf({
    receipt_no: 'RCP-000001', school_name: NEPALI_SCHOOL, date: '2026-10-11 20:18:53', status: 'valid',
    invoice_no: 'INV-000001', period: 'Term 1 2026',
    student: { name: NEPALI_STUDENT, class_level: 7, section: 'A', roll_no: 3 },
    items: [{ name: 'शुल्क', gross_paisa: 500000, concession_paisa: 0, net_paisa: 500000 }],
    invoice: { net_paisa: 500000, paid_paisa: 500000, balance_paisa: 0, credit_balance_paisa: 0 },
    amount_paisa: 500000, refunded_paisa: 0,
  }, { compress: false });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const text = buf.toString('latin1');
  assert.ok(text.includes('NotoSansDevanagari'), 'Noto font is embedded for the Nepali name and school');
  assert.ok(text.includes('/BaseFont /Helvetica'), 'Latin labels keep Helvetica (searchable text)');
});

test('English-only receipt does not embed Noto (output for Latin-only schools is unchanged)', async () => {
  const buf = await renderReceiptPdf({
    receipt_no: 'RCP-000002', school_name: 'Sample School', date: '2026-10-11 20:18:53', status: 'valid',
    invoice_no: 'INV-000002', period: 'Term 1 2026',
    student: { name: 'Asha Sharma', class_level: 7, section: 'A', roll_no: 3 },
    items: [{ name: 'Tuition', gross_paisa: 500000, concession_paisa: 0, net_paisa: 500000 }],
    invoice: { net_paisa: 500000, paid_paisa: 500000, balance_paisa: 0, credit_balance_paisa: 0 },
    amount_paisa: 500000, refunded_paisa: 0,
  }, { compress: false });
  const text = buf.toString('latin1');
  assert.ok(!text.includes('NotoSansDevanagari'));
  assert.ok(text.includes('/BaseFont /Helvetica'));
});

test('marksheet PDF embeds the Devanagari font', async () => {
  const buf = await renderMarksheetPdf({
    student: { name: NEPALI_STUDENT, class_level: 10, section: 'A', roll_no: 7 },
    term: { name: 'First Terminal', session_name: '2083' },
    rows: [{ subject_name: 'गणित', theory: 60, internal: 20, total: 80, percent: 80, grade: 'A+', grade_point: 3.6, credit_hours: 5, is_absent: false }],
    summary: { gpa: 3.6, credit_total: 5, status: 'complete' },
    footer: { version_labels: ['v1'], sign_off_ids: ['SO-1'], published_at: ['2026-10-11 20:00:00'] },
  }, { compress: false, schoolName: NEPALI_SCHOOL });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.toString('latin1').includes('NotoSansDevanagari'));
});

test('font registration works on a fresh PDF document', async () => {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument();
  assert.doesNotThrow(() => registerPdfFonts(doc));
  doc.end();
});
