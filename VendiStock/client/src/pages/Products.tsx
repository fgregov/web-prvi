import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../components/DataTable';
import { ProductPicker } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, NumberInput, PageHeader, Select, Tabs, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtMoney, fmtNum, fmtQty } from '../lib/format';
import type { Category, Product, Supplier } from '../lib/types';
import Recipes from './Recipes';
import PurchasePrices from './PurchasePrices';

const UNITS = ['kom', 'kg', 'g', 'l', 'ml', 'pak', 'kut'];

export function useCatalog() {
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers') });
  return { products, categories, suppliers };
}

type Tab = 'products' | 'prices' | 'categories' | 'suppliers' | 'televend' | 'recipes';

export default function Products() {
  const [tab, setTab] = useState<Tab>('products');
  return (
    <div>
      <PageHeader title="Artikli" subtitle="Artikli se automatski stvaraju iz Televend Clouda; ručno se unosi nabavna cijena (i po potrebi minimalna/ciljana zaliha)" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'products', label: 'Artikli' },
          { key: 'prices', label: 'Nabavne cijene' },
          { key: 'categories', label: 'Kategorije' },
          { key: 'suppliers', label: 'Dobavljači' },
          { key: 'televend', label: 'Televend povezivanje' },
          { key: 'recipes', label: 'Normativi' },
        ]}
      />
      {tab === 'products' && <ProductList />}
      {tab === 'prices' && <PurchasePrices />}
      {tab === 'categories' && <Categories />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'televend' && <TelevendLinks />}
      {tab === 'recipes' && <Recipes />}
    </div>
  );
}

interface ProductForm {
  code: string;
  name: string;
  categoryId: number | null;
  supplierId: number | null;
  purchasePrice: number | null;
  unit: string;
  packSize: number | null;
  minStock: number | null;
  targetStock: number | null;
  active: boolean;
  note: string;
}

const emptyForm: ProductForm = { code: '', name: '', categoryId: null, supplierId: null, purchasePrice: 0, unit: 'kom', packSize: 1, minStock: 0, targetStock: 0, active: true, note: '' };

function ProductList() {
  const { products, categories, suppliers } = useCatalog();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: number | null; form: ProductForm } | null>(null);
  const [del, setDel] = useState<Product | null>(null);
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('active');
  const [supplier, setSupplier] = useState('');

  const save = useMutation({
    mutationFn: async (e: { id: number | null; form: ProductForm }) => {
      const body = {
        ...e.form,
        purchasePrice: e.form.purchasePrice ?? 0,
        packSize: e.form.packSize ?? 1,
        minStock: e.form.minStock ?? 0,
        targetStock: e.form.targetStock ?? 0,
        note: e.form.note || null,
      };
      return e.id ? api.put(`/api/products/${e.id}`, body) : api.post('/api/products', body);
    },
    onSuccess: () => {
      toast.success('Artikl spremljen.');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del<{ result: string }>(`/api/products/${id}`),
    onSuccess: (r) => {
      toast.success(r.result === 'deleted' ? 'Artikl obrisan.' : 'Artikl ima povijest kretanja pa je deaktiviran (nije obrisan).');
      setDel(null);
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e),
  });

  const rows = (products.data ?? []).filter(
    (p) =>
      (!cat || String(p.category_id) === cat) &&
      (!supplier || String(p.supplier_id) === supplier) &&
      (status === 'all' ||
        (status === 'low' ? !!p.is_low : status === 'noprice' ? !!p.active && !p.price_set : status === 'active' ? !!p.active : !p.active)),
  );

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Šifra', render: (p) => <span className="font-mono text-xs text-slate-600">{p.code}</span> },
    {
      key: 'name',
      header: 'Naziv',
      render: (p) => (
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-900">{p.name}</span>
            {p.auto_created ? <Badge color="petrol">iz Televenda</Badge> : null}
          </div>
          {p.televend_names && <div className="max-w-xs truncate text-xs text-slate-500">Televend: {p.televend_names}</div>}
        </div>
      ),
    },
    { key: 'category_name', header: 'Kategorija', render: (p) => p.category_name ?? '—' },
    { key: 'supplier_name', header: 'Dobavljač', render: (p) => p.supplier_name ?? '—' },
    {
      key: 'purchase_price',
      header: 'Nabavna cijena',
      align: 'right',
      exportType: 'money',
      render: (p) => (p.price_set ? fmtMoney(p.purchase_price) : <Badge color="yellow">nije unesena</Badge>),
    },
    { key: 'unit', header: 'JM' },
    { key: 'pack_size', header: 'Pakiranje', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.pack_size) },
    { key: 'min_stock', header: 'Min.', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.min_stock) },
    { key: 'target_stock', header: 'Cilj', align: 'right', exportType: 'qty', render: (p) => fmtNum(p.target_stock) },
    {
      key: 'current_stock',
      header: 'Stanje',
      align: 'right',
      exportType: 'qty',
      render: (p) => <span className={p.is_low ? 'font-semibold text-red-700' : 'font-semibold text-slate-900'}>{fmtNum(p.current_stock)}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      value: (p) => (p.active ? 'aktivan' : 'neaktivan'),
      render: (p) => (
        <div className="flex gap-1">
          {p.active ? <Badge color="green">aktivan</Badge> : <Badge>neaktivan</Badge>}
          {p.is_low ? <Badge color="red">ispod min.</Badge> : null}
        </div>
      ),
    },
    {
      key: 'televend_links',
      header: 'Televend',
      align: 'center',
      render: (p) => (p.televend_links ? <Badge color="petrol">{p.televend_links}</Badge> : <span className="text-slate-400">—</span>),
    },
    ...(canEdit
      ? [
          {
            key: '_actions',
            header: '',
            sortable: false,
            exportable: false,
            render: (p: Product) => (
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Uredi"
                  onClick={() =>
                    setEdit({
                      id: p.id,
                      form: {
                        code: p.code,
                        name: p.name,
                        categoryId: p.category_id,
                        supplierId: p.supplier_id,
                        purchasePrice: p.purchase_price,
                        unit: p.unit,
                        packSize: p.pack_size,
                        minStock: p.min_stock,
                        targetStock: p.target_stock,
                        active: !!p.active,
                        note: p.note ?? '',
                      },
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Obriši" onClick={() => setDel(p)}>
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            ),
          } as Column<Product>,
        ]
      : []),
  ];

  const f = edit?.form;
  const setF = (patch: Partial<ProductForm>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <Card padded>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        loading={products.isLoading}
        exportName="artikli"
        exportTitle="Artikli"
        searchPlaceholder="Pretraži šifru, naziv, dobavljača…"
        empty="Još nema artikala. Dodajte prvi artikl gumbom „Novi artikl”."
        initialSort={{ key: 'name', dir: 'asc' }}
        toolbar={
          <>
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 w-44 py-1">
              <option value="">Sve kategorije</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-9 w-44 py-1">
              <option value="">Svi dobavljači</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-40 py-1">
              <option value="active">Aktivni</option>
              <option value="inactive">Neaktivni</option>
              <option value="low">Ispod minimuma</option>
              <option value="noprice">Bez nabavne cijene</option>
              <option value="all">Svi</option>
            </Select>
            {canEdit && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, form: { ...emptyForm } })}>
                Novi artikl
              </Button>
            )}
          </>
        }
      />
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi artikl' : 'Novi artikl'}
        wide
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Odustani</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Spremi
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Interna šifra" required hint="Jedinstvena šifra za praćenje proizvoda">
              <Input value={f.code} onChange={(e) => setF({ code: e.target.value })} />
            </Field>
            <Field label="Naziv" required>
              <Input value={f.name} onChange={(e) => setF({ name: e.target.value })} />
            </Field>
            <Field label="Kategorija">
              <Select value={f.categoryId ?? ''} onChange={(e) => setF({ categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— bez kategorije —</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dobavljač">
              <Select value={f.supplierId ?? ''} onChange={(e) => setF({ supplierId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— bez dobavljača —</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nabavna cijena (€)" required>
              <NumberInput step="0.0001" min={0} value={f.purchasePrice} onChange={(v) => setF({ purchasePrice: v })} />
            </Field>
            <Field label="Jedinica mjere" required>
              <Select value={f.unit} onChange={(e) => setF({ unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Količina u pakiranju" required hint="Za zaokruživanje preporučene narudžbe na cijela pakiranja">
              <NumberInput step="0.001" min={0} value={f.packSize} onChange={(v) => setF({ packSize: v })} />
            </Field>
            <div />
            <Field label="Minimalna skladišna zaliha" required>
              <NumberInput step="0.001" min={0} value={f.minStock} onChange={(v) => setF({ minStock: v })} />
            </Field>
            <Field label="Ciljana zaliha" required error={f.targetStock !== null && f.minStock !== null && f.targetStock < f.minStock ? 'Ciljana zaliha mora biti ≥ minimalne.' : null}>
              <NumberInput step="0.001" min={0} value={f.targetStock} onChange={(v) => setF({ targetStock: v })} />
            </Field>
            <Field label="Napomena" className="sm:col-span-2">
              <Textarea value={f.note} onChange={(e) => setF({ note: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox checked={f.active} onChange={(v) => setF({ active: v })} label="Aktivan artikl" />
            </div>
            <Alert tone="info" className="sm:col-span-2">
              Trenutno stanje se ne unosi ovdje – mijenja se isključivo kroz skladišne dokumente (početno stanje, ulaz, izlaz, prijenos, inventura) kako bi svaka promjena imala trag u skladišnoj knjizi.
            </Alert>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} title="Obrisati artikl?" danger confirmLabel="Obriši" loading={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)}>
        Artikl <b>{del?.name}</b> bit će obrisan. Ako artikl ima povijest kretanja, umjesto brisanja bit će deaktiviran kako bi se sačuvao revizijski trag.
      </ConfirmDialog>
    </Card>
  );
}

function Categories() {
  const { categories } = useCatalog();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: number | null; name: string } | null>(null);
  const save = useMutation({
    mutationFn: (e: { id: number | null; name: string }) => (e.id ? api.put(`/api/categories/${e.id}`, { name: e.name }) : api.post('/api/categories', { name: e.name })),
    onSuccess: () => {
      setEdit(null);
      toast.success('Kategorija spremljena.');
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/categories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
    onError: (e) => toast.error(e),
  });
  return (
    <Card>
      <DataTable
        rows={categories.data}
        rowKey={(c) => c.id}
        loading={categories.isLoading}
        exportName="kategorije"
        columns={[
          { key: 'name', header: 'Naziv', render: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'product_count', header: 'Broj artikala', align: 'right' },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (c: Category) => (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name })} aria-label="Uredi">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)} aria-label="Obriši">
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  ),
                } as Column<Category>,
              ]
            : []),
        ]}
        toolbar={
          canEdit && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, name: '' })}>
              Nova kategorija
            </Button>
          )
        }
      />
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi kategoriju' : 'Nova kategorija'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Odustani</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Spremi
            </Button>
          </>
        }
      >
        <Field label="Naziv" required>
          <Input value={edit?.name ?? ''} onChange={(e) => setEdit((x) => (x ? { ...x, name: e.target.value } : x))} autoFocus />
        </Field>
      </Modal>
    </Card>
  );
}

interface SupplierForm {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  oib: string;
  address: string;
  note: string;
  active: boolean;
}

function Suppliers() {
  const { suppliers } = useCatalog();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: number | null; form: SupplierForm } | null>(null);
  const save = useMutation({
    mutationFn: (e: { id: number | null; form: SupplierForm }) => (e.id ? api.put(`/api/suppliers/${e.id}`, e.form) : api.post('/api/suppliers', e.form)),
    onSuccess: () => {
      setEdit(null);
      toast.success('Dobavljač spremljen.');
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e) => toast.error(e),
  });
  const set = (p: Partial<SupplierForm>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));
  const f = edit?.form;
  return (
    <Card>
      <DataTable
        rows={suppliers.data}
        rowKey={(s) => s.id}
        loading={suppliers.isLoading}
        exportName="dobavljaci"
        exportTitle="Dobavljači"
        columns={[
          { key: 'name', header: 'Naziv', render: (s) => <span className="font-medium">{s.name}</span> },
          { key: 'contact_person', header: 'Kontakt osoba', render: (s) => s.contact_person ?? '—' },
          { key: 'email', header: 'E-mail', render: (s) => s.email ?? '—' },
          { key: 'phone', header: 'Telefon', render: (s) => s.phone ?? '—' },
          { key: 'oib', header: 'OIB', render: (s) => s.oib ?? '—' },
          { key: 'product_count', header: 'Artikala', align: 'right' },
          { key: 'active', header: 'Status', value: (s) => (s.active ? 'aktivan' : 'neaktivan'), render: (s) => (s.active ? <Badge color="green">aktivan</Badge> : <Badge>neaktivan</Badge>) },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (s: Supplier) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Uredi"
                      onClick={() =>
                        setEdit({
                          id: s.id,
                          form: { name: s.name, contactPerson: s.contact_person ?? '', email: s.email ?? '', phone: s.phone ?? '', oib: s.oib ?? '', address: s.address ?? '', note: s.note ?? '', active: !!s.active },
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  ),
                } as Column<Supplier>,
              ]
            : []),
        ]}
        toolbar={
          canEdit && (
            <Button
              variant="primary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setEdit({ id: null, form: { name: '', contactPerson: '', email: '', phone: '', oib: '', address: '', note: '', active: true } })}
            >
              Novi dobavljač
            </Button>
          )
        }
      />
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi dobavljača' : 'Novi dobavljač'}
        wide
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Odustani</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Spremi
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Naziv" required>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Kontakt osoba">
              <Input value={f.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Telefon">
              <Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field label="OIB">
              <Input value={f.oib} onChange={(e) => set({ oib: e.target.value })} maxLength={11} />
            </Field>
            <Field label="Adresa">
              <Input value={f.address} onChange={(e) => set({ address: e.target.value })} />
            </Field>
            <Field label="Napomena" className="sm:col-span-2">
              <Textarea value={f.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
            <Checkbox checked={f.active} onChange={(v) => set({ active: v })} label="Aktivan dobavljač" />
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface TvProduct {
  id: number;
  ext_key: string;
  source_id: string | null;
  name: string;
  machine_name: string | null;
  last_price: number | null;
  last_seen_at: string;
  product_id: number | null;
  product_code: string | null;
  product_name: string | null;
  sold_qty: number;
}

function TelevendLinks() {
  const { products } = useCatalog();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [linkFor, setLinkFor] = useState<TvProduct | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const tv = useQuery({ queryKey: ['tv-products', onlyUnlinked], queryFn: () => api.get<TvProduct[]>(`/api/televend/products${onlyUnlinked ? '?unlinked=1' : ''}`) });
  const link = useMutation({
    mutationFn: (v: { id: number; productId: number | null }) => api.put(`/api/televend/products/${v.id}/link`, { productId: v.productId }),
    onSuccess: () => {
      toast.success('Povezivanje spremljeno.');
      setLinkFor(null);
      void qc.invalidateQueries({ queryKey: ['tv-products'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card>
      <Alert tone="info" className="mb-4">
        Televend artikli nastaju automatski iz preuzetih podataka. Isti fizički proizvod može imati različite nazive u pojedinim automatima – povežite svaki Televend naziv s jednim lokalnim artiklom (interna šifra). Prodaja nepovezanih artikala vidljiva je u analitici, ali se ne knjiži na zalihe.
      </Alert>
      <DataTable
        rows={tv.data}
        rowKey={(r) => r.id}
        loading={tv.isLoading}
        exportName="televend-artikli"
        empty="Još nema Televend artikala – pojavit će se nakon prve sinkronizacije ili uvoza datoteke."
        toolbar={<Checkbox checked={onlyUnlinked} onChange={setOnlyUnlinked} label="Samo nepovezani" />}
        columns={[
          { key: 'name', header: 'Naziv u Televendu', render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'source_id', header: 'Televend ID', render: (r) => r.source_id ?? '—' },
          { key: 'machine_name', header: 'Automat', render: (r) => r.machine_name ?? 'svi' },
          { key: 'last_price', header: 'Zadnja cijena', align: 'right', render: (r) => fmtMoney(r.last_price) },
          { key: 'sold_qty', header: 'Prodano ukupno', align: 'right', render: (r) => fmtQty(r.sold_qty) },
          {
            key: 'product_name',
            header: 'Lokalni artikl',
            render: (r) => (r.product_id ? <span>{r.product_code} · {r.product_name}</span> : <Badge color="yellow">nije povezan</Badge>),
          },
          ...(canEdit
            ? [
                {
                  key: '_a',
                  header: '',
                  sortable: false,
                  exportable: false,
                  render: (r: TvProduct) => (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Link2 className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setChosen(r.product_id);
                        setLinkFor(r);
                      }}
                    >
                      Poveži
                    </Button>
                  ),
                } as Column<TvProduct>,
              ]
            : []),
        ]}
      />
      <Modal
        open={!!linkFor}
        onClose={() => setLinkFor(null)}
        title="Poveži Televend artikl"
        footer={
          <>
            {linkFor?.product_id && (
              <Button variant="ghost" onClick={() => linkFor && link.mutate({ id: linkFor.id, productId: null })}>
                Ukloni povezivanje
              </Button>
            )}
            <Button onClick={() => setLinkFor(null)}>Odustani</Button>
            <Button variant="primary" disabled={!chosen} loading={link.isPending} onClick={() => linkFor && link.mutate({ id: linkFor.id, productId: chosen })}>
              Spremi
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Televend: <b>{linkFor?.name}</b>
          {linkFor?.machine_name ? ` (automat ${linkFor.machine_name})` : ''}
        </p>
        <Field label="Lokalni artikl">
          <ProductPicker products={products.data} value={chosen} onChange={setChosen} />
        </Field>
      </Modal>
    </Card>
  );
}
