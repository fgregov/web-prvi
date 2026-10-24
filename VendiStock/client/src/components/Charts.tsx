import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtCompact, fmtDate, fmtMoney, fmtNum } from '../lib/format';
import type { SeriesPoint } from '../lib/types';

/** Boje podataka – validirane za CVD razdvojivost i kontrast na svijetloj podlozi. */
export const SERIES_1 = '#0a9d95';
export const SERIES_2 = '#eb6834';
const GRID = '#e5eaea';
const AXIS = '#64748b';

const MONTHS = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
export function periodLabel(p: string): string {
  if (/^\d{4}-\d{2}$/.test(p)) return `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}.`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return `${Number(p.slice(8, 10))}.${Number(p.slice(5, 7))}.`;
  return p;
}

interface TipProps {
  active?: boolean;
  payload?: { value: number; color?: string; name?: string; dataKey?: string }[];
  label?: string;
  metric: 'qty' | 'revenue';
}

function TimeTooltip({ active, payload, label, metric }: TipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="tabular text-sm font-semibold text-slate-900">{metric === 'qty' ? `${fmtNum(v)} kom` : fmtMoney(v)}</div>
      <div className="mt-0.5 text-slate-500">{label && /^\d{4}-\d{2}-\d{2}$/.test(label) ? fmtDate(label) : periodLabel(label ?? '')}</div>
    </div>
  );
}

/** Prodaja kroz vrijeme – jedna serija (količina ILI prihod, nikad dvije osi). */
export function SalesTimeChart({ data, metric, height = 280 }: { data: SeriesPoint[]; metric: 'qty' | 'revenue'; height?: number }) {
  const rows = data.map((d) => ({ period: d.period, value: metric === 'qty' ? d.qty : (d.revenue ?? 0) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_1} stopOpacity={0.14} />
            <stop offset="100%" stopColor={SERIES_1} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="period" tickFormatter={periodLabel} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} tick={{ fill: AXIS, fontSize: 12 }} />
        <YAxis tickFormatter={(v: number) => fmtCompact(v)} tickLine={false} axisLine={false} width={48} tick={{ fill: AXIS, fontSize: 12 }} allowDecimals={false} />
        <Tooltip content={<TimeTooltip metric={metric} />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={SERIES_1}
          strokeWidth={2}
          fill="url(#salesFill)"
          dot={false}
          activeDot={{ r: 4.5, fill: SERIES_1, stroke: '#ffffff', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface BarRow {
  name: string;
  value: number;
}

function BarTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: BarRow }[]; metric: 'qty' | 'revenue' }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="tabular text-sm font-semibold text-slate-900">{metric === 'qty' ? `${fmtNum(r.value)} kom` : fmtMoney(r.value)}</div>
      <div className="mt-0.5 max-w-[240px] text-slate-500">{r.name}</div>
    </div>
  );
}

/** Vodoravni stupčasti prikaz (rang), jedna serija; vrijednost na kraju stupca. */
export function RankBarChart({ rows, metric }: { rows: BarRow[]; metric: 'qty' | 'revenue' }) {
  const height = Math.max(120, rows.length * 34 + 24);
  const fmt = (v: number) => (metric === 'qty' ? fmtNum(v) : fmtMoney(v));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={(v: number) => fmtCompact(v)} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} />
        <YAxis type="category" dataKey="name" width={210} tickLine={false} axisLine={false} tick={{ fill: '#334155', fontSize: 12 }} tickFormatter={(s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s)} />
        <Tooltip content={<BarTooltip metric={metric} />} cursor={{ fill: 'rgba(15, 94, 99, 0.06)' }} />
        <Bar
          dataKey="value"
          fill={SERIES_1}
          maxBarSize={22}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          label={{ position: 'right', fill: '#334155', fontSize: 12, formatter: (v: unknown) => fmt(Number(v)) }}
        >
          {rows.map((r) => (
            <Cell key={r.name} fill={SERIES_1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Usporedba dvaju razdoblja po artiklima – dvije serije, legenda + boje validirane za CVD. */
export function CompareBarChart({ rows, labelA, labelB }: { rows: { name: string; a: number; b: number }[]; labelA: string; labelB: string }) {
  const height = Math.max(160, rows.length * 44 + 60);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barGap={2} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={(v: number) => fmtCompact(v)} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} />
        <YAxis type="category" dataKey="name" width={210} tickLine={false} axisLine={false} tick={{ fill: '#334155', fontSize: 12 }} tickFormatter={(s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s)} />
        <Tooltip
          cursor={{ fill: 'rgba(15, 94, 99, 0.06)' }}
          formatter={(v: unknown, name: unknown) => [`${fmtNum(Number(v))} kom`, String(name)]}
          contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: '#334155' }} />
        <Bar dataKey="a" name={labelA} fill={SERIES_1} maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        <Bar dataKey="b" name={labelB} fill={SERIES_2} maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Mali vodoravni pokazatelj udjela unutar tablice (TOP 10). */
export function InlineBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-petrol-50" aria-hidden="true">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: SERIES_1 }} />
    </div>
  );
}
