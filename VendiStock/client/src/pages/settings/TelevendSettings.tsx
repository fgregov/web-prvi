import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, PlugZap, RefreshCw, Save, ShieldAlert, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConnectionBadge, RunBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, KeyValue, Modal, NumberInput, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime, fmtDuration, fmtNum } from '../../lib/format';
import type { ConnectionState } from '../../lib/types';
import { ManualSession } from './ManualSession';

export interface DatasetConfig {
  enabled: boolean;
  method: 'export' | 'table';
  pageUrl: string;
  fills: { selector: string; value: string }[];
  applyTrigger: { by: 'text' | 'selector'; value: string } | null;
  exportTrigger: { by: 'text' | 'selector'; value: string } | null;
  tableSelector: string | null;
  nextPageSelector: string | null;
  maxPages: number;
  columns: Record<string, string>;
  headerRow: number | null;
  dateFormat: string | null;
  decimalSeparator: ',' | '.' | 'auto';
  cancelledValues: string[];
  maxRejectedPercent: number;
  productsPerMachine: boolean;
}

export interface TelevendState {
  config: {
    portalUrl: string;
    username: string;
    autoSync: boolean;
    intervalMinutes: number;
    salesOverlapDays: number;
    initialSalesDays: number;
    navigationTimeoutSeconds: number;
    loginSelectors: { username: string | null; password: string | null; submit: string | null; loggedInIndicator: string | null };
    datasets: Record<string, DatasetConfig>;
  };
  status: {
    state: ConnectionState;
    message: string | null;
    lastLoginAt: string | null;
    lastLoginOk: boolean | null;
    lastSyncAt: string | null;
    lastSyncOkAt: string | null;
    lastSyncDurationMs: number | null;
    lastSyncRecords: number | null;
    lastSyncStatus: string | null;
    lastError: string | null;
    consecutiveAuthFailures: number;
    autoSyncSuspended: boolean;
    suspendedReason: string | null;
    salesSyncedThrough: string | null;
    running: { kind: string; startedAt: string } | null;
  };
  password: { stored: boolean; readable: boolean; updatedAt: string | null };
  session: { stored: boolean; readable: boolean; updatedAt: string | null };
  secretKey: { status: string; error: string | null };
  allowedHosts: string[];
  demoMode: boolean;
  manualSession: { active: boolean };
}

interface StepEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface TestResult {
  runId: number;
  result: { status: string; message: string; finalUrl: string | null };
  steps: StepEntry[];
  blocked: string[];
}

export function useTelevendState() {
  return useQuery({ queryKey: ['televend-state'], queryFn: () => api.get<TelevendState>('/api/televend/state'), refetchInterval: (q) => (q.state.data?.status.running ? 3000 : 30_000) });
}

export function StepsLog({ steps }: { steps: StepEntry[] }) {
  return (
    <ol className="max-h-72 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11.5px] leading-relaxed">
      {steps.map((s, i) => (
        <li key={i} className={s.level === 'error' ? 'text-red-300' : s.level === 'warn' ? 'text-amber-300' : 'text-slate-200'}>
          <span className="text-slate-500">{new Date(s.at).toLocaleTimeString('hr-HR')}</span> {s.message}
        </li>
      ))}
    </ol>
  );
}

export default function TelevendSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const st = useTelevendState();
  const [form, setForm] = useState<{
    portalUrl: string;
    username: string;
    password: string;
    autoSync: boolean;
    intervalMinutes: number | null;
    salesOverlapDays: number | null;
    initialSalesDays: number | null;
    navigationTimeoutSeconds: number | null;
    loginSelectors: TelevendState['config']['loginSelectors'];
  } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (st.data && !form) {
      const c = st.data.config;
      setForm({
        portalUrl: c.portalUrl,
        username: c.username,
        password: '',
        autoSync: c.autoSync,
        intervalMinutes: c.intervalMinutes,
        salesOverlapDays: c.salesOverlapDays,
        initialSalesDays: c.initialSalesDays,
        navigationTimeoutSeconds: c.navigationTimeoutSeconds,
        loginSelectors: c.loginSelectors,
      });
    }
  }, [st.data, form]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['televend-state'] });
    void qc.invalidateQueries({ queryKey: ['televend-runs'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.put<TelevendState>('/api/televend/settings', {
        portalUrl: form!.portalUrl,
        username: form!.username,
        password: form!.password || null,
        autoSync: form!.autoSync,
        intervalMinutes: form!.intervalMinutes ?? 15,
        salesOverlapDays: form!.salesOverlapDays ?? 2,
        initialSalesDays: form!.initialSalesDays ?? 30,
        navigationTimeoutSeconds: form!.navigationTimeoutSeconds ?? 45,
        loginSelectors: {
          username: form!.loginSelectors.username || null,
          password: form!.loginSelectors.password || null,
          submit: form!.loginSelectors.submit || null,
          loggedInIndicator: form!.loginSelectors.loggedInIndicator || null,
        },
      }),
    onSuccess: () => {
      toast.success('Postavke spremljene. Lozinka je pohranjena šifrirano.');
      setForm((f) => (f ? { ...f, password: '' } : f));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const testM = useMutation({
    mutationFn: () => api.post<TestResult>('/api/televend/test'),
    onSuccess: (r) => {
      setTest(r);
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ status: string; message: string | null }>('/api/televend/sync'),
    onSuccess: (r) => {
      if (r.status === 'success') toast.success('Sinkronizacija uspješna.');
      else if (r.status === 'skipped') toast.error(r.message ?? 'Sinkronizacija preskočena.');
      else toast.error(`Sinkronizacija: ${r.status}. ${r.message ?? ''}`);
      refresh();
      ['dashboard', 'analytics', 'machines', 'tv-products', 'imports'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(e),
  });
  const disconnect = useMutation({
    mutationFn: () => api.post('/api/televend/disconnect'),
    onSuccess: () => {
      setConfirmDisconnect(false);
      toast.success('Veza prekinuta – lozinka i sesija obrisane.');
      setForm(null);
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const resume = useMutation({ mutationFn: () => api.post('/api/televend/resume'), onSuccess: refresh, onError: (e) => toast.error(e) });

  if (!st.data || !form) return <Spinner />;
  const s = st.data.status;
  const running = !!s.running;
  const setF = (p: Partial<typeof form>) => setForm({ ...form, ...p });

  return (
    <div className="space-y-6">
      {st.data.demoMode && <Alert tone="warning" title="Demo način rada">Povezivanje s Televend Cloudom isključeno je u demo načinu kako se izmišljeni i stvarni podaci ne bi miješali.</Alert>}
      {st.data.secretKey.status === 'unavailable' && (
        <Alert tone="error" title="Ključ za šifriranje nije dostupan">
          {st.data.secretKey.error} Spremljene lozinke nisu čitljive. U Postavke → Sustav možete generirati novi ključ i ponovno unijeti lozinke.
        </Alert>
      )}
      <Alert tone="info" title="Kako radi povezivanje">
        VendiStock se prijavljuje u korisnički web portal Televend Clouda (bez javnog API-ja) kroz izolirani preglednik na serveru, s vašim korisničkim imenom i lozinkom. Lozinka se pohranjuje isključivo šifrirano (AES-256, ključ zaštićen Windows DPAPI-jem), a kolačići sesije ostaju na serveru. MFA i CAPTCHA se ne zaobilaze – za njih koristite ručnu prijavu.
      </Alert>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Podaci za prijavu" subtitle="Postavke → Televend Cloud">
          <div className="space-y-4">
            <Field label="Web adresa / HTTPS URL" required hint={st.data.allowedHosts.length ? `Dopuštene domene (konfiguracija servera): ${st.data.allowedHosts.join(', ')}` : 'Adresa stranice za prijavu korisničkog portala, npr. https://…'}>
              <Input type="url" value={form.portalUrl} onChange={(e) => setF({ portalUrl: e.target.value })} placeholder="https://" autoComplete="off" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Korisničko ime" required>
                <Input value={form.username} onChange={(e) => setF({ username: e.target.value })} autoComplete="off" />
              </Field>
              <Field
                label="Lozinka"
                required={!st.data.password.stored}
                hint={st.data.password.stored ? (st.data.password.readable ? `Spremljena šifrirano (${fmtDateTime(st.data.password.updatedAt)}). Ostavite prazno za zadržavanje.` : 'Spremljena lozinka nije čitljiva – unesite je ponovno.') : 'Pohranjuje se šifrirano; nikad se ne prikazuje.'}
              >
                <Input type="password" value={form.password} onChange={(e) => setF({ password: e.target.value })} autoComplete="new-password" placeholder={st.data.password.stored ? '••••••••' : ''} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Checkbox checked={form.autoSync} onChange={(v) => setF({ autoSync: v })} label="Automatska sinkronizacija" hint="Radi na serveru i kad je preglednik zatvoren" />
              <Field label="Interval sinkronizacije (minute)" hint="Najmanje 15 minuta">
                <NumberInput min={15} max={1440} value={form.intervalMinutes} onChange={(v) => setF({ intervalMinutes: v })} />
              </Field>
            </div>
            <button type="button" className="text-xs font-medium text-petrol-700 hover:underline" onClick={() => setAdvanced((a) => !a)}>
              {advanced ? 'Sakrij napredne postavke' : 'Napredne postavke (razdoblje, timeout, selektori obrasca)'}
            </button>
            {advanced && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Prva sinkronizacija prodaje (dana unatrag)">
                    <NumberInput min={1} max={366} value={form.initialSalesDays} onChange={(v) => setF({ initialSalesDays: v })} />
                  </Field>
                  <Field label="Preklapanje razdoblja (dana)" hint="Duplikati se prepoznaju">
                    <NumberInput min={0} max={31} value={form.salesOverlapDays} onChange={(v) => setF({ salesOverlapDays: v })} />
                  </Field>
                  <Field label="Timeout navigacije (s)">
                    <NumberInput min={10} max={180} value={form.navigationTimeoutSeconds} onChange={(v) => setF({ navigationTimeoutSeconds: v })} />
                  </Field>
                </div>
                <p className="text-xs text-slate-500">
                  Obrazac za prijavu prepoznaje se automatski (polje lozinke, korisničko ime, gumb). Ako to ne uspije, unesite CSS selektore sa stvarne stranice za prijavu. Indikator prijave je element koji postoji samo kad ste prijavljeni (npr. poveznica za odjavu).
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(['username', 'password', 'submit', 'loggedInIndicator'] as const).map((k) => (
                    <Field key={k} label={{ username: 'Selektor korisničkog imena', password: 'Selektor lozinke', submit: 'Selektor gumba za prijavu', loggedInIndicator: 'Indikator prijave' }[k]}>
                      <Input value={form.loginSelectors[k] ?? ''} onChange={(e) => setF({ loginSelectors: { ...form.loginSelectors, [k]: e.target.value } })} placeholder="npr. #Email ili a[href*=logout]" className="font-mono text-xs" />
                    </Field>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()} disabled={st.data.demoMode}>
                Spremi postavke
              </Button>
              <Button icon={<PlugZap className="h-4 w-4" />} loading={testM.isPending} disabled={running || !st.data.password.stored || st.data.demoMode} onClick={() => testM.mutate()}>
                Testiraj povezivanje
              </Button>
              <Button icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending || s.running?.kind === 'sync'} disabled={running || st.data.demoMode} onClick={() => sync.mutate()}>
                Sinkroniziraj sada
              </Button>
              <Button variant="ghost" icon={<Unplug className="h-4 w-4" />} onClick={() => setConfirmDisconnect(true)} disabled={!st.data.password.stored && !st.data.session.stored}>
                Prekini vezu
              </Button>
            </div>
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Status veze" actions={<ConnectionBadge state={s.state} />}>
          <KeyValue
            items={[
              ['Status veze', s.message ?? '—'],
              ['Posljednja uspješna prijava', s.lastLoginOk && s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : '—'],
              ['Posljednja sinkronizacija', fmtDateTime(s.lastSyncAt)],
              ['Trajanje posljednje sinkronizacije', fmtDuration(s.lastSyncDurationMs)],
              ['Broj preuzetih zapisa', s.lastSyncRecords !== null ? fmtNum(s.lastSyncRecords) : '—'],
              ['Status posljednje sinkronizacije', s.lastSyncStatus ? <RunBadge key="r" status={s.lastSyncStatus} /> : '—'],
              ['Prodaja preuzeta zaključno s', s.salesSyncedThrough ?? '—'],
              ['Spremljena sesija portala', st.data.session.stored ? `da (${fmtDateTime(st.data.session.updatedAt)})` : 'ne'],
            ]}
          />
          {running && (
            <Alert tone="info" className="mt-4">
              U tijeku: {s.running!.kind === 'sync' ? 'sinkronizacija' : s.running!.kind === 'discovery' ? 'istraživanje portala' : 'test povezivanja'} (od {fmtDateTime(s.running!.startedAt)})
            </Alert>
          )}
          {s.lastError && (
            <Alert tone="error" className="mt-4" title="Poruka o pogrešci">
              {s.lastError}
            </Alert>
          )}
          {s.autoSyncSuspended && (
            <Alert tone="warning" className="mt-4" title="Automatska sinkronizacija obustavljena">
              {s.suspendedReason} Neuspjele prijave se ne ponavljaju automatski kako se račun na portalu ne bi zaključao.
              <div className="mt-2">
                <Button size="sm" onClick={() => resume.mutate()}>
                  Ponovno omogući
                </Button>
              </div>
            </Alert>
          )}
          {(s.state === 'mfa_required' || s.state === 'captcha_required' || s.state === 'form_not_found' || s.state === 'auth_failed') && (
            <Button className="mt-4 w-full" variant="outline" icon={<Monitor className="h-4 w-4" />} onClick={() => setManualOpen(true)}>
              Ručna prijava (kontrolirana sesija)
            </Button>
          )}
          {!(s.state === 'mfa_required' || s.state === 'captcha_required' || s.state === 'form_not_found' || s.state === 'auth_failed') && st.data.config.portalUrl && !st.data.demoMode && (
            <button className="mt-4 text-xs font-medium text-petrol-700 hover:underline" onClick={() => setManualOpen(true)}>
              Ručna prijava kroz kontroliranu sesiju preglednika…
            </button>
          )}
        </Card>
      </div>

      {test && (
        <Card
          title="Rezultat testa povezivanja"
          actions={<Badge color={['ok', 'already_logged_in'].includes(test.result.status) ? 'green' : test.result.status === 'uncertain' ? 'yellow' : 'red'}>{test.result.status}</Badge>}
        >
          <Alert tone={['ok', 'already_logged_in'].includes(test.result.status) ? 'success' : test.result.status === 'uncertain' ? 'warning' : 'error'} className="mb-3">
            {test.result.message}
            {test.result.finalUrl && <div className="mt-1 break-all font-mono text-xs opacity-80">Konačna adresa: {test.result.finalUrl}</div>}
          </Alert>
          {test.blocked.length > 0 && (
            <Alert tone="warning" className="mb-3" title="Blokirani zahtjevi (sigurnosna pravila domene)">
              {test.blocked.join(' · ')}
            </Alert>
          )}
          <StepsLog steps={test.steps} />
          {['ok', 'already_logged_in'].includes(test.result.status) && (
            <p className="mt-3 text-sm text-slate-600">
              Sljedeći korak: <b>Istraži portal</b> (kartica „Izvori podataka”) kako bi se utvrdilo koji su podaci i izvozi stvarno dostupni.
            </p>
          )}
        </Card>
      )}

      <ConfirmDialog open={confirmDisconnect} title="Prekinuti vezu s Televend Cloudom?" danger confirmLabel="Prekini vezu" loading={disconnect.isPending} onClose={() => setConfirmDisconnect(false)} onConfirm={() => disconnect.mutate()}>
        Spremljena lozinka i sesija portala bit će trajno obrisane, a automatska sinkronizacija isključena. Već preuzeti podaci ostaju u VendiStocku.
      </ConfirmDialog>
      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Ručna prijava kroz kontroliranu sesiju preglednika" wide="xl">
        <ManualSession
          onDone={() => {
            setManualOpen(false);
            refresh();
          }}
        />
      </Modal>
      <div className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Zaštita: dopušten je samo HTTPS, IP adrese i lokalne adrese su odbijene, a preglednik smije navigirati samo na domenu portala (i domene iz TELEVEND_EXTRA_NAVIGATION_HOSTS). Ručni testovi su ograničeni na jedan u 30 s i 6 na sat.
        </span>
      </div>
    </div>
  );
}

