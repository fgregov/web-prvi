import clsx from 'clsx';
import { BarChart3, Cpu, FileText, LayoutDashboard, LogOut, Menu, Package, Settings, ShoppingCart, TriangleAlert, Warehouse, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { Logo } from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/artikli', label: 'Artikli', icon: Package },
  { to: '/skladiste', label: 'Skladište', icon: Warehouse },
  { to: '/automati', label: 'Automati', icon: Cpu },
  { to: '/analitika', label: 'Analitika', icon: BarChart3 },
  { to: '/nabava', label: 'Nabava', icon: ShoppingCart },
  { to: '/izvjestaji', label: 'Izvještaji', icon: FileText },
  { to: '/postavke', label: 'Postavke', icon: Settings },
];

const ROLE: Record<string, string> = { admin: 'Administrator', user: 'Korisnik', viewer: 'Pregled' };

export function Layout() {
  const { user, logout, mode } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white/12 text-white shadow-[inset_3px_0_0_#5fd0c6]' : 'text-petrol-100/80 hover:bg-white/6 hover:text-white',
            )
          }
        >
          <n.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
  const footer = (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="mb-3 min-w-0">
        <div className="truncate text-sm font-medium text-white">{user?.full_name || user?.username}</div>
        <div className="text-xs text-petrol-200">{ROLE[user?.role ?? 'user']}</div>
      </div>
      <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-petrol-100/80 hover:bg-white/6 hover:text-white">
        <LogOut className="h-4 w-4" /> Odjava
      </button>
    </div>
  );
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-petrol-900 lg:flex">
        <div className="px-5 py-5">
          <Logo dark />
        </div>
        {nav}
        {footer}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-petrol-900">
            <div className="flex items-center justify-between px-5 py-5">
              <Logo dark />
              <button onClick={() => setOpen(false)} className="text-petrol-100" aria-label="Zatvori izbornik">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'demo' && (
          <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            DEMO NAČIN RADA – svi prikazani podaci su izmišljeni, služe samo za razvoj i prikaz i nalaze se u zasebnoj demo bazi.
          </div>
        )}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Otvori izbornik" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

