import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';

export type Cell = string | number | Date | boolean | null;

export interface ParsedReport {
  format: 'csv' | 'xlsx' | 'table';
  encoding?: string;
  delimiter?: string;
  sheetName?: string;
  rows: Cell[][];
}

function isUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Dekodira CSV: UTF-8 (s ili bez BOM-a), UTF-16 ili Windows-1250 (čest za hrvatske izvoze iz Excela). */
export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8-bom' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: iconv.decode(buf.subarray(2), 'utf16le'), encoding: 'utf-16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: iconv.decode(buf.subarray(2), 'utf16be'), encoding: 'utf-16be' };
  if (isUtf8(buf)) return { text: buf.toString('utf8'), encoding: 'utf-8' };
  return { text: iconv.decode(buf, 'win1250'), encoding: 'windows-1250' };
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const cands = [';', ',', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseCsvBuffer(buf: Buffer): ParsedReport {
  const { text, encoding } = decodeText(buf);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as string[][];
  return { format: 'csv', encoding, delimiter, rows };
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v);
}

export async function parseXlsxBuffer(buf: Buffer): Promise<ParsedReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) return { format: 'xlsx', rows: [] };
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const out: Cell[] = [];
    for (let c = 1; c < values.length; c++) out.push(cellValue(values[c]));
    if (out.some((x) => x !== null && x !== '')) rows.push(out);
  });
  return { format: 'xlsx', sheetName: ws.name, rows };
}

/** Prepoznaje format prema sadržaju (XLSX je ZIP arhiva), a ne samo prema nastavku naziva. */
export async function parseReportFile(buf: Buffer, fileName: string): Promise<ParsedReport> {
  if (buf.length === 0) throw new Error('Datoteka izvještaja je prazna.');
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) return parseXlsxBuffer(buf);
  if (/\.xls$/i.test(fileName) && buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new Error('Stari Excel format (.xls) nije podržan. Izvezite podatke kao CSV ili XLSX.');
  }
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    // Neki portali „Excel” izvoz šalju kao HTML tablicu – ne pogađamo strukturu, nego javljamo.
    throw new Error('Datoteka je HTML stranica, a ne CSV/XLSX izvoz. Provjerite postavke izvoza ili istek sesije.');
  }
  return parseCsvBuffer(buf);
}
