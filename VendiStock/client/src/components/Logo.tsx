export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0f5e63" />
      <path d="M14 18h8l10 22 10-22h8L36 48h-8z" fill="#ffffff" />
      <rect x="40" y="40" width="10" height="8" rx="2" fill="#5fd0c6" />
    </svg>
  );
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className={dark ? 'text-[17px] font-semibold tracking-tight text-white' : 'text-[17px] font-semibold tracking-tight text-slate-900'}>VendiStock</div>
        <div className={dark ? 'text-[11px] text-petrol-200' : 'text-[11px] text-slate-500'}>Inventory &amp; Sales Intelligence</div>
      </div>
    </div>
  );
}
