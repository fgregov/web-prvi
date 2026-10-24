import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Mail, Save, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, NumberInput, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';

interface EmailConfig {
  host: string;
  port: number;
  security: 'starttls' | 'tls' | 'none';
  authMethod: 'password' | 'oauth2' | 'none';
  username: string | null;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  ccAddresses: string[];
  oauth2ClientId: string | null;
  oauth2AccessUrl: string | null;
  tlsRejectUnauthorized: boolean;
}

interface SecretInfo {
  stored: boolean;
  readable: boolean;
  updatedAt: string | null;
}

interface EmailState {
  config: EmailConfig;
  password: SecretInfo;
  oauth2ClientSecret: SecretInfo;
  oauth2RefreshToken: SecretInfo;
  problem: string | null;
}

interface AlertSettings {
  enabled: boolean;
  debounceSeconds: number;
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
}

interface EmailLog {
  id: number;
  kind: string;
  to_addresses: string;
  subject: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

const KIND: Record<string, string> = { low_stock: 'Upozorenje o niskim zalihama', daily_reminder: 'Dnevni podsjetnik', test: 'Testna poruka', procurement_list: 'Lista za nabavu' };

export default function EmailSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['email-settings'], queryFn: () => api.get<EmailState>('/api/settings/email') });
  const alerts = useQuery({ queryKey: ['alert-settings'], queryFn: () => api.get<AlertSettings>('/api/settings/alerts') });
  const log = useQuery({ queryKey: ['email-log'], queryFn: () => api.get<EmailLog[]>('/api/email/log') });
  const [f, setF] = useState<(EmailConfig & { password: string; oauth2ClientSecret: string; oauth2RefreshToken: string; cc: string }) | null>(null);
  const [a, setA] = useState<AlertSettings | null>(null);
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    if (q.data && !f) setF({ ...q.data.config, password: '', oauth2ClientSecret: '', oauth2RefreshToken: '', cc: q.data.config.ccAddresses.join(', ') });
  }, [q.data, f]);
  useEffect(() => {
    if (alerts.data && !a) setA(alerts.data);
  }, [alerts.data, a]);

  const save = useMutation({
    mutationFn: () => {
      const { password, oauth2ClientSecret, oauth2RefreshToken, cc, ...cfg } = f!;
      return api.put<{ problem: string | null }>('/api/settings/email', {
        ...cfg,
        username: cfg.username || null,
        oauth2ClientId: cfg.oauth2ClientId || null,
        oauth2AccessUrl: cfg.oauth2AccessUrl || null,
        ccAddresses: cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
        password: password || null,
        oauth2ClientSecret: oauth2ClientSecret || null,
        oauth2RefreshToken: oauth2RefreshToken || null,
      });
    },
    onSuccess: (r) => {
      toast.success(r.problem ? `Spremljeno. Napomena: ${r.problem}` : 'Postavke e-pošte spremljene.');
      setF((x) => (x ? { ...x, password: '', oauth2ClientSecret: '', oauth2RefreshToken: '' } : x));
      void qc.invalidateQueries({ queryKey: ['email-settings'] });
    },
    onError: (e) => toast.error(e),
  });
  const test = useMutation({
    mutationFn: () => api.post('/api/settings/email/test', testTo ? { to: testTo } : {}),
    onSuccess: () => {
      toast.success('Testna poruka poslana.');
      void qc.invalidateQueries({ queryKey: ['email-log'] });
    },
    onError: (e) => {
      toast.error(e);
      void qc.invalidateQueries({ queryKey: ['email-log'] });
    },
  });
  const saveAlerts = useMutation({
    mutationFn: () => api.put('/api/settings/alerts', a),
    onSuccess: () => toast.success('Pravila upozorenja spremljena.'),
    onError: (e) => toast.error(e),
  });
  const resend = useMutation({
    mutationFn: (id: number) => api.post(`/api/email/log/${id}/resend`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-log'] }),
    onError: (e) => toast.error(e),
  });
  const reminder = useMutation({
    mutationFn: () => api.post<{ sent: boolean; reason: string | null }>('/api/alerts/reminder'),
    onSuccess: (r) => {
      if (r.sent) toast.success('Podsjetnik poslan.');
      else toast.error(r.reason === 'nothing_low' ? 'Nema artikala ispod minimuma.' : `Nije poslano: ${r.reason}`);
      void qc.invalidateQueries({ queryKey: ['email-log'] });
    },
    onError: (e) => toast.error(e),
  });

  if (!q.data || !f || !a) return <Spinner />;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <div className="space-y-6">
      <Card title="SMTP poslužitelj" subtitle="Postavke → E-mail" actions={q.data.problem ? <Badge color="yellow">{q.data.problem}</Badge> : <Badge color="green">konfigurirano</Badge>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="SMTP server" required className="md:col-span-2">
            <Input value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.primjer.hr" />
          </Field>
          <Field label="Port" required>
            <NumberInput min={1} max={65535} value={f.port} onChange={(v) => set({ port: v ?? 587 })} />
          </Field>
          <Field label="Sigurnost veze">
            <Select value={f.security} onChange={(e) => set({ security: e.target.value as EmailConfig['security'] })}>
              <option value="starttls">STARTTLS (obično port 587)</option>
              <option value="tls">TLS/SSL (obično port 465)</option>
              <option value="none">Bez šifriranja (samo interni relay)</option>
            </Select>
          </Field>
          <Field label="Način autentifikacije">
            <Select value={f.authMethod} onChange={(e) => set({ authMethod: e.target.value as EmailConfig['authMethod'] })}>
              <option value="password">Korisničko ime i lozinka</option>
              <option value="oauth2">OAuth2 (npr. Microsoft 365 / Google)</option>
              <option value="none">Bez autentifikacije (interni relay)</option>
            </Select>
          </Field>
          <Field label="Korisničko ime">
            <Input value={f.username ?? ''} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
          </Field>
          {f.authMethod === 'password' && (
            <Field label="Lozinka" hint={q.data.password.stored ? `Spremljena šifrirano (${fmtDateTime(q.data.password.updatedAt)}). Prazno = zadrži.` : 'Pohranjuje se šifrirano.'}>
              <Input type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
            </Field>
          )}
          {f.authMethod === 'oauth2' && (
            <>
              <Field label="OAuth2 Client ID">
                <Input value={f.oauth2ClientId ?? ''} onChange={(e) => set({ oauth2ClientId: e.target.value })} />
              </Field>
              <Field label="OAuth2 Client Secret" hint={q.data.oauth2ClientSecret.stored ? 'Spremljeno šifrirano' : undefined}>
                <Input type="password" value={f.oauth2ClientSecret} onChange={(e) => set({ oauth2ClientSecret: e.target.value })} />
              </Field>
              <Field label="OAuth2 Refresh token" hint={q.data.oauth2RefreshToken.stored ? 'Spremljeno šifrirano' : undefined}>
                <Input type="password" value={f.oauth2RefreshToken} onChange={(e) => set({ oauth2RefreshToken: e.target.value })} />
              </Field>
              <Field label="Token URL (neobavezno)">
                <Input value={f.oauth2AccessUrl ?? ''} onChange={(e) => set({ oauth2AccessUrl: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Adresa pošiljatelja" required>
            <Input type="email" value={f.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} />
          </Field>
          <Field label="Naziv pošiljatelja">
            <Input value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} />
          </Field>
          <Field label="Adresa primatelja" required>
            <Input type="email" value={f.toAddress} onChange={(e) => set({ toAddress: e.target.value })} />
          </Field>
          <Field label="Dodatni primatelji (neobavezno)" hint="Odvojite zarezom" className="md:col-span-2">
            <Input value={f.cc} onChange={(e) => set({ cc: e.target.value })} />
          </Field>
          <div className="md:col-span-3">
            <Checkbox checked={f.tlsRejectUnauthorized} onChange={(v) => set({ tlsRejectUnauthorized: v })} label="Provjeravaj TLS certifikat poslužitelja" hint="Isključite samo za interni poslužitelj s vlastitim certifikatom" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-2 border-t pt-4">
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>
            Spremi
          </Button>
          <Field label="Testna poruka na adresu (neobavezno)" className="w-72">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={f.toAddress || 'primatelj'} />
          </Field>
          <Button icon={<Send className="h-4 w-4" />} loading={test.isPending} onClick={() => test.mutate()}>
            Pošalji testnu poruku
          </Button>
        </div>
      </Card>

      <Card title="Automatsko upozorenje o niskim zalihama" subtitle="Pravila slanja">
        <div className="space-y-4">
          <Checkbox checked={a.enabled} onChange={(v) => setA({ ...a, enabled: v })} label="Šalji upozorenje kad raspoloživa količina padne ispod minimalne" />
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>E-mail se šalje pri prvom ulasku artikla u status niske zalihe – ne za svaku sljedeću promjenu količine.</li>
            <li>Kad zaliha ponovno dosegne ili prijeđe minimum, status se resetira; sljedeći pad stvara novo upozorenje.</li>
            <li>Više artikala koji padnu u kratkom roku objedinjuje se u jednu poruku.</li>
          </ul>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Objedinjavanje (sekundi)" hint="Čekanje prije slanja">
              <NumberInput min={0} max={3600} value={a.debounceSeconds} onChange={(v) => setA({ ...a, debounceSeconds: v ?? 60 })} />
            </Field>
            <div className="flex items-end">
              <Checkbox checked={a.dailyReminderEnabled} onChange={(v) => setA({ ...a, dailyReminderEnabled: v })} label="Dnevni podsjetnik" hint="Jednom dnevno, popis svih artikala ispod minimuma" />
            </div>
            <Field label="Vrijeme podsjetnika (Europe/Zagreb)">
              <Input type="time" value={a.dailyReminderTime} onChange={(e) => setA({ ...a, dailyReminderTime: e.target.value })} />
            </Field>
          </div>
          <div className="flex gap-2 border-t pt-4">
            <Button variant="primary" icon={<BellRing className="h-4 w-4" />} loading={saveAlerts.isPending} onClick={() => saveAlerts.mutate()}>
              Spremi pravila
            </Button>
            <Button icon={<Mail className="h-4 w-4" />} loading={reminder.isPending} onClick={() => reminder.mutate()}>
              Pošalji podsjetnik sada
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Evidencija poslanih e-mailova" subtitle="Status slanja; neuspjela slanja automatski se ponavljaju (najviše 3 pokušaja)">
        <DataTable
          rows={log.data}
          loading={log.isLoading}
          rowKey={(r) => r.id}
          exportName="evidencija-emailova"
          columns={[
            { key: 'created_at', header: 'Vrijeme', exportType: 'datetime', render: (r) => fmtDateTime(r.created_at) },
            { key: 'kind', header: 'Vrsta', value: (r) => KIND[r.kind] ?? r.kind },
            { key: 'subject', header: 'Naslov' },
            { key: 'to_addresses', header: 'Primatelji', render: (r) => <span className="text-xs">{r.to_addresses}</span> },
            { key: 'status', header: 'Status', render: (r) => (r.status === 'sent' ? <Badge color="green">poslano</Badge> : r.status === 'failed' ? <Badge color="red">neuspjelo</Badge> : <Badge color="blue">čeka</Badge>) },
            { key: 'attempts', header: 'Pokušaja', align: 'right' },
            { key: 'error', header: 'Pogreška', render: (r) => <span className="text-xs text-red-700">{r.error ?? ''}</span> },
            {
              key: '_r',
              header: '',
              sortable: false,
              exportable: false,
              render: (r) =>
                r.status === 'failed' && (
                  <Button size="sm" loading={resend.isPending} onClick={() => resend.mutate(r.id)}>
                    Pošalji ponovno
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Alert tone="info">Lozinke i tokeni za e-poštu pohranjuju se šifrirano i nikad se ne vraćaju u preglednik.</Alert>
    </div>
  );
}
