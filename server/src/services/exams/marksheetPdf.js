// Marksheet PDF. Built only from marksheetFor() data, which reads the publication snapshots.
// It never reads live marks, so a printed sheet matches the version it was issued from.
// Footer: "Version: <publish versions> | Date: YYYY-MM-DD", the verification timestamp, and the sign-off ID.
// Times are shown in Nepal time (UTC+05:45, no daylight saving).
import PDFDocument from 'pdfkit';
import { TERM_STATUS_LABEL } from './grading.js';

const LEFT = 50;
const RIGHT = 545;
const NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

export const nptStamp = d => new Date(new Date(d).getTime() + NPT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
export const nptDate = d => nptStamp(d).slice(0, 10);

const show = v => (v === null || v === undefined || v === '' ? '-' : String(v));

const NG_REASON_TEXT = {
  theory: 'theory is below the component minimum',
  internal: 'internal is below the component minimum',
  total: 'total is below the lowest pass band',
};

export function renderMarksheetPdf(data, { compress = true, verifiedAt = new Date(), schoolName = 'School' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: LEFT, compress,
      info: { Title: `Marksheet - ${data.student.name} - ${data.term.name}`, Author: schoolName, Creator: 'NITEX exams' },
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const versions = data.footer.version_labels.join(', ');
    const signOffs = data.footer.sign_off_ids.join(', ');

    doc.font('Helvetica-Bold').fontSize(15).text(schoolName, LEFT, doc.y, { width: RIGHT - LEFT, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12).text('Academic Marksheet', LEFT, doc.y, { width: RIGHT - LEFT, align: 'center' });
    doc.moveDown(0.8);

    const info = (label, value, x, y) => {
      doc.font('Helvetica-Bold').fontSize(9.5).text(label, x, y, { width: 80 });
      doc.font('Helvetica').fontSize(9.5).text(show(value), x + 80, y, { width: 180 });
    };
    let y = doc.y;
    info('Name', data.student.name, LEFT, y);
    info('Term', data.term.name, 320, y);
    y += 16;
    info('Roll no.', data.student.roll_no, LEFT, y);
    info('Session', data.term.session_name, 320, y);
    y += 16;
    info('Class', `${data.student.class_level}${data.student.section ? ` ${data.student.section}` : ''}`, LEFT, y);
    doc.y = y + 26;

    // Table
    const cols = { subject: [LEFT, 180], theory: [230, 55], internal: [285, 60], total: [345, 50], pct: [395, 50], grade: [445, 40], gp: [485, 35], credit: [520, 25] };
    const cell = (key, text, { bold = false, align = 'left' } = {}) => {
      const [x, w] = cols[key];
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(text, x, rowY, { width: w, align });
    };
    const header = () => {
      rowY = doc.y;
      cell('subject', 'Subject', { bold: true });
      cell('theory', 'Theory', { bold: true, align: 'right' });
      cell('internal', 'Internal', { bold: true, align: 'right' });
      cell('total', 'Total', { bold: true, align: 'right' });
      cell('pct', '%', { bold: true, align: 'right' });
      cell('grade', 'Grade', { bold: true, align: 'center' });
      cell('gp', 'GP', { bold: true, align: 'right' });
      cell('credit', 'Cr', { bold: true, align: 'right' });
      doc.moveTo(LEFT, doc.y + 12).lineTo(RIGHT, doc.y + 12).stroke();
      doc.y += 16;
    };
    let rowY = doc.y;
    header();
    for (const r of data.rows) {
      rowY = doc.y;
      cell('subject', r.subject_name);
      cell('theory', r.is_absent ? '-' : show(r.theory), { align: 'right' });
      cell('internal', r.is_absent ? '-' : show(r.internal), { align: 'right' });
      cell('total', r.is_absent ? '-' : show(r.total), { align: 'right' });
      cell('pct', r.is_absent ? '-' : show(r.percent), { align: 'right' });
      cell('grade', r.grade, { bold: true, align: 'center' });
      cell('gp', show(r.grade_point), { align: 'right' });
      cell('credit', show(r.credit_hours), { align: 'right' });
      doc.y = Math.max(doc.y, rowY + 12);
      if (r.grade === 'NG' && r.ng_reason) {
        rowY = doc.y;
        cell('subject', `  NG: ${NG_REASON_TEXT[r.ng_reason] || r.ng_reason}`);
        doc.y = rowY + 11;
      }
      if (r.is_absent) {
        rowY = doc.y;
        cell('subject', '  Absent in this examination');
        doc.y = rowY + 11;
      }
    }
    doc.moveTo(LEFT, doc.y + 2).lineTo(RIGHT, doc.y + 2).stroke();
    doc.y += 12;

    // Result
    const s = data.summary;
    doc.font('Helvetica-Bold').fontSize(10).text(`Term result: ${TERM_STATUS_LABEL[s.status] || s.label}`, LEFT, doc.y);
    doc.moveDown(0.3);
    const gpaText = s.gpa !== null
      ? `${s.gpa.toFixed(2)} (credit-weighted over ${s.credit_total} credit hours)`
      : `Not printed. ${s.status === 'incomplete' ? 'A subject is NG or absent.' : 'Credit hours are missing for a subject.'}`;
    doc.font('Helvetica').fontSize(9.5).text(`GPA: ${gpaText}`, LEFT, doc.y, { width: RIGHT - LEFT });

    // Footer block
    doc.moveDown(1.4);
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(8.5);
    doc.text(`Version: ${versions} | Date: ${nptDate(verifiedAt)}`, LEFT, doc.y, { width: RIGHT - LEFT });
    doc.text(`Publish Version ID: ${versions}`, LEFT, doc.y, { width: RIGHT - LEFT });
    doc.text(`Verification Timestamp: ${nptStamp(verifiedAt)} (NPT)`, LEFT, doc.y, { width: RIGHT - LEFT });
    doc.text(`Authorized Sign-off ID: ${signOffs}`, LEFT, doc.y, { width: RIGHT - LEFT });
    doc.text(`Published: ${data.footer.published_at.map(d => nptStamp(d) + ' (NPT)').join('; ')}`, LEFT, doc.y, { width: RIGHT - LEFT });

    doc.end();
  });
}
