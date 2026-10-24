import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProductPicker } from '../../components/Pickers';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, Input, Modal, NumberInput, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtQty, todayIso } from '../../lib/format';
import type { Location, Product, Supplier } from '../../lib/types';

export type MovementKind = 'receipt' | 'issue' | 'transfer' | 'opening';

export interface Line {
  productId: number | null;
  qty: number | null;
  price: number | null;
}

export interface MovementDraft {
  kind: MovementKind;
  docDate: string;
  supplierId: number | null;
  documentRef: string;
  note: string;
  destinationType: 'vehicle' | 'machine' | 'other';
  destinationLocationId: number | null;
  fromLocationId: number | null;
  toLocationId: number | null;
  locationId: number | null;
  lines: Line[];
}

export const TITLES: Record<MovementKind, string> = {
  receipt: 'Ulaz robe',
  issue: 'Izlaz robe',
  transfer: 'Prijenos robe',
  opening: 'Početno stanje',
};

export function newDraft(kind: MovementKind): MovementDraft {
  return {
    kind,
    docDate: todayIso(),
    supplierId: null,
    documentRef: '',
    note: '',
    destinationType: 'vehicle',
    destinationLocationId: null,
    fromLocationId: null,
    toLocationId: null,
    locationId: null,
    lines: [{ productId: null, qty: null, price: null }],
  };
}

export function draftToBody(d: MovementDraft) {
  const lines = d.lines.filter((l) => l.productId && l.qty);
  const note = d.note.trim() || null;
  if (d.kind === 'receipt') {
    return { docDate: d.docDate, supplierId: d.supplierId, documentRef: d.documentRef.trim() || null, note, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.price })) };
  }
  if (d.kind === 'issue') {
    return {
      docDate: d.docDate,
      destinationType: d.destinationType,
      destinationLocationId: d.destinationType === 'other' ? null : d.destinationLocationId,
      note,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    };
  }
  if (d.kind === 'transfer') {
    return { docDate: d.docDate, fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, note, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) };
  }
  return { docDate: d.docDate, locationId: d.locationId, note, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.price })) };
}

const ENDPOINT: Record<MovementKind, string> = {
  receipt: '/api/stock/receipts',
  issue: '/api/stock/issues',
  transfer: '/api/stock/transfers',
  opening: '/api/stock/openings',
};

/**
 * Obrazac skladišnog dokumenta (ulaz, izlaz, prijenos, početno stanje).
 * U načinu ispravka (correctId) sprema se kao storno originala + novi dokument.
 */
export function MovementForm({ draft, onClose, correctId }: { draft: MovementDraft | null; onClose: () => void; correctId?: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<MovementDraft | null>(draft);
  const [reason, setReason] = useState('');
  useEffect(() => {
    setD(draft);
    setReason('');
  }, [draft]);
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/api/products') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/api/suppliers') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<Location[]>('/api/locations') });
  const balances = useQuery({
    queryKey: ['balances', 'all'],
    queryFn: () => api.get<{ product_id: number; location_id: number; qty: number }[]>('/api/stock/balances'),
    enabled: !!d,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!d) return null;
      const body = draftToBody(d);
      if (correctId) return api.post<{ replacement: { docNo: string } }>(`/api/stock/movements/${correctId}/correct`, { reason, type: d.kind, data: body });
      return api.post<{ docNo: string }>(ENDPOINT[d.kind], body);
    },
    onSuccess: (r) => {
      const docNo = r && 'replacement' in r ? r.replacement.docNo : (r as { docNo: string } | null)?.docNo;
      toast.success(correctId ? `Ispravak proknjižen (novi dokument ${docNo}).` : `Dokument ${docNo} proknjižen.`);
      for (const k of ['products', 'stock-overview', 'balances', 'movements', 'history', 'dashboard', 'recommendations']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  if (!d) return null;
  const set = (p: Partial<MovementDraft>) => setD({ ...d, ...p });
  const setLine = (i: number, p: Partial<Line>) => set({ lines: d.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) });
  const locs = (locations.data ?? []).filter((l) => l.active);
  const central = locs.find((l) => l.type === 'central');
  const sourceLocationId = d.kind === 'issue' ? central?.id : d.kind === 'transfer' ? d.fromLocationId : null;
  const available = (productId: number | null) =>
    productId && sourceLocationId ? (balances.data?.find((b) => b.product_id === productId && b.location_id === sourceLocationId)?.qty ?? 0) : null;
  const unitOf = (productId: number | null) => products.data?.find((p) => p.id === productId)?.unit ?? '';
  const showPrice = d.kind === 'receipt' || d.kind === 'opening';
  const total = showPrice ? d.lines.reduce((s, l) => s + (l.qty ?? 0) * (l.price ?? 0), 0) : 0;

  return (
    <Modal
      open={!!d}
      onClose={onClose}
      wide
      title={correctId ? `Ispravak dokumenta – ${TITLES[d.kind]}` : TITLES[d.kind]}
      footer={
        <>
          <Button onClick={onClose}>Odustani</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!!correctId && reason.trim().length < 3}>
            {correctId ? 'Proknjiži ispravak' : d.kind === 'receipt' ? 'Potvrdi ulaz' : d.kind === 'issue' ? 'Potvrdi izlaz' : d.kind === 'transfer' ? 'Potvrdi prijenos' : 'Proknjiži početno stanje'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {correctId && (
          <Alert tone="warning">
            Originalni dokument neće biti izbrisan: bit će storniran, a ovaj sadržaj proknjižen kao novi dokument. Oba ostaju u revizijskom tragu.
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={d.kind === 'receipt' ? 'Datum ulaza' : d.kind === 'issue' ? 'Datum izlaza' : 'Datum'} required>
            <Input type="date" value={d.docDate} max={todayIso()} onChange={(e) => set({ docDate: e.target.value })} />
          </Field>
          {d.kind === 'receipt' && (
            <>
              <Field label="Dobavljač">
                <Select value={d.supplierId ?? ''} onChange={(e) => set({ supplierId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— odaberite —</option>
                  {suppliers.data?.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Broj dokumenta (neobavezno)">
                <Input value={d.documentRef} onChange={(e) => set({ documentRef: e.target.value })} placeholder="npr. otpremnica / račun" />
              </Field>
            </>
          )}
          {d.kind === 'issue' && (
            <>
              <Field label="Odredište" required>
                <Select value={d.destinationType} onChange={(e) => set({ destinationType: e.target.value as MovementDraft['destinationType'], destinationLocationId: null })}>
                  <option value="vehicle">Vozilo</option>
                  <option value="machine">Samoposlužni automat</option>
                  <option value="other">Ostalo (potrošnja, otpis…)</option>
                </Select>
              </Field>
              {d.destinationType !== 'other' && (
                <Field label={d.destinationType === 'vehicle' ? 'Vozilo' : 'Automat'} required>
                  <Select value={d.destinationLocationId ?? ''} onChange={(e) => set({ destinationLocationId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— odaberite —</option>
                    {locs
                      .filter((l) => l.type === d.destinationType)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
            </>
          )}
          {d.kind === 'transfer' && (
            <>
              <Field label="Iz lokacije" required>
                <Select value={d.fromLocationId ?? ''} onChange={(e) => set({ fromLocationId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— odaberite —</option>
                  {locs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="U lokaciju" required>
                <Select value={d.toLocationId ?? ''} onChange={(e) => set({ toLocationId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— odaberite —</option>
                  {locs
                    .filter((l) => l.id !== d.fromLocationId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </>
          )}
          {d.kind === 'opening' && (
            <Field label="Lokacija" required>
              <Select value={d.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— odaberite —</option>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {d.kind === 'issue' && (
          <p className="text-xs text-slate-500">
            Izlaz smanjuje stanje centralnog skladišta. Ako je odredište vozilo ili automat, ista količina povećava stanje odredišta (ukupna količina robe se ne mijenja).
          </p>
        )}
        {d.kind === 'opening' && <p className="text-xs text-slate-500">Početno stanje unosi se jednom po artiklu i lokaciji. Kasnije razlike ispravljaju se inventurom.</p>}

        <div>
          <div className={`mb-1.5 hidden gap-2 text-xs font-medium text-slate-500 sm:grid ${showPrice ? 'sm:grid-cols-[1fr_120px_130px_36px]' : 'sm:grid-cols-[1fr_120px_36px]'}`}>
            <span>Artikl</span>
            <span className="text-right">Količina</span>
            {showPrice && <span className="text-right">Nabavna cijena (€)</span>}
            <span />
          </div>
          <div className="space-y-2">
            {d.lines.map((l, i) => {
              const av = available(l.productId);
              const insufficient = av !== null && l.qty !== null && l.qty > av;
              return (
                <div key={i}>
                  <div className={`grid grid-cols-1 gap-2 ${showPrice ? 'sm:grid-cols-[1fr_120px_130px_36px]' : 'sm:grid-cols-[1fr_120px_36px]'}`}>
                    <ProductPicker
                      products={products.data}
                      value={l.productId}
                      onChange={(v) => {
                        const p = products.data?.find((x) => x.id === v);
                        setLine(i, { productId: v, price: showPrice && l.price === null && p ? p.purchase_price : l.price });
                      }}
                    />
                    <NumberInput step="0.001" min={0} placeholder="0" value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
                    {showPrice && <NumberInput step="0.0001" min={0} placeholder="0,00" value={l.price} onChange={(v) => setLine(i, { price: v })} />}
                    <Button variant="ghost" aria-label="Ukloni stavku" disabled={d.lines.length === 1} onClick={() => set({ lines: d.lines.filter((_, x) => x !== i) })}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                  {av !== null && (
                    <p className={`mt-0.5 text-xs ${insufficient ? 'text-red-600' : 'text-slate-500'}`}>
                      Raspoloživo na polaznoj lokaciji: {fmtQty(av, unitOf(l.productId))}
                      {insufficient && ' – nedovoljna količina'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set({ lines: [...d.lines, { productId: null, qty: null, price: null }] })}>
              Dodaj stavku
            </Button>
            {showPrice && total > 0 && <span className="tabular text-sm text-slate-600">Ukupno: {total.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</span>}
          </div>
        </div>
        <Field label="Napomena">
          <Textarea value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        {correctId && (
          <Field label="Razlog ispravka" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="npr. pogrešno unesena količina" />
          </Field>
        )}
      </div>
    </Modal>
  );
}
