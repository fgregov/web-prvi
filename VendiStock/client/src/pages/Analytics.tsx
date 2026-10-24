import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, GitCompareArrows } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CompareBarChart, RankBarChart, SalesTimeChart, periodLabel } from '../components/Charts';
import { DataTable, type Column } from '../components/DataTable';
import { DateRangePicker, ProductPicker, rangeFor, type Range } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, KpiCard, PageHeader, QueryError, Select, Spinner, Tabs } from '../components/ui';
import { api, download, qs } from '../lib/api';
import { addDaysIso, fmtDate, fmtDec1, fmtMoney, fmtNum, todayIso } from '../lib/format';
import type { Category, Machine, Product, ProductSales, SeriesPoint } from '../lib/types';

interface Summary {
  hasData: boolean;
  totalQty: number;
  totalRevenue: number | null;
  revenueCoverage: number;
  transactions: number;
  days: number;
  avgDailyQty: number;
  avgDailyRevenue: number | null;
  machines: number;
  products: number;
  topProduct: { name: string; qty: number } | null;
}

interface Report {
  hasAnySales: boolean;
  summary: Summary;
  topByQty: ProductSales[];
  topByRevenue: ProductSales[];
  byMachine: { machineId: number | null; name: string; location: string | null; qty: number; revenue: number | null; transactions: number }[];
  byCategory: { categoryId: number | null; name: string; qty: number; revenue: number | null; transactions: number }[];
  daily: SeriesPoint[];
  monthly: SeriesPoint[];
  leastSold: ProductSales[];
  granularity: 'day' | 'month';
}

type Tab = 'qty' | 'revenue' | 'machines' | 'categories' | 'time' | 'least' | 'compare';

const productCols = (metric: 'qty' | 'revenue'): Column<ProductSales>[] => [
  { key: 'rank', header: '#', sortable: false, exportable: false, render: () => null },
  {
    key: 'name',
    header: 'Artikl',
    render: (p) => (
      <div>
        <span className="font-medium text-slate-900">{p.name}</span>
        {!p.mapped && <Badge color="yellow">nepovezan</Badge>}
      </div>
    ),
  },
  { key: 'code', header: 'Šifra', render: (p) => p.code ?? '—' },
  { key: 'categoryName', header: 'Kategorija', render: (p) => p.categoryName ?? '—' },
  { key: 'qty', header: 'Prodano (jed.)', align: 'right', exportType: 'qty', render: (p) => <span className={metric === 'qty' ? 'font-semibold' : ''}>{fmtNum(p.qty)}</span> },
  { key: 'revenue', header: 'Prihod', align: 'right', exportType: 'money', render: (p) => <span className={metric === 'revenue' ? 'font-semibold' : ''}>{fmtMoney(p.revenue)}</span> },
  { key: 'transactions', header: 'Transakcija', align: 'right', exportType: 'number' },
  { key: 'avgDailyQty', header: 'Prosječno dnevno', align: 'right', exportType: 'qty', render: (p) => fmtDec1(p.avgDailyQty) },
];

export default function Analytics() {
  const toast = useToast();
  const [range, setRange] = useState<Range>(rangeFor(30));
  const [machineId, setMachineId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('qty');
  const filters = { ...range, machineId, categoryId, productId };
  const q = useQuery({ queryKey: ['analytics', filters], queryFn: () => api.get<Report>(`/api/analytics/report${qs(filters)}`), placeholderData: (p) => p });
  const machines = useQuery({ queryKey: ['machines-list'], queryFn: () => api.get<{ machines: Machine[] }>('/api/machines') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const r = q.data;
  const s = r?.summary;
  const withRank = (rows: ProductSales[]) => rows.map((x, i) => ({ ...x, _rank: i + 1 }));
  const rankCol = (cols: Column<ProductSales>[]): Column<ProductSales & { _rank?: number }>[] =>
    cols.map((c) => (c.key === 'rank' ? { ...c, render: (p: ProductSales & { _rank?: number }) => <span className="tabular text-slate-500">{p._rank}</span> } : c));

  const exportReport = (format: 'xlsx' | 'pdf') => download(`/api/reports/sales/${format}${qs(filters)}`).catch((e) => toast.error(e));

  return (
    <div>
      <PageHeader
        title="Analitika prodaje"
        subtitle="Najprodavaniji proizvod određuje se prema broju prodanih jedinica; prihod je zaseban kriterij"
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => void exportReport('xlsx')} disabled={!r?.hasAnySales}>
              Excel
            </Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => void exportReport('pdf')} disabled={!r?.hasAnySales}>
              PDF
            </Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="h-9 w-52 py-1">
          <option value="">Svi automati</option>
          {machines.data?.machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-48 py-1">
          <option value="">Sve kategorije</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <ProductPicker products={products.data} value={productId} onChange={setProductId} placeholder="Svi artikli" onlyActive={false} className="w-64" />
        {(machineId || categoryId || productId) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMachineId('');
              setCategoryId('');
              setProductId(null);
            }}
          >
            Poništi filtre
          </Button>
        )}
      </div>
      {q.isError && !r ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !r ? (
        <Spinner />
      ) : !r.hasAnySales ? (
        <EmptyState icon={<BarChart3 className="h-10 w-10" />} title="Podaci nisu dostupni">
          Još nema preuzetih podataka o prodaji. Prodaja se preuzima iz Televend Clouda (Postavke → Televend Cloud) ili ručnim uvozom izvezene datoteke (Postavke → Uvoz datoteke).
        </EmptyState>
      ) : (
        <div className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Prodano jedinica" value={fmtNum(s!.totalQty)} sub={`${fmtNum(s!.transactions)} transakcija`} icon={<BarChart3 className="h-4 w-4" />} />
            <KpiCard
              label="Prihod"
              value={s!.totalRevenue !== null ? fmtMoney(s!.totalRevenue) : 'Podaci nisu dostupni'}
              sub={s!.totalRevenue !== null && s!.revenueCoverage < 1 ? `Cijena poznata za ${Math.round(s!.revenueCoverage * 100)} % transakcija` : 'Iz preuzetih izvještaja'}
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <KpiCard label="Prosječna dnevna prodaja" value={`${fmtDec1(s!.avgDailyQty)} jed.`} sub={s!.avgDailyRevenue !== null ? `${fmtMoney(s!.avgDailyRevenue)} dnevno · ${s!.days} dana` : `${s!.days} dana`} icon={<BarChart3 className="h-4 w-4" />} />
            <KpiCard label="Najprodavaniji artikl" value={s!.topProduct?.name ?? '—'} sub={s!.topProduct ? `${fmtNum(s!.topProduct.qty)} jedinica` : undefined} icon={<BarChart3 className="h-4 w-4" />} />
          </div>
          <div className="mt-6">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'qty', label: 'TOP po količini' },
                { key: 'revenue', label: 'TOP po prihodu' },
                { key: 'machines', label: 'Po automatima' },
                { key: 'categories', label: 'Po kategorijama' },
                { key: 'time', label: 'Dnevno / mjesečno' },
                { key: 'least', label: 'Najmanja prodaja' },
                { key: 'compare', label: 'Usporedba razdoblja' },
              ]}
            />
            {tab === 'qty' && (
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
                <Card className="2xl:col-span-2" title="TOP 10 prema količini" subtitle="Prodane jedinice">
                  <RankBarChart rows={r.topByQty.slice(0, 10).map((p) => ({ name: p.name, value: p.qty }))} metric="qty" />
                </Card>
                <Card className="2xl:col-span-3" title="Najprodavaniji artikli prema količini">
                  <DataTable rows={withRank(r.topByQty)} rowKey={(p) => p.key} columns={rankCol(productCols('qty'))} exportName="top-po-kolicini" pageSize={10} />
                </Card>
              </div>
            )}
            {tab === 'revenue' && (
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
                <Card className="2xl:col-span-2" title="TOP 10 prema prihodu" subtitle="Prihod u eurima">
                  {r.topByRevenue.some((p) => p.revenue !== null) ? (
                    <RankBarChart rows={r.topByRevenue.filter((p) => p.revenue !== null).slice(0, 10).map((p) => ({ name: p.name, value: p.revenue ?? 0 }))} metric="revenue" />
                  ) : (
                    <EmptyState title="Prihod nije dostupan u preuzetim podacima" />
                  )}
                </Card>
                <Card className="2xl:col-span-3" title="Najprodavaniji artikli prema prihodu">
                  <DataTable rows={withRank(r.topByRevenue)} rowKey={(p) => p.key} columns={rankCol(productCols('revenue'))} exportName="top-po-prihodu" pageSize={10} />
                </Card>
              </div>
            )}
            {tab === 'machines' && (
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
                <Card title="Prodaja po automatima" subtitle="Prodane jedinice">
                  <RankBarChart rows={r.byMachine.slice(0, 15).map((m) => ({ name: m.name, value: m.qty }))} metric="qty" />
                </Card>
                <Card title="Tablica po automatima">
                  <DataTable
                    rows={r.byMachine}
                    rowKey={(m) => String(m.machineId)}
                    exportName="prodaja-po-automatima"
                    columns={[
                      { key: 'name', header: 'Automat', render: (m) => <span className="font-medium">{m.name}</span> },
                      { key: 'location', header: 'Lokacija', render: (m) => m.location ?? '—' },
                      { key: 'qty', header: 'Prodano', align: 'right', exportType: 'qty', render: (m) => fmtNum(m.qty) },
                      { key: 'revenue', header: 'Prihod', align: 'right', exportType: 'money', render: (m) => fmtMoney(m.revenue) },
                      { key: 'transactions', header: 'Transakcija', align: 'right' },
                    ]}
                  />
                </Card>
              </div>
            )}
            {tab === 'categories' && (
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
                <Card title="Prodaja po kategorijama" subtitle="Prodane jedinice; nepovezani Televend artikli nemaju kategoriju">
                  <RankBarChart rows={r.byCategory.map((c) => ({ name: c.name, value: c.qty }))} metric="qty" />
                </Card>
                <Card title="Tablica po kategorijama">
                  <DataTable
                    rows={r.byCategory}
                    rowKey={(c) => c.name}
                    exportName="prodaja-po-kategorijama"
                    columns={[
                      { key: 'name', header: 'Kategorija', render: (c) => <span className="font-medium">{c.name}</span> },
                      { key: 'qty', header: 'Prodano', align: 'right', exportType: 'qty', render: (c) => fmtNum(c.qty) },
                      { key: 'revenue', header: 'Prihod', align: 'right', exportType: 'money', render: (c) => fmtMoney(c.revenue) },
                      { key: 'transactions', header: 'Transakcija', align: 'right' },
                    ]}
                  />
                </Card>
              </div>
            )}
            {tab === 'time' && <TimeTab daily={r.daily} monthly={r.monthly} />}
            {tab === 'least' && (
              <Card title="Artikli s najmanjom prodajom" subtitle="Uključuje povezane aktivne artikle bez ijedne prodaje u razdoblju">
                <DataTable rows={withRank(r.leastSold)} rowKey={(p) => p.key} columns={rankCol(productCols('qty'))} exportName="najmanja-prodaja" />
              </Card>
            )}
            {tab === 'compare' && <Compare common={{ machineId, categoryId, productId }} />}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeTab({ daily, monthly }: { daily: SeriesPoint[]; monthly: SeriesPoint[] }) {
  const [gran, setGran] = useState<'day' | 'month'>(daily.length > 92 ? 'month' : 'day');
  const [metric, setMetric] = useState<'qty' | 'revenue'>('qty');
  const data = gran === 'day' ? daily : monthly;
  return (
    <div className="space-y-6">
      <Card
        title={gran === 'day' ? 'Dnevna prodaja' : 'Mjesečna prodaja'}
        subtitle={metric === 'qty' ? 'Prodane jedinice' : 'Prihod'}
        actions={
          <>
            <Select value={gran} onChange={(e) => setGran(e.target.value as 'day')} className="h-8 w-32 py-0 text-xs">
              <option value="day">Dnevno</option>
              <option value="month">Mjesečno</option>
            </Select>
            <Select value={metric} onChange={(e) => setMetric(e.target.value as 'qty')} className="h-8 w-32 py-0 text-xs">
              <option value="qty">Količina</option>
              <option value="revenue">Prihod</option>
            </Select>
          </>
        }
      >
        <SalesTimeChart data={data} metric={metric} height={300} />
      </Card>
      <Card title="Tablični prikaz">
        <DataTable
          rows={[...data].reverse()}
          rowKey={(p) => p.period}
          exportName={gran === 'day' ? 'dnevna-prodaja' : 'mjesecna-prodaja'}
          columns={[
            { key: 'period', header: gran === 'day' ? 'Datum' : 'Mjesec', exportType: gran === 'day' ? 'date' : 'text', render: (p) => (gran === 'day' ? fmtDate(p.period) : periodLabel(p.period)) },
            { key: 'qty', header: 'Prodano', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.qty) },
            { key: 'revenue', header: 'Prihod', align: 'right', exportType: 'money', render: (p) => fmtMoney(p.revenue) },
            { key: 'transactions', header: 'Transakcija', align: 'right' },
          ]}
        />
      </Card>
    </div>
  );
}

interface CompareData {
  a: Summary;
  b: Summary;
  qtyDiff: number;
  qtyDiffPct: number | null;
  revenueDiff: number | null;
  revenueDiffPct: number | null;
  products: { key: string; name: string; code: string | null; qtyA: number; qtyB: number; diff: number; diffPct: number | null; revenueA: number | null; revenueB: number | null }[];
}

function Compare({ common }: { common: { machineId: string; categoryId: string; productId: number | null } }) {
  const toast = useToast();
  const today = todayIso();
  const [a, setA] = useState<Range>({ from: addDaysIso(today, -29), to: today });
  const [b, setB] = useState<Range>({ from: addDaysIso(today, -59), to: addDaysIso(today, -30) });
  const params = { fromA: a.from, toA: a.to, fromB: b.from, toB: b.to, ...common };
  const q = useQuery({ queryKey: ['compare', params], queryFn: () => api.get<CompareData>(`/api/analytics/compare${qs(params)}`) });
  const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v)} %`);
  const labelA = `A: ${fmtDate(a.from)} – ${fmtDate(a.to)}`;
  const labelB = `B: ${fmtDate(b.from)} – ${fmtDate(b.to)}`;
  const chartRows = useMemo(() => (q.data?.products ?? []).slice(0, 12).map((p) => ({ name: p.name, a: p.qtyA, b: p.qtyB })), [q.data]);
  return (
    <div className="space-y-6">
      <Card
        title="Usporedba dvaju razdoblja"
        actions={
          <>
            <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`/api/reports/compare/xlsx${qs(params)}`).catch((e) => toast.error(e))}>
              Excel
            </Button>
            <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => download(`/api/reports/compare/pdf${qs(params)}`).catch((e) => toast.error(e))}>
              PDF
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#0a9d95' }} /> Razdoblje A
            </div>
            <div className="flex gap-2">
              <Field label="Od" className="flex-1">
                <Input type="date" value={a.from} max={a.to} onChange={(e) => setA({ ...a, from: e.target.value })} />
              </Field>
              <Field label="Do" className="flex-1">
                <Input type="date" value={a.to} min={a.from} onChange={(e) => setA({ ...a, to: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#eb6834' }} /> Razdoblje B
            </div>
            <div className="flex gap-2">
              <Field label="Od" className="flex-1">
                <Input type="date" value={b.from} max={b.to} onChange={(e) => setB({ ...b, from: e.target.value })} />
              </Field>
              <Field label="Do" className="flex-1">
                <Input type="date" value={b.to} min={b.from} onChange={(e) => setB({ ...b, to: e.target.value })} />
              </Field>
            </div>
          </div>
        </div>
        {q.data && (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Prodano A / B" value={`${fmtNum(q.data.a.totalQty)} / ${fmtNum(q.data.b.totalQty)}`} sub={`Promjena ${pct(q.data.qtyDiffPct)}`} icon={<GitCompareArrows className="h-4 w-4" />} />
            <KpiCard label="Prihod A / B" value={`${fmtMoney(q.data.a.totalRevenue)} / ${fmtMoney(q.data.b.totalRevenue)}`} sub={`Promjena ${pct(q.data.revenueDiffPct)}`} icon={<GitCompareArrows className="h-4 w-4" />} />
            <KpiCard label="Prosječno dnevno A / B" value={`${fmtDec1(q.data.a.avgDailyQty)} / ${fmtDec1(q.data.b.avgDailyQty)}`} icon={<GitCompareArrows className="h-4 w-4" />} />
          </div>
        )}
      </Card>
      {q.data && (
        <>
          <Card title="Najveće promjene po artiklima" subtitle="Prodane jedinice – razdoblje A i B">
            {chartRows.length ? <CompareBarChart rows={chartRows} labelA={labelA} labelB={labelB} /> : <EmptyState title="Podaci nisu dostupni" />}
          </Card>
          <Card title="Usporedba po artiklima">
            <DataTable
              rows={q.data.products}
              rowKey={(p) => p.key}
              exportName="usporedba-razdoblja"
              columns={[
                { key: 'name', header: 'Artikl', render: (p) => <span className="font-medium">{p.name}</span> },
                { key: 'qtyA', header: 'A', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.qtyA) },
                { key: 'qtyB', header: 'B', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.qtyB) },
                { key: 'diff', header: 'Razlika', align: 'right', exportType: 'qty', render: (p) => <span className={p.diff > 0 ? 'text-emerald-700' : p.diff < 0 ? 'text-red-700' : ''}>{p.diff > 0 ? `+${fmtNum(p.diff)}` : fmtNum(p.diff)}</span> },
                { key: 'diffPct', header: 'Razlika %', align: 'right', exportType: 'percent', render: (p) => pct(p.diffPct) },
                { key: 'revenueA', header: 'Prihod A', align: 'right', exportType: 'money', render: (p) => fmtMoney(p.revenueA) },
                { key: 'revenueB', header: 'Prihod B', align: 'right', exportType: 'money', render: (p) => fmtMoney(p.revenueB) },
              ]}
            />
          </Card>
        </>
      )}
      <Alert tone="info">Usporedba koristi iste filtre (automat, kategorija, artikl) kao i ostatak stranice.</Alert>
    </div>
  );
}
