// IZVJEŠTAJI → PDF (A4, portrait). The same Report the page shows, laid out
// for print: header (RENVARA, report, period, when it was generated), the
// applied filters, key figures, charts drawn in the PDF itself, tables that
// continue on the next page with their header repeated, notes, and a footer
// (RENVARA CRM, page X of Y) on every page. Numbers are right-aligned; long
// text wraps inside its column and never leaves the page.
import {
  A4,
  decodePng,
  PdfWriter,
  rgb,
  type PdfPage,
  type Rgb,
  type Zlib,
} from './pdf/pdf-writer.ts';
import type { TrueTypeFont } from './pdf/truetype.ts';
import type { Report, ReportChart, ReportTable } from './report-engine.ts';

export interface PdfResources {
  readonly fonts: { readonly regular: TrueTypeFont; readonly bold: TrueTypeFont };
  /** The Renvara logo (PNG); the header shows the name alone without it. */
  readonly logo: Uint8Array | null;
  readonly zlib: Zlib;
}

const C = {
  ink: rgb('#111111'),
  text: rgb('#2b2b2b'),
  muted: rgb('#6b6b6b'),
  line: rgb('#dcdcdc'),
  soft: rgb('#f5f5f5'),
  group: rgb('#f0f0f0'),
  red: rgb('#e32222'),
  redSoft: rgb('#fdecec'),
  green: rgb('#16794a'),
  greenSoft: rgb('#e8f4ed'),
  bar: rgb('#bdbdbd'),
  white: rgb('#ffffff'),
} as const;

const MARGIN = 40;
const TOP = 40;
const FOOTER = 46; // space kept for the footer
const WIDTH = A4.width - 2 * MARGIN;
const BOTTOM = A4.height - FOOTER;

const toneFill = (tone: string | undefined): Rgb =>
  tone === 'won' ? C.green : tone === 'lost' ? C.red : tone === 'highlight' ? C.red : C.bar;

export async function renderReportPdf(report: Report, res: PdfResources): Promise<Uint8Array> {
  const doc = new PdfWriter(res.fonts, res.zlib, {
    title: `RENVARA CRM — ${report.title} — ${report.period.label}`,
    subject: report.title,
    creator: 'RENVARA CRM · Izvještaji',
    createdAt: new Date(report.generatedAt),
  });
  let hasLogo = false;
  if (res.logo) {
    try {
      doc.addImage('Logo', await decodePng(res.logo, res.zlib));
      hasLogo = true;
    } catch {
      // Without the image the header still says RENVARA.
    }
  }

  /** Lines of `text` that fit `width` (words kept whole unless one alone is too long). */
  function wrap(text: string, size: number, width: number, font: 'regular' | 'bold' = 'regular') {
    const lines: string[] = [];
    for (const paragraph of String(text).split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (doc.widthOf(candidate, size, font) <= width) {
          current = candidate;
          continue;
        }
        if (current) lines.push(current);
        if (doc.widthOf(word, size, font) <= width) current = word;
        else {
          let piece = '';
          for (const ch of word) {
            if (doc.widthOf(piece + ch, size, font) > width && piece) {
              lines.push(piece);
              piece = ch;
            } else piece += ch;
          }
          current = piece;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  /** At most `max` lines; the last one ends with "…" when text was cut. */
  function clamp(
    lines: string[],
    max: number,
    size: number,
    width: number,
    font: 'regular' | 'bold',
  ) {
    if (lines.length <= max) return lines;
    const kept = lines.slice(0, max);
    let last = kept[max - 1]!;
    while (last && doc.widthOf(`${last}…`, size, font) > width) last = last.slice(0, -1);
    kept[max - 1] = `${last}…`;
    return kept;
  }

  let page: PdfPage = doc.addPage();
  let y = TOP;

  function firstHeader() {
    let x = MARGIN;
    if (hasLogo) {
      page.image('Logo', MARGIN, y, 26, 30);
      x += 34;
    }
    page.text(x, y + 14, 'RENVARA', { font: 'bold', size: 18, color: C.red });
    page.text(x, y + 27, 'CRM · Izvještaji', { size: 8.5, color: C.muted });
    page.text(A4.width - MARGIN, y + 12, `Generirano: ${report.generatedLabel}`, {
      size: 8.5,
      color: C.muted,
      align: 'right',
    });
    page.text(A4.width - MARGIN, y + 24, `Vremenska zona: ${report.timeZone}`, {
      size: 8.5,
      color: C.muted,
      align: 'right',
    });
    y += 38;
    page.rect(MARGIN, y, WIDTH, 2, { fill: C.red });
    y += 22;
    for (const line of wrap(report.title.toUpperCase(), 18, WIDTH, 'bold')) {
      page.text(MARGIN, y, line, { font: 'bold', size: 18, color: C.ink });
      y += 22;
    }
    page.text(MARGIN, y, `Razdoblje: ${report.period.label}`, { size: 11, color: C.text });
    y += 10;
  }

  function continuationHeader() {
    page.text(MARGIN, y + 10, 'RENVARA', { font: 'bold', size: 10, color: C.red });
    page.text(MARGIN + 58, y + 10, `${report.title} · ${report.period.label}`, {
      size: 9,
      color: C.muted,
    });
    y += 18;
    page.line(MARGIN, y, A4.width - MARGIN, y, C.line, 0.75);
    y += 14;
  }

  function newPage() {
    page = doc.addPage();
    y = TOP;
    continuationHeader();
  }

  /** Makes room for `height` points, on a new page when needed. */
  function need(height: number) {
    if (y + height > BOTTOM) newPage();
  }

  function sectionTitle(title: string) {
    need(40);
    y += 14;
    page.text(MARGIN, y, title, { font: 'bold', size: 12, color: C.ink });
    y += 10;
  }

  // ---------------------------------------------------------- filters ---
  function filters() {
    const size = 9;
    const labelWidth = 125;
    const lines = report.filters.map((f) => ({
      label: `${f.label}:`,
      value: clamp(
        wrap(f.value, size, WIDTH - labelWidth - 20),
        2,
        size,
        WIDTH - labelWidth - 20,
        'regular',
      ),
    }));
    const height = 10 + lines.reduce((h, l) => h + l.value.length * 12, 0);
    y += 10;
    need(height + 18);
    page.text(MARGIN, y + 2, 'PRIMIJENJENI FILTERI', { font: 'bold', size: 8, color: C.muted });
    y += 8;
    page.rect(MARGIN, y, WIDTH, height, { fill: C.soft });
    let ly = y + 15;
    for (const l of lines) {
      page.text(MARGIN + 10, ly, l.label, { font: 'bold', size, color: C.text });
      for (const v of l.value) {
        page.text(MARGIN + 10 + labelWidth, ly, v, { size, color: C.text });
        ly += 12;
      }
    }
    y += height;
  }

  // ---------------------------------------------------------- summary ---
  function summary() {
    const perRow = report.summary.length === 4 ? 4 : 3;
    const gap = 8;
    const tileWidth = (WIDTH - gap * (perRow - 1)) / perRow;
    y += 14;
    for (let i = 0; i < report.summary.length; i += perRow) {
      const row = report.summary.slice(i, i + perRow);
      const tiles = row.map((item) => {
        const label = clamp(
          wrap(item.label, 8.5, tileWidth - 16),
          2,
          8.5,
          tileWidth - 16,
          'regular',
        );
        let valueSize = 15;
        while (valueSize > 9 && doc.widthOf(item.display, valueSize, 'bold') > tileWidth - 16) {
          valueSize -= 0.5;
        }
        const hint = item.hint
          ? clamp(wrap(item.hint, 7.5, tileWidth - 16), 1, 7.5, tileWidth - 16, 'regular')
          : [];
        return { item, label, valueSize, hint };
      });
      const height = Math.max(
        ...tiles.map((t) => 14 + t.label.length * 11 + 22 + t.hint.length * 10),
      );
      need(height + gap);
      tiles.forEach((t, k) => {
        const x = MARGIN + k * (tileWidth + gap);
        const accent = t.item.tone === 'won' ? C.green : t.item.tone === 'lost' ? C.red : C.ink;
        page.rect(x, y, tileWidth, height, { fill: C.white, stroke: C.line, lineWidth: 0.75 });
        page.rect(x, y, 3, height, { fill: accent });
        let ty = y + 14;
        for (const l of t.label) {
          page.text(x + 10, ty, l, { size: 8.5, color: C.muted });
          ty += 11;
        }
        page.text(x + 10, ty + 12, t.item.display, {
          font: 'bold',
          size: t.valueSize,
          color: accent,
        });
        ty += 24;
        for (const l of t.hint) {
          page.text(x + 10, ty, l, { size: 7.5, color: C.muted });
          ty += 10;
        }
      });
      y += height + gap;
    }
  }

  // ----------------------------------------------------------- charts ---
  function columnsChart(chart: ReportChart) {
    const height = 170;
    sectionTitle(chart.title);
    need(height + 10);
    const top = y + 8;
    const chartHeight = 110;
    const baseline = top + 18 + chartHeight;
    const max = Math.max(...chart.items.map((i) => i.value), 0);
    const slot = WIDTH / chart.items.length;
    const barWidth = Math.min(70, slot * 0.5);
    page.line(MARGIN, baseline, A4.width - MARGIN, baseline, C.line, 1);
    chart.items.forEach((item, k) => {
      const cx = MARGIN + slot * k + slot / 2;
      const h = max > 0 ? (item.value / max) * chartHeight : 0;
      if (h > 0) {
        page.rect(cx - barWidth / 2, baseline - h, barWidth, h, { fill: toneFill(item.tone) });
      }
      page.text(cx, baseline - h - 5, item.display, {
        size: 8,
        color: C.text,
        align: 'center',
        font: 'bold',
      });
      page.text(cx, baseline + 14, item.label, {
        size: 9.5,
        color: C.ink,
        align: 'center',
        font: 'bold',
      });
    });
    if (max === 0) {
      page.text(MARGIN + WIDTH / 2, top + 60, 'Nema prihoda za prikaz.', {
        size: 9,
        color: C.muted,
        align: 'center',
      });
    }
    y = baseline + 26;
  }

  function barsChart(chart: ReportChart) {
    sectionTitle(chart.title);
    const labelWidth = 150;
    const valueWidth = 120;
    const barArea = WIDTH - labelWidth - valueWidth - 10;
    const max = Math.max(...chart.items.map((i) => i.value), 0);
    y += 6;
    for (const item of chart.items) {
      need(20);
      const label =
        clamp(wrap(item.label, 9, labelWidth - 6), 1, 9, labelWidth - 6, 'regular')[0] ?? '';
      page.text(MARGIN, y + 11, label, { size: 9, color: C.text });
      page.rect(MARGIN + labelWidth, y + 2, barArea, 12, { fill: C.soft });
      const w = max > 0 ? Math.max((item.value / max) * barArea, item.value > 0 ? 2 : 0) : 0;
      if (w > 0) page.rect(MARGIN + labelWidth, y + 2, w, 12, { fill: toneFill(item.tone) });
      page.text(A4.width - MARGIN, y + 11, item.display, {
        size: 9,
        color: C.ink,
        align: 'right',
        font: 'bold',
      });
      y += 19;
    }
    if (chart.items.length === 0) {
      page.text(MARGIN, y + 10, 'Nema podataka za prikaz.', { size: 9, color: C.muted });
      y += 18;
    }
    y += 6;
  }

  // ----------------------------------------------------------- tables ---
  function table(t: ReportTable) {
    const size = 8.5;
    const lineHeight = 11;
    const pad = 5;
    const widths = t.columns.map((c) => c.width * WIDTH);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

    const headerLines = t.columns.map((c, i) =>
      clamp(wrap(c.label, 8, widths[i]! - 2 * pad, 'bold'), 2, 8, widths[i]! - 2 * pad, 'bold'),
    );
    const headerHeight = Math.max(...headerLines.map((l) => l.length)) * 10 + 2 * pad + 2;

    function header(continued: boolean) {
      if (continued) {
        page.text(MARGIN, y + 4, `${t.title} (nastavak)`, {
          font: 'bold',
          size: 9,
          color: C.muted,
        });
        y += 10;
      }
      page.rect(MARGIN, y, WIDTH, headerHeight, { fill: C.ink });
      t.columns.forEach((c, i) => {
        let ly = y + pad + 9;
        for (const l of headerLines[i]!) {
          const x = c.align === 'right' ? xs[i]! + widths[i]! - pad : xs[i]! + pad;
          page.text(x, ly, l, { font: 'bold', size: 8, color: C.white, align: c.align });
          ly += 10;
        }
      });
      y += headerHeight;
    }

    sectionTitle(t.title);
    if (t.rows.length === 0) {
      need(40);
      y += 4;
      page.rect(MARGIN, y, WIDTH, 34, { fill: C.soft, stroke: C.line, lineWidth: 0.75 });
      page.text(MARGIN + WIDTH / 2, y + 21, t.empty, {
        size: 9.5,
        color: C.muted,
        align: 'center',
      });
      y += 40;
      return;
    }
    need(headerHeight + 40);
    y += 4;
    header(false);
    let zebra = false;
    for (const row of t.rows) {
      const font: 'regular' | 'bold' =
        row.kind === 'row' || row.kind === 'muted' ? 'regular' : 'bold';
      const cells = row.cells.map((cell, i) => {
        const indent = i === 0 && row.indent ? 10 : 0;
        const inner = widths[i]! - 2 * pad - indent;
        return clamp(wrap(cell, size, inner, font), 3, size, inner, font);
      });
      const height = Math.max(...cells.map((l) => l.length)) * lineHeight + 2 * pad - 1;
      if (y + height > BOTTOM) {
        newPage();
        header(true);
        zebra = false;
      }
      const fill =
        row.kind === 'group' ? C.group : row.kind === 'total' ? C.redSoft : zebra ? C.soft : null;
      if (fill) page.rect(MARGIN, y, WIDTH, height, { fill });
      if (row.kind === 'total') page.line(MARGIN, y, A4.width - MARGIN, y, C.red, 1);
      const textColor = row.kind === 'muted' ? C.muted : row.kind === 'total' ? C.ink : C.text;
      cells.forEach((lines, i) => {
        const c = t.columns[i]!;
        const indent = i === 0 && row.indent ? 10 : 0;
        let ly = y + pad + 8;
        for (const l of lines) {
          const x = c.align === 'right' ? xs[i]! + widths[i]! - pad : xs[i]! + pad + indent;
          page.text(x, ly, l, { font, size, color: textColor, align: c.align });
          ly += lineHeight;
        }
      });
      y += height;
      page.line(MARGIN, y, A4.width - MARGIN, y, C.line, 0.4);
      zebra = row.kind === 'row' ? !zebra : false;
    }
    y += 6;
  }

  function notes() {
    if (!report.notes.length) return;
    sectionTitle('Napomene');
    y += 4;
    for (const note of report.notes) {
      const lines = wrap(note, 8, WIDTH - 12);
      need(lines.length * 10 + 4);
      page.text(MARGIN, y + 7, '•', { size: 8, color: C.muted });
      for (const l of lines) {
        page.text(MARGIN + 10, y + 7, l, { size: 8, color: C.muted });
        y += 10;
      }
      y += 3;
    }
  }

  // --------------------------------------------------------- the pages ---
  firstHeader();
  filters();
  if (report.empty) {
    y += 12;
    need(40);
    page.rect(MARGIN, y, WIDTH, 30, { fill: C.redSoft });
    page.text(
      MARGIN + 12,
      y + 19,
      'Za odabrano razdoblje i odabrane filtre nema zaključenih prilika.',
      {
        size: 9.5,
        color: C.red,
      },
    );
    y += 30;
  }
  summary();
  for (const chart of report.charts) {
    if (chart.kind === 'columns') columnsChart(chart);
    else barsChart(chart);
  }
  for (const t of report.tables) table(t);
  notes();

  // Footer on every page, now that the number of pages is known.
  const total = doc.pages.length;
  doc.pages.forEach((p, i) => {
    const fy = A4.height - 28;
    p.line(MARGIN, fy - 10, A4.width - MARGIN, fy - 10, C.line, 0.75);
    p.text(MARGIN, fy, 'RENVARA CRM', { font: 'bold', size: 8, color: C.red });
    p.text(MARGIN + 64, fy, report.title, { size: 8, color: C.muted });
    p.text(A4.width - MARGIN, fy, `Stranica ${i + 1} od ${total}`, {
      size: 8,
      color: C.muted,
      align: 'right',
    });
  });
  return doc.bytes();
}
