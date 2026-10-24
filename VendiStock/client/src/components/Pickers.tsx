import clsx from 'clsx';
import { CalendarRange, Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDaysIso, fmtDate, todayIso } from '../lib/format';
import type { Product } from '../lib/types';

/** Pretraživi odabir artikla (šifra ili naziv). */
export function ProductPicker({
  products,
  value,
  onChange,
  placeholder = 'Odaberite artikl…',
  onlyActive = true,
  className,
}: {
  products: Product[] | undefined;
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  onlyActive?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = products?.find((p) => p.id === value) ?? null;
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (products ?? [])
      .filter((p) => (onlyActive ? p.active : true))
      .filter((p) => !n || p.name.toLowerCase().includes(n) || p.code.toLowerCase().includes(n))
      .slice(0, 80);
  }, [products, q, onlyActive]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus:border-petrol-500 focus:outline-none focus:ring-2 focus:ring-petrol-200"
      >
        <span className={clsx('truncate', !selected && 'text-slate-400')}>{selected ? `${selected.code} · ${selected.name}` : placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pretraži šifru ili naziv…"
            className="mb-1 block w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-petrol-400 focus:outline-none"
          />
          <ul className="max-h-64 overflow-y-auto">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    setQ('');
                  }}
                  className={clsx('flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-petrol-50', p.id === value && 'bg-petrol-50')}
                >
                  <span className="truncate">
                    <span className="text-slate-500">{p.code}</span> · {p.name}
                  </span>
                  <span className="tabular shrink-0 text-xs text-slate-500">
                    {p.current_stock} {p.unit}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2.5 py-2 text-sm text-slate-500">Nema artikala.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface Range {
  from: string;
  to: string;
}

const PRESETS: { label: string; days?: number; kind?: 'month' | 'prevMonth' | 'year' }[] = [
  { label: 'Danas', days: 1 },
  { label: 'Zadnjih 7 dana', days: 7 },
  { label: 'Zadnjih 30 dana', days: 30 },
  { label: 'Zadnjih 90 dana', days: 90 },
  { label: 'Ovaj mjesec', kind: 'month' },
  { label: 'Prošli mjesec', kind: 'prevMonth' },
  { label: 'Ova godina', kind: 'year' },
];

function presetRange(p: (typeof PRESETS)[number]): Range {
  const today = todayIso();
  if (p.days) return { from: addDaysIso(today, -(p.days - 1)), to: today };
  if (p.kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p.kind === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 1);
  const from = first.toISOString().slice(0, 10);
  const last = addDaysIso(`${today.slice(0, 7)}-01`, -1);
  return { from, to: last };
}

export function rangeFor(days: number): Range {
  return presetRange({ label: '', days });
}

/** Odabir razdoblja: unaprijed zadana razdoblja + prilagođeno razdoblje. */
export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setCustom(value), [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const active = PRESETS.find((p) => {
    const r = presetRange(p);
    return r.from === value.from && r.to === value.to;
  });
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm hover:bg-slate-50"
      >
        <CalendarRange className="h-4 w-4 text-slate-500" />
        <span className="font-medium text-slate-800">{active ? active.label : `${fmtDate(value.from)} – ${fmtDate(value.to)}`}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(presetRange(p));
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className={clsx(active?.label === p.label && 'font-semibold text-slate-900')}>{p.label}</span>
              {active?.label === p.label && <Check className="h-4 w-4 text-petrol-700" strokeWidth={2.5} />}
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 p-2">
            <div className="mb-1.5 text-xs font-medium text-slate-500">Prilagođeno razdoblje</div>
            <div className="flex items-center gap-1.5">
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs" />
              <span className="text-slate-400">–</span>
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs" />
            </div>
            <button
              type="button"
              disabled={!custom.from || !custom.to || custom.from > custom.to}
              onClick={() => {
                onChange(custom);
                setOpen(false);
              }}
              className="mt-2 w-full rounded-md bg-petrol-700 py-1.5 text-xs font-medium text-white hover:bg-petrol-800 disabled:opacity-50"
            >
              Primijeni
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
