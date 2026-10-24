/** Klijent za VendiStock API. Kolačić sesije je httpOnly; CSRF token se šalje u zaglavlju. */
let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCsrfToken(t: string | null) {
  csrfToken = t;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('application/json') ? await res.json() : await res.blob()) as T;
  }
  let code = 'ERROR';
  let message = `Pogreška ${res.status}`;
  let details: unknown;
  try {
    const body = await res.json();
    code = body?.error?.code ?? code;
    message = body?.error?.message ?? message;
    details = body?.error?.details;
  } catch {
    /* odgovor nije JSON */
  }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  throw new ApiError(res.status, code, message, details);
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (csrfToken) h['X-CSRF-Token'] = csrfToken;
  return h;
}

export function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T>(url: string) => fetch(url, { credentials: 'same-origin', headers: headers(false) }).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, { method: 'POST', credentials: 'same-origin', headers: headers(true), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  put: <T>(url: string, body?: unknown) =>
    fetch(url, { method: 'PUT', credentials: 'same-origin', headers: headers(true), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body?: unknown) =>
    fetch(url, { method: 'PATCH', credentials: 'same-origin', headers: headers(true), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  del: <T>(url: string) => fetch(url, { method: 'DELETE', credentials: 'same-origin', headers: headers(false) }).then((r) => handle<T>(r)),
  upload: <T>(url: string, file: File, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', file);
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: headers(false), body: fd }).then((r) => handle<T>(r));
  },
};

function saveBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function fileNameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

/** Preuzimanje datoteke (izvoz) s GET rute. */
export async function download(url: string, fallbackName = 'izvoz') {
  const res = await fetch(url, { credentials: 'same-origin', headers: headers(false) });
  if (!res.ok) await handle(res);
  saveBlob(await res.blob(), fileNameFrom(res, fallbackName));
}

export interface ExportColumn {
  header: string;
  key: string;
  type?: 'text' | 'number' | 'money' | 'qty' | 'date' | 'datetime' | 'percent';
}

/** Izvoz podataka iz tablice u Excel (server izrađuje XLSX). */
export async function exportXlsx(fileName: string, title: string, columns: ExportColumn[], rows: Record<string, unknown>[], subtitle?: string) {
  const res = await fetch('/api/export/xlsx', {
    method: 'POST',
    credentials: 'same-origin',
    headers: headers(true),
    body: JSON.stringify({ fileName, title, subtitle, columns, rows }),
  });
  if (!res.ok) await handle(res);
  saveBlob(await res.blob(), fileNameFrom(res, `${fileName}.xlsx`));
}

/** CSV izvoz u pregledniku (UTF-8 s BOM-om i točka-zarezom za hrvatski Excel). */
export function exportCsv(fileName: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(';'), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(';'))];
  saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
}
