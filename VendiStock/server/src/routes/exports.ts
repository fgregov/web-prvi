import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { buildPdf, pdfDate, pdfMoney, pdfQty, type PdfColumn } from '../lib/export/pdf.js';
import { buildXlsx, type XlsxColumn } from '../lib/export/xlsx.js';
import { formatLocalDate, todayLocal } from '../lib/time.js';
import { parse, zIdParams, zIsoDate } from '../lib/validate.js';
import { actorOf, editors, sendFile } from '../http/helpers.js';
import { audit } from '../modules/audit/audit.js';
import { sendEmail } from '../modules/email/mailer.js';
import { lowStockEmail } from '../modules/email/templates.js';
import { getInventoryCount } from '../modules/inventory/operations.js';
import { stockHistory, stockOverview, stockValue } from '../modules/inventory/queries.js';
import { getPurchaseOrder, recommendations } from '../modules/procurement/service.js';
import { byCategory, byMachine, comparePeriods, leastSold, summary, timeseries, topProducts } from '../modules/sales/analytics.js';
import { historyQuery } from './inventory.js';
import { filtersFrom, salesFilterQuery } from './sales.js';

const fmtParam = z.object({ format: z.enum(['xlsx', 'pdf']) });
const stamp = () => todayLocal();

export function registerExportRoutes(app: FastifyInstance, ctx: AppContext) {
  // Generički izvoz tablice iz sučelja (podaci koje korisnik već vidi)
  app.post('/api/export/xlsx', async (req, reply) => {
    const b = parse(
      z.object({
        fileName: z.string().trim().min(1).max(100),
        title: z.string().max(200).optional(),
        subtitle: z.string().max(300).optional(),
        columns: z.array(z.object({ header: z.string().max(100), key: z.string().max(100), type: z.enum(['text', 'number', 'money', 'qty', 'date', 'datetime', 'percent']).optional() })).min(1).max(60),
        rows: z.array(z.record(z.string(), z.unknown())).max(100_000),
      }),
      req.body,
    );
    const buf = await buildXlsx([{ name: b.title ?? 'Podaci', title: b.title, subtitle: b.subtitle, columns: b.columns, rows: b.rows }]);
    const name = b.fileName.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/\.xlsx$/i, '');
    return sendFile(reply, buf, `${name}.xlsx`);
  });

  // Povijest skladišta
  app.get('/api/reports/stock-history.xlsx', async (req, reply) => {
    const q = parse(historyQuery, req.query);
    const rows = stockHistory(ctx.db, { ...q, limit: 100_000 });
    const columns: XlsxColumn[] = [
      { header: 'Datum', key: 'doc_date', type: 'date', width: 12 },
      { header: 'Dokument', key: 'doc_no', width: 18 },
      { header: 'Šifra', key: 'product_code', width: 12 },
      { header: 'Artikl', key: 'product_name', width: 32 },
      { header: 'Vrsta promjene', key: 'type_label', width: 20 },
      { header: 'Ulaz', key: 'qty_in', type: 'qty', width: 10 },
      { header: 'Izlaz', key: 'qty_out', type: 'qty', width: 10 },
      { header: 'Lokacija', key: 'location_name', width: 26 },
      { header: 'Stanje nakon knjiženja', key: 'balance_after', type: 'qty', width: 14 },
      { header: 'Jed.', key: 'unit', width: 6 },
      { header: 'Napomena', key: 'note', width: 40 },
      { header: 'Unio', key: 'created_by_name', width: 16 },
    ];
    const sub = [q.from && `od ${formatLocalDate(q.from)}`, q.to && `do ${formatLocalDate(q.to)}`].filter(Boolean).join(' ');
    return sendFile(reply, await buildXlsx([{ name: 'Povijest skladišta', title: 'Povijest skladišta', subtitle: sub || 'Sva razdoblja', columns, rows }]), `povijest-skladista-${stamp()}.xlsx`);
  });

  // Stanje zaliha
  app.get('/api/reports/stock/:format', async (req, reply) => {
    const { format } = parse(fmtParam, req.params);
    const rows = stockOverview(ctx.db).map((r) => ({ ...r, value: Math.round(Number(r.central_qty) * Number(r.purchase_price) * 100) / 100 }));
    const value = stockValue(ctx.db);
    if (format === 'xlsx') {
      const columns: XlsxColumn[] = [
        { header: 'Šifra', key: 'code', width: 12 },
        { header: 'Artikl', key: 'name', width: 32 },
        { header: 'Kategorija', key: 'category_name', width: 18 },
        { header: 'Jed.', key: 'unit', width: 6 },
        { header: 'Centralno skladište', key: 'central_qty', type: 'qty' },
        { header: 'Vozila', key: 'vehicle_qty', type: 'qty' },
        { header: 'Automati', key: 'machine_qty', type: 'qty' },
        { header: 'Rezervirano', key: 'reserved_qty', type: 'qty' },
        { header: 'Minimum', key: 'min_stock', type: 'qty' },
        { header: 'Cilj', key: 'target_stock', type: 'qty' },
        { header: 'Nabavna cijena', key: 'purchase_price', type: 'money' },
        { header: 'Vrijednost (centralno)', key: 'value', type: 'money', width: 18 },
      ];
      return sendFile(reply, await buildXlsx([{ name: 'Stanje zaliha', title: 'Stanje zaliha', subtitle: `Na dan ${formatLocalDate(stamp())}`, columns, rows }]), `stanje-zaliha-${stamp()}.xlsx`);
    }
    const columns: PdfColumn[] = [
      { header: 'Šifra', key: 'code', width: 10 },
      { header: 'Artikl', key: 'name', width: 30 },
      { header: 'Centralno', key: 'central_qty', width: 11, align: 'right', format: pdfQty },
      { header: 'Vozila', key: 'vehicle_qty', width: 9, align: 'right', format: pdfQty },
      { header: 'Automati', key: 'machine_qty', width: 10, align: 'right', format: pdfQty },
      { header: 'Min.', key: 'min_stock', width: 8, align: 'right', format: pdfQty },
      { header: 'Vrijednost', key: 'value', width: 13, align: 'right', format: pdfMoney },
    ];
    const pdf = await buildPdf({
      title: 'Stanje zaliha',
      subtitle: `Na dan ${formatLocalDate(stamp())}`,
      sections: [
        { heading: 'Sažetak', keyValues: [['Vrijednost centralnog skladišta', pdfMoney(value.central)], ['Vrijednost svih lokacija', pdfMoney(value.total)], ['Broj artikala', String(rows.length)]] },
        { heading: 'Artikli', columns, rows },
      ],
    });
    return sendFile(reply, pdf, `stanje-zaliha-${stamp()}.pdf`);
  });

  // Lista za nabavu
  const procColumnsX: XlsxColumn[] = [
    { header: 'Šifra', key: 'code', width: 12 },
    { header: 'Artikl', key: 'name', width: 32 },
    { header: 'Dobavljač', key: 'supplierName', width: 24 },
    { header: 'Jed.', key: 'unit', width: 6 },
    { header: 'Trenutno stanje', key: 'stock', type: 'qty' },
    { header: 'Rezervirano', key: 'reserved', type: 'qty' },
    { header: 'Raspoloživo', key: 'available', type: 'qty' },
    { header: 'Minimalna količina', key: 'minStock', type: 'qty' },
    { header: 'Ciljana količina', key: 'targetStock', type: 'qty' },
    { header: 'Otvorene narudžbe', key: 'openOrders', type: 'qty' },
    { header: 'Pakiranje', key: 'packSize', type: 'qty' },
    { header: 'Količina za naručivanje', key: 'orderQty', type: 'qty', width: 16 },
    { header: 'Procjena vrijednosti', key: 'estimatedCost', type: 'money', width: 16 },
  ];
  app.get('/api/reports/procurement/:format', async (req, reply) => {
    const { format } = parse(fmtParam, req.params);
    const q = parse(z.object({ all: z.enum(['0', '1']).optional(), supplierId: z.coerce.number().int().positive().optional() }), req.query);
    const rows = recommendations(ctx.db, { onlyBelowMin: q.all !== '1', supplierId: q.supplierId });
    const subtitle = `Na dan ${formatLocalDate(stamp())} · Preporuka = MAX(0, ciljana − raspoloživa − otvorene narudžbe), zaokruženo na pakiranja`;
    audit(ctx.db, actorOf(req), 'procurement.export', 'procurement', null, { format, rows: rows.length });
    if (format === 'xlsx') {
      return sendFile(reply, await buildXlsx([{ name: 'Lista za nabavu', title: 'Lista za nabavu', subtitle, columns: procColumnsX, rows }]), `lista-za-nabavu-${stamp()}.xlsx`);
    }
    const columns: PdfColumn[] = [
      { header: 'Artikl', key: 'name', width: 28 },
      { header: 'Dobavljač', key: 'supplierName', width: 18, format: (v) => (v ? String(v) : '—') },
      { header: 'Stanje', key: 'stock', width: 9, align: 'right', format: pdfQty },
      { header: 'Minimum', key: 'minStock', width: 9, align: 'right', format: pdfQty },
      { header: 'Cilj', key: 'targetStock', width: 9, align: 'right', format: pdfQty },
      { header: 'Otvoreno', key: 'openOrders', width: 9, align: 'right', format: pdfQty },
      { header: 'Naručiti', key: 'orderQty', width: 10, align: 'right', format: (v, r) => `${pdfQty(v)} ${r.unit === 'kom' ? '' : String(r.unit)}`.trim() },
    ];
    return sendFile(reply, await buildPdf({ title: 'Lista za nabavu', subtitle, sections: [{ heading: `Artikli za naručivanje (${rows.length})`, columns, rows }] }), `lista-za-nabavu-${stamp()}.pdf`);
  });

  app.post('/api/procurement/email-list', { preHandler: editors }, async (req) => {
    const rows = recommendations(ctx.db, { onlyBelowMin: true });
    if (!rows.length) throw badRequest('Nema artikala ispod minimalne zalihe.');
    const msg = lowStockEmail(
      rows.map((r) => ({ name: r.name, code: r.code, unit: r.unit, available: r.available, minStock: r.minStock, orderQty: r.orderQty, supplierName: r.supplierName })),
      'reminder',
    );
    const xlsx = await buildXlsx([{ name: 'Lista za nabavu', title: 'Lista za nabavu', columns: procColumnsX, rows }]);
    const r = await sendEmail(ctx, {
      kind: 'procurement_list',
      subject: 'VendiStock – Lista za nabavu',
      text: msg.text,
      html: msg.html,
      attachments: [{ filename: `lista-za-nabavu-${stamp()}.xlsx`, content: xlsx }],
    });
    audit(ctx.db, actorOf(req), 'procurement.email', 'email_log', r.emailId, { status: r.status });
    return r;
  });

  // Narudžbenica dobavljaču
  app.get('/api/reports/purchase-order/:id/pdf', async (req, reply) => {
    const { id } = parse(zIdParams, req.params);
    const { order, lines } = getPurchaseOrder(ctx.db, id);
    const pdf = await buildPdf({
      title: `Narudžbenica ${String(order.po_no)}`,
      subtitle: `Dobavljač: ${String(order.supplier_name ?? '—')} · Datum: ${pdfDate(order.order_date)}${order.expected_date ? ` · Očekivana isporuka: ${pdfDate(order.expected_date)}` : ''}`,
      sections: [
        {
          heading: 'Stavke',
          note: order.note ? String(order.note) : undefined,
          columns: [
            { header: 'Šifra', key: 'code', width: 12 },
            { header: 'Artikl', key: 'name', width: 40 },
            { header: 'Količina', key: 'qty_ordered', width: 12, align: 'right', format: pdfQty },
            { header: 'Jed.', key: 'unit', width: 8 },
            { header: 'Cijena', key: 'unit_price', width: 12, align: 'right', format: pdfMoney },
          ],
          rows: lines as Record<string, unknown>[],
        },
      ],
    });
    return sendFile(reply, pdf, `narudzbenica-${String(order.po_no)}.pdf`);
  });

  // Inventura
  app.get('/api/reports/inventory-count/:id/xlsx', async (req, reply) => {
    const { id } = parse(zIdParams, req.params);
    const { count, lines } = getInventoryCount(ctx.db, id);
    const columns: XlsxColumn[] = [
      { header: 'Šifra', key: 'code', width: 12 },
      { header: 'Artikl', key: 'name', width: 32 },
      { header: 'Jed.', key: 'unit', width: 6 },
      { header: 'Knjigovodstveno stanje', key: 'book_qty', type: 'qty', width: 16 },
      { header: 'Trenutno stanje', key: 'current_qty', type: 'qty', width: 14 },
      { header: 'Prebrojano', key: 'counted_qty', type: 'qty', width: 12 },
      { header: 'Razlika', key: 'difference', type: 'qty', width: 10 },
    ];
    return sendFile(
      reply,
      await buildXlsx([{ name: `Inventura ${id}`, title: `Inventura #${id} – ${String(count.location_name)}`, subtitle: `Datum: ${formatLocalDate(String(count.count_date))} · Status: ${String(count.status)}`, columns, rows: lines as Record<string, unknown>[] }]),
      `inventura-${id}.xlsx`,
    );
  });

  // Analitika prodaje
  app.get('/api/reports/sales/:format', async (req, reply) => {
    const { format } = parse(fmtParam, req.params);
    const f = filtersFrom(parse(salesFilterQuery, req.query));
    const s = summary(ctx.db, f);
    const byQty = topProducts(ctx.db, f, 'qty', 100_000);
    const byRev = topProducts(ctx.db, f, 'revenue', 100_000);
    const machines = byMachine(ctx.db, f);
    const cats = byCategory(ctx.db, f);
    const daily = timeseries(ctx.db, f, 'day');
    const monthly = timeseries(ctx.db, f, 'month');
    const least = leastSold(ctx.db, f, 30);
    const subtitle = `Razdoblje ${formatLocalDate(f.from)} – ${formatLocalDate(f.to)} (Europe/Zagreb)`;
    if (format === 'xlsx') {
      const prodCols: XlsxColumn[] = [
        { header: 'Šifra', key: 'code', width: 12 },
        { header: 'Artikl', key: 'name', width: 34 },
        { header: 'Kategorija', key: 'categoryName', width: 18 },
        { header: 'Prodano (kom)', key: 'qty', type: 'qty' },
        { header: 'Prihod', key: 'revenue', type: 'money' },
        { header: 'Transakcija', key: 'transactions', type: 'number' },
        { header: 'Prosj. dnevno', key: 'avgDailyQty', type: 'qty' },
      ];
      const buf = await buildXlsx([
        {
          name: 'Sažetak',
          title: 'Analitika prodaje',
          subtitle,
          columns: [
            { header: 'Pokazatelj', key: 'k', width: 34 },
            { header: 'Vrijednost', key: 'v', width: 24 },
          ],
          rows: [
            { k: 'Ukupno prodanih jedinica', v: s.totalQty },
            { k: 'Ukupan prihod (€)', v: s.totalRevenue ?? 'nije dostupno' },
            { k: 'Broj transakcija', v: s.transactions },
            { k: 'Prosječna dnevna prodaja (jed.)', v: s.avgDailyQty },
            { k: 'Prosječan dnevni prihod (€)', v: s.avgDailyRevenue ?? 'nije dostupno' },
            { k: 'Najprodavaniji artikl (količina)', v: s.topProduct ? `${s.topProduct.name} (${s.topProduct.qty})` : '—' },
          ],
        },
        { name: 'TOP po količini', columns: prodCols, rows: byQty as unknown as Record<string, unknown>[] },
        { name: 'TOP po prihodu', columns: prodCols, rows: byRev as unknown as Record<string, unknown>[] },
        {
          name: 'Po automatima',
          columns: [
            { header: 'Automat', key: 'name', width: 30 },
            { header: 'Lokacija', key: 'location', width: 30 },
            { header: 'Prodano', key: 'qty', type: 'qty' },
            { header: 'Prihod', key: 'revenue', type: 'money' },
            { header: 'Transakcija', key: 'transactions', type: 'number' },
          ],
          rows: machines as unknown as Record<string, unknown>[],
        },
        {
          name: 'Po kategorijama',
          columns: [
            { header: 'Kategorija', key: 'name', width: 30 },
            { header: 'Prodano', key: 'qty', type: 'qty' },
            { header: 'Prihod', key: 'revenue', type: 'money' },
          ],
          rows: cats as unknown as Record<string, unknown>[],
        },
        {
          name: 'Dnevno',
          columns: [
            { header: 'Datum', key: 'period', type: 'date', width: 12 },
            { header: 'Prodano', key: 'qty', type: 'qty' },
            { header: 'Prihod', key: 'revenue', type: 'money' },
            { header: 'Transakcija', key: 'transactions', type: 'number' },
          ],
          rows: daily,
        },
        {
          name: 'Mjesečno',
          columns: [
            { header: 'Mjesec', key: 'period', width: 10 },
            { header: 'Prodano', key: 'qty', type: 'qty' },
            { header: 'Prihod', key: 'revenue', type: 'money' },
          ],
          rows: monthly,
        },
        { name: 'Najmanja prodaja', columns: prodCols, rows: least as unknown as Record<string, unknown>[] },
      ]);
      return sendFile(reply, buf, `analitika-prodaje-${f.from}-${f.to}.xlsx`);
    }
    const pc: PdfColumn[] = [
      { header: '#', key: 'rank', width: 4, align: 'right' },
      { header: 'Artikl', key: 'name', width: 40 },
      { header: 'Prodano', key: 'qty', width: 12, align: 'right', format: pdfQty },
      { header: 'Prihod', key: 'revenue', width: 14, align: 'right', format: pdfMoney },
      { header: 'Prosj./dan', key: 'avgDailyQty', width: 11, align: 'right', format: pdfQty },
    ];
    const rank = <T extends object>(arr: T[]) => arr.map((r, i) => ({ ...r, rank: i + 1 }));
    const pdf = await buildPdf({
      title: 'Analitika prodaje',
      subtitle,
      sections: [
        {
          heading: 'Sažetak',
          keyValues: [
            ['Ukupno prodanih jedinica', pdfQty(s.totalQty)],
            ['Ukupan prihod', s.totalRevenue === null ? 'nije dostupno u izvoru' : pdfMoney(s.totalRevenue)],
            ['Broj transakcija', String(s.transactions)],
            ['Prosječna dnevna prodaja', `${pdfQty(s.avgDailyQty)} jed.`],
            ['Najprodavaniji artikl (količina)', s.topProduct ? `${s.topProduct.name} – ${pdfQty(s.topProduct.qty)}` : '—'],
          ],
        },
        { heading: 'TOP 20 artikala prema količini', columns: pc, rows: rank(byQty.slice(0, 20)) },
        { heading: 'TOP 20 artikala prema prihodu', columns: pc, rows: rank(byRev.slice(0, 20)) },
        {
          heading: 'Prodaja po automatima',
          columns: [
            { header: 'Automat', key: 'name', width: 40 },
            { header: 'Prodano', key: 'qty', width: 14, align: 'right', format: pdfQty },
            { header: 'Prihod', key: 'revenue', width: 16, align: 'right', format: pdfMoney },
            { header: 'Transakcija', key: 'transactions', width: 12, align: 'right' },
          ],
          rows: machines as unknown as Record<string, unknown>[],
        },
        {
          heading: 'Prodaja po kategorijama',
          columns: [
            { header: 'Kategorija', key: 'name', width: 40 },
            { header: 'Prodano', key: 'qty', width: 14, align: 'right', format: pdfQty },
            { header: 'Prihod', key: 'revenue', width: 16, align: 'right', format: pdfMoney },
          ],
          rows: cats as unknown as Record<string, unknown>[],
        },
        {
          heading: 'Mjesečna prodaja',
          columns: [
            { header: 'Mjesec', key: 'period', width: 20 },
            { header: 'Prodano', key: 'qty', width: 14, align: 'right', format: pdfQty },
            { header: 'Prihod', key: 'revenue', width: 16, align: 'right', format: pdfMoney },
          ],
          rows: monthly,
        },
        { heading: 'Artikli s najmanjom prodajom', columns: pc, rows: rank(least) },
      ],
    });
    return sendFile(reply, pdf, `analitika-prodaje-${f.from}-${f.to}.pdf`);
  });

  app.get('/api/reports/compare/:format', async (req, reply) => {
    const { format } = parse(fmtParam, req.params);
    const q = parse(salesFilterQuery.extend({ fromA: zIsoDate, toA: zIsoDate, fromB: zIsoDate, toB: zIsoDate }), req.query);
    const common = { machineId: q.machineId, productId: q.productId, categoryId: q.categoryId };
    const c = comparePeriods(ctx.db, { from: q.fromA, to: q.toA, ...common }, { from: q.fromB, to: q.toB, ...common });
    const la = `${formatLocalDate(q.fromA)} – ${formatLocalDate(q.toA)}`;
    const lb = `${formatLocalDate(q.fromB)} – ${formatLocalDate(q.toB)}`;
    if (format === 'xlsx') {
      const buf = await buildXlsx([
        {
          name: 'Usporedba',
          title: 'Usporedba razdoblja',
          subtitle: `A: ${la} · B: ${lb}`,
          columns: [
            { header: 'Šifra', key: 'code', width: 12 },
            { header: 'Artikl', key: 'name', width: 34 },
            { header: 'Količina A', key: 'qtyA', type: 'qty' },
            { header: 'Količina B', key: 'qtyB', type: 'qty' },
            { header: 'Razlika', key: 'diff', type: 'qty' },
            { header: 'Razlika %', key: 'diffPct', type: 'percent' },
            { header: 'Prihod A', key: 'revenueA', type: 'money' },
            { header: 'Prihod B', key: 'revenueB', type: 'money' },
          ],
          rows: c.products,
        },
      ]);
      return sendFile(reply, buf, `usporedba-razdoblja.xlsx`);
    }
    const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${pdfQty(v)} %`);
    const pdf = await buildPdf({
      title: 'Usporedba razdoblja',
      subtitle: `A: ${la} · B: ${lb}`,
      sections: [
        {
          heading: 'Ukupno',
          keyValues: [
            ['Prodano A / B', `${pdfQty(c.a.totalQty)} / ${pdfQty(c.b.totalQty)} (${pct(c.qtyDiffPct)})`],
            ['Prihod A / B', `${pdfMoney(c.a.totalRevenue)} / ${pdfMoney(c.b.totalRevenue)} (${pct(c.revenueDiffPct)})`],
            ['Prosječno dnevno A / B', `${pdfQty(c.a.avgDailyQty)} / ${pdfQty(c.b.avgDailyQty)}`],
          ],
        },
        {
          heading: 'Po artiklima',
          columns: [
            { header: 'Artikl', key: 'name', width: 40 },
            { header: 'A', key: 'qtyA', width: 12, align: 'right', format: pdfQty },
            { header: 'B', key: 'qtyB', width: 12, align: 'right', format: pdfQty },
            { header: 'Razlika', key: 'diff', width: 12, align: 'right', format: pdfQty },
            { header: '%', key: 'diffPct', width: 10, align: 'right', format: pct },
          ],
          rows: c.products,
        },
      ],
    });
    return sendFile(reply, pdf, 'usporedba-razdoblja.pdf');
  });
}
