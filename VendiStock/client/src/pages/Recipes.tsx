import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DateRangePicker, ProductPicker, rangeFor, type Range } from '../components/Pickers';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, NumberInput, Select, Textarea } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtNum, fmtQty } from '../lib/format';
import type { Product } from '../lib/types';

interface Recipe {
  id: number;
  name: string;
  tv_product_id: number | null;
  tv_product_name: string | null;
  active: number;
  verified: number;
  note: string | null;
  ingredients: { product_id: number; code: string; name: string; qty: number; unit: string; product_unit: string }[];
}

interface Form {
  name: string;
  tvProductId: number | null;
  active: boolean;
  note: string;
  ingredients: { productId: number | null; qty: number | null; unit: string }[];
}

const INGREDIENT_UNITS = ['g', 'kg', 'ml', 'l', 'kom'];

export default function Recipes() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => api.get<Recipe[]>('/api/recipes') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const tv = useQuery({ queryKey: ['tv-products', false], queryFn: () => api.get<{ id: number; name: string }[]>('/api/televend/products') });
  const [range, setRange] = useState<Range>(rangeFor(30));
  const preview = useQuery({
    queryKey: ['recipe-consumption', range],
    queryFn: () => api.get<{ recipes: { recipe_name: string; sold: number }[]; ingredients: { productId: number; code: string; name: string; unit: string; qty: number; convertible: boolean }[]; note: string }>(`/api/recipes/consumption${qs(range)}`),
  });
  const [edit, setEdit] = useState<{ id: number | null; form: Form } | null>(null);
  const save = useMutation({
    mutationFn: (e: { id: number | null; form: Form }) => {
      const body = {
        name: e.form.name,
        tvProductId: e.form.tvProductId,
        active: e.form.active,
        note: e.form.note || null,
        ingredients: e.form.ingredients.filter((i) => i.productId && i.qty).map((i) => ({ productId: i.productId, qty: i.qty, unit: i.unit })),
      };
      return e.id ? api.put(`/api/recipes/${e.id}`, body) : api.post('/api/recipes', body);
    },
    onSuccess: () => {
      toast.success('Normativ spremljen.');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipe-consumption'] });
    },
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/recipes/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }),
    onError: (e) => toast.error(e),
  });
  const f = edit?.form;
  const setF = (p: Partial<Form>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));

  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Priprema za buduću verziju">
        Normativi (recepture napitaka) služe za budući izračun potrošnje sirovina prema prodanim napicima. U verziji 1.0.0 sastojci se <b>ne razdužuju automatski</b> – dok sustav normativa i povezivanje s Televend
        prodajom ne budu testirani na stvarnim podacima. Prikazane vrijednosti su informativne.
      </Alert>
      <Card
        title="Normativi napitaka"
        actions={
          canEdit && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, form: { name: '', tvProductId: null, active: true, note: '', ingredients: [{ productId: null, qty: null, unit: 'g' }] } })}>
              Novi normativ
            </Button>
          )
        }
      >
        {!recipes.data?.length ? (
          <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Nema definiranih normativa">
            Primjer (samo demonstracija): Kava s mlijekom – kava 7,5 g, mlijeko u prahu 11,2 g, šećer 4,2 g, čaša 1 kom.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {recipes.data.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{r.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">Televend: {r.tv_product_name ?? 'nije povezan'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.active ? <Badge color="green">aktivan</Badge> : <Badge>neaktivan</Badge>}
                    <Badge color="yellow">nije verificiran</Badge>
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Uredi"
                          onClick={() =>
                            setEdit({
                              id: r.id,
                              form: { name: r.name, tvProductId: r.tv_product_id, active: !!r.active, note: r.note ?? '', ingredients: r.ingredients.map((i) => ({ productId: i.product_id, qty: i.qty, unit: i.unit })) },
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Obriši" onClick={() => del.mutate(r.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {r.ingredients.map((i) => (
                    <li key={i.product_id} className="flex justify-between py-1.5">
                      <span>{i.name}</span>
                      <span className="tabular font-medium">
                        {fmtNum(i.qty)} {i.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Teorijska potrošnja sastojaka (informativno)" subtitle="Prodani napitci povezani s normativima × količine iz normativa – ne knjiži se" actions={<DateRangePicker value={range} onChange={setRange} />}>
        {!preview.data?.ingredients.length ? (
          <EmptyState title="Podaci nisu dostupni">Potrebni su aktivni normativi povezani s Televend artiklima i preuzeta prodaja.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-slate-500">
                <th className="py-2 text-left">Sastojak</th>
                <th className="py-2 text-right">Teorijska potrošnja</th>
              </tr>
            </thead>
            <tbody>
              {preview.data.ingredients.map((i) => (
                <tr key={i.productId} className="border-b border-slate-50">
                  <td className="py-2">
                    {i.code} · {i.name}
                  </td>
                  <td className="tabular py-2 text-right">{i.convertible ? fmtQty(i.qty, i.unit) : 'jedinice nisu usklađene'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi normativ' : 'Novi normativ'}
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
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Naziv napitka" required>
                <Input value={f.name} onChange={(e) => setF({ name: e.target.value })} />
              </Field>
              <Field label="Televend artikl (napitak)">
                <Select value={f.tvProductId ?? ''} onChange={(e) => setF({ tvProductId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— nije povezan —</option>
                  {tv.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-600">Sastojci po jednom napitku</div>
              <div className="space-y-2">
                {f.ingredients.map((ing, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_110px_90px_36px] gap-2">
                    <ProductPicker
                      products={products.data}
                      value={ing.productId}
                      onChange={(v) => setF({ ingredients: f.ingredients.map((x, i) => (i === idx ? { ...x, productId: v } : x)) })}
                      placeholder="Sastojak…"
                    />
                    <NumberInput step="0.001" min={0} value={ing.qty} onChange={(v) => setF({ ingredients: f.ingredients.map((x, i) => (i === idx ? { ...x, qty: v } : x)) })} />
                    <Select value={ing.unit} onChange={(e) => setF({ ingredients: f.ingredients.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)) })}>
                      {INGREDIENT_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </Select>
                    <Button variant="ghost" aria-label="Ukloni" onClick={() => setF({ ingredients: f.ingredients.filter((_, i) => i !== idx) })}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setF({ ingredients: [...f.ingredients, { productId: null, qty: null, unit: 'g' }] })}>
                Dodaj sastojak
              </Button>
            </div>
            <Field label="Napomena">
              <Textarea value={f.note} onChange={(e) => setF({ note: e.target.value })} />
            </Field>
            <Checkbox checked={f.active} onChange={(v) => setF({ active: v })} label="Aktivan normativ" />
          </div>
        )}
      </Modal>
    </div>
  );
}
