import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, KeyRound, Pencil, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { DateRangePicker, rangeFor, type Range } from '../../components/Pickers';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, KeyValue, Modal, NumberInput, Select, Spinner } from '../../components/ui';
import { api, download, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtBytes, fmtDateTime, todayIso } from '../../lib/format';

// ---------------------------------------------------------------- Automatizacija, skladište i nabava
interface AutomationOverview {
  settings: {
    autoCreateProducts: boolean;
    autoPostSales: boolean;
    autoBookRefills: boolean;
    autoSyncMachineStock: boolean;
    refillSourceLocationId: number | null;
    startDate: string | null;
  };
  productsWithoutPrice: number;
  autoCreatedProducts: number;
  negativeCentral: number;
  pendingRefills: number;
  autoMovements: number;
}

export function InventorySettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['inventory-settings'],
    queryFn: () => api.get<{ inventory: { updatePurchasePriceOnReceipt: boolean }; procurement: { roundToPacks: boolean } }>('/api/settings/inventory'),
  });
  const auto = useQuery({ queryKey: ['automation'], queryFn: () => api.get<AutomationOverview>('/api/settings/automation') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: number; name: string; type: string; active: number }[]>('/api/locations') });
  const [f, setF] = useState<{ updatePurchasePriceOnReceipt: boolean; roundToPacks: boolean } | null>(null);
  const [a, setA] = useState<AutomationOverview['settings'] | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ ...q.data.inventory, roundToPacks: q.data.procurement.roundToPacks });
  }, [q.data, f]);
  useEffect(() => {
    if (auto.data && !a) setA(auto.data.settings);
  }, [auto.data, a]);
  const invalidate = () => ['inventory-settings', 'automation', 'stock-overview', 'recommendations', 'dashboard', 'products'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const save = useMutation({
    mutationFn: () => api.put('/api/settings/inventory', f),
    onSuccess: () => {
      toast.success('Postavke spremljene.');
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  const saveAuto = useMutation({
    mutationFn: () => api.put<{ createdProducts: number; sales: { posted: number }; refills: { booked: number; reconciled: number } }>('/api/settings/automation', a),
    onSuccess: (r) => {
      toast.success(`Automatizacija spremljena. Novih artikala: ${r.createdProducts}, knjiženo prodaja: ${r.sales.posted}, dopuna: ${r.refills.booked}.`);
      invalidate();
    },
    onError: (e) => toast.error(e),
  });
  if (!f || !a || !auto.data) return <Spinner />;
  const o = auto.data;
  return (
    <div className="space-y-6">
      <Card title="Automatizacija iz Televend Clouda" subtitle="Ručno se unosi samo ulaz robe s nabavnom cijenom; sve ostalo aplikacija generira iz preuzetih podataka">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Artikli iz Televenda', o.autoCreatedProducts],
            ['Bez nabavne cijene', o.productsWithoutPrice],
            ['Automatskih dokumenata', o.autoMovements],
            ['Dopune na čekanju', o.pendingRefills],
            ['Negativno centralno stanje', o.negativeCentral],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{k}</div>
              <div className={`tabular mt-1 text-xl font-semibold ${(k === 'Bez nabavne cijene' || k === 'Negativno centralno stanje') && Number(v) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{v}</div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <Checkbox checked={a.autoCreateProducts} onChange={(v) => setA({ ...a, autoCreateProducts: v })} label="Automatski stvaraj artikle iz Televenda" hint="Novi Televend artikl postaje lokalni artikl (šifra TV-…); nabavnu cijenu unosite ručno (Artikli → Nabavne cijene)" />
          <Checkbox checked={a.autoPostSales} onChange={(v) => setA({ ...a, autoPostSales: v })} label="Prodaja smanjuje zalihu automata" hint="Nikad ponovno centralno skladište; storno u Televendu vraća zalihu" />
          <Checkbox checked={a.autoBookRefills} onChange={(v) => setA({ ...a, autoBookRefills: v })} label="Dopune automata knjiže se automatski (izvorna lokacija → automat)" hint="Ako je ista dopuna već ručno unesena prijenosom, samo se povezuje – bez dvostrukog knjiženja" />
          <Checkbox checked={a.autoSyncMachineStock} onChange={(v) => setA({ ...a, autoSyncMachineStock: v })} label="Stanje automata usklađuje se sa stanjem u Televendu" hint="Razlika se knjiži kao automatska inventurna korekcija (ako portal nudi stanja u automatima)" />
          <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
            <Field label="Izvorna lokacija dopuna" hint="Zadano: centralno skladište">
              <Select value={a.refillSourceLocationId ?? ''} onChange={(e) => setA({ ...a, refillSourceLocationId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Centralno skladište</option>
                {locations.data
                  ?.filter((l) => l.active && l.type !== 'machine' && l.type !== 'central')
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Kretanja se generiraju od datuma" hint="Postavlja se automatski pri prvom uvozu; starija prodaja se samo analizira">
              <Input type="date" value={a.startDate ?? ''} max={todayIso()} onChange={(e) => setA({ ...a, startDate: e.target.value || null })} />
            </Field>
          </div>
          {o.negativeCentral > 0 && (
            <Alert tone="warning">Centralno skladište ima negativno stanje za {o.negativeCentral} artikala – dopune iz Televenda su knjižene, a ulaz robe još nije unesen. Unesite ulaz robe s nabavnom cijenom.</Alert>
          )}
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saveAuto.isPending} onClick={() => saveAuto.mutate()}>
            Spremi i primijeni
          </Button>
        </div>
      </Card>
      <Card title="Skladište i nabava">
        <div className="space-y-4">
          <Checkbox checked={f.updatePurchasePriceOnReceipt} onChange={(v) => setF({ ...f, updatePurchasePriceOnReceipt: v })} label="Ažuriraj nabavnu cijenu artikla prema posljednjem ulazu robe" />
          <Checkbox checked={f.roundToPacks} onChange={(v) => setF({ ...f, roundToPacks: v })} label="Zaokruži preporučenu nabavu na cijela dobavljačka pakiranja" />
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>
            Spremi
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Korisnici
interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: 'admin' | 'user' | 'viewer';
  active: number;
  last_login_at: string | null;
  locked_until: string | null;
}
const ROLE: Record<string, string> = { admin: 'Administrator', user: 'Korisnik (unos)', viewer: 'Pregled (samo čitanje)' };

export function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/api/users') });
  const [edit, setEdit] = useState<{ id: number | null; username: string; fullName: string; email: string; role: UserRow['role']; active: boolean; password: string } | null>(null);
  const [pw, setPw] = useState<{ id: number; password: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      edit!.id
        ? api.put(`/api/users/${edit!.id}`, { fullName: edit!.fullName, email: edit!.email || null, role: edit!.role, active: edit!.active })
        : api.post('/api/users', { username: edit!.username, fullName: edit!.fullName, email: edit!.email || null, role: edit!.role, password: edit!.password }),
    onSuccess: () => {
      setEdit(null);
      toast.success('Korisnik spremljen.');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(e),
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/api/users/${pw!.id}/password`, { password: pw!.password }),
    onSuccess: () => {
      setPw(null);
      toast.success('Lozinka postavljena; aktivne sesije korisnika su odjavljene.');
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card
      title="Korisnici VendiStocka"
      subtitle="Odvojeno od Televend vjerodajnica. Lozinke se pohranjuju kao scrypt hash."
      actions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ id: null, username: '', fullName: '', email: '', role: 'user', active: true, password: '' })}>
          Novi korisnik
        </Button>
      }
    >
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(u) => u.id}
        exportName="korisnici"
        columns={[
          { key: 'username', header: 'Korisničko ime', render: (u) => <span className="font-medium">{u.username}</span> },
          { key: 'full_name', header: 'Ime i prezime' },
          { key: 'email', header: 'E-mail', render: (u) => u.email ?? '—' },
          { key: 'role', header: 'Uloga', value: (u) => ROLE[u.role] },
          { key: 'active', header: 'Status', value: (u) => (u.active ? 'aktivan' : 'neaktivan'), render: (u) => (u.active ? <Badge color="green">aktivan</Badge> : <Badge>neaktivan</Badge>) },
          { key: 'last_login_at', header: 'Zadnja prijava', exportType: 'datetime', render: (u) => fmtDateTime(u.last_login_at) },
          { key: 'locked_until', header: 'Zaključan do', render: (u) => (u.locked_until && new Date(u.locked_until) > new Date() ? <Badge color="red">{fmtDateTime(u.locked_until)}</Badge> : '—') },
          {
            key: '_a',
            header: '',
            sortable: false,
            exportable: false,
            render: (u) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label="Uredi" onClick={() => setEdit({ id: u.id, username: u.username, fullName: u.full_name, email: u.email ?? '', role: u.role, active: !!u.active, password: '' })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Postavi lozinku" onClick={() => setPw({ id: u.id, password: '' })}>
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
              </div>
            ),
          },
        ]}
      />
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Uredi korisnika' : 'Novi korisnik'}
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
            <Field label="Korisničko ime" required>
              <Input value={edit.username} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
            </Field>
            <Field label="Ime i prezime">
              <Input value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <Field label="Uloga">
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as UserRow['role'] })}>
                {Object.entries(ROLE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            {!edit.id && (
              <Field label="Početna lozinka" required hint="Najmanje 10 znakova; barem tri vrste znakova">
                <Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" />
              </Field>
            )}
            {edit.id && <Checkbox checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Aktivan korisnik" />}
          </div>
        )}
      </Modal>
      <Modal
        open={!!pw}
        onClose={() => setPw(null)}
        title="Postavi novu lozinku"
        footer={
          <>
            <Button onClick={() => setPw(null)}>Odustani</Button>
            <Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>
              Postavi
            </Button>
          </>
        }
      >
        {pw && (
          <Field label="Nova lozinka" hint="Najmanje 10 znakova; barem tri vrste znakova">
            <Input type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" />
          </Field>
        )}
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- Backup
interface BackupRow {
  file: string;
  createdAt: string;
  reason: 'auto' | 'manual' | 'pre_restore';
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  integrity: string;
  hasManifest: boolean;
}

export function Backups() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ settings: { autoEnabled: boolean; time: string; keep: number }; backups: BackupRow[]; dir: string }>('/api/backups') });
  const [s, setS] = useState<{ autoEnabled: boolean; time: string; keep: number } | null>(null);
  const [validation, setValidation] = useState<{ file: string; ok: boolean; problems: string[]; warnings: string[]; counts: Record<string, number> } | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const { logout } = useAuth();
  useEffect(() => {
    if (q.data && !s) setS(q.data.settings);
  }, [q.data, s]);
  const create = useMutation({
    mutationFn: () => api.post<BackupRow>('/api/backups'),
    onSuccess: (r) => {
      toast.success(`Sigurnosna kopija izrađena: ${r.file}`);
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (e) => toast.error(e),
  });
  const saveS = useMutation({ mutationFn: () => api.put('/api/backups/settings', s), onSuccess: () => toast.success('Postavke backupa spremljene.'), onError: (e) => toast.error(e) });
  const validate = useMutation({
    mutationFn: (file: string) => api.get<{ ok: boolean; problems: string[]; warnings: string[]; counts: Record<string, number> }>(`/api/backups/${file}/validate`).then((r) => ({ ...r, file })),
    onSuccess: setValidation,
    onError: (e) => toast.error(e),
  });
  const doRestore = useMutation({
    mutationFn: () => api.post<{ safetyBackup: string }>(`/api/backups/${restore}/restore`, { confirm: confirmText }),
    onSuccess: (r) => {
      toast.success(`Baza vraćena. Prije vraćanja izrađena je kopija ${r.safetyBackup}. Prijavite se ponovno.`);
      setRestore(null);
      setTimeout(() => void logout(), 1500);
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (file: string) => api.del(`/api/backups/${file}`),
    onSuccess: () => {
      setDel(null);
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (e) => toast.error(e),
  });
  if (!q.data || !s) return <Spinner />;
  const REASON: Record<string, string> = { auto: 'automatski', manual: 'ručno', pre_restore: 'prije vraćanja' };
  return (
    <div className="space-y-6">
      <Card
        title="Sigurnosne kopije baze"
        subtitle={`Mapa: ${q.data.dir}`}
        actions={
          <Button variant="primary" icon={<DatabaseBackup className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>
            Izradi backup sada
          </Button>
        }
      >
        <Alert tone="info" className="mb-4">
          Kopija se izrađuje SQLite online backup API-jem (konzistentno i tijekom rada). Iz kopije se uklanja spremljena sesija portala; lozinke ostaju šifrirane ključem zaštićenim DPAPI-jem na ovom računalu – na drugom računalu moraju se ponovno unijeti. Preporuka: mapu s kopijama redovito kopirajte i na drugi disk ili NAS.
        </Alert>
        <DataTable
          rows={q.data.backups}
          rowKey={(b) => b.file}
          exportName="sigurnosne-kopije"
          empty="Još nema sigurnosnih kopija."
          columns={[
            { key: 'createdAt', header: 'Izrađeno', exportType: 'datetime', render: (b) => fmtDateTime(b.createdAt) },
            { key: 'file', header: 'Datoteka', render: (b) => <span className="font-mono text-xs">{b.file}</span> },
            { key: 'reason', header: 'Vrsta', value: (b) => REASON[b.reason] },
            { key: 'sizeBytes', header: 'Veličina', align: 'right', render: (b) => fmtBytes(b.sizeBytes) },
            { key: 'integrity', header: 'Integritet', render: (b) => (b.integrity === 'ok' ? <Badge color="green">ok</Badge> : <Badge color="yellow">{b.integrity}</Badge>) },
            {
              key: '_a',
              header: '',
              sortable: false,
              exportable: false,
              render: (b) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => validate.mutate(b.file)}>
                    Provjeri
                  </Button>
                  <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setRestore(b.file)}>
                    Vrati
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Preuzmi" onClick={() => download(`/api/backups/${b.file}/download`).catch((e) => toast.error(e))}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Obriši" onClick={() => setDel(b.file)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      <Card title="Automatski backup">
        <div className="flex flex-wrap items-end gap-4">
          <Checkbox checked={s.autoEnabled} onChange={(v) => setS({ ...s, autoEnabled: v })} label="Automatski dnevni backup" />
          <Field label="Vrijeme (Europe/Zagreb)" className="w-40">
            <Input type="time" value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} />
          </Field>
          <Field label="Broj automatskih kopija koje se čuvaju" className="w-56">
            <NumberInput min={1} max={365} value={s.keep} onChange={(v) => setS({ ...s, keep: v ?? 30 })} />
          </Field>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saveS.isPending} onClick={() => saveS.mutate()}>
            Spremi
          </Button>
        </div>
      </Card>
      <Modal open={!!validation} onClose={() => setValidation(null)} title={`Provjera kopije ${validation?.file ?? ''}`}>
        {validation && (
          <div className="space-y-3">
            <Alert tone={validation.ok ? 'success' : 'error'}>{validation.ok ? 'Kopija je ispravna i može se vratiti.' : 'Kopija nije ispravna.'}</Alert>
            {[...validation.problems, ...validation.warnings].length > 0 && (
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {validation.problems.map((p) => (
                  <li key={p} className="text-red-700">
                    {p}
                  </li>
                ))}
                {validation.warnings.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <KeyValue items={Object.entries(validation.counts).map(([k, v]) => [k, v])} />
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!restore} title="Vratiti bazu iz sigurnosne kopije?" danger confirmLabel="Vrati bazu" loading={doRestore.isPending} onClose={() => setRestore(null)} onConfirm={() => doRestore.mutate()}>
        <p className="mb-2">Kopija će se najprije provjeriti. Trenutno stanje baze automatski se sprema kao nova kopija („prije vraćanja”). Nakon vraćanja svi korisnici moraju se ponovno prijaviti.</p>
        <Field label={`Za potvrdu upišite naziv kopije: ${restore ?? ''}`}>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!del} title="Obrisati sigurnosnu kopiju?" danger confirmLabel="Obriši" loading={remove.isPending} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)}>
        Datoteka <b>{del}</b> bit će trajno obrisana.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------- Revizijski zapis
interface AuditRow {
  id: number;
  created_at: string;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
  ip: string | null;
}

export function AuditLog() {
  const [range, setRange] = useState<Range>(rangeFor(7));
  const q = useQuery({ queryKey: ['audit', range], queryFn: () => api.get<AuditRow[]>(`/api/audit${qs({ ...range, limit: 5000 })}`) });
  return (
    <Card title="Revizijski zapis" subtitle="Evidencija važnih korisničkih aktivnosti (prijave, knjiženja, izmjene postavki…); osjetljive vrijednosti su skrivene">
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.id}
        exportName="revizijski-zapis"
        dense
        pageSize={50}
        toolbar={<DateRangePicker value={range} onChange={setRange} />}
        columns={[
          { key: 'created_at', header: 'Vrijeme', exportType: 'datetime', render: (r) => fmtDateTime(r.created_at) },
          { key: 'username', header: 'Korisnik', render: (r) => r.username ?? 'sustav' },
          { key: 'action', header: 'Radnja', render: (r) => <code className="text-xs">{r.action}</code> },
          { key: 'entity', header: 'Objekt', render: (r) => (r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—') },
          { key: 'details', header: 'Detalji', render: (r) => <span className="line-clamp-2 max-w-xl break-all font-mono text-[11px] text-slate-500">{r.details ?? ''}</span> },
          { key: 'ip', header: 'IP', render: (r) => r.ip ?? '—' },
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- Sustav
interface SystemInfo {
  version: string;
  mode: string;
  node: string;
  platform: string;
  hostname: string;
  uptimeSeconds: number;
  schemaVersion: number;
  dbFile: string;
  dbSizeBytes: number;
  backupDir: string;
  logDir: string;
  https: boolean;
  port: number;
  host: string;
  publicUrl: string | null;
  allowedClientCidrs: string[];
  keyProtection: string;
  dpapiScope: string;
  secretKey: { status: string; keyId: string | null; error: string | null };
  televendAllowedHosts: string[];
  lanAddresses: string[];
}

export function SystemPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/api/system') });
  const integrity = useQuery({ queryKey: ['integrity'], queryFn: () => api.get<{ ok: boolean; mismatches: unknown[]; continuityErrors: number }>('/api/stock/integrity'), enabled: false });
  const [regen, setRegen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const regenerate = useMutation({
    mutationFn: () => api.post<{ note: string }>('/api/system/regenerate-key', { confirm }),
    onSuccess: (r) => {
      setRegen(false);
      toast.success(r.note);
      void qc.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (e) => toast.error(e),
  });
  if (!q.data) return <Spinner />;
  const d = q.data;
  const proto = d.https ? 'https' : 'http';
  return (
    <div className="space-y-6">
      {!d.https && <Alert tone="warning" title="HTTPS nije uključen">Za produkcijski pristup iz lokalne mreže uključite HTTPS (HTTPS_ENABLED u .env) i instalirajte lokalni certifikat – upute su u README dokumentu.</Alert>}
      <Card title="Sustav">
        <KeyValue
          items={[
            ['Verzija', `VendiStock ${d.version} (${d.mode})`],
            ['Node.js', d.node],
            ['Operativni sustav', d.platform],
            ['Računalo', d.hostname],
            ['Rad bez prekida', `${Math.floor(d.uptimeSeconds / 3600)} h ${Math.floor((d.uptimeSeconds % 3600) / 60)} min`],
            ['Lokalni pristup', `${proto}://localhost:${d.port}`],
            ['LAN pristup', d.lanAddresses.map((a) => `${proto}://${a}:${d.port}`).join(', ') || '—'],
            ['Dopuštene mreže klijenata', d.allowedClientCidrs.join(', ')],
            ['Baza podataka', `${d.dbFile} (${fmtBytes(d.dbSizeBytes)}, shema v${d.schemaVersion})`],
            ['Mapa sigurnosnih kopija', d.backupDir],
            ['Dnevnici (log)', d.logDir],
            ['Dopuštene Televend domene', d.televendAllowedHosts.join(', ') || 'nije ograničeno popisom (vrijede ostala pravila)'],
          ]}
        />
      </Card>
      <Card title="Zaštita tajni (lozinke Televenda i SMTP-a)">
        <KeyValue
          items={[
            ['Zaštita ključa', d.keyProtection === 'dpapi' ? `Windows DPAPI (${d.dpapiScope})` : 'Datoteka s ograničenim pravima (razvojni način, nije Windows)'],
            ['Status ključa', d.secretKey.status === 'unavailable' ? <Badge key="k" color="red">nedostupan</Badge> : <Badge key="k" color="green">dostupan</Badge>],
            ['ID ključa', d.secretKey.keyId ?? '—'],
          ]}
        />
        {d.secretKey.error && <Alert tone="error" className="mt-3">{d.secretKey.error}</Alert>}
        <Button className="mt-4" variant="ghost" icon={<KeyRound className="h-4 w-4" />} onClick={() => setRegen(true)}>
          Generiraj novi ključ…
        </Button>
      </Card>
      <Card title="Provjera integriteta skladišne knjige" subtitle="Stanja moraju odgovarati zbroju svih kretanja">
        <Button loading={integrity.isFetching} onClick={() => void integrity.refetch()}>
          Pokreni provjeru
        </Button>
        {integrity.data && (
          <Alert tone={integrity.data.ok ? 'success' : 'error'} className="mt-3">
            {integrity.data.ok ? 'Skladišna knjiga je konzistentna.' : `Pronađena odstupanja: ${integrity.data.mismatches.length} stanja, ${integrity.data.continuityErrors} grešaka kontinuiteta.`}
          </Alert>
        )}
      </Card>
      <ConfirmDialog open={regen} title="Generirati novi ključ za šifriranje?" danger confirmLabel="Generiraj" loading={regenerate.isPending} onClose={() => setRegen(false)} onConfirm={() => regenerate.mutate()}>
        <p className="mb-2">Sve spremljene lozinke (Televend, SMTP) i sesija portala postat će nečitljive i morat ćete ih ponovno unijeti. Koristite samo ako je postojeći ključ nedostupan (npr. nakon promjene Windows računa servisa).</p>
        <Field label="Za potvrdu upišite: NOVI KLJUČ">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------- Moj račun
export function MyAccount() {
  const toast = useToast();
  const { user } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const save = useMutation({
    mutationFn: () => {
      if (f.newPassword !== f.repeat) throw new Error('Nove lozinke se ne podudaraju.');
      return api.post('/api/auth/password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
    },
    onSuccess: () => {
      toast.success('Lozinka promijenjena. Ostale sesije su odjavljene.');
      setF({ currentPassword: '', newPassword: '', repeat: '' });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card title="Moj račun" subtitle={`${user?.full_name || user?.username} · ${ROLE[user?.role ?? 'user']}`}>
      <div className="max-w-md space-y-3">
        <Field label="Trenutna lozinka">
          <Input type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} autoComplete="current-password" />
        </Field>
        <Field label="Nova lozinka" hint="Najmanje 10 znakova; barem tri vrste znakova">
          <Input type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="Ponovite novu lozinku">
          <Input type="password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} autoComplete="new-password" />
        </Field>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Promijeni lozinku
        </Button>
      </div>
    </Card>
  );
}
