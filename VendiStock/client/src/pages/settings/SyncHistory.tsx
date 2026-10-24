import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { RunBadge } from '../../components/StatusBadge';
import { Alert, Card, KeyValue, Modal, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime, fmtDuration } from '../../lib/format';
import { StepsLog } from './TelevendSettings';

interface Run {
  id: number;
  kind: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  attempts: number;
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  records_duplicate: number;
  records_rejected: number;
  error_code: string | null;
  error_message: string | null;
}

const KIND: Record<string, string> = { test: 'Test povezivanja', sync: 'Sinkronizacija', discovery: 'Istraživanje portala', manual_session: 'Ručna sesija' };
const TRIGGER: Record<string, string> = { manual: 'ručno', auto: 'automatski', startup: 'pri pokretanju' };

export default function SyncHistory() {
  const runs = useQuery({ queryKey: ['televend-runs'], queryFn: () => api.get<Run[]>('/api/televend/runs'), refetchInterval: 20_000 });
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useQuery({
    queryKey: ['televend-run', openId],
    queryFn: () => api.get<Run & { log: { steps: { at: string; level: 'info' | 'warn' | 'error'; message: string }[]; blocked: string[]; details: unknown } | null }>(`/api/televend/runs/${openId}`),
    enabled: !!openId,
  });
  return (
    <Card title="Povijest sinkronizacija" subtitle="Svi pokušaji povezivanja, sinkronizacije i istraživanja – uključujući neuspjele i prekinute">
      <DataTable
        rows={runs.data}
        loading={runs.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        exportName="povijest-sinkronizacija"
        columns={[
          { key: 'started_at', header: 'Početak', exportType: 'datetime', render: (r) => fmtDateTime(r.started_at) },
          { key: 'kind', header: 'Vrsta', value: (r) => KIND[r.kind] ?? r.kind },
          { key: 'trigger', header: 'Pokretanje', value: (r) => TRIGGER[r.trigger] ?? r.trigger },
          { key: 'status', header: 'Status', render: (r) => <RunBadge status={r.status} /> },
          { key: 'duration_ms', header: 'Trajanje', align: 'right', render: (r) => fmtDuration(r.duration_ms) },
          { key: 'attempts', header: 'Pokušaja', align: 'right' },
          { key: 'records_fetched', header: 'Preuzeto', align: 'right' },
          { key: 'records_inserted', header: 'Novih', align: 'right' },
          { key: 'records_duplicate', header: 'Duplikata', align: 'right' },
          { key: 'records_rejected', header: 'Odbijeno', align: 'right' },
          { key: 'error_message', header: 'Poruka', render: (r) => <span className="line-clamp-2 max-w-sm text-xs text-red-700">{r.error_message ?? ''}</span> },
        ]}
      />
      <Modal open={!!openId} onClose={() => setOpenId(null)} title={`Zapis #${openId}`} wide>
        {!detail.data ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <KeyValue
              items={[
                ['Vrsta', KIND[detail.data.kind] ?? detail.data.kind],
                ['Status', <RunBadge key="s" status={detail.data.status} />],
                ['Početak', fmtDateTime(detail.data.started_at)],
                ['Završetak', fmtDateTime(detail.data.finished_at)],
                ['Trajanje', fmtDuration(detail.data.duration_ms)],
                ['Pokušaja', detail.data.attempts],
              ]}
            />
            {detail.data.error_message && <Alert tone="error">{detail.data.error_message}</Alert>}
            {detail.data.log?.blocked?.length ? <Alert tone="warning" title="Blokirani zahtjevi">{detail.data.log.blocked.join(' · ')}</Alert> : null}
            {detail.data.log?.steps?.length ? <StepsLog steps={detail.data.log.steps} /> : <p className="text-sm text-slate-500">Nema zapisanih koraka.</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
}
