import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Mail, PackageCheck, Plus, Send, ShoppingCart, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { ProductPicker } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, KeyValue, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea } from '../components/ui';
import { api, download, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtQty, todayIso } from '../lib/format';
import type { Product, Recommendation, Supplier } from '../lib/types';

type Tab = 'recommendations' | 'orders' | 'alerts';

export default function Procurement() {
  const [tab, setTab] = useState<Tab>('recommendations');
  return (
    <div>
      <PageHeader title="Nabava" subtitle="Preporučena nabava = MAX(0, ciljana zaliha − raspoloživa zaliha − količina na otvorenim narudžbama), zaokruženo na cijela pakiranja" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'recommendations', label: 'Lista za nabavu' },
          { key: 'orders', label: 'Narudžbe' },
          { key: 'alerts', label: 'Povijest upozorenja' },
        ]}
      />
      {tab === 'recommendations' && <Recommendations onOrdersCreated={() => setTab('orders')} />}
      {tab === 'orders' && <Orders />}
      {tab === 'alerts' && <AlertsHistory />}
    </div>
  );
}

function Recommendations({ onOrdersCreated }: { onOrdersCreated: () => void }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers') });
  const q = useQuery({ queryKey: ['recommendations', all, supplierId], queryFn: () => api.get<Recommendation[]>(`/api/procurement/recommendations${qs({ all: all ? 1 : 0, supplierId })}`) });
  const create = useMutation({
    mutationFn: () => api.post<{ ids: number[] }>('/api/procurement/orders/from-recommendations', { productIds: [...selected] }),
    onSuccess: (r) => {
      toast.success(`Izrađeno narudžbi (nacrt): ${r.ids.length} – po jedna za svakog dobavljača.`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['orders'] });
      onOrdersCreated();
    },
    onError: (e) => toast.error(e),
  });
  const email = useMutation({
    mutationFn: () => api.post<{ status: string; error?: string }>('/api/procurement/email-list'),
    onSuccess: (r) => (r.status === 'sent' ? toast.success('Lista za nabavu poslana e-mailom.') : toast.error(`Slanje nije uspjelo: ${r.error}`)),
    onError: (e) => toast.error(e),
  });
  const total = (q.data ?? []).reduce((s, r) => s + r.estimatedCost, 0);
  const params = qs({ all: all ? 1 : 0, supplierId });
  return (
    <Card
      title="Lista za nabavu"
      subtitle="Raspoloživa zaliha = fizička zaliha centralnog skladišta − rezervirana roba"
      actions={
        <>
          <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/api/reports/procurement/xlsx${params}`).catch((e) => toast.error(e))}>
            Izvezi listu za nabavu
          </Button>
          <Button icon={<FileText className="h-4 w-4" />} onClick={() => download(`/api/reports/procurement/pdf${params}`).catch((e) => toast.error(e))}>
            PDF
          </Button>
          {canEdit && (
            <Button icon={<Mail className="h-4 w-4" />} loading={email.isPending} onClick={() => email.mutate()}>
              Pošalji e-mailom
            </Button>
          )}
          {canEdit && (
            <Button variant="primary" icon={<ShoppingCart className="h-4 w-4" />} disabled={!selected.size} loading={create.isPending} onClick={() => create.mutate()}>
              Nova narudžba ({selected.size})
            </Button>
          )}
        </>
      }
    >
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.productId}
        selectable={canEdit}
        selected={selected}
        onSelectedChange={setSelected}
        exportName="lista-za-nabavu"
        exportTitle="Lista za nabavu"
        empty="Nema artikala ispod minimalne zalihe."
        toolbar={
          <>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-9 w-48 py-1">
              <option value="">Svi dobavljači</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Checkbox checked={all} onChange={setAll} label="Uključi i artikle iznad minimuma (do ciljane zalihe)" />
          </>
        }
        rowClassName={(r) => (r.belowMin ? undefined : 'opacity-75')}
        columns={[
          { key: 'name', header: 'Artikl', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.code}</div></div> },
          { key: 'stock', header: 'Trenutno stanje', align: 'right', exportType: 'qty', render: (r) => fmtQty(r.stock, r.unit) },
          { key: 'reserved', header: 'Rezervirano', align: 'right', exportType: 'qty', render: (r) => (r.reserved ? fmtNum(r.reserved) : '—') },
          { key: 'available', header: 'Raspoloživo', align: 'right', exportType: 'qty', render: (r) => <span className={r.belowMin ? 'font-semibold text-red-700' : ''}>{fmtNum(r.available)}</span> },
          { key: 'minStock', header: 'Minimalna količina', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.minStock) },
          { key: 'targetStock', header: 'Ciljana količina', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.targetStock) },
          { key: 'openOrders', header: 'Otvorene narudžbe', align: 'right', exportType: 'qty', render: (r) => (r.openOrders ? fmtNum(r.openOrders) : '—') },
          {
            key: 'orderQty',
            header: 'Količina za naručivanje',
            align: 'right',
            exportType: 'qty',
            render: (r) => (
              <div>
                <div className="font-semibold text-slate-900">{r.orderQty > 0 ? fmtQty(r.orderQty, r.unit) : <Badge color="blue">pokriveno narudžbom</Badge>}</div>
                {r.orderQty > 0 && r.packSize !== 1 && <div className="text-xs text-slate-500">{fmtNum(r.packs)} pak. × {fmtNum(r.packSize)}</div>}
              </div>
            ),
          },
          { key: 'supplierName', header: 'Dobavljač', render: (r) => r.supplierName ?? <span className="text-slate-400">—</span> },
          { key: 'estimatedCost', header: 'Procjena', align: 'right', exportType: 'money', render: (r) => fmtMoney(r.estimatedCost) },
        ]}
        footer={
          q.data?.length ? (
            <tr>
              <td colSpan={canEdit ? 10 : 9} className="px-3 py-2.5 text-right text-xs font-medium text-slate-500">
                Ukupna procjena vrijednosti
              </td>
              <td className="tabular px-3 py-2.5 text-right text-sm font-semibold">{fmtMoney(total)}</td>
            </tr>
          ) : null
        }
      />
    </Card>
  );
}

interface OrderRow {
  id: number;
  po_no: string;
  supplier_name: string | null;
  status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
  order_date: string;
  expected_date: string | null;
  line_count: number;
  total_value: number | null;
  note: string | null;
}

const PO_STATUS: Record<OrderRow['status'], { label: string; color: 'gray' | 'blue' | 'yellow' | 'green' | 'red' }> = {
  draft: { label: 'nacrt', color: 'gray' },
  ordered: { label: 'naručeno', color: 'blue' },
  partial: { label: 'djelomično zaprimljeno', color: 'yellow' },
  received: { label: 'zaprimljeno', color: 'green' },
  cancelled: { label: 'otkazano', color: 'red' },
};

function Orders() {
  const { canEdit } = useAuth();
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api.get<OrderRow[]>('/api/procurement/orders') });
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Card
      title="Narudžbe dobavljačima"
      subtitle="Naručene i djelomično zaprimljene narudžbe ulaze u „otvorene narudžbe” u formuli preporuke"
      actions={
        canEdit && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nova narudžba
          </Button>
        )
      }
    >
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        exportName="narudzbe"
        columns={[
          { key: 'po_no', header: 'Broj', render: (r) => <span className="font-mono text-xs font-medium">{r.po_no}</span> },
          { key: 'order_date', header: 'Datum', exportType: 'date', render: (r) => fmtDate(r.order_date) },
          { key: 'supplier_name', header: 'Dobavljač', render: (r) => r.supplier_name ?? '—' },
          { key: 'status', header: 'Status', value: (r) => PO_STATUS[r.status].label, render: (r) => <Badge color={PO_STATUS[r.status].color}>{PO_STATUS[r.status].label}</Badge> },
          { key: 'line_count', header: 'Stavki', align: 'right' },
          { key: 'total_value', header: 'Vrijednost', align: 'right', exportType: 'money', render: (r) => fmtMoney(r.total_value) },
          { key: 'expected_date', header: 'Očekivano', exportType: 'date', render: (r) => fmtDate(r.expected_date) },
        ]}
      />
      <OrderDetail id={openId} onClose={() => setOpenId(null)} />
      <NewOrder open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} />
    </Card>
  );
}

function NewOrder({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<{ productId: number | null; qty: number | null; price: number | null }[]>([{ productId: null, qty: null, price: null }]);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>('/api/procurement/orders', {
        supplierId,
        orderDate: todayIso(),
        expectedDate: expected || null,
        note: note || null,
        lines: lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.price })),
      }),
    onSuccess: (r) => {
      toast.success('Narudžba izrađena (nacrt).');
      void qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
      setLines([{ productId: null, qty: null, price: null }]);
      onCreated(r.id);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova narudžba"
      wide
      footer={
        <>
          <Button onClick={onClose}>Odustani</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Spremi nacrt
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dobavljač">
            <Select value={supplierId ?? ''} onChange={(e) => setSupplierId(Number(e.target.value) || null)}>
              <option value="">— odaberite —</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Očekivana isporuka">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_120px_36px]">
              <ProductPicker
                products={products.data}
                value={l.productId}
                onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: v, price: products.data?.find((p) => p.id === v)?.purchase_price ?? x.price } : x)))}
              />
              <NumberInput placeholder="Količina" min={0} value={l.qty} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
              <NumberInput placeholder="Cijena" min={0} step="0.0001" value={l.price} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
              <Button variant="ghost" aria-label="Ukloni" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines([...lines, { productId: null, qty: null, price: null }])}>
            Dodaj stavku
          </Button>
        </div>
        <Field label="Napomena">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

interface OrderDetailData {
  order: OrderRow & { supplier_email: string | null };
  lines: { id: number; product_id: number; code: string; name: string; unit: string; qty_ordered: number; qty_received: number; unit_price: number | null }[];
  receipts: { id: number; doc_no: string; doc_date: string }[];
}

function OrderDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetailData>(`/api/procurement/orders/${id}`), enabled: !!id });
  const [receiving, setReceiving] = useState<{ docDate: string; documentRef: string; lines: Record<number, number | null> } | null>(null);
  const invalidate = () => ['orders', 'order', 'recommendations', 'stock-overview', 'products', 'dashboard', 'movements', 'history'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const status = useMutation({ mutationFn: (s: 'ordered' | 'cancelled') => api.post(`/api/procurement/orders/${id}/status`, { status: s }), onSuccess: invalidate, onError: (e) => toast.error(e) });
  const receive = useMutation({
    mutationFn: () =>
      api.post<{ docNo: string }>(`/api/procurement/orders/${id}/receive`, {
        docDate: receiving!.docDate,
        documentRef: receiving!.documentRef || null,
        lines: Object.entries(receiving!.lines)
          .filter(([, v]) => v && v > 0)
          .map(([pid, v]) => ({ productId: Number(pid), qty: v, unitPrice: q.data?.lines.find((l) => l.product_id === Number(pid))?.unit_price ?? null })),
      }),
    onSuccess: (r) => {
      toast.success(`Roba zaprimljena – primka ${r.docNo}.`);
      setReceiving(null);
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title={d ? `Narudžba ${d.order.po_no}` : 'Narudžba'} wide>
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <KeyValue
            items={[
              ['Dobavljač', d.order.supplier_name ?? '—'],
              ['E-mail dobavljača', d.order.supplier_email ?? '—'],
              ['Status', <Badge key="s" color={PO_STATUS[d.order.status].color}>{PO_STATUS[d.order.status].label}</Badge>],
              ['Datum', fmtDate(d.order.order_date)],
              ['Očekivana isporuka', fmtDate(d.order.expected_date)],
              ['Primke', d.receipts.map((r) => r.doc_no).join(', ') || '—'],
            ]}
          />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 text-left">Artikl</th>
                <th className="py-2 text-right">Naručeno</th>
                <th className="py-2 text-right">Zaprimljeno</th>
                <th className="py-2 text-right">Cijena</th>
                {receiving && <th className="py-2 text-right">Zaprimi sada</th>}
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="py-2">
                    {l.code} · {l.name}
                  </td>
                  <td className="tabular py-2 text-right">{fmtQty(l.qty_ordered, l.unit)}</td>
                  <td className="tabular py-2 text-right">{fmtQty(l.qty_received, l.unit)}</td>
                  <td className="tabular py-2 text-right">{fmtMoney(l.unit_price)}</td>
                  {receiving && (
                    <td className="w-32 py-1.5 pl-2">
                      <NumberInput min={0} value={receiving.lines[l.product_id] ?? null} onChange={(v) => setReceiving({ ...receiving, lines: { ...receiving.lines, [l.product_id]: v } })} className="h-8 py-1" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {receiving && (
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
              <Field label="Datum primke">
                <Input type="date" value={receiving.docDate} onChange={(e) => setReceiving({ ...receiving, docDate: e.target.value })} />
              </Field>
              <Field label="Broj dokumenta dobavljača">
                <Input value={receiving.documentRef} onChange={(e) => setReceiving({ ...receiving, documentRef: e.target.value })} />
              </Field>
              <div className="flex items-end gap-2">
                <Button onClick={() => setReceiving(null)}>Odustani</Button>
                <Button variant="primary" loading={receive.isPending} onClick={() => receive.mutate()}>
                  Potvrdi ulaz
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button icon={<FileText className="h-4 w-4" />} onClick={() => download(`/api/reports/purchase-order/${id}/pdf`).catch((e) => toast.error(e))}>
              Narudžbenica (PDF)
            </Button>
            {canEdit && d.order.status === 'draft' && (
              <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={status.isPending} onClick={() => status.mutate('ordered')}>
                Označi kao naručeno
              </Button>
            )}
            {canEdit && ['ordered', 'partial'].includes(d.order.status) && !receiving && (
              <Button
                variant="primary"
                icon={<PackageCheck className="h-4 w-4" />}
                onClick={() =>
                  setReceiving({
                    docDate: todayIso(),
                    documentRef: '',
                    lines: Object.fromEntries(d.lines.map((l) => [l.product_id, Math.max(0, Math.round((l.qty_ordered - l.qty_received) * 1000) / 1000)])),
                  })
                }
              >
                Zaprimi robu
              </Button>
            )}
            {canEdit && ['draft', 'ordered'].includes(d.order.status) && (
              <Button variant="ghost" loading={status.isPending} onClick={() => status.mutate('cancelled')}>
                Otkaži narudžbu
              </Button>
            )}
          </div>
          {d.order.status === 'draft' && <Alert tone="info">Nacrt ne ulazi u otvorene narudžbe dok se ne označi kao naručen.</Alert>}
        </div>
      )}
    </Modal>
  );
}

interface AlertRow {
  id: number;
  event: 'entered_low' | 'recovered';
  available_qty: number;
  min_qty: number;
  notify_status: string;
  created_at: string;
  code: string;
  name: string;
  unit: string;
  email_status: string | null;
  sent_at: string | null;
}

const NOTIFY: Record<string, { label: string; color: 'gray' | 'green' | 'yellow' | 'red' | 'blue' }> = {
  pending: { label: 'čeka slanje', color: 'blue' },
  sent: { label: 'e-mail poslan', color: 'green' },
  failed: { label: 'slanje nije uspjelo', color: 'red' },
  skipped: { label: 'bez e-maila', color: 'gray' },
  not_required: { label: '—', color: 'gray' },
};

function AlertsHistory() {
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<AlertRow[]>('/api/alerts/history') });
  return (
    <Card title="Povijest upozorenja o niskim zalihama" subtitle="Upozorenje nastaje pri prvom padu ispod minimuma; ponovno tek nakon što zaliha dosegne minimum i ponovno padne">
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        exportName="upozorenja"
        columns={[
          { key: 'created_at', header: 'Vrijeme', exportType: 'datetime', render: (r) => fmtDateTime(r.created_at) },
          { key: 'name', header: 'Artikl', render: (r) => `${r.code} · ${r.name}` },
          { key: 'event', header: 'Događaj', value: (r) => (r.event === 'entered_low' ? 'pad ispod minimuma' : 'zaliha ponovno ≥ minimum'), render: (r) => (r.event === 'entered_low' ? <Badge color="red">pad ispod minimuma</Badge> : <Badge color="green">ponovno ≥ minimum</Badge>) },
          { key: 'available_qty', header: 'Raspoloživo', align: 'right', render: (r) => fmtQty(r.available_qty, r.unit) },
          { key: 'min_qty', header: 'Minimum', align: 'right', render: (r) => fmtQty(r.min_qty, r.unit) },
          { key: 'notify_status', header: 'Obavijest', value: (r) => NOTIFY[r.notify_status]?.label, render: (r) => <Badge color={NOTIFY[r.notify_status]?.color ?? 'gray'}>{NOTIFY[r.notify_status]?.label ?? r.notify_status}</Badge> },
        ]}
      />
    </Card>
  );
}
