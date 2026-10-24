import { useQuery } from '@tanstack/react-query';
import { Lock, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { Alert, Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, type User } from '../lib/auth';

interface SetupStatus {
  needsSetup: boolean;
  localRequest: boolean;
  mode: string;
}

export default function Login() {
  const { login, setSession } = useAuth();
  const setup = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/api/auth/setup-status') });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsSetup = setup.data?.needsSetup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsSetup) {
        if (password !== password2) throw new Error('Lozinke se ne podudaraju.');
        const r = await api.post<{ user: User; csrfToken: string; mode: 'production' | 'demo' | 'test' }>('/api/auth/setup', { username, fullName, password });
        setSession(r);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-petrol-50 via-white to-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            {needsSetup ? <ShieldCheck className="h-5 w-5 text-petrol-700" /> : <Lock className="h-5 w-5 text-petrol-700" />}
            {needsSetup ? 'Početno postavljanje' : 'Prijava u VendiStock'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {needsSetup
              ? 'Stvorite administratorski račun. Ovaj račun je odvojen od Televend Cloud vjerodajnica.'
              : 'Koristite svoje VendiStock korisničko ime i lozinku (ne Televend lozinku).'}
          </p>
          {needsSetup && !setup.data?.localRequest && (
            <Alert tone="warning" className="mt-4" title="Postavljanje je moguće samo na serveru">
              Administratorski račun može se stvoriti samo u pregledniku na računalu na kojem radi VendiStock (http://localhost:3000) ili naredbom
              <code className="mx-1 rounded bg-amber-100 px-1">npm run user:create</code>.
            </Alert>
          )}
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Korisničko ime" required>
              <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </Field>
            {needsSetup && (
              <Field label="Ime i prezime">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
            )}
            <Field label="Lozinka" required hint={needsSetup ? 'Najmanje 10 znakova; barem tri od: mala i velika slova, brojke, posebni znakovi.' : undefined}>
              <Input type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {needsSetup && (
              <Field label="Ponovite lozinku" required>
                <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
              </Field>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={needsSetup && !setup.data?.localRequest}>
              {needsSetup ? 'Stvori administratora' : 'Prijava'}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">VendiStock 1.0.0 · Vending Express · interna aplikacija</p>
      </div>
    </div>
  );
}
