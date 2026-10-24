import { useState } from 'react';
import { PageHeader, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AuditLog, Backups, InventorySettings, MyAccount, SystemPanel, Users } from './settings/AdminSettings';
import DataSources from './settings/DataSources';
import EmailSettings from './settings/EmailSettings';
import SyncHistory from './settings/SyncHistory';
import TelevendSettings from './settings/TelevendSettings';
import Upload from './settings/Upload';

type Tab = 'televend' | 'sources' | 'upload' | 'sync' | 'email' | 'inventory' | 'users' | 'backup' | 'audit' | 'system' | 'account';

export default function Settings() {
  const { isAdmin, canEdit } = useAuth();
  const [tab, setTab] = useState<Tab>(isAdmin ? 'televend' : canEdit ? 'upload' : 'account');
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'televend', label: 'Televend Cloud', show: isAdmin },
    { key: 'sources', label: 'Izvori podataka', show: isAdmin },
    { key: 'upload', label: 'Uvoz datoteke', show: canEdit },
    { key: 'sync', label: 'Povijest sinkronizacija', show: true },
    { key: 'email', label: 'E-mail i upozorenja', show: isAdmin },
    { key: 'inventory', label: 'Automatizacija i skladište', show: isAdmin },
    { key: 'users', label: 'Korisnici', show: isAdmin },
    { key: 'backup', label: 'Backup', show: isAdmin },
    { key: 'audit', label: 'Revizijski zapis', show: isAdmin },
    { key: 'system', label: 'Sustav', show: isAdmin },
    { key: 'account', label: 'Moj račun', show: true },
  ];
  return (
    <div>
      <PageHeader title="Postavke" subtitle="Povezivanje s Televend Cloudom, e-pošta, korisnici, sigurnosne kopije i sustav" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs.filter((t) => t.show).map((t) => ({ key: t.key, label: t.label }))} />
      {tab === 'televend' && <TelevendSettings />}
      {tab === 'sources' && <DataSources />}
      {tab === 'upload' && <Upload />}
      {tab === 'sync' && <SyncHistory />}
      {tab === 'email' && <EmailSettings />}
      {tab === 'inventory' && <InventorySettings />}
      {tab === 'users' && <Users />}
      {tab === 'backup' && <Backups />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'system' && <SystemPanel />}
      {tab === 'account' && <MyAccount />}
    </div>
  );
}
