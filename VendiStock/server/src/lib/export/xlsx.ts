import ExcelJS from 'exceljs';

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  type?: 'text' | 'number' | 'money' | 'qty' | 'date' | 'datetime' | 'percent';
}

export interface XlsxSheet {
  name: string;
  title?: string;
  subtitle?: string;
  columns: XlsxColumn[];
  rows: readonly object[];
}

const FMT: Record<string, string> = {
  number: '#,##0',
  money: '#,##0.00 [$€-hr-HR]',
  qty: '#,##0.###',
  date: 'dd.mm.yyyy.',
  datetime: 'dd.mm.yyyy. hh:mm',
  percent: '0.0"%"',
};

function convert(v: unknown, type?: XlsxColumn['type']): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  if ((type === 'date' || type === 'datetime') && typeof v === 'string') {
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      // Excel nema vremenske zone: upisuje se lokalno vrijeme Europe/Zagreb
      const local = new Date(d.toLocaleString('sv-SE', { timeZone: 'Europe/Zagreb' }).replace(' ', 'T') + 'Z');
      return local;
    }
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v instanceof Date) return v;
  return String(v);
}

/** Izrada Excel (XLSX) datoteke s naslovom, zaglavljem i formatima brojeva/datuma. */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VendiStock';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'List');
    let headerRowNo = 1;
    if (s.title) {
      ws.addRow([s.title]).font = { bold: true, size: 14, color: { argb: 'FF0F5E63' } };
      if (s.subtitle) ws.addRow([s.subtitle]).font = { italic: true, color: { argb: 'FF64748B' } };
      ws.addRow([]);
      headerRowNo = ws.rowCount + 1;
    }
    const header = ws.addRow(s.columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5E63' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const r of s.rows) ws.addRow(s.columns.map((c) => convert((r as Record<string, unknown>)[c.key], c.type)));
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.min(50, Math.max(10, c.header.length + 4));
      if (c.type && FMT[c.type]) col.numFmt = FMT[c.type];
    });
    ws.views = [{ state: 'frozen', ySplit: headerRowNo }];
    ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: s.columns.length } };
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
