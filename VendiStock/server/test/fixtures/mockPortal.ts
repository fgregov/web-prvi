/**
 * TESTNI PORTAL – ISKLJUČIVO ZA AUTOMATSKE TESTOVE.
 * Struktura stranica, nazivi polja, URL-ovi i format izvoza su IZMIŠLJENI kako bi se provjerio
 * mehanizam konektora (prijava, MFA/CAPTCHA detekcija, istraživanje, izvoz, tablice, greške).
 * NE predstavlja stvarni Televend Cloud portal i ne smije se koristiti kao izvor pretpostavki o njemu.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type PortalMode = 'normal' | 'mfa' | 'captcha' | 'twostep' | 'nologinform';

export interface Sale {
  id: string;
  at: string; // lokalno vrijeme "dd.MM.yyyy HH:mm:ss"
  machine: string;
  product: string;
  qty: number;
  amount: string; // hr format, npr. "2,50"
  status: string;
}

export interface MockPortal {
  url: string;
  mode: PortalMode;
  sales: Sale[];
  /** Broj sljedećih zahtjeva za izvoz koji će vratiti HTTP 500 (privremena greška). */
  failExports: number;
  loginAttempts: number;
  exportRequests: number;
  close(): Promise<void>;
}

const USER = 'demo@vendingexpress.test';
const PASS = 'TestnaLozinka!1';

function page(title: string, body: string): string {
  return `<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

const nav = `<nav class="sidebar">
  <a href="/dashboard">Početna</a>
  <a href="/reports/sales">Izvještaj prodaje</a>
  <a href="/machines">Uređaji</a>
  <a href="/admin/delete-all">Obriši sve podatke</a>
  <a href="/logout">Odjava</a>
</nav>`;

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length === 2),
  );
}

function readBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

function toIso(local: string): string {
  const [d, t] = local.split(' ');
  const [dd, mm, yyyy] = d.split('.');
  return `${yyyy}-${mm}-${dd}T${t}`;
}

export async function startMockPortal(mode: PortalMode = 'normal'): Promise<MockPortal> {
  const state: Omit<MockPortal, 'url' | 'close'> = {
    mode,
    sales: [],
    failExports: 0,
    loginAttempts: 0,
    exportRequests: 0,
  };
  const sessions = new Set<string>();
  const pending = new Set<string>();

  const loginForm = (error?: string, step: 'full' | 'user' | 'pass' = 'full') =>
    page(
      'Prijava – Testni portal',
      `<h1>Prijava</h1>${error ? `<div class="alert alert-danger" role="alert">${error}</div>` : ''}
      <form method="post" action="/login">
        ${step !== 'pass' ? '<label>E-mail <input type="text" name="Email" id="Email" autocomplete="username"></label>' : ''}
        ${step !== 'user' ? '<label>Lozinka <input type="password" name="Password" id="Password"></label>' : ''}
        ${state.mode === 'captcha' ? '<div class="g-recaptcha" data-sitekey="test-site-key"></div>' : ''}
        <button type="submit">${step === 'user' ? 'Dalje' : 'Prijava'}</button>
      </form>`,
    );

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sid = parseCookies(req).sid;
    const authed = sid ? sessions.has(sid) : false;
    const send = (code: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    const redirect = (to: string, headers: Record<string, string> = {}) => {
      res.writeHead(302, { Location: to, ...headers });
      res.end();
    };

    if (url.pathname === '/' ) return redirect(authed ? '/dashboard' : '/login');
    if (url.pathname === '/login' && req.method === 'GET') {
      if (state.mode === 'nologinform') return send(200, page('Dobrodošli', '<h1>Dobrodošli</h1><p>Nema obrasca.</p>'));
      if (authed) return redirect('/dashboard');
      return send(200, loginForm(undefined, state.mode === 'twostep' ? 'user' : 'full'));
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (state.mode === 'twostep' && body.has('Email') && !body.has('Password')) {
        return send(200, loginForm(undefined, 'pass').replace('<form', `<form data-user="${body.get('Email')}"`).replace('</form>', `<input type="hidden" name="EmailHidden" value="${body.get('Email')}"></form>`));
      }
      state.loginAttempts++;
      const user = body.get('Email') ?? body.get('EmailHidden');
      if (user === USER && body.get('Password') === PASS) {
        const id = Math.random().toString(36).slice(2);
        if (state.mode === 'mfa') {
          pending.add(id);
          return redirect('/mfa', { 'Set-Cookie': `pending=${id}; HttpOnly; Path=/` });
        }
        sessions.add(id);
        return redirect('/dashboard', { 'Set-Cookie': `sid=${id}; HttpOnly; Path=/` });
      }
      return send(200, loginForm('Neispravno korisničko ime ili lozinka.', state.mode === 'twostep' ? 'pass' : 'full'));
    }
    if (url.pathname === '/mfa') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const p = parseCookies(req).pending;
        if (p && pending.has(p) && body.get('code') === '123456') {
          sessions.add(p);
          return redirect('/dashboard', { 'Set-Cookie': `sid=${p}; HttpOnly; Path=/` });
        }
      }
      return send(
        200,
        page('Potvrda', '<h1>Dvofaktorska provjera</h1><p>Unesite kod iz aplikacije authenticator.</p><form method="post" action="/mfa"><input name="code" autocomplete="one-time-code"><button type="submit">Potvrdi</button></form>'),
      );
    }
    if (url.pathname === '/logout') {
      if (sid) sessions.delete(sid);
      return redirect('/login', { 'Set-Cookie': 'sid=; Max-Age=0; Path=/' });
    }
    if (url.pathname === '/redirect-out') return redirect('https://phishing.example/');
    if (!authed) return redirect('/login');

    if (url.pathname === '/dashboard') {
      return send(200, page('Početna – Testni portal', `${nav}<h1>Početna</h1><p>Prijavljeni ste.</p>`));
    }
    if (url.pathname === '/admin/delete-all') {
      // Istraživanje portala ovu stranicu NIKAD ne smije otvoriti
      state.sales = [];
      return send(200, page('Obrisano', '<h1>Svi podaci obrisani</h1>'));
    }
    if (url.pathname === '/reports/sales') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      return send(
        200,
        page(
          'Izvještaj prodaje',
          `${nav}<h1>Izvještaj prodaje</h1>
          <form method="get"><input type="date" name="from" id="from" value="${from}"><input type="date" name="to" id="to" value="${to}"><button type="submit">Prikaži</button></form>
          <a id="export" href="/reports/sales/export.csv?from=${from}&to=${to}">Izvoz u CSV</a>
          <table id="sales"><thead><tr><th>Broj</th><th>Vrijeme</th><th>Uređaj</th><th>Proizvod</th><th>Količina</th><th>Iznos</th><th>Status</th></tr></thead>
          <tbody>${state.sales.map((s) => `<tr><td>${s.id}</td><td>${s.at}</td><td>${s.machine}</td><td>${s.product}</td><td>${s.qty}</td><td>${s.amount}</td><td>${s.status}</td></tr>`).join('')}</tbody></table>`,
        ),
      );
    }
    if (url.pathname === '/reports/sales/export.csv') {
      state.exportRequests++;
      if (state.failExports > 0) {
        state.failExports--;
        return send(500, 'Internal Server Error');
      }
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const rows = state.sales.filter((s) => {
        const d = toIso(s.at).slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
      const csv = ['Broj;Vrijeme;Uređaj;Proizvod;Količina;Iznos;Status', ...rows.map((s) => [s.id, s.at, s.machine, s.product, s.qty, s.amount, s.status].join(';'))].join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="prodaja.csv"' });
      return res.end('﻿' + csv);
    }
    if (url.pathname === '/machines') {
      const pg = Number(url.searchParams.get('page') ?? '1');
      const all = [
        ['M-001', 'Automat Bolnica', 'Zagreb, Ilica 1'],
        ['M-002', 'Automat Fakultet', 'Zagreb, Savska 2'],
        ['M-003', 'Automat Kolodvor', 'Split, Obala 3'],
      ];
      const rows = pg === 1 ? all.slice(0, 2) : all.slice(2);
      return send(
        200,
        page(
          'Uređaji',
          `${nav}<h1>Uređaji</h1><table id="machines"><tr><th>ID</th><th>Naziv</th><th>Lokacija</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
          ${pg === 1 ? '<a id="next" href="/machines?page=2">Sljedeća</a>' : ''}`,
        ),
      );
    }
    return send(404, page('404', 'Nije pronađeno'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const portal = state as MockPortal;
  portal.url = `http://127.0.0.1:${port}`;
  portal.close = () => new Promise((r) => server.close(() => r()));
  return portal;
}

export const MOCK_CREDENTIALS = { username: USER, password: PASS };
