import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { exportCsv, exportXlsx, type ExportColumn } from '../lib/api';
import { useToast } from './Toast';
import { Button, Spinner } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** Vrijednost za pretragu, sortiranje i izvoz (zadano: row[key]). */
  value?: (row: T) => unknown;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  exportType?: ExportColumn['type'];
  exportable?: boolean;
  className?: string;
}

interface Props<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  pageSize?: number;
  exportName?: string;
  exportTitle?: string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  selectable?: boolean;
  selected?: Set<string | number>;
  onSelectedChange?: (s: Set<string | number>) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  dense?: boolean;
}

const collator = new Intl.Collator('hr', { numeric: true, sensitivity: 'base' });

function valueOf<T>(c: Column<T>, row: T): unknown {
  return c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
}

/** Tablica s pretragom, sortiranjem, paginacijom i izvozom (Excel/CSV). */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  searchPlaceholder = 'Pretraži…',
  toolbar,
  pageSize: initialPageSize = 25,
  exportName,
  exportTitle,
  empty,
  onRowClick,
  initialSort,
  selectable,
  selected,
  onSelectedChange,
  rowClassName,
  footer,
  dense,
}: Props<T>) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const needle = q.trim().toLowerCase();
    let out = needle
      ? list.filter((r) =>
          columns.some((c) => {
            const v = valueOf(c, r);
            return v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
          }),
        )
      : list;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = valueOf(col, a);
          const vb = valueOf(col, b);
          if (va === vb) return 0;
          if (va === null || va === undefined || va === '') return 1;
          if (vb === null || vb === undefined || vb === '') return -1;
          const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
          return sort.dir === 'asc' ? r : -r;
        });
      }
    }
    return out;
  }, [rows, columns, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const exportCols = columns.filter((c) => c.exportable !== false).map((c) => ({ header: c.header, key: c.key, type: c.exportType }));
  const exportRows = () =>
    filtered.map((r) => Object.fromEntries(columns.filter((c) => c.exportable !== false).map((c) => [c.key, valueOf(c, r) ?? null])));

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
    setPage(0);
  };

  const allVisibleSelected = selectable && visible.length > 0 && visible.every((r) => selected?.has(rowKey(r)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="block h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-petrol-500 focus:outline-none focus:ring-2 focus:ring-petrol-200"
          />
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {exportName && (
            <>
              <Button
                size="sm"
                icon={<Download className="h-3.5 w-3.5" />}
                loading={exporting}
                disabled={!filtered.length}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await exportXlsx(exportName, exportTitle ?? exportName, exportCols, exportRows());
                  } catch (e) {
                    toast.error(e);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                Excel
              </Button>
              <Button size="sm" variant="ghost" disabled={!filtered.length} onClick={() => exportCsv(exportName, exportCols, exportRows())}>
                CSV
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Odaberi sve"
                    className="h-4 w-4 accent-petrol-700"
                    checked={!!allVisibleSelected}
                    onChange={(e) => {
                      const s = new Set(selected);
                      visible.forEach((r) => (e.target.checked ? s.add(rowKey(r)) : s.delete(rowKey(r))));
                      onSelectedChange?.(s);
                    }}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={clsx(
                    'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  )}
                >
                  {c.sortable === false ? (
                    c.header
                  ) : (
                    <button className={clsx('inline-flex items-center gap-1 hover:text-slate-800', c.align === 'right' && 'flex-row-reverse')} onClick={() => toggleSort(c.key)}>
                      {c.header}
                      {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3">
                  <Spinner />
                </td>
              </tr>
            )}
            {!loading && !visible.length && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-10 text-center text-sm text-slate-500">
                  {q ? 'Nema rezultata za zadanu pretragu.' : (empty ?? 'Nema podataka.')}
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={clsx(onRowClick && 'cursor-pointer', 'hover:bg-slate-50/80', rowClassName?.(r))}
                >
                  {selectable && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Odaberi redak"
                        className="h-4 w-4 accent-petrol-700"
                        checked={selected?.has(rowKey(r)) ?? false}
                        onChange={(e) => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(rowKey(r));
                          else s.delete(rowKey(r));
                          onSelectedChange?.(s);
                        }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx(
                        dense ? 'py-1.5' : 'py-2.5',
                        'px-3 text-slate-700',
                        c.align === 'right' && 'tabular text-right',
                        c.align === 'center' && 'text-center',
                        c.className,
                      )}
                    >
                      {c.render ? c.render(r) : String(valueOf(c, r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
          {footer && <tfoot className="border-t border-slate-200 bg-slate-50/80">{footer}</tfoot>}
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {filtered.length === 0 ? '0 zapisa' : `${current * pageSize + 1}–${Math.min(filtered.length, (current + 1) * pageSize)} od ${filtered.length}`}
          {rows && filtered.length !== rows.length && ` (filtrirano od ${rows.length})`}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
            aria-label="Redaka po stranici"
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>
                {n} / str.
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Prethodna stranica">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular">
            {current + 1} / {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Sljedeća stranica">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
