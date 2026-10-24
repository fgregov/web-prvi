import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardList, Download, Eye, FileClock, PackagePlus, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../components/DataTable';
import { DateRangePicker, ProductPicker, rangeFor, type Range } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, KeyValue, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea } from '../components/ui';
import { api, download, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtQty, todayIso } from '../lib/format';
import type { Location, Machine, Product } from '../lib/types';
import { MovementForm, newDraft, type MovementDraft, type MovementKind } from './warehouse/MovementForm';

type Tab = 'stock' | 'documents' | 'history' | 'counts' | 'locations' | 'reservations';

const TYPE_COLORS: Record<string, 'green' | 'red' | 'blue' | 'gray' | 'yellow' | 'petrol' | 'orange'> = {
  opening: 'gray',
  receipt: 'green',
  issue: 'orange',
  transfer: 'blue',
  adjustment: 'yellow',
  sale: 'petrol',
  reversal: 'red',
};

export default function Warehouse() {
  const [tab, setTab] = useState<Tab>('stock');
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const { canEdit } = useAuth();
  const open = (k: MovementKind) => setDraft(newDraft(k));
  return (
    <div>
      <PageHeader
        title="Skladište"
        subtitle="Vlastita skladišna evidencija VendiStocka (neovisna o Televendu) – model skladišne knjige s revizijskim tragom"
        actions={
          canEdit && (
            <>
              <Button variant="primary" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => open('receipt')}>
                Novi ulaz
              </Button>
              <Button variant="primary" icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => open('issue')}>
                Novi izlaz
              </Button>
              <Button variant="outline" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => open('transfer')}>
                Prijenos
              </Button>
              <Button variant="secondary" icon={<PackagePlus className="h-4 w-4" />} onClick={() => open('opening')}>
                Početno stanje
              </Button>
            </>
          )
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'stock', label: 'Stanje' },
          { key: 'documents', label: 'Dokumenti' },
          { key: 'history', label: 'Povijest skladišta' },
          { key: 'counts', label: 'Inventura' },
          { key: 'locations', label: 'Lokacije' },
          { key: 'reservations', label: 'Rezervacije' },
        ]}
      />
      {tab === 'stock' && <StockTab />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'counts' && <CountsTab />}
      {tab === 'locations' && <LocationsTab />}
      {tab === 'reservations' && <ReservationsTab />}
      <MovementForm draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

interface OverviewRow {
  id: number;
  code: string;
  name: string;
  unit: string;
  purchase_price: number;
  min_stock: number;
  target_stock: number;
  active: number;
  category_name: string | null;
  supplier_name: string | null;
  central_qty: number;
  vehicle_qty: number;
  machine_qty: number;
  other_qty: number;
  total_qty: number;
  reserved_qty: number;
}

function StockTab() {
  const q = useQuery({
    queryKey: ['stock-overview'],
    queryFn: () => api.get<{ products: OverviewRow[]; value: { central: number; total: number }; unposted: { unmapped: number; pending: number } }>('/api/stock/overview'),
  });
  const [locationId, setLocationId] = useState('');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const balances = useQuery({
    queryKey: ['balances', locationId],
    queryFn: () => api.get<{ product_id: number; code: string; name: string; unit: string; location_name: string; qty: number; value: number }[]>(`/api/stock/balances${qs({ locationId })}`),
    enabled: !!locationId,
  });
  const [onlyActive, setOnlyActive] = useState(true);
  const rows = (q.data?.products ?? []).filter((r) => !onlyActive || r.active);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-xs text-slate-500">Vrijednost centralnog skladišta</div>
          <div className="tabular mt-1 text-2xl font-semibold">{fmtMoney(q.data?.value.central)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Vrijednost svih lokacija</div>
          <div className="tabular mt-1 text-2xl font-semibold">{fmtMoney(q.data?.value.total)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Vrednovanje</div>
          <div className="mt-1 text-sm text-slate-700">Količina × trenutačna nabavna cijena artikla</div>
        </Card>
      </div>
      {q.data && q.data.unposted.unmapped > 0 && (
        <Alert tone="warning">{q.data.unposted.unmapped} transakcija prodaje nije knjiženo na zalihe automata jer Televend artikl nije povezan s lokalnim artiklom (Artikli → Televend povezivanje).</Alert>
      )}
      <Card title="Stanje po artiklima" subtitle="Centralno skladište, vozila, automati i raspoloživa zaliha (centralno − rezervirano)">
        <DataTable
          rows={rows}
          loading={q.isLoading}
          rowKey={(r) => r.id}
          exportName="stanje-zaliha"
          exportTitle="Stanje zaliha"
          initialSort={{ key: 'name', dir: 'asc' }}
          toolbar={
            <>
              <Checkbox checked={onlyActive} onChange={setOnlyActive} label="Samo aktivni" />
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void download('/api/reports/stock/pdf')}>
                PDF
              </Button>
            </>
          }
          columns={[
            { key: 'code', header: 'Šifra', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: 'name', header: 'Artikl', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
            { key: 'category_name', header: 'Kategorija', render: (r) => r.category_name ?? '—' },
            { key: 'central_qty', header: 'Centralno', align: 'right', exportType: 'qty', render: (r) => <b className={r.central_qty < 0 ? 'text-red-600' : ''}>{fmtQty(r.central_qty, r.unit)}</b> },
            { key: 'vehicle_qty', header: 'Vozila', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.vehicle_qty) },
            { key: 'machine_qty', header: 'Automati', align: 'right', exportType: 'qty', render: (r) => <span className={r.machine_qty < 0 ? 'text-red-600' : ''}>{fmtNum(r.machine_qty)}</span> },
            { key: 'reserved_qty', header: 'Rezervirano', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.reserved_qty) },
            {
              key: 'available',
              header: 'Raspoloživo',
              align: 'right',
              exportType: 'qty',
              value: (r) => Math.round((r.central_qty - r.reserved_qty) * 1000) / 1000,
              render: (r) => {
                const a = r.central_qty - r.reserved_qty;
                return <span className={r.min_stock > 0 && a < r.min_stock ? 'font-semibold text-red-700' : 'font-semibold'}>{fmtNum(Math.round(a * 1000) / 1000)}</span>;
              },
            },
            { key: 'min_stock', header: 'Min.', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.min_stock) },
            { key: 'value', header: 'Vrijednost', align: 'right', exportType: 'money', value: (r) => Math.round(r.central_qty * r.purchase_price * 100) / 100, render: (r) => fmtMoney(r.central_qty * r.purchase_price) },
          ]}
        />
      </Card>
      <Card title="Stanje po lokaciji" subtitle="Odaberite vozilo, automat ili drugu lokaciju">
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mb-3 max-w-sm">
          <option value="">— odaberite lokaciju —</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        {locationId && (
          <DataTable
            rows={balances.data}
            loading={balances.isLoading}
            rowKey={(r) => r.product_id}
            exportName="stanje-lokacije"
            columns={[
              { key: 'code', header: 'Šifra' },
              { key: 'name', header: 'Artikl' },
              { key: 'qty', header: 'Količina', align: 'right', exportType: 'qty', render: (r) => fmtQty(r.qty, r.unit) },
              { key: 'value', header: 'Vrijednost', align: 'right', exportType: 'money', render: (r) => fmtMoney(r.value) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

interface MovementRow {
  id: number;
  doc_no: string;
  type: string;
  type_label: string;
  doc_date: string;
  document_ref: string | null;
  note: string | null;
  supplier_name: string | null;
  created_by_name: string | null;
  created_at: string;
  reversed: number;
  reverses_movement_id: number | null;
  corrects_movement_id: number | null;
  purchase_order_id: number | null;
  product_count: number;
  from_locations: string | null;
  to_locations: string | null;
  value_in: number | null;
  source_ref: string | null;
}

function DocumentsTab() {
  const [range, setRange] = useState<Range>(rangeFor(30));
  const [type, setType] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['movements', range, type], queryFn: () => api.get<MovementRow[]>(`/api/stock/movements${qs({ ...range, type, limit: 5000 })}`) });
  return (
    <Card>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        exportName="skladisni-dokumenti"
        exportTitle="Skladišni dokumenti"
        onRowClick={(r) => setDetailId(r.id)}
        toolbar={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-48 py-1">
              <option value="">Sve vrste</option>
              <option value="receipt">Ulaz robe</option>
              <option value="issue">Izlaz robe</option>
              <option value="transfer">Prijenos</option>
              <option value="opening">Početno stanje</option>
              <option value="adjustment">Inventurna korekcija</option>
              <option value="sale">Prodaja (Televend)</option>
              <option value="reversal">Storno</option>
            </Select>
          </>
        }
        columns={[
          { key: 'doc_date', header: 'Datum', exportType: 'date', render: (r) => fmtDate(r.doc_date) },
          { key: 'doc_no', header: 'Dokument', render: (r) => <span className="font-mono text-xs font-medium">{r.doc_no}</span> },
          {
            key: 'type_label',
            header: 'Vrsta',
            render: (r) => (
              <div className="flex gap-1">
                <Badge color={TYPE_COLORS[r.type]}>{r.type_label}</Badge>
                {r.reversed ? <Badge color="red">storniran</Badge> : null}
                {r.corrects_movement_id ? <Badge color="yellow">ispravak</Badge> : null}
              </div>
            ),
          },
          { key: 'from_locations', header: 'Iz', render: (r) => r.from_locations ?? '—' },
          { key: 'to_locations', header: 'U', render: (r) => r.to_locations ?? '—' },
          { key: 'product_count', header: 'Stavki', align: 'right' },
          { key: 'supplier_name', header: 'Dobavljač', render: (r) => r.supplier_name ?? '—' },
          { key: 'document_ref', header: 'Br. dokumenta', render: (r) => r.document_ref ?? '—' },
          { key: 'value_in', header: 'Vrijednost ulaza', align: 'right', exportType: 'money', render: (r) => (r.value_in ? fmtMoney(r.value_in) : '—') },
          { key: 'created_by_name', header: 'Unio', render: (r) => r.created_by_name ?? 'sustav' },
          { key: '_v', header: '', sortable: false, exportable: false, render: () => <Eye className="h-4 w-4 text-slate-400" /> },
        ]}
      />
      <MovementDetail id={detailId} onClose={() => setDetailId(null)} />
    </Card>
  );
}

interface MovementDetailData {
  movement: MovementRow & { reversed_by_doc_no: string | null; reverses_doc_no: string | null; corrects_doc_no: string | null; destination_type: string | null; supplier_id: number | null };
  lines: { id: number; product_id: number; code: string; name: string; unit: string; location_id: number; location_name: string; location_type: string; qty_delta: number; unit_cost: number | null; balance_after: number }[];
  auditTrail: { created_at: string; username: string | null; action: string; details: string | null }[];
}

function MovementDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['movement', id], queryFn: () => api.get<MovementDetailData>(`/api/stock/movements/${id}`), enabled: !!id });
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [editMeta, setEditMeta] = useState<{ note: string; documentRef: string } | null>(null);
  const [correction, setCorrection] = useState<MovementDraft | null>(null);
  const invalidate = () => {
    for (const k of ['movements', 'movement', 'stock-overview', 'history', 'products', 'dashboard', 'recommendations', 'balances']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const reverse = useMutation({
    mutationFn: () => api.post<{ docNo: string }>(`/api/stock/movements/${id}/reverse`, { reason }),
    onSuccess: (r) => {
      toast.success(`Storno proknjižen (${r.docNo}).`);
      setReverseOpen(false);
      setReason('');
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const saveMeta = useMutation({
    mutationFn: () => api.patch(`/api/stock/movements/${id}`, { note: editMeta?.note || null, documentRef: editMeta?.documentRef || null }),
    onSuccess: () => {
      toast.success('Podaci dokumenta ažurirani (zapisano u revizijski trag).');
      setEditMeta(null);
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  const m = d?.movement;
  const canReverse = canEdit && m && !m.reversed && m.type !== 'reversal' && m.type !== 'sale';
  const canCorrect = canReverse && ['receipt', 'issue', 'transfer'].includes(m!.type) && !m!.purchase_order_id;

  const startCorrection = () => {
    if (!d || !m) return;
    const kind = m.type as MovementKind;
    const draft = newDraft(kind);
    draft.docDate = m.doc_date;
    draft.note = m.note ?? '';
    draft.documentRef = m.document_ref ?? '';
    draft.supplierId = m.supplier_id;
    if (kind === 'receipt') draft.lines = d.lines.map((l) => ({ productId: l.product_id, qty: l.qty_delta, price: l.unit_cost }));
    if (kind === 'issue') {
      const out = d.lines.filter((l) => l.qty_delta < 0);
      const dest = d.lines.find((l) => l.qty_delta > 0);
      draft.destinationType = (m.destination_type as MovementDraft['destinationType']) ?? 'other';
      draft.destinationLocationId = dest?.location_id ?? null;
      draft.lines = out.map((l) => ({ productId: l.product_id, qty: -l.qty_delta, price: null }));
    }
    if (kind === 'transfer') {
      const out = d.lines.filter((l) => l.qty_delta < 0);
      draft.fromLocationId = out[0]?.location_id ?? null;
      draft.toLocationId = d.lines.find((l) => l.qty_delta > 0)?.location_id ?? null;
      draft.lines = out.map((l) => ({ productId: l.product_id, qty: -l.qty_delta, price: null }));
    }
    setCorrection(draft);
  };

  return (
    <>
      <Modal open={!!id && !correction} onClose={onClose} title={m ? `${m.type_label} ${m.doc_no}` : 'Dokument'} wide>
        {!d || !m ? (
          <Spinner />
        ) : (
          <div className="space-y-5">
            <KeyValue
              items={[
                ['Datum dokumenta', fmtDate(m.doc_date)],
                ['Proknjiženo', `${fmtDateTime(m.created_at)} · ${m.created_by_name ?? 'sustav'}`],
                ['Dobavljač', m.supplier_name ?? '—'],
                ['Broj dokumenta', m.document_ref ?? '—'],
                ['Napomena', m.note ?? '—'],
                ['Izvor', m.source_ref ?? 'ručni unos'],
                ...(m.reversed_by_doc_no ? ([['Storniran dokumentom', m.reversed_by_doc_no]] as [string, string][]) : []),
                ...(m.reverses_doc_no ? ([['Stornira dokument', m.reverses_doc_no]] as [string, string][]) : []),
                ...(m.corrects_doc_no ? ([['Ispravak dokumenta', m.corrects_doc_no]] as [string, string][]) : []),
              ]}
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 text-left">Artikl</th>
                  <th className="py-2 text-left">Lokacija</th>
                  <th className="py-2 text-right">Ulaz</th>
                  <th className="py-2 text-right">Izlaz</th>
                  <th className="py-2 text-right">Stanje nakon</th>
                  <th className="py-2 text-right">Cijena</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50">
                    <td className="py-2">
                      {l.code} · {l.name}
                    </td>
                    <td className="py-2">{l.location_name}</td>
                    <td className="tabular py-2 text-right text-emerald-700">{l.qty_delta > 0 ? fmtQty(l.qty_delta, l.unit) : ''}</td>
                    <td className="tabular py-2 text-right text-orange-700">{l.qty_delta < 0 ? fmtQty(-l.qty_delta, l.unit) : ''}</td>
                    <td className="tabular py-2 text-right font-medium">{fmtNum(l.balance_after)}</td>
                    <td className="tabular py-2 text-right">{l.unit_cost !== null ? fmtMoney(l.unit_cost) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <FileClock className="h-4 w-4" /> Revizijski trag
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {d.auditTrail.map((a, i) => (
                  <li key={i} className="rounded-md bg-slate-50 px-3 py-2">
                    <span className="font-medium text-slate-800">{fmtDateTime(a.created_at)}</span> · {a.username ?? 'sustav'} · {a.action}
                    {a.details && <div className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{a.details.slice(0, 400)}</div>}
                  </li>
                ))}
              </ul>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditMeta({ note: m.note ?? '', documentRef: m.document_ref ?? '' })}>
                  Uredi napomenu / broj dokumenta
                </Button>
                {canCorrect && (
                  <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={startCorrection}>
                    Ispravi količine (storno + novi dokument)
                  </Button>
                )}
                {canReverse && (
                  <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setReverseOpen(true)}>
                    Storniraj
                  </Button>
                )}
              </div>
            )}
            {m.type === 'sale' && <Alert tone="info">Knjiženja prodaje prate podatke iz Televenda: storno ili ispravak transakcije u Televendu automatski stornira ovo knjiženje.</Alert>}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={reverseOpen} title="Stornirati dokument?" danger confirmLabel="Storniraj" loading={reverse.isPending} onClose={() => setReverseOpen(false)} onConfirm={() => reverse.mutate()}>
        <p className="mb-3">Proknjižit će se storno dokument sa suprotnim stavkama. Originalni dokument ostaje vidljiv u povijesti.</p>
        <Field label="Razlog storna" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </ConfirmDialog>
      <Modal
        open={!!editMeta}
        onClose={() => setEditMeta(null)}
        title="Uredi podatke dokumenta"
        footer={
          <>
            <Button onClick={() => setEditMeta(null)}>Odustani</Button>
            <Button variant="primary" loading={saveMeta.isPending} onClick={() => saveMeta.mutate()}>
              Spremi
            </Button>
          </>
        }
      >
        {editMeta && (
          <div className="space-y-3">
            <Field label="Broj dokumenta">
              <Input value={editMeta.documentRef} onChange={(e) => setEditMeta({ ...editMeta, documentRef: e.target.value })} />
            </Field>
            <Field label="Napomena">
              <Textarea value={editMeta.note} onChange={(e) => setEditMeta({ ...editMeta, note: e.target.value })} />
            </Field>
            <p className="text-xs text-slate-500">Promjena se zapisuje u revizijski trag (vrijednost prije i poslije).</p>
          </div>
        )}
      </Modal>
      <MovementForm
        draft={correction}
        correctId={id ?? undefined}
        onClose={() => {
          setCorrection(null);
          invalidate();
        }}
      />
    </>
  );
}

interface HistoryRow {
  ledger_id: number;
  doc_no: string;
  doc_date: string;
  type: string;
  type_label: string;
  product_code: string;
  product_name: string;
  unit: string;
  location_name: string;
  qty_in: number | null;
  qty_out: number | null;
  balance_after: number;
  note: string | null;
  reversed: number;
  created_by_name: string | null;
}

function HistoryTab() {
  const [range, setRange] = useState<Range>(rangeFor(30));
  const [productId, setProductId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState('');
  const [type, setType] = useState('');
  const toast = useToast();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const params = { ...range, productId, locationId, type };
  const q = useQuery({ queryKey: ['history', params], queryFn: () => api.get<HistoryRow[]>(`/api/stock/history${qs({ ...params, limit: 5000 })}`) });
  return (
    <Card title="Povijest skladišta" subtitle="Datum | Artikl | Vrsta promjene | Ulaz | Izlaz | Lokacija | Stanje nakon knjiženja">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <ProductPicker products={products.data} value={productId} onChange={setProductId} placeholder="Svi artikli" onlyActive={false} className="w-64" />
        {productId && (
          <Button size="sm" variant="ghost" onClick={() => setProductId(null)}>
            Poništi artikl
          </Button>
        )}
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-9 w-52 py-1">
          <option value="">Sve lokacije</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-48 py-1">
          <option value="">Sve vrste promjena</option>
          <option value="receipt">Ulaz robe</option>
          <option value="issue">Izlaz robe</option>
          <option value="transfer">Prijenos</option>
          <option value="opening">Početno stanje</option>
          <option value="adjustment">Inventurna korekcija</option>
          <option value="sale">Prodaja (Televend)</option>
          <option value="reversal">Storno</option>
        </Select>
        <Button
          variant="primary"
          size="sm"
          icon={<Download className="h-3.5 w-3.5" />}
          className="ml-auto"
          onClick={() => download(`/api/reports/stock-history.xlsx${qs(params)}`).catch((e) => toast.error(e))}
        >
          Izvoz u Excel (svi zapisi)
        </Button>
      </div>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.ledger_id}
        dense
        pageSize={50}
        columns={[
          { key: 'doc_date', header: 'Datum', exportType: 'date', render: (r) => fmtDate(r.doc_date) },
          { key: 'product_name', header: 'Artikl', render: (r) => <span>{r.product_code} · {r.product_name}</span> },
          {
            key: 'type_label',
            header: 'Vrsta promjene',
            render: (r) => (
              <span className="flex items-center gap-1">
                <Badge color={TYPE_COLORS[r.type]}>{r.type_label}</Badge>
                <span className="font-mono text-[11px] text-slate-400">{r.doc_no}</span>
              </span>
            ),
          },
          { key: 'qty_in', header: 'Ulaz', align: 'right', exportType: 'qty', render: (r) => (r.qty_in ? <span className="text-emerald-700">{fmtNum(r.qty_in)}</span> : '') },
          { key: 'qty_out', header: 'Izlaz', align: 'right', exportType: 'qty', render: (r) => (r.qty_out ? <span className="text-orange-700">{fmtNum(r.qty_out)}</span> : '') },
          { key: 'location_name', header: 'Lokacija' },
          { key: 'balance_after', header: 'Stanje nakon knjiženja', align: 'right', exportType: 'qty', render: (r) => <b>{fmtQty(r.balance_after, r.unit)}</b> },
          { key: 'created_by_name', header: 'Unio', render: (r) => r.created_by_name ?? 'sustav' },
        ]}
      />
    </Card>
  );
}

interface CountRow {
  id: number;
  status: 'draft' | 'posted' | 'cancelled';
  count_date: string;
  note: string | null;
  location_name: string;
  movement_doc_no: string | null;
  line_count: number;
  counted_count: number;
  diff_count: number;
  posted_at: string | null;
}

function CountsTab() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const counts = useQuery({ queryKey: ['counts'], queryFn: () => api.get<CountRow[]>('/api/stock/counts') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const [create, setCreate] = useState<{ locationId: number | null; countDate: string; note: string } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const createM = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/stock/counts', { locationId: create?.locationId, countDate: create?.countDate, note: create?.note || null }),
    onSuccess: (r) => {
      setCreate(null);
      setOpenId(r.id);
      void qc.invalidateQueries({ queryKey: ['counts'] });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card
      title="Inventure"
      subtitle="Unos stvarno prebrojanih količina i usporedba s knjigovodstvenim stanjem; svaka razlika knjiži se kao inventurna korekcija"
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreate({ locationId: locations.data?.find((l) => l.type === 'central')?.id ?? null, countDate: todayIso(), note: '' })}>
            Nova inventura
          </Button>
        )
      }
    >
      <DataTable
        rows={counts.data}
        loading={counts.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        exportName="inventure"
        columns={[
          { key: 'id', header: '#', render: (r) => `#${r.id}` },
          { key: 'count_date', header: 'Datum', exportType: 'date', render: (r) => fmtDate(r.count_date) },
          { key: 'location_name', header: 'Lokacija' },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (r.status === 'draft' ? <Badge color="blue">otvorena</Badge> : r.status === 'posted' ? <Badge color="green">proknjižena</Badge> : <Badge>otkazana</Badge>),
          },
          { key: 'counted_count', header: 'Prebrojano', align: 'right', render: (r) => `${r.counted_count} / ${r.line_count}` },
          { key: 'diff_count', header: 'Razlika', align: 'right' },
          { key: 'movement_doc_no', header: 'Korekcija', render: (r) => r.movement_doc_no ?? '—' },
        ]}
      />
      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title="Nova inventura"
        footer={
          <>
            <Button onClick={() => setCreate(null)}>Odustani</Button>
            <Button variant="primary" loading={createM.isPending} disabled={!create?.locationId} onClick={() => createM.mutate()}>
              Započni inventuru
            </Button>
          </>
        }
      >
        {create && (
          <div className="space-y-3">
            <Field label="Lokacija" required>
              <Select value={create.locationId ?? ''} onChange={(e) => setCreate({ ...create, locationId: Number(e.target.value) || null })}>
                {locations.data?.filter((l) => l.active).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Datum inventure" required>
              <Input type="date" value={create.countDate} onChange={(e) => setCreate({ ...create, countDate: e.target.value })} />
            </Field>
            <Field label="Napomena">
              <Input value={create.note} onChange={(e) => setCreate({ ...create, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
      <CountDetail id={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

interface CountDetailData {
  count: { id: number; status: string; count_date: string; location_name: string; note: string | null; movement_doc_no: string | null };
  lines: { product_id: number; code: string; name: string; unit: string; book_qty: number; current_qty: number; counted_qty: number | null; difference: number | null }[];
}

function CountDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const q = useQuery({ queryKey: ['count', id], queryFn: () => api.get<CountDetailData>(`/api/stock/counts/${id}`), enabled: !!id });
  const [edits, setEdits] = useState<Record<number, number | null>>({});
  const [filter, setFilter] = useState('');
  const [confirmPost, setConfirmPost] = useState(false);
  const draft = q.data?.count.status === 'draft' && canEdit;
  const invalidate = () => ['counts', 'count', 'stock-overview', 'history', 'products', 'movements', 'dashboard'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const saveLines = useMutation({
    mutationFn: () => api.put(`/api/stock/counts/${id}/lines`, { lines: Object.entries(edits).map(([pid, v]) => ({ productId: Number(pid), countedQty: v })) }),
    onSuccess: () => {
      setEdits({});
      toast.success('Prebrojane količine spremljene.');
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const post = useMutation({
    mutationFn: async () => {
      if (Object.keys(edits).length) await api.put(`/api/stock/counts/${id}/lines`, { lines: Object.entries(edits).map(([pid, v]) => ({ productId: Number(pid), countedQty: v })) });
      return api.post<{ differences: number; movement: { docNo: string } | null }>(`/api/stock/counts/${id}/post`);
    },
    onSuccess: (r) => {
      setEdits({});
      setConfirmPost(false);
      toast.success(r.movement ? `Inventura proknjižena – ${r.differences} razlika (${r.movement.docNo}).` : 'Inventura proknjižena bez razlika.');
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/api/stock/counts/${id}/cancel`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const lines = (q.data?.lines ?? []).filter((l) => !filter || `${l.code} ${l.name}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      wide="xl"
      title={q.data ? `Inventura #${q.data.count.id} – ${q.data.count.location_name} (${fmtDate(q.data.count.count_date)})` : 'Inventura'}
      footer={
        <>
          <Button icon={<Download className="h-4 w-4" />} onClick={() => void download(`/api/reports/inventory-count/${id}/xlsx`)}>
            Excel
          </Button>
          {draft && (
            <>
              <Button variant="ghost" onClick={() => cancel.mutate()}>
                Otkaži inventuru
              </Button>
              <Button disabled={!Object.keys(edits).length} loading={saveLines.isPending} onClick={() => saveLines.mutate()}>
                Spremi unos
              </Button>
              <Button variant="primary" icon={<ClipboardList className="h-4 w-4" />} onClick={() => setConfirmPost(true)}>
                Proknjiži inventuru
              </Button>
            </>
          )}
        </>
      }
    >
      {!q.data ? (
        <Spinner />
      ) : (
        <div>
          {q.data.count.status !== 'draft' && (
            <Alert tone={q.data.count.status === 'posted' ? 'success' : 'info'} className="mb-3">
              {q.data.count.status === 'posted' ? `Inventura je proknjižena${q.data.count.movement_doc_no ? ` (korekcija ${q.data.count.movement_doc_no})` : ' bez razlika'}.` : 'Inventura je otkazana.'}
            </Alert>
          )}
          <Input placeholder="Filtriraj artikle…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-xs" />
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Artikl</th>
                  <th className="px-3 py-2 text-right">Knjigovodstveno</th>
                  <th className="px-3 py-2 text-right">Prebrojano</th>
                  <th className="px-3 py-2 text-right">Razlika</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => {
                  const counted = l.product_id in edits ? edits[l.product_id] : l.counted_qty;
                  const book = q.data!.count.status === 'draft' ? l.current_qty : l.book_qty;
                  const diff = counted === null || counted === undefined ? null : Math.round((counted - book) * 1000) / 1000;
                  return (
                    <tr key={l.product_id}>
                      <td className="px-3 py-1.5">
                        {l.code} · {l.name}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">{fmtQty(book, l.unit)}</td>
                      <td className="w-36 px-3 py-1.5 text-right">
                        {draft ? (
                          <NumberInput min={0} step="0.001" value={counted ?? null} onChange={(v) => setEdits((e) => ({ ...e, [l.product_id]: v }))} className="h-8 py-1" />
                        ) : (
                          fmtNum(counted)
                        )}
                      </td>
                      <td className={`tabular px-3 py-1.5 text-right font-medium ${diff ? (diff > 0 ? 'text-emerald-700' : 'text-red-700') : 'text-slate-400'}`}>
                        {diff === null ? '—' : diff > 0 ? `+${fmtNum(diff)}` : fmtNum(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmPost} title="Proknjižiti inventuru?" confirmLabel="Proknjiži" loading={post.isPending} onClose={() => setConfirmPost(false)} onConfirm={() => post.mutate()}>
        Za svaki artikl s unesenom količinom razlika (prebrojano − trenutačno knjigovodstveno stanje) bit će proknjižena kao inventurna korekcija. Artikli bez unesene količine se ne mijenjaju.
      </ConfirmDialog>
    </Modal>
  );
}

function LocationsTab() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const machines = useQuery({ queryKey: ['machines-list'], queryFn: () => api.get<{ machines: Machine[] }>('/api/machines') });
  const [edit, setEdit] = useState<{ id: number | null; type: 'vehicle' | 'machine' | 'other'; name: string; machineId: number | null; active: boolean; note: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { type: edit!.type, name: edit!.name, machineId: edit!.type === 'machine' ? edit!.machineId : null, active: edit!.active, note: edit!.note || null };
      return edit!.id ? api.put(`/api/locations/${edit!.id}`, body) : api.post('/api/locations', body);
    },
    onSuccess: () => {
      setEdit(null);
      toast.success('Lokacija spremljena.');
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (e) => toast.error(e),
  });
  const TYPE: Record<string, string> = { central: 'Centralno skladište', vehicle: 'Vozilo', machine: 'Automat', other: 'Ostalo' };
  return (
    <Card
      title="Lokacije zaliha"
      subtitle="Centralno skladište → vozilo → automat. Automati iz Televenda automatski dobivaju vlastitu lokaciju."
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, type: 'vehicle', name: '', machineId: null, active: true, note: '' })}>
            Nova lokacija
          </Button>
        )
      }
    >
      <DataTable
        rows={locations.data}
        loading={locations.isLoading}
        rowKey={(l) => l.id}
        exportName="lokacije"
        columns={[
          { key: 'name', header: 'Naziv', render: (l) => <span className="font-medium">{l.name}</span> },
          { key: 'type', header: 'Vrsta', value: (l) => TYPE[l.type], render: (l) => <Badge color={l.type === 'central' ? 'petrol' : l.type === 'vehicle' ? 'blue' : l.type === 'machine' ? 'green' : 'gray'}>{TYPE[l.type]}</Badge> },
          { key: 'machine_name', header: 'Automat', render: (l) => l.machine_name ?? '—' },
          { key: 'product_count', header: 'Artikala na zalihi', align: 'right' },
          { key: 'active', header: 'Status', value: (l) => (l.active ? 'aktivna' : 'neaktivna'), render: (l) => (l.active ? <Badge color="green">aktivna</Badge> : <Badge>neaktivna</Badge>) },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (l: Location) =>
                    l.type !== 'central' && (
                      <Button size="sm" variant="ghost" aria-label="Uredi" onClick={() => setEdit({ id: l.id, type: l.type as 'vehicle', name: l.name, machineId: l.machine_id, active: !!l.active, note: l.note ?? '' })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ),
                } as Column<Location>,
              ]
            : []),
        ]}
      />
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi lokaciju' : 'Nova lokacija'}
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
            <Field label="Vrsta" required>
              <Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as 'vehicle' })}>
                <option value="vehicle">Vozilo</option>
                <option value="machine">Automat</option>
                <option value="other">Ostalo</option>
              </Select>
            </Field>
            <Field label="Naziv" required hint="npr. registracija vozila ili naziv automata">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            {edit.type === 'machine' && (
              <Field label="Povezani automat">
                <Select value={edit.machineId ?? ''} onChange={(e) => setEdit({ ...edit, machineId: Number(e.target.value) || null })}>
                  <option value="">— nije povezan —</option>
                  {machines.data?.machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Napomena">
              <Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
            <Checkbox checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Aktivna lokacija" />
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface ReservationRow {
  id: number;
  product_id: number;
  code: string;
  name: string;
  unit: string;
  qty: number;
  note: string | null;
  created_at: string;
  released_at: string | null;
}

function ReservationsTab() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const rows = useQuery({ queryKey: ['reservations', all], queryFn: () => api.get<ReservationRow[]>(`/api/stock/reservations${all ? '?all=1' : ''}`) });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const [create, setCreate] = useState<{ productId: number | null; qty: number | null; note: string } | null>(null);
  const invalidate = () => ['reservations', 'stock-overview', 'products', 'recommendations', 'dashboard'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({
    mutationFn: () => api.post('/api/stock/reservations', { productId: create?.productId, qty: create?.qty, note: create?.note || null }),
    onSuccess: () => {
      setCreate(null);
      invalidate();
      toast.success('Rezervacija spremljena.');
    },
    onError: (e) => toast.error(e),
  });
  const release = useMutation({ mutationFn: (id: number) => api.post(`/api/stock/reservations/${id}/release`), onSuccess: invalidate, onError: (e) => toast.error(e) });
  return (
    <Card
      title="Rezervirana roba"
      subtitle="Rezervirana roba umanjuje raspoloživu zalihu centralnog skladišta (nabava i upozorenja)"
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreate({ productId: null, qty: null, note: '' })}>
            Nova rezervacija
          </Button>
        )
      }
    >
      <DataTable
        rows={rows.data}
        loading={rows.isLoading}
        rowKey={(r) => r.id}
        exportName="rezervacije"
        toolbar={<Checkbox checked={all} onChange={setAll} label="Prikaži i otpuštene" />}
        columns={[
          { key: 'name', header: 'Artikl', render: (r) => `${r.code} · ${r.name}` },
          { key: 'qty', header: 'Količina', align: 'right', render: (r) => fmtQty(r.qty, r.unit) },
          { key: 'note', header: 'Napomena', render: (r) => r.note ?? '—' },
          { key: 'created_at', header: 'Kreirano', exportType: 'datetime', render: (r) => fmtDateTime(r.created_at) },
          { key: 'released_at', header: 'Status', render: (r) => (r.released_at ? <Badge>otpušteno {fmtDate(r.released_at)}</Badge> : <Badge color="yellow">aktivno</Badge>) },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (r: ReservationRow) =>
                    !r.released_at && (
                      <Button size="sm" onClick={() => release.mutate(r.id)}>
                        Otpusti
                      </Button>
                    ),
                } as Column<ReservationRow>,
              ]
            : []),
        ]}
      />
      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title="Nova rezervacija"
        footer={
          <>
            <Button onClick={() => setCreate(null)}>Odustani</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Spremi
            </Button>
          </>
        }
      >
        {create && (
          <div className="space-y-3">
            <Field label="Artikl" required>
              <ProductPicker products={products.data} value={create.productId} onChange={(v) => setCreate({ ...create, productId: v })} />
            </Field>
            <Field label="Količina" required>
              <NumberInput min={0} step="0.001" value={create.qty} onChange={(v) => setCreate({ ...create, qty: v })} />
            </Field>
            <Field label="Napomena">
              <Input value={create.note} onChange={(e) => setCreate({ ...create, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
