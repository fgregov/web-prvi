import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

export interface PdfColumn {
  header: string;
  key: string;
  width: number; // relativna širina
  align?: 'left' | 'right';
  format?: (v: unknown, row: Record<string, unknown>) => string;
}

export interface PdfSection {
  heading: string;
  note?: string;
  columns?: PdfColumn[];
  rows?: readonly object[];
  keyValues?: [string, string][];
}

export interface PdfReport {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
}

const PETROL = '#0f5e63';

/** PDF izvještaj (A4) s fontom koji podržava hrvatske znakove (č, ć, đ, š, ž). */
export function buildPdf(report: PdfReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: report.title, Creator: 'VendiStock' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('regular', FONT);
    doc.registerFont('bold', FONT_BOLD);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

    doc.font('bold').fontSize(16).fillColor(PETROL).text('VendiStock', left, 40);
    doc.font('regular').fontSize(8).fillColor('#64748b').text('Inventory & Sales Intelligence');
    doc.moveDown(0.8);
    doc.font('bold').fontSize(13).fillColor('#0f172a').text(report.title);
    if (report.subtitle) doc.font('regular').fontSize(9).fillColor('#475569').text(report.subtitle);
    doc.moveDown(0.6);

    for (const s of report.sections) {
      if (doc.y > bottom() - 60) doc.addPage();
      doc.font('bold').fontSize(11).fillColor(PETROL).text(s.heading, left, doc.y);
      if (s.note) doc.font('regular').fontSize(8).fillColor('#64748b').text(s.note);
      doc.moveDown(0.3);
      if (s.keyValues) {
        for (const [k, v] of s.keyValues) {
          const y = doc.y;
          doc.font('regular').fontSize(9).fillColor('#475569').text(k, left, y, { width: width * 0.45 });
          doc.font('bold').fontSize(9).fillColor('#0f172a').text(v, left + width * 0.45, y, { width: width * 0.55 });
          doc.moveDown(0.15);
        }
        doc.moveDown(0.5);
      }
      if (s.columns && s.rows) {
        const total = s.columns.reduce((n, c) => n + c.width, 0);
        const widths = s.columns.map((c) => (c.width / total) * width);
        const drawHeader = () => {
          const y = doc.y;
          doc.rect(left, y - 2, width, 16).fill(PETROL);
          let x = left;
          s.columns!.forEach((c, i) => {
            doc.font('bold').fontSize(8).fillColor('#ffffff').text(c.header, x + 3, y + 2, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
            x += widths[i];
          });
          doc.y = y + 17;
        };
        drawHeader();
        if (!s.rows.length) {
          doc.font('regular').fontSize(8).fillColor('#64748b').text('Podaci nisu dostupni.', left + 3, doc.y + 2);
          doc.moveDown(0.8);
        }
        (s.rows as Record<string, unknown>[]).forEach((r, idx) => {
          if (doc.y > bottom()) {
            doc.addPage();
            drawHeader();
          }
          const y = doc.y;
          if (idx % 2 === 1) doc.rect(left, y - 1, width, 13).fill('#f1f5f9');
          let x = left;
          s.columns!.forEach((c, i) => {
            const raw = r[c.key];
            const text = c.format ? c.format(raw, r) : raw === null || raw === undefined ? '' : String(raw);
            doc.font('regular').fontSize(7.5).fillColor('#0f172a').text(text, x + 3, y + 1, { width: widths[i] - 6, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
            x += widths[i];
          });
          doc.y = y + 13;
        });
        doc.moveDown(0.8);
      }
    }
    const range = doc.bufferedPageRange();
    const printed = new Date().toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb' });
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('regular').fontSize(7).fillColor('#94a3b8').text(
        `VendiStock · ispisano ${printed} · stranica ${i + 1} / ${range.count}`,
        left,
        doc.page.height - 30,
        { width, align: 'center', lineBreak: false },
      );
    }
    doc.end();
  });
}

const nf = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pdfQty = (v: unknown) => (v === null || v === undefined || v === '' ? '' : nf.format(Number(v)));
export const pdfMoney = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : `${mf.format(Number(v))} €`);
export const pdfDate = (v: unknown) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}.`;
  }
  return new Date(s).toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb' });
};
