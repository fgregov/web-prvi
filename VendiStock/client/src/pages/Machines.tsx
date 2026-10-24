import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Link2, Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { RankBarChart, SalesTimeChart } from '../components/Charts';
import { DataTable, type Column } from '../components/DataTable';
import { DateRangePicker, rangeFor, type Range } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, KeyValue, Modal, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtQty, relativeTime } from '../lib/format';
import type { Location, Machine, ProductSales, SeriesPoint } from '../lib/types';

export default function Machines() {
  const { id } = useParams();
  return id ? <MachineDetail id={Number(id)} /> : <MachineList />;
}

type Tab = 'list' | 'refills';

function MachineList() {
  const [tab, setTab] = useState<Tab>('list');
  const [range, setRange] = useState<Range>(rangeFor(30));
  const { canEdit } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['machines', range], queryFn: () => api.get<{ machines: Machine[] }>(`/api/machines${qs(range)}`) });
  const [edit, setEdit] = useState<{ id: number | null; name: string; locationText: string; serialNo: string; active: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const b = { name: edit!.name, locationText: edit!.locationText || null, serialNo: edit!.serialNo || null, active: edit!.active };
      return edit!.id ? api.put(`/api/machines/${edit!.id}`, b) : api.post('/api/machines', b);
    },
    onSuccess: () => {
      setEdit(null);
      toast.success('Automat spremljen.');
      void qc.invalidateQueries({ queryKey: ['machines'] });
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (e) => toast.error(e),
  });
  const SRC: Record<string, string> = { televend: 'Televend', manual: 'ručno', upload: 'uvoz datoteke' };
  return (
    <div>
      <PageHeader
        title="Automati"
        subtitle="Samoposlužni automati, prodaja po automatu i usklađivanje dopuna"
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            {canEdit && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, name: '', locationText: '', serialNo: '', active: true })}>
                Novi automat
              </Button>
            )}
          </>
        }
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'list', label: 'Automati' }, { key: 'refills', label: 'Dopune iz Televenda' }]} />
      {tab === 'list' ? (
        <Card>
          <DataTable
            rows={q.data?.machines}
            loading={q.isLoading}
            rowKey={(m) => m.id}
            onRowClick={(m) => nav(`/automati/${m.id}`)}
            exportName="automati"
            empty="Još nema automata. Automati se preuzimaju iz Televend Clouda ili se dodaju ručno."
            initialSort={{ key: 'sold_qty', dir: 'desc' }}
            columns={[
              { key: 'name', header: 'Automat', render: (m) => <span className="font-medium text-slate-900">{m.name}</span> },
              { key: 'location_text', header: 'Lokacija', render: (m) => m.location_text ?? '—' },
              { key: 'source', header: 'Izvor', value: (m) => SRC[m.source], render: (m) => <Badge color={m.source === 'televend' ? 'petrol' : 'gray'}>{SRC[m.source]}</Badge> },
              { key: 'sold_qty', header: 'Prodano (razdoblje)', align: 'right', exportType: 'qty', render: (m) => fmtNum(m.sold_qty) },
              { key: 'revenue', header: 'Prihod', align: 'right', exportType: 'money', render: (m) => fmtMoney(m.revenue) },
              { key: 'last_sale_at', header: 'Zadnja prodaja', exportType: 'datetime', render: (m) => (m.last_sale_at ? relativeTime(m.last_sale_at) : '—') },
              { key: 'stock_qty', header: 'Roba u automatu (lokalno)', align: 'right', exportType: 'qty', render: (m) => <span className={m.stock_qty < 0 ? 'text-red-600' : ''}>{fmtNum(m.stock_qty)}</span> },
              { key: 'pending_refills', header: 'Dopune na čekanju', align: 'right', render: (m) => (m.pending_refills ? <Badge color="yellow">{m.pending_refills}</Badge> : '—') },
              { key: 'active', header: 'Status', value: (m) => (m.active ? 'aktivan' : 'neaktivan'), render: (m) => (m.active ? <Badge color="green">aktivan</Badge> : <Badge>neaktivan</Badge>) },
              ...(canEdit
                ? [
                    {
                      key: '_e',
                      header: '',
                      sortable: false,
                      exportable: false,
                      render: (m: Machine) => (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Uredi"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEdit({ id: m.id, name: m.name, locationText: m.location_text ?? '', serialNo: m.serial_no ?? '', active: !!m.active });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ),
                    } as Column<Machine>,
                  ]
                : []),
            ]}
          />
        </Card>
      ) : (
        <Refills />
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi automat' : 'Novi automat'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Odustani</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Spremi
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Naziv" required>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Lokacija / adresa">
              <Input value={edit.locationText} onChange={(e) => setEdit({ ...edit, locationText: e.target.value })} />
            </Field>
            <Field label="Serijski broj">
              <Input value={edit.serialNo} onChange={(e) => setEdit({ ...edit, serialNo: e.target.value })} />
            </Field>
            <Checkbox checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Aktivan" />
            {!edit.id && <p className="text-xs text-slate-500">Za novi automat automatski se stvara skladišna lokacija tipa „automat”.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

interface MachineDetailData {
  machine: Machine & { stock_location_name: string | null; raw: string | null; first_seen_at: string | null; fetched_at: string | null };
  period: Range;
  summary: { qty: number; revenue: number | null; transactions: number } | null;
  topProducts: ProductSales[];
  series: SeriesPoint[];
  localStock: { product_id: number; code: string; name: string; unit: string; qty: number }[];
  televendStock: { tv_product_id: number; name: string; quantity: number; capacity: number | null; measured_at_utc: string | null; fetched_at: string }[];
}

function MachineDetail({ id }: { id: number }) {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>(rangeFor(30));
  const q = useQuery({ queryKey: ['machine', id, range], queryFn: () => api.get<MachineDetailData>(`/api/machines/${id}${qs(range)}`), placeholderData: (p) => p });
  const d = q.data;
  return (
    <div>
      <button onClick={() => nav('/automati')} className="mb-3 flex items-center gap-1 text-sm text-petrol-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Svi automati
      </button>
      {!d ? (
        <Spinner />
      ) : (
        <>
          <PageHeader title={d.machine.name} subtitle={d.machine.location_text ?? 'Samoposlužni automat'} actions={<DateRangePicker value={range} onChange={setRange} />} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Podaci o automatu">
              <KeyValue
                items={[
                  ['Izvor', d.machine.source === 'televend' ? 'Televend Cloud' : d.machine.source === 'upload' ? 'Uvoz datoteke' : 'Ručni unos'],
                  ['Televend ID', d.machine.source_id ?? '—'],
                  ['Serijski broj', d.machine.serial_no ?? '—'],
                  ['Skladišna lokacija', d.machine.stock_location_name ?? '—'],
                  ['Prvi put viđen', fmtDateTime(d.machine.first_seen_at)],
                  ['Zadnje preuzimanje', fmtDateTime(d.machine.fetched_at)],
                  ['Prodano u razdoblju', d.summary ? `${fmtNum(d.summary.qty)} kom` : '—'],
                  ['Prihod u razdoblju', fmtMoney(d.summary?.revenue)],
                ]}
              />
            </Card>
            <Card className="xl:col-span-2" title="Prodaja kroz vrijeme" subtitle="Prodane jedinice po danu">
              {d.summary ? <SalesTimeChart data={d.series} metric="qty" height={240} /> : <EmptyState title="Podaci nisu dostupni" />}
            </Card>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Najprodavaniji artikli u automatu" subtitle="Prema broju prodanih jedinica">
              {d.topProducts.length ? <RankBarChart rows={d.topProducts.slice(0, 10).map((p) => ({ name: p.name, value: p.qty }))} metric="qty" /> : <EmptyState title="Podaci nisu dostupni" />}
            </Card>
            <Card title="Roba u automatu" subtitle="Lokalna evidencija VendiStocka (prijenosi u automat − knjižena prodaja)">
              {d.localStock.length ? (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {d.localStock.map((s) => (
                      <tr key={s.product_id}>
                        <td className="py-2">
                          {s.code} · {s.name}
                        </td>
                        <td className={`tabular py-2 text-right font-medium ${s.qty < 0 ? 'text-red-600' : ''}`}>{fmtQty(s.qty, s.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="Nema evidentirane robe u automatu" />
              )}
              <h4 className="mb-2 mt-6 text-sm font-semibold text-slate-800">Stanje prema Televendu</h4>
              {d.televendStock.length ? (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {d.televendStock.map((s) => (
                      <tr key={s.tv_product_id}>
                        <td className="py-2">{s.name}</td>
                        <td className="tabular py-2 text-right">
                          {fmtNum(s.quantity)}
                          {s.capacity ? ` / ${fmtNum(s.capacity)}` : ''}
                        </td>
                        <td className="py-2 pl-3 text-right text-xs text-slate-500">{fmtDateTime(s.measured_at_utc ?? s.fetched_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">Podaci nisu dostupni (stanja u automatima preuzimaju se samo ako ih portal nudi i izvor je konfiguriran).</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

interface RefillRow {
  id: number;
  machine_name: string;
  tv_product_name: string;
  product_id: number | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number;
  refilled_at_utc: string;
  status: 'pending' | 'reconciled' | 'booked' | 'ignored';
  movement_doc_no: string | null;
  note: string | null;
}

function Refills() {
  const [status, setStatus] = useState('pending');
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['refills', status], queryFn: () => api.get<RefillRow[]>(`/api/refills${qs({ status })}`) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const [open, setOpen] = useState<RefillRow | null>(null);
  const [fromLoc, setFromLoc] = useState<number | null>(null);
  const matches = useQuery({
    queryKey: ['refill-matches', open?.id],
    queryFn: () => api.get<{ movement_id: number; doc_no: string; doc_date: string; type: string; qty: number; same_qty: number }[]>(`/api/refills/${open!.id}/matches`),
    enabled: !!open,
  });
  const done = () => {
    setOpen(null);
    ['refills', 'machines', 'stock-overview', 'history', 'movements'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  };
  const reconcile = useMutation({ mutationFn: (movementId: number) => api.post(`/api/refills/${open!.id}/reconcile`, { movementId }), onSuccess: () => (toast.success('Dopuna usklađena s postojećim dokumentom.'), done()), onError: (e) => toast.error(e) });
  const book = useMutation({ mutationFn: () => api.post(`/api/refills/${open!.id}/book`, { fromLocationId: fromLoc }), onSuccess: () => (toast.success('Dopuna proknjižena kao prijenos u automat.'), done()), onError: (e) => toast.error(e) });
  const ignore = useMutation({ mutationFn: () => api.post(`/api/refills/${open!.id}/ignore`, { note: null }), onSuccess: done, onError: (e) => toast.error(e) });
  const STATUS: Record<string, ReactNode> = {
    pending: <Badge color="yellow">na čekanju</Badge>,
    reconciled: <Badge color="green">usklađeno</Badge>,
    booked: <Badge color="blue">proknjiženo</Badge>,
    ignored: <Badge>zanemareno</Badge>,
  };
  return (
    <Card>
      <Alert tone="info" className="mb-4">
        Ako Televend bilježi dopune automata, svaka dopuna se ovdje usklađuje s lokalnim evidencijama: poveže se s već unesenim prijenosom u automat (bez ponovnog knjiženja) ili se proknjiži jednom kao novi prijenos. Ista dopuna ne može se proknjižiti dva puta.
      </Alert>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        exportName="dopune-automata"
        empty="Nema dopuna u odabranom statusu. Dopune se preuzimaju iz Televenda samo ako ih portal nudi i izvor „Evidencija dopunjavanja” je konfiguriran."
        toolbar={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-44 py-1">
            <option value="pending">Na čekanju</option>
            <option value="reconciled">Usklađene</option>
            <option value="booked">Proknjižene</option>
            <option value="ignored">Zanemarene</option>
            <option value="">Sve</option>
          </Select>
        }
        columns={[
          { key: 'refilled_at_utc', header: 'Vrijeme dopune', exportType: 'datetime', render: (r) => fmtDateTime(r.refilled_at_utc) },
          { key: 'machine_name', header: 'Automat' },
          { key: 'tv_product_name', header: 'Artikl (Televend)' },
          { key: 'product_name', header: 'Lokalni artikl', render: (r) => (r.product_id ? `${r.product_code} · ${r.product_name}` : <Badge color="yellow">nije povezan</Badge>) },
          { key: 'quantity', header: 'Količina', align: 'right', render: (r) => fmtNum(r.quantity) },
          { key: 'status', header: 'Status', render: (r) => STATUS[r.status] },
          { key: 'movement_doc_no', header: 'Dokument', render: (r) => r.movement_doc_no ?? '—' },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (r: RefillRow) =>
                    r.status === 'pending' && (
                      <Button size="sm" variant="outline" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setOpen(r)}>
                        Uskladi
                      </Button>
                    ),
                } as Column<RefillRow>,
              ]
            : []),
        ]}
      />
      <Modal open={!!open} onClose={() => setOpen(null)} title="Usklađivanje dopune" wide>
        {open && (
          <div className="space-y-5">
            <KeyValue
              items={[
                ['Automat', open.machine_name],
                ['Artikl', open.product_name ?? open.tv_product_name],
                ['Količina', fmtNum(open.quantity)],
                ['Vrijeme', fmtDateTime(open.refilled_at_utc)],
              ]}
            />
            {!open.product_id ? (
              <Alert tone="warning">Televend artikl nije povezan s lokalnim artiklom. Povežite ga u Artikli → Televend povezivanje.</Alert>
            ) : (
              <>
                <div>
                  <h4 className="mb-2 text-sm font-semibold">1. Poveži s postojećim prijenosom (preporučeno ako je dopuna već evidentirana)</h4>
                  {matches.data?.length ? (
                    <ul className="space-y-1.5">
                      {matches.data.map((m) => (
                        <li key={m.movement_id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                          <span>
                            <b>{m.doc_no}</b> · {fmtDate(m.doc_date)} · {fmtNum(m.qty)} kom {m.same_qty ? <Badge color="green">ista količina</Badge> : null}
                          </span>
                          <Button size="sm" loading={reconcile.isPending} onClick={() => reconcile.mutate(m.movement_id)}>
                            Poveži
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">Nema odgovarajućih lokalnih prijenosa u automat (±2 dana).</p>
                  )}
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold">2. Proknjiži kao novi prijenos u automat</h4>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Iz lokacije" className="w-64">
                      <Select value={fromLoc ?? ''} onChange={(e) => setFromLoc(Number(e.target.value) || null)}>
                        <option value="">— odaberite —</option>
                        {locations.data?.filter((l) => l.active && l.type !== 'machine').map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button variant="primary" disabled={!fromLoc} loading={book.isPending} onClick={() => book.mutate()}>
                      Proknjiži prijenos
                    </Button>
                  </div>
                </div>
              </>
            )}
            <div className="border-t pt-3">
              <Button variant="ghost" loading={ignore.isPending} onClick={() => ignore.mutate()}>
                Zanemari ovu dopunu
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

