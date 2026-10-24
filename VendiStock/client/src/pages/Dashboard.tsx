import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Cpu, Package, RefreshCw, ShoppingCart, TrendingUp, Trophy, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { InlineBar, SalesTimeChart } from '../components/Charts';
import { DateRangePicker, rangeFor, type Range } from '../components/Pickers';
import { ConnectionBadge, RunBadge } from '../components/StatusBadge';
import { Alert, Badge, Button, Card, EmptyState, KeyValue, KpiCard, PageHeader, QueryError, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { fmtDateTime, fmtDuration, fmtInt, fmtMoney, fmtNum, fmtQty, relativeTime } from '../lib/format';
import type { ConnectionState, ProductSales, Recommendation, SeriesPoint } from '../lib/types';

interface DashboardData {
  period: Range;
  kpi: {
    stockValue: { central: number; total: number };
    activeProducts: number;
    belowMinimum: number;
    toOrder: number;
    sales: { qty: number; revenue: number | null; transactions: number; hasData: boolean } | null;
    topProduct: { name: string; qty: number } | null;
    machines: { total: number; televend: number };
    lastSync: { at: string | null; okAt: string | null; status: string | null; state: ConnectionState };
  };
  salesSeries: SeriesPoint[] | null;
  top10: ProductSales[] | null;
  procurement: Recommendation[];
  automation: { productsWithoutPrice: number; negativeCentral: number; pendingRefills: number; autoCreatedProducts: number };
  televend: {
    state: ConnectionState;
    message: string | null;
    lastLoginAt: string | null;
    lastLoginOk: boolean | null;
    lastSyncAt: string | null;
    lastSyncOkAt: string | null;
    lastSyncStatus: string | null;
    lastSyncRecords: number | null;
    lastSyncDurationMs: number | null;
    lastError: string | null;
    autoSyncSuspended: boolean;
  };
}

const NA = 'Podaci nisu dostupni';

export default function Dashboard() {
  const [range, setRange] = useState<Range>(rangeFor(30));
  const [metric, setMetric] = useState<'qty' | 'revenue'>('qty');
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<DashboardData>(`/api/dashboard${qs(range)}`), placeholderData: (p) => p });
  const d = q.data;
  const k = d?.kpi;
  const hasSales = !!k?.sales?.hasData;
  const maxTop = Math.max(...(d?.top10 ?? []).map((t) => t.qty), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Pregled skladišta, prodaje i nabave"
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => void q.refetch()} loading={q.isFetching}>
              Osvježi
            </Button>
          </>
        }
      />
      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Spinner />
      ) : (
        <div className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          {(d.automation.productsWithoutPrice > 0 || d.automation.negativeCentral > 0) && (
            <div className="mb-5 space-y-2">
              {d.automation.productsWithoutPrice > 0 && (
                <Alert tone="warning" title={`${d.automation.productsWithoutPrice} artikala bez nabavne cijene`}>
                  Artikle je aplikacija stvorila iz Televend Clouda; nabavnu cijenu unesite ručno u{' '}
                  <button className="font-medium underline" onClick={() => nav('/artikli')}>
                    Artikli → Nabavne cijene
                  </button>
                  . Do tada se vrijednost skladišta za njih računa s 0 €.
                </Alert>
              )}
              {d.automation.negativeCentral > 0 && (
                <Alert tone="warning" title={`Negativno stanje centralnog skladišta (${d.automation.negativeCentral} artikala)`}>
                  Dopune iz Televenda su automatski proknjižene, ali ulaz robe još nije unesen. Unesite ulaz robe s nabavnom cijenom (Skladište → Novi ulaz).
                </Alert>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Ukupna vrijednost skladišta"
              value={fmtMoney(k!.stockValue.central)}
              sub={`Sve lokacije: ${fmtMoney(k!.stockValue.total)}`}
              icon={<Warehouse className="h-4 w-4" />}
              onClick={() => nav('/skladiste')}
            />
            <KpiCard label="Broj aktivnih artikala" value={fmtInt(k!.activeProducts)} icon={<Package className="h-4 w-4" />} onClick={() => nav('/artikli')} />
            <KpiCard
              label="Artikli ispod minimalnih zaliha"
              value={fmtInt(k!.belowMinimum)}
              tone={k!.belowMinimum ? 'danger' : 'success'}
              sub={k!.belowMinimum ? 'Raspoloživa zaliha < minimum' : 'Sve zalihe iznad minimuma'}
              icon={<AlertTriangle className="h-4 w-4" />}
              onClick={() => nav('/nabava')}
            />
            <KpiCard
              label="Broj artikala za narudžbu"
              value={fmtInt(k!.toOrder)}
              tone={k!.toOrder ? 'warning' : 'default'}
              sub="Preporučena količina > 0"
              icon={<ShoppingCart className="h-4 w-4" />}
              onClick={() => nav('/nabava')}
            />
            <KpiCard
              label="Ukupna prodaja za razdoblje"
              value={hasSales ? `${fmtNum(k!.sales!.qty)} kom` : NA}
              sub={hasSales ? (k!.sales!.revenue !== null ? `Prihod ${fmtMoney(k!.sales!.revenue)} · ${fmtInt(k!.sales!.transactions)} transakcija` : 'Prihod nije dostupan u izvoru') : 'Nema preuzetih podataka o prodaji'}
              icon={<TrendingUp className="h-4 w-4" />}
              onClick={() => nav('/analitika')}
            />
            <KpiCard
              label="Najprodavaniji proizvod"
              value={k!.topProduct ? k!.topProduct.name : NA}
              sub={k!.topProduct ? `${fmtNum(k!.topProduct.qty)} prodanih jedinica` : 'Kriterij: broj prodanih jedinica'}
              icon={<Trophy className="h-4 w-4" />}
            />
            <KpiCard
              label="Broj povezanih automata"
              value={k!.machines.total ? fmtInt(k!.machines.total) : NA}
              sub={k!.machines.total ? `Iz Televenda: ${fmtInt(k!.machines.televend)}` : 'Automati se preuzimaju iz Televenda ili unose ručno'}
              icon={<Cpu className="h-4 w-4" />}
              onClick={() => nav('/automati')}
            />
            <KpiCard
              label="Posljednja sinkronizacija"
              value={k!.lastSync.at ? relativeTime(k!.lastSync.at) : NA}
              sub={k!.lastSync.at ? fmtDateTime(k!.lastSync.at) : 'Televend Cloud još nije sinkroniziran'}
              tone={k!.lastSync.status === 'failed' ? 'danger' : k!.lastSync.status === 'success' ? 'success' : 'default'}
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => nav('/postavke')}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title="Prodaja kroz vrijeme"
              subtitle={metric === 'qty' ? 'Prodane jedinice po danu (Europe/Zagreb)' : 'Prihod po danu (Europe/Zagreb)'}
              actions={
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                  {(['qty', 'revenue'] as const).map((m) => (
                    <button key={m} onClick={() => setMetric(m)} className={`rounded-md px-3 py-1 font-medium ${metric === m ? 'bg-petrol-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                      {m === 'qty' ? 'Količina' : 'Prihod'}
                    </button>
                  ))}
                </div>
              }
            >
              {d.salesSeries && hasSales ? (
                <SalesTimeChart data={d.salesSeries} metric={metric} />
              ) : (
                <EmptyState icon={<TrendingUp className="h-8 w-8" />} title={NA}>
                  Prodaja se preuzima iz Televend Clouda (Postavke → Televend Cloud) ili ručnim uvozom izvezene datoteke.
                </EmptyState>
              )}
            </Card>

            <Card title="Status Televend Cloud" subtitle="Povezivanje i ažuriranje podataka" actions={<ConnectionBadge state={d.televend.state} />}>
              <KeyValue
                items={[
                  ['Posljednja prijava', d.televend.lastLoginAt ? `${fmtDateTime(d.televend.lastLoginAt)} ${d.televend.lastLoginOk ? '✓' : '✗'}` : '—'],
                  ['Posljednja sinkronizacija', d.televend.lastSyncAt ? fmtDateTime(d.televend.lastSyncAt) : '—'],
                  ['Posljednja uspješna', d.televend.lastSyncOkAt ? fmtDateTime(d.televend.lastSyncOkAt) : '—'],
                  ['Status', d.televend.lastSyncStatus ? <RunBadge key="s" status={d.televend.lastSyncStatus} /> : '—'],
                  ['Preuzeto zapisa', d.televend.lastSyncRecords ?? '—'],
                  ['Trajanje', fmtDuration(d.televend.lastSyncDurationMs)],
                ]}
              />
              {d.televend.autoSyncSuspended && (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Automatska sinkronizacija je obustavljena nakon neuspjele prijave.</p>
              )}
              {d.televend.lastError && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{d.televend.lastError}</p>}
              <Button className="mt-4 w-full" variant="outline" onClick={() => nav('/postavke')}>
                Postavke → Televend Cloud
              </Button>
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="TOP 10 artikala" subtitle="Prema broju prodanih jedinica u odabranom razdoblju" padded={false}>
              {d.top10 && d.top10.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                      <th className="w-10 px-5 py-2.5 text-left font-semibold">#</th>
                      <th className="px-2 py-2.5 text-left font-semibold">Artikl</th>
                      <th className="w-40 px-2 py-2.5 text-left font-semibold">Udio</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Prodano</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {d.top10.map((t, i) => (
                      <tr key={t.key}>
                        <td className="tabular px-5 py-2.5 text-slate-500">{i + 1}</td>
                        <td className="px-2 py-2.5">
                          <div className="font-medium text-slate-800">{t.name}</div>
                          {!t.mapped && <div className="text-xs text-amber-700">Televend artikl nije povezan s lokalnim artiklom</div>}
                        </td>
                        <td className="px-2 py-2.5">
                          <InlineBar value={t.qty} max={maxTop} />
                        </td>
                        <td className="tabular px-5 py-2.5 text-right font-semibold text-slate-900">{fmtNum(t.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-5">
                  <EmptyState icon={<Trophy className="h-8 w-8" />} title={NA} />
                </div>
              )}
            </Card>

            <Card
              title="Nabava"
              subtitle="Roba ispod minimalnih skladišnih zaliha"
              padded={false}
              actions={
                <Button size="sm" variant="primary" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={() => nav('/nabava')}>
                  Lista za nabavu
                </Button>
              }
            >
              {d.procurement.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-2.5 text-left font-semibold">Artikl</th>
                      <th className="px-2 py-2.5 text-right font-semibold">Stanje</th>
                      <th className="px-2 py-2.5 text-right font-semibold">Minimum</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Naručiti</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {d.procurement.map((r) => (
                      <tr key={r.productId}>
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-slate-800">{r.name}</div>
                          <div className="text-xs text-slate-500">{r.supplierName ?? 'Bez dobavljača'}</div>
                        </td>
                        <td className="tabular px-2 py-2.5 text-right text-red-700">{fmtQty(r.available, r.unit)}</td>
                        <td className="tabular px-2 py-2.5 text-right text-slate-600">{fmtQty(r.minStock, r.unit)}</td>
                        <td className="tabular px-5 py-2.5 text-right font-semibold text-slate-900">
                          {r.orderQty > 0 ? fmtQty(r.orderQty, r.unit) : <Badge color="blue">naručeno</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-5">
                  <EmptyState icon={<Banknote className="h-8 w-8" />} title="Nema artikala ispod minimalne zalihe">
                    Minimalne i ciljane zalihe definiraju se na kartici artikla.
                  </EmptyState>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
