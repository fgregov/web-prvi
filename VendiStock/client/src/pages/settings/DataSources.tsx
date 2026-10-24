import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Eye, FileSpreadsheet, Save, Table2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, NumberInput, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { StepsLog, useTelevendState, type DatasetConfig } from './TelevendSettings';

export interface DatasetDef {
  key: string;
  label: string;
  fields: { key: string; label: string; required?: boolean; kind: string }[];
}

export interface Preview {
  headerRowIndex: number;
  headers: string[];
  sampleRows: unknown[][];
  missingColumns: string[];
  totalRows: number;
  validRows: number;
  rejectedRows: { rowNo: number; reason: string }[];
  sampleRecords: Record<string, unknown>[];
  steps?: { at: string; level: 'info' | 'warn' | 'error'; message: string }[];
  format?: string;
  encoding?: string | null;
  delimiter?: string | null;
  source?: { kind: string; fileName?: string; format?: string; pages?: number };
}

interface DiscoveryReport {
  startedAt: string;
  landingUrl: string;
  landingTitle: string;
  navigation: { text: string; path: string }[];
  pages: {
    url: string;
    path: string;
    linkText: string | null;
    title: string;
    heading: string | null;
    tables: { selector: string; headers: string[]; rowCount: number }[];
    grids: { selector: string; headers: string[] }[];
    exports: { text: string; tag: string; href: string | null }[];
    dateInputs: { selector: string; type: string; name: string | null; placeholder: string | null }[];
    error?: string;
  }[];
  skippedLinks: { text: string; path: string; reason: string }[];
  blockedRequests: string[];
  summary: { pagesVisited: number; pagesWithTables: number; pagesWithExports: number; exportCandidates: number };
}

export const useDatasetDefs = () => useQuery({ queryKey: ['tv-datasets'], queryFn: () => api.get<DatasetDef[]>('/api/televend/datasets'), staleTime: Infinity });

/** Mapiranje stupaca izvještaja na polja VendiStocka (prema stvarnim zaglavljima iz pregleda). */
export function ColumnMapper({ def, cfg, headers, onChange }: { def: DatasetDef; cfg: DatasetConfig; headers: string[]; onChange: (c: DatasetConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {def.fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required}>
            {headers.length ? (
              <Select value={cfg.columns[f.key] ?? ''} onChange={(e) => onChange({ ...cfg, columns: { ...cfg.columns, [f.key]: e.target.value } })}>
                <option value="">— nije mapirano —</option>
                {headers.filter(Boolean).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
                {cfg.columns[f.key] && !headers.includes(cfg.columns[f.key]) && <option value={cfg.columns[f.key]}>{cfg.columns[f.key]} (nije u izvještaju)</option>}
              </Select>
            ) : (
              <Input value={cfg.columns[f.key] ?? ''} placeholder="naziv stupca u izvještaju" onChange={(e) => onChange({ ...cfg, columns: { ...cfg.columns, [f.key]: e.target.value } })} />
            )}
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Format datuma (neobavezno)" hint="npr. dd.MM.yyyy HH:mm:ss; prazno = automatski">
          <Input value={cfg.dateFormat ?? ''} onChange={(e) => onChange({ ...cfg, dateFormat: e.target.value || null })} className="font-mono text-xs" />
        </Field>
        <Field label="Decimalni separator">
          <Select value={cfg.decimalSeparator} onChange={(e) => onChange({ ...cfg, decimalSeparator: e.target.value as DatasetConfig['decimalSeparator'] })}>
            <option value="auto">automatski</option>
            <option value=",">zarez (1.234,56)</option>
            <option value=".">točka (1,234.56)</option>
          </Select>
        </Field>
        <Field label="Redak zaglavlja" hint="prazno = automatski">
          <NumberInput min={1} max={50} value={cfg.headerRow} onChange={(v) => onChange({ ...cfg, headerRow: v })} />
        </Field>
        <Field label="Najviše odbijenih redaka (%)" hint="Iznad praga izvještaj se ne uvozi">
          <NumberInput min={0} max={100} value={cfg.maxRejectedPercent} onChange={(v) => onChange({ ...cfg, maxRejectedPercent: v ?? 5 })} />
        </Field>
      </div>
      {def.key === 'sales' && (
        <Field label="Vrijednosti statusa koje znače storno (odvojene zarezom)">
          <Input value={cfg.cancelledValues.join(', ')} onChange={(e) => onChange({ ...cfg, cancelledValues: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      )}
      {def.key !== 'machines' && (
        <Checkbox
          checked={cfg.productsPerMachine}
          onChange={(v) => onChange({ ...cfg, productsPerMachine: v })}
          label="Nazivi artikala su specifični po automatu"
          hint="Uključite ako isti naziv u dva automata može označavati različite proizvode"
        />
      )}
    </div>
  );
}

export function PreviewView({ preview }: { preview: Preview }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge color="petrol">redaka: {preview.totalRows}</Badge>
        <Badge color="green">ispravnih: {preview.validRows}</Badge>
        {preview.rejectedRows.length > 0 && <Badge color="red">odbijenih: {preview.totalRows - preview.validRows}</Badge>}
        {preview.format && <Badge>format: {preview.format}</Badge>}
        {preview.encoding && <Badge>kodiranje: {preview.encoding}</Badge>}
        {preview.delimiter && <Badge>separator: {preview.delimiter === '\t' ? 'TAB' : preview.delimiter}</Badge>}
        {preview.source?.fileName && <Badge>datoteka: {preview.source.fileName}</Badge>}
      </div>
      {preview.missingColumns.length > 0 && (
        <Alert tone="warning" title="Mapiranje nije potpuno">
          {preview.missingColumns.join('; ')}
        </Alert>
      )}
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Stvarna zaglavlja izvještaja (redak {preview.headerRowIndex + 1})</div>
        <div className="flex flex-wrap gap-1">
          {preview.headers.filter(Boolean).map((h) => (
            <code key={h} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              {h}
            </code>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {preview.headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.sampleRows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-700">
                    {c === null ? '' : String(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.sampleRecords.length > 0 && (
        <details className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">Kako će VendiStock protumačiti prve retke</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(preview.sampleRecords.slice(0, 5), null, 2)}</pre>
        </details>
      )}
      {preview.rejectedRows.length > 0 && (
        <details className="rounded-lg border border-red-200 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-red-700">Odbijeni redci</summary>
          <ul className="mt-2 space-y-0.5">
            {preview.rejectedRows.map((r) => (
              <li key={r.rowNo}>
                Redak {r.rowNo}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function DataSources() {
  const toast = useToast();
  const qc = useQueryClient();
  const st = useTelevendState();
  const defs = useDatasetDefs();
  const discovery = useQuery({ queryKey: ['tv-discovery'], queryFn: () => api.get<{ id: number; createdAt: string; report: DiscoveryReport } | null>('/api/televend/discovery') });
  const [dataset, setDataset] = useState('sales');
  const [cfg, setCfg] = useState<DatasetConfig | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [discSteps, setDiscSteps] = useState<Preview['steps'] | null>(null);

  useEffect(() => {
    if (st.data) {
      setCfg(st.data.config.datasets[dataset]);
      setPreview(null);
    }
  }, [dataset, st.data?.config.datasets]);

  const discover = useMutation({
    mutationFn: () => api.post<{ report: DiscoveryReport | null; login: { status: string; message: string }; steps: Preview['steps'] }>('/api/televend/discover', { maxPages: 40 }),
    onSuccess: (r) => {
      setDiscSteps(r.steps ?? null);
      if (r.report) toast.success(`Istraživanje završeno: ${r.report.summary.pagesVisited} stranica, ${r.report.summary.exportCandidates} kandidata za izvoz.`);
      else toast.error(`Prijava nije uspjela: ${r.login.message}`);
      void qc.invalidateQueries({ queryKey: ['tv-discovery'] });
      void qc.invalidateQueries({ queryKey: ['televend-state'] });
    },
    onError: (e) => toast.error(e),
  });
  const save = useMutation({
    mutationFn: () => api.put(`/api/televend/datasets/${dataset}`, cfg),
    onSuccess: () => {
      toast.success('Konfiguracija izvora spremljena.');
      void qc.invalidateQueries({ queryKey: ['televend-state'] });
    },
    onError: (e) => toast.error(e),
  });
  const test = useMutation({
    mutationFn: () => api.post<Preview>(`/api/televend/datasets/${dataset}/preview-portal`, cfg),
    onSuccess: (p) => setPreview(p),
    onError: (e) => {
      toast.error(e);
      const steps = (e as { details?: { steps?: Preview['steps'] } }).details?.steps;
      if (steps) setDiscSteps(steps);
    },
  });

  if (!st.data || !defs.data || !cfg) return <Spinner />;
  const def = defs.data.find((d) => d.key === dataset)!;
  const rep = discovery.data?.report;
  const connected = ['connected'].includes(st.data.status.state);
  const set = (p: Partial<DatasetConfig>) => setCfg({ ...cfg, ...p });

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Ništa se ne pretpostavlja">
        VendiStock ne izmišlja adrese stranica, selektore ni nazive stupaca Televend portala. Nakon uspješne prijave pokrenite <b>Istraži portal</b>: obilaze se poveznice izbornika (samo čitanje) i bilježe tablice i gumbi za izvoz. Zatim za svaki skup podataka zadajte stvarnu stranicu, način preuzimanja (prednost: CSV/XLSX izvoz) i mapiranje stupaca te ga provjerite gumbom „Testiraj izvor”. Ako se struktura ne može utvrditi, izvezite izvještaj ručno s portala i učitajte ga u kartici „Uvoz datoteke”.
      </Alert>

      <Card
        title="Istraživanje portala"
        subtitle={rep ? `Posljednje: ${fmtDateTime(discovery.data!.createdAt)} · početna stranica „${rep.landingTitle}”` : 'Još nije pokrenuto'}
        actions={
          <Button variant="primary" icon={<Compass className="h-4 w-4" />} loading={discover.isPending} disabled={!connected && st.data.status.state !== 'configured'} onClick={() => discover.mutate()}>
            Istraži portal
          </Button>
        }
      >
        {!connected && <Alert tone="warning" className="mb-4">Najprije uspješno testirajte povezivanje (kartica „Televend Cloud”).</Alert>}
        {discSteps && (
          <div className="mb-4">
            <StepsLog steps={discSteps} />
          </div>
        )}
        {!rep ? (
          <EmptyState icon={<Compass className="h-8 w-8" />} title="Nema izvještaja istraživanja" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge color="petrol">stranica: {rep.summary.pagesVisited}</Badge>
              <Badge color="blue">s tablicama: {rep.summary.pagesWithTables}</Badge>
              <Badge color="green">s izvozom: {rep.summary.pagesWithExports}</Badge>
              <Badge>kandidata za izvoz: {rep.summary.exportCandidates}</Badge>
              {rep.blockedRequests.length > 0 && <Badge color="yellow">blokirano: {rep.blockedRequests.length}</Badge>}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Stranica</th>
                    <th className="px-3 py-2 text-left">Tablice (zaglavlja)</th>
                    <th className="px-3 py-2 text-left">Mogućnosti izvoza</th>
                    <th className="px-3 py-2 text-left">Polja za datum</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {rep.pages.map((p) => (
                    <tr key={p.url}>
                      <td className="max-w-[240px] px-3 py-2">
                        <div className="font-medium text-slate-800">{p.linkText || p.heading || p.title || '—'}</div>
                        <div className="break-all font-mono text-[11px] text-slate-500">{p.path}</div>
                        {p.error && <div className="text-red-600">{p.error}</div>}
                      </td>
                      <td className="max-w-[320px] px-3 py-2">
                        {p.tables.map((t) => (
                          <div key={t.selector} className="mb-1">
                            <code className="text-[11px] text-petrol-800">{t.selector}</code> · {t.rowCount} red.
                            <div className="text-slate-500">{t.headers.join(' | ') || 'bez zaglavlja'}</div>
                          </div>
                        ))}
                        {p.grids.map((g) => (
                          <div key={g.selector} className="mb-1 text-slate-500">
                            grid: {g.headers.join(' | ')}
                          </div>
                        ))}
                        {!p.tables.length && !p.grids.length && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="max-w-[260px] px-3 py-2">
                        {p.exports.map((x, i) => (
                          <div key={i}>
                            <Badge color="green">{x.tag}</Badge> {x.text || x.href}
                          </div>
                        ))}
                        {!p.exports.length && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {p.dateInputs.map((d) => (
                          <div key={d.selector}>
                            <code className="text-[11px]">{d.selector}</code>
                          </div>
                        ))}
                        {!p.dateInputs.length && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const exp = p.exports[0];
                            set({
                              pageUrl: p.path,
                              method: exp ? 'export' : 'table',
                              exportTrigger: exp && exp.text ? { by: 'text', value: exp.text } : cfg.exportTrigger,
                              tableSelector: !exp && p.tables[0] ? p.tables[0].selector : cfg.tableSelector,
                            });
                            toast.success(`Stranica ${p.path} postavljena kao izvor za „${def.label}”. Provjerite i spremite konfiguraciju.`);
                          }}
                        >
                          Koristi za odabrani izvor
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rep.skippedLinks.length > 0 && (
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Preskočene poveznice ({rep.skippedLinks.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {rep.skippedLinks.map((l, i) => (
                    <li key={i}>
                      {l.text} <code>{l.path}</code> – {l.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Konfiguracija izvora podataka"
        subtitle="Za svaki skup podataka: stranica portala, način preuzimanja i mapiranje stupaca"
        actions={
          <Select value={dataset} onChange={(e) => setDataset(e.target.value)} className="h-9 w-80 py-1">
            {defs.data.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label} {st.data!.config.datasets[d.key]?.enabled ? '✓' : ''}
              </option>
            ))}
          </Select>
        }
      >
        <div className="space-y-5">
          <Checkbox checked={cfg.enabled} onChange={(v) => set({ enabled: v })} label={`Uključi „${def.label}” u sinkronizaciju`} hint="Uključite tek nakon uspješnog testa izvora" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Stranica na portalu" required hint="Putanja ili puni URL; predlošci {from:dd.MM.yyyy} i {to:dd.MM.yyyy}" className="md:col-span-2">
              <Input value={cfg.pageUrl} onChange={(e) => set({ pageUrl: e.target.value })} className="font-mono text-xs" placeholder="/putanja-sa-stvarnog-portala" />
            </Field>
            <Field label="Način preuzimanja">
              <Select value={cfg.method} onChange={(e) => set({ method: e.target.value as DatasetConfig['method'] })}>
                <option value="export">Izvoz datoteke (CSV/XLSX) – preporučeno</option>
                <option value="table">Čitanje tablice sa stranice</option>
              </Select>
            </Field>
          </div>
          {cfg.method === 'export' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Gumb za izvoz – način">
                <Select value={cfg.exportTrigger?.by ?? ''} onChange={(e) => set({ exportTrigger: e.target.value ? { by: e.target.value as 'text', value: cfg.exportTrigger?.value ?? '' } : null })}>
                  <option value="">nema (adresa je izravna poveznica na datoteku)</option>
                  <option value="text">prema tekstu gumba</option>
                  <option value="selector">prema CSS selektoru</option>
                </Select>
              </Field>
              {cfg.exportTrigger && (
                <Field label={cfg.exportTrigger.by === 'text' ? 'Tekst gumba (s portala)' : 'CSS selektor gumba'} className="md:col-span-2">
                  <Input value={cfg.exportTrigger.value} onChange={(e) => set({ exportTrigger: { ...cfg.exportTrigger!, value: e.target.value } })} />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Selektor tablice" required>
                <Input value={cfg.tableSelector ?? ''} onChange={(e) => set({ tableSelector: e.target.value || null })} className="font-mono text-xs" placeholder="npr. table#sales ili table >> nth=0" />
              </Field>
              <Field label="Selektor „sljedeća stranica” (neobavezno)">
                <Input value={cfg.nextPageSelector ?? ''} onChange={(e) => set({ nextPageSelector: e.target.value || null })} className="font-mono text-xs" />
              </Field>
              <Field label="Najviše stranica">
                <NumberInput min={1} max={200} value={cfg.maxPages} onChange={(v) => set({ maxPages: v ?? 20 })} />
              </Field>
            </div>
          )}
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Polja filtra prije preuzimanja (npr. razdoblje) i gumb „Prikaži”</summary>
            <div className="mt-3 space-y-2">
              {cfg.fills.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input value={f.selector} placeholder="CSS selektor polja" className="font-mono text-xs" onChange={(e) => set({ fills: cfg.fills.map((x, j) => (j === i ? { ...x, selector: e.target.value } : x)) })} />
                  <Input value={f.value} placeholder="{from:dd.MM.yyyy}" className="font-mono text-xs" onChange={(e) => set({ fills: cfg.fills.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <Button variant="ghost" onClick={() => set({ fills: cfg.fills.filter((_, j) => j !== i) })}>
                    Ukloni
                  </Button>
                </div>
              ))}
              <Button size="sm" onClick={() => set({ fills: [...cfg.fills, { selector: '', value: '' }] })}>
                Dodaj polje
              </Button>
              <div className="grid grid-cols-1 gap-2 pt-2 md:grid-cols-3">
                <Select value={cfg.applyTrigger?.by ?? ''} onChange={(e) => set({ applyTrigger: e.target.value ? { by: e.target.value as 'text', value: cfg.applyTrigger?.value ?? '' } : null })}>
                  <option value="">bez gumba „Prikaži”</option>
                  <option value="text">gumb prema tekstu</option>
                  <option value="selector">gumb prema selektoru</option>
                </Select>
                {cfg.applyTrigger && <Input className="md:col-span-2" value={cfg.applyTrigger.value} onChange={(e) => set({ applyTrigger: { ...cfg.applyTrigger!, value: e.target.value } })} />}
              </div>
            </div>
          </details>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-800">Mapiranje stupaca</h4>
            <ColumnMapper def={def} cfg={cfg} headers={preview?.headers ?? []} onChange={setCfg} />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>
              Spremi konfiguraciju izvora
            </Button>
            <Button icon={<Eye className="h-4 w-4" />} loading={test.isPending} disabled={!connected || !cfg.pageUrl} onClick={() => test.mutate()}>
              Testiraj izvor (bez uvoza)
            </Button>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              {cfg.method === 'export' ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
              Test preuzima podatke s portala i prikazuje kako bi bili protumačeni – ništa se ne zapisuje.
            </span>
          </div>
        </div>
      </Card>
      {preview && (
        <Card title={`Rezultat testa izvora – ${def.label}`}>
          {preview.steps && (
            <div className="mb-4">
              <StepsLog steps={preview.steps} />
            </div>
          )}
          <PreviewView preview={preview} />
        </Card>
      )}
    </div>
  );
}
