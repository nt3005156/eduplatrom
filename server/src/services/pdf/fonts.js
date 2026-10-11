// Fonts for PDFs (receipts, marksheets).
// Latin text stays in Helvetica, so the PDF text stays searchable and the layout does not change.
// Any text run that contains Devanagari is printed in Noto Sans Devanagari instead, so Nepali names,
// school names and labels print correctly. Licence: SIL Open Font License 1.1 (assets/fonts/OFL.txt).
// The static Regular and Bold files were made from the Google Fonts variable font (wght 400 and 700) with fontTools.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(here, '../../../assets/fonts');
const NOTO = 'Noto';
const NOTO_BOLD = 'Noto-Bold';
const DEVANAGARI = /[\u0900-\u097F]/;

/**
 * Registers the Noto faces on a PDFKit document and makes doc.text() switch to them for Devanagari runs.
 * Call it once, right after creating the document. Throws if the font files are missing.
 */
export function registerPdfFonts(doc) {
  const regular = path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf');
  const bold = path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf');
  for (const f of [regular, bold]) {
    if (!fs.existsSync(f)) throw new Error(`PDF font missing: ${f}`);
  }
  doc.registerFont(NOTO, regular);
  doc.registerFont(NOTO_BOLD, bold);

  // Remember the font the caller asked for, so it can be restored after a Devanagari run.
  let requested = 'Helvetica';
  const originalFont = doc.font.bind(doc);
  const originalText = doc.text.bind(doc);
  doc.font = (name, ...rest) => {
    if (typeof name === 'string' && name.startsWith('Helvetica')) requested = name;
    return originalFont(name, ...rest);
  };
  doc.text = (str, ...rest) => {
    if (typeof str !== 'string' || !DEVANAGARI.test(str)) return originalText(str, ...rest);
    const bold = requested.endsWith('-Bold');
    originalFont(bold ? NOTO_BOLD : NOTO);
    try {
      return originalText(str, ...rest);
    } finally {
      originalFont(requested);
    }
  };
  return doc;
}
