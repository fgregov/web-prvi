import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DataTable } from '../components/DataTable';
import { DateRangePicker, rangeFor, type Range } from '../components/Pickers';
import { RunBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { Button, Card, PageHeader } from '../components/ui';
import { api, download, qs } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../lib/format';

interface ImportBatch {
  id: number;
  dataset: string;
  source: string;
  file_name: string | null;
  period_from: string | null;
  period_to: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_duplicate: number;
  rows_rejected: number;
  status: string;
  error_message: string | null;
  fetched_at: string;
  created_by_name: string | null;
}

interface SaleTx {
  id: number;
  source_txn_id: string | null;
  sold_at_utc: string;
  machine_name: string | null;
  product_name: string;
  quantity: number;
  unit_price: number | null;
  revenue: number | null;
  status: string;
  source: string;
  fetched_at: string;
  revision: number;
  stock_movement_id: number | null;
}

export const DATASET_LABEL: Record<string, string> = {
  machines: 'Automati',
  products: 'Artikli',
  sales: 'Prodaja',
  machine_stock: 'Stanja u automatima',
  refills: 'Dopune',
};

function ReportRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3.5 last:border-0">
      <div>
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function Reports() {
  const toast = useToast();
  const [range, setRange] = useState<Range>(rangeFor(30));
  const dl = (url: string) => download(url).catch((e) => toast.error(e));
  const imports = useQuery({ queryKey: ['imports'], queryFn: () => api.get<ImportBatch[]>('/api/televend/imports') });
  const tx = useQuery({ queryKey: ['transactions', range], queryFn: () => api.get<SaleTx[]>(`/api/sales/transactions${qs({ ...range, limit: 20000 })}`) });
  const xl = (url: string) => (
    <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => void dl(url)}>
      Excel
    </Button>
  );
  const pdf = (url: string) => (
    <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => void dl(url)}>
      PDF
    </Button>
  );
  return (
    <div>
      <PageHeader title="Izvještaji" subtitle="Izvoz izvještaja u Excel i PDF te pregled preuzetih podataka" actions={<DateRangePicker value={range} onChange={setRange} />} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Skladište">
          <ReportRow title="Stanje zaliha" desc="Stanje po artiklima i lokacijama s vrijednošću (na današnji dan)">
            {xl('/api/reports/stock/xlsx')}
            {pdf('/api/reports/stock/pdf')}
          </ReportRow>
          <ReportRow title="Povijest skladišta" desc={`Sva kretanja u razdoblju ${fmtDate(range.from)} – ${fmtDate(range.to)}`}>
            {xl(`/api/reports/stock-history.xlsx${qs(range)}`)}
          </ReportRow>
        </Card>
        <Card title="Prodaja i nabava">
          <ReportRow title="Analitika prodaje" desc={`TOP artikli, automati, kategorije, dnevno/mjesečno (${fmtDate(range.from)} – ${fmtDate(range.to)})`}>
            {xl(`/api/reports/sales/xlsx${qs(range)}`)}
            {pdf(`/api/reports/sales/pdf${qs(range)}`)}
          </ReportRow>
          <ReportRow title="Lista za nabavu" desc="Artikli ispod minimuma s preporučenom količinom">
            {xl('/api/reports/procurement/xlsx')}
            {pdf('/api/reports/procurement/pdf')}
          </ReportRow>
        </Card>
      </div>
      <Card className="mt-6" title="Preuzete transakcije prodaje" subtitle="Svaki zapis nosi izvor, vrijeme preuzimanja i identifikacijsku referencu; vrijeme prodaje je iz izvještaja (Europe/Zagreb)">
        <DataTable
          rows={tx.data}
          loading={tx.isLoading}
          rowKey={(r) => r.id}
          exportName="transakcije-prodaje"
          dense
          pageSize={50}
          empty="Nema preuzetih transakcija u razdoblju."
          columns={[
            { key: 'sold_at_utc', header: 'Vrijeme prodaje', exportType: 'datetime', render: (r) => fmtDateTime(r.sold_at_utc) },
            { key: 'machine_name', header: 'Automat', render: (r) => r.machine_name ?? '—' },
            { key: 'product_name', header: 'Artikl' },
            { key: 'quantity', header: 'Kol.', align: 'right', exportType: 'qty', render: (r) => fmtNum(r.quantity) },
            { key: 'revenue', header: 'Iznos', align: 'right', exportType: 'money', render: (r) => fmtMoney(r.revenue) },
            { key: 'status', header: 'Status', render: (r) => (r.status === 'valid' ? 'valjana' : 'stornirana') },
            { key: 'source_txn_id', header: 'ID izvora', render: (r) => r.source_txn_id ?? '—' },
            { key: 'source', header: 'Izvor', render: (r) => (r.source === 'televend_portal' ? 'Televend portal' : 'ručni uvoz') },
            { key: 'fetched_at', header: 'Preuzeto', exportType: 'datetime', render: (r) => fmtDateTime(r.fetched_at) },
            { key: 'revision', header: 'Rev.', align: 'right' },
          ]}
        />
      </Card>
      <Card className="mt-6" title="Povijest uvoza podataka" subtitle="Svaki uvoz (sinkronizacija ili ručni) s brojem novih, ažuriranih, duplikata i odbijenih redaka">
        <DataTable
          rows={imports.data}
          loading={imports.isLoading}
          rowKey={(r) => r.id}
          exportName="povijest-uvoza"
          columns={[
            { key: 'fetched_at', header: 'Preuzeto', exportType: 'datetime', render: (r) => fmtDateTime(r.fetched_at) },
            { key: 'dataset', header: 'Skup podataka', value: (r) => DATASET_LABEL[r.dataset] ?? r.dataset },
            { key: 'source', header: 'Izvor', render: (r) => (r.source === 'televend_portal' ? 'Televend portal' : `ručni uvoz${r.created_by_name ? ` (${r.created_by_name})` : ''}`) },
            { key: 'file_name', header: 'Datoteka', render: (r) => <span className="max-w-[220px] truncate">{r.file_name ?? '—'}</span> },
            { key: 'period', header: 'Razdoblje', value: (r) => (r.period_from ? `${r.period_from} – ${r.period_to}` : ''), render: (r) => (r.period_from ? `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` : '—') },
            { key: 'status', header: 'Status', render: (r) => <RunBadge status={r.status} /> },
            { key: 'rows_total', header: 'Redaka', align: 'right' },
            { key: 'rows_inserted', header: 'Novih', align: 'right' },
            { key: 'rows_updated', header: 'Ažur.', align: 'right' },
            { key: 'rows_duplicate', header: 'Dupl.', align: 'right' },
            { key: 'rows_rejected', header: 'Odbij.', align: 'right' },
            { key: 'error_message', header: 'Poruka', render: (r) => <span className="text-xs text-red-700">{r.error_message ?? ''}</span> },
          ]}
        />
      </Card>
      <p className="mt-4 flex items-center gap-1 text-xs text-slate-400">
        <Download className="h-3 w-3" /> Sve tablice također imaju izvoz u Excel i CSV.
      </p>
    </div>
  );
}
