import { useMutation } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CornerDownLeft, Monitor, Save, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Alert, Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Kontrolirana sesija preglednika: preglednik radi na serveru, korisnik vidi snimku zaslona
 * i klikom/tipkanjem sam dovršava prijavu (uključujući MFA). Ništa se ne zaobilazi.
 */
export function ManualSession({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [active, setActive] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const blob = await api.get<Blob>('/api/televend/manual/screenshot');
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setImg(url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setActive(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [active, refresh]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const start = useMutation({
    mutationFn: () => api.post('/api/televend/manual/start'),
    onSuccess: () => setActive(true),
    onError: (e) => toast.error(e),
  });
  const finish = useMutation({
    mutationFn: () => api.post<{ saved: boolean; confirmed: boolean }>('/api/televend/manual/finish'),
    onSuccess: (r) => {
      toast.success(r.confirmed ? 'Prijava potvrđena i sesija spremljena (šifrirano).' : 'Sesija spremljena. Prijava nije potvrđena indikatorom – provjerite testom povezivanja.');
      setActive(false);
      onDone();
    },
    onError: (e) => toast.error(e),
  });
  const cancel = async () => {
    await api.post('/api/televend/manual/cancel').catch(() => undefined);
    setActive(false);
    onDone();
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const onClick = (e: MouseEvent<HTMLImageElement>) => {
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * VIEWPORT.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * VIEWPORT.height);
    void act(() => api.post('/api/televend/manual/click', { x, y }));
  };

  if (!active) {
    return (
      <div className="space-y-4">
        <Alert tone="info" title="Kada koristiti ručnu prijavu">
          Kad portal traži dodatnu potvrdu (MFA, SMS ili kod iz aplikacije), CAPTCHA provjeru ili kad automatsko prepoznavanje obrasca ne uspije. Preglednik se otvara na serveru; ovdje vidite njegov zaslon, kliknete na polja i upišete podatke. Nakon prijave kliknite „Završi i spremi sesiju” – spremaju se samo kolačići sesije (šifrirano), koje automatska sinkronizacija koristi dok ne isteknu.
        </Alert>
        <Button variant="primary" icon={<Monitor className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>
          Pokreni kontroliranu sesiju
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tekst za upis u odabrano polje (npr. MFA kod)" className="max-w-sm" type="text" autoComplete="off" />
        <Button
          disabled={!text || busy}
          onClick={() =>
            void act(async () => {
              await api.post('/api/televend/manual/type', { text });
              setText('');
            })
          }
        >
          Upiši
        </Button>
        <Button icon={<CornerDownLeft className="h-4 w-4" />} disabled={busy} onClick={() => void act(() => api.post('/api/televend/manual/key', { key: 'Enter' }))}>
          Enter
        </Button>
        <Button disabled={busy} onClick={() => void act(() => api.post('/api/televend/manual/key', { key: 'Tab' }))}>
          Tab
        </Button>
        <Button disabled={busy} onClick={() => void act(() => api.post('/api/televend/manual/key', { key: 'Backspace' }))}>
          ⌫
        </Button>
        <Button aria-label="Pomakni gore" disabled={busy} onClick={() => void act(() => api.post('/api/televend/manual/scroll', { dy: -400 }))}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button aria-label="Pomakni dolje" disabled={busy} onClick={() => void act(() => api.post('/api/televend/manual/scroll', { dy: 400 }))}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => void cancel()}>
            Odustani
          </Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={finish.isPending} onClick={() => finish.mutate()}>
            Završi i spremi sesiju
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">Kliknite na zaslon za odabir polja ili gumba. Zaslon se osvježava svakih 1,5 s. Sesija se automatski zatvara nakon 10 minuta neaktivnosti.</p>
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100">
        {img ? <img ref={imgRef} src={img} alt="Zaslon preglednika na serveru" onClick={onClick} className="block w-full cursor-crosshair select-none" draggable={false} /> : <div className="p-10 text-center text-sm text-slate-500">Učitavanje zaslona…</div>}
      </div>
    </div>
  );
}
