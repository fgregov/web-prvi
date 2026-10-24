import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Upload as UploadIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { ColumnMapper, PreviewView, useDatasetDefs, type Preview } from './DataSources';
import { useTelevendState, type DatasetConfig } from './TelevendSettings';

interface ImportResult {
  summary: { batchId: number; status: string; rowsTotal: number; inserted: number; updated: number; duplicate: number; rejected: number; message: string | null; missingColumns: string[] };
  posting: { enabled: boolean; posted: number; reversed: number; unmapped: number } | null;
}

/** Ručni uvoz datoteke izvezene s Televend portala – isti parser, mapiranje i kontrola duplikata kao sinkronizacija. */
export default function Upload() {
  const toast = useToast();
  const qc = useQueryClient();
  const st = useTelevendState();
  const defs = useDatasetDefs();
  const [dataset, setDataset] = useState('sales');
  const [file, setFile] = useState<File | null>(null);
  const [cfg, setCfg] = useState<DatasetConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saveMapping, setSaveMapping] = useState(true);

  useEffect(() => {
    if (st.data) setCfg(st.data.config.datasets[dataset]);
    setPreview(null);
    setResult(null);
  }, [dataset, st.data]);

  const previewM = useMutation({
    mutationFn: () => api.upload<Preview>(`/api/televend/upload/${dataset}/preview`, file!, { config: JSON.stringify(cfg) }),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
    },
    onError: (e) => toast.error(e),
  });
  const importM = useMutation({
    mutationFn: async () => {
      const r = await api.upload<ImportResult>(`/api/televend/upload/${dataset}/import`, file!, { config: JSON.stringify(cfg) });
      if (saveMapping && r.summary.status === 'committed' && st.data?.config) {
        await api.put(`/api/televend/datasets/${dataset}`, { ...cfg, enabled: st.data.config.datasets[dataset].enabled }).catch(() => undefined);
      }
      return r;
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.summary.status === 'committed') toast.success(`Uvezeno: ${r.summary.inserted} novih, ${r.summary.updated} ažuriranih, ${r.summary.duplicate} duplikata preskočeno.`);
      else toast.error(r.summary.message ?? 'Uvoz odbijen.');
      ['dashboard', 'analytics', 'machines', 'tv-products', 'imports', 'televend-state', 'stock-overview'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(e),
  });

  if (!defs.data || !cfg) return <Spinner />;
  const def = defs.data.find((d) => d.key === dataset)!;
  return (
    <div className="space-y-6">
      <Alert tone="info" title="Kada koristiti ručni uvoz">
        Kad automatsko preuzimanje još nije konfigurirano ili za provjeru stvarnog formata izvještaja: na Televend portalu izvezite izvještaj (CSV ili XLSX) i učitajte ga ovdje. Uvoz koristi istu kontrolu duplikata kao sinkronizacija – ponovni uvoz iste datoteke ili preklapajućeg razdoblja ne stvara dvostruke zapise.
      </Alert>
      <Card title="Uvoz datoteke izvoza">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Skup podataka">
            <Select value={dataset} onChange={(e) => setDataset(e.target.value)}>
              {defs.data.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Datoteka (CSV ili XLSX, najviše 25 MB)" className="md:col-span-2">
            <input
              type="file"
              accept=".csv,.txt,.xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-petrol-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-petrol-800 hover:file:bg-petrol-100"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button icon={<Eye className="h-4 w-4" />} disabled={!file} loading={previewM.isPending} onClick={() => previewM.mutate()}>
            Pregledaj datoteku
          </Button>
        </div>
      </Card>
      {preview && (
        <>
          <Card title="Mapiranje stupaca" subtitle="Odaberite koji stupac izvještaja odgovara kojem podatku – zatim ponovno pregledajte">
            <ColumnMapper def={def} cfg={cfg} headers={preview.headers} onChange={setCfg} />
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              <Button icon={<Eye className="h-4 w-4" />} loading={previewM.isPending} onClick={() => previewM.mutate()}>
                Ponovno pregledaj s mapiranjem
              </Button>
              <Button variant="primary" icon={<UploadIcon className="h-4 w-4" />} loading={importM.isPending} disabled={preview.missingColumns.length > 0 || preview.validRows === 0} onClick={() => importM.mutate()}>
                Uvezi {preview.validRows} redaka
              </Button>
              <Checkbox checked={saveMapping} onChange={setSaveMapping} label="Spremi mapiranje za ovaj skup podataka" />
            </div>
          </Card>
          <Card title="Pregled datoteke">
            <PreviewView preview={preview} />
          </Card>
        </>
      )}
      {result && (
        <Card title="Rezultat uvoza">
          {result.summary.status === 'committed' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge color="green">novih: {result.summary.inserted}</Badge>
                <Badge color="blue">ažuriranih (ispravci/storna): {result.summary.updated}</Badge>
                <Badge>duplikata preskočeno: {result.summary.duplicate}</Badge>
                <Badge color={result.summary.rejected ? 'red' : 'gray'}>odbijenih redaka: {result.summary.rejected}</Badge>
              </div>
              {result.posting && (
                <p className="text-sm text-slate-600">
                  {result.posting.enabled
                    ? `Knjiženje na zalihe automata: ${result.posting.posted} knjiženo, ${result.posting.reversed} stornirano, ${result.posting.unmapped} čeka povezivanje artikla.`
                    : 'Knjiženje prodaje na zalihe automata nije uključeno (Postavke → Skladište).'}
                </p>
              )}
            </div>
          ) : (
            <Alert tone="error" title="Uvoz odbijen – ništa nije zapisano">
              {result.summary.message}
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
