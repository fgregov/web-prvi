import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, NumberInput } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtMoney, fmtNum } from '../lib/format';
import type { Product } from '../lib/types';
import { useCatalog } from './Products';

/**
 * Ručni unos nabavnih (ulaznih) cijena – jedini ručni unos za artikle koje aplikacija sama stvara iz Televenda.
 * Cijene se mogu unijeti i kod ulaza robe (ažuriraju cijenu artikla).
 */
export default function PurchasePrices() {
  const { products } = useCatalog();
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<number, number | null>>({});
  const [onlyMissing, setOnlyMissing] = useState(true);
  const rows = useMemo(() => (products.data ?? []).filter((p) => p.active && (!onlyMissing || !p.price_set)), [products.data, onlyMissing]);
  const missing = (products.data ?? []).filter((p) => p.active && !p.price_set).length;
  const changed = Object.entries(edits).filter(([, v]) => v !== null && v !== undefined);
  const save = useMutation({
    mutationFn: () => api.put<{ updated: number }>('/api/products/prices', { items: changed.map(([id, v]) => ({ id: Number(id), purchasePrice: v })) }),
    onSuccess: (r) => {
      toast.success(`Spremljeno nabavnih cijena: ${r.updated}.`);
      setEdits({});
      ['products', 'dashboard', 'stock-overview', 'recommendations'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card
      title="Nabavne cijene"
      subtitle="Jedini ručni unos: nabavna (ulazna) cijena. Artikle, automate i kretanja zaliha aplikacija generira iz Televenda."
      actions={
        canEdit && (
          <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>
            Spremi cijene ({changed.length})
          </Button>
        )
      }
    >
      {missing > 0 ? (
        <Alert tone="warning" className="mb-4">
          {missing} aktivnih artikala još nema unesenu nabavnu cijenu – vrijednost skladišta i procjena nabave za njih računaju se s 0 €.
        </Alert>
      ) : (
        <Alert tone="success" className="mb-4">
          Svi aktivni artikli imaju unesenu nabavnu cijenu.
        </Alert>
      )}
      <DataTable
        rows={rows}
        loading={products.isLoading}
        rowKey={(p) => p.id}
        exportName="nabavne-cijene"
        exportTitle="Nabavne cijene"
        pageSize={50}
        dense
        toolbar={<Checkbox checked={onlyMissing} onChange={setOnlyMissing} label="Samo artikli bez unesene cijene" />}
        empty={onlyMissing ? 'Nema artikala bez nabavne cijene.' : 'Nema artikala.'}
        columns={[
          { key: 'code', header: 'Šifra', render: (p: Product) => <span className="font-mono text-xs">{p.code}</span> },
          {
            key: 'name',
            header: 'Artikl',
            render: (p: Product) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-slate-900">{p.name}</span>
                {p.auto_created ? <Badge color="petrol">iz Televenda</Badge> : null}
              </div>
            ),
          },
          { key: 'televend_names', header: 'Naziv u Televendu', render: (p: Product) => <span className="text-xs text-slate-500">{p.televend_names ?? '—'}</span> },
          { key: 'unit', header: 'JM' },
          { key: 'current_stock', header: 'Stanje', align: 'right', exportType: 'qty', render: (p: Product) => fmtNum(p.current_stock) },
          {
            key: 'purchase_price',
            header: 'Nabavna cijena (€)',
            align: 'right',
            exportType: 'money',
            render: (p: Product) =>
              canEdit ? (
                <div className="ml-auto w-32">
                  <NumberInput
                    min={0}
                    step="0.0001"
                    placeholder={p.price_set ? undefined : 'unesite'}
                    value={p.id in edits ? edits[p.id] : p.price_set ? p.purchase_price : null}
                    onChange={(v) => setEdits((e) => ({ ...e, [p.id]: v }))}
                    className="h-8 py-1"
                  />
                </div>
              ) : (
                fmtMoney(p.purchase_price)
              ),
          },
          {
            key: 'price_set',
            header: 'Status',
            value: (p: Product) => (p.price_set ? 'uneseno' : 'nije uneseno'),
            render: (p: Product) => (p.id in edits ? <Badge color="blue">izmijenjeno</Badge> : p.price_set ? <Badge color="green">uneseno</Badge> : <Badge color="yellow">nije uneseno</Badge>),
          },
        ]}
      />
    </Card>
  );
}
