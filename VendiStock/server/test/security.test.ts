import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../src/app.js';
import { SecretStore } from '../src/lib/crypto/secretStore.js';
import { powershellArgs } from '../src/lib/crypto/dpapi.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/auth/passwords.js';
import { createUser } from '../src/modules/users/service.js';
import { requestDecision, validatePortalUrl } from '../src/televend/urlPolicy.js';
import { makeContext, tmpDir } from './helpers.js';
import type { AppContext } from '../src/context.js';

const PASS = 'Sigurna!Lozinka2026';

async function app(): Promise<{ ctx: AppContext; app: FastifyInstance }> {
  const ctx = await makeContext();
  await createUser(ctx.db, { username: 'admin', password: PASS, role: 'admin' });
  await createUser(ctx.db, { username: 'pregled', password: PASS, role: 'viewer' });
  const a = await buildApp(ctx);
  return { ctx, app: a };
}

async function login(a: FastifyInstance, username = 'admin', password = PASS) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, remoteAddress: '192.168.1.20' });
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  return { status: r.statusCode, cookie, csrf: (r.json() as { csrfToken: string }).csrfToken, body: r.json() };
}

describe('Lozinke korisnika VendiStocka', () => {
  it('scrypt hash, provjera i jačina lozinke', async () => {
    const h = await hashPassword(PASS);
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain(PASS);
    expect(await verifyPassword(PASS, h)).toBe(true);
    expect(await verifyPassword('kriva', h)).toBe(false);
    expect(validatePasswordStrength('kratka')).toMatch(/10 znakova/);
    expect(validatePasswordStrength('samomalaslova')).toMatch(/tri/);
    expect(validatePasswordStrength(PASS)).toBeNull();
  });
});

describe('Šifrirana pohrana tajni', () => {
  it('AES-GCM: dešifriranje, zaštita od izmjene i vezanje uz naziv tajne', async () => {
    const ctx = await makeContext();
    ctx.secrets.set(ctx.db, 'televend.password', 'TajnaLozinka!');
    const row = ctx.db.prepare("SELECT ciphertext FROM secrets WHERE name = 'televend.password'").get() as { ciphertext: string };
    expect(row.ciphertext).not.toContain('TajnaLozinka');
    expect(ctx.secrets.get(ctx.db, 'televend.password')).toBe('TajnaLozinka!');
    // izmijenjeni šifrat se ne može dešifrirati
    const tampered = row.ciphertext.slice(0, -4) + (row.ciphertext.endsWith('A') ? 'B' : 'A') + row.ciphertext.slice(-3);
    ctx.db.prepare("UPDATE secrets SET ciphertext = ? WHERE name = 'televend.password'").run(tampered);
    expect(ctx.secrets.get(ctx.db, 'televend.password')).toBeNull();
    // šifrat jedne tajne ne vrijedi pod drugim nazivom (AAD)
    expect(() => ctx.secrets.decrypt('email.password', row.ciphertext)).toThrow();
  });

  it('novi ključ čini stare tajne nečitljivima; ključ iz datoteke se ponovno učitava', async () => {
    const dir = tmpDir();
    const keyFile = path.join(dir, 'keys', 'master.key.json');
    const ctx = await makeContext();
    const s1 = new SecretStore({ keyFile, protection: 'file', dpapiScope: 'CurrentUser' });
    expect(await s1.init()).toBe('created');
    s1.set(ctx.db, 'x', 'vrijednost');
    const s2 = new SecretStore({ keyFile, protection: 'file', dpapiScope: 'CurrentUser' });
    expect(await s2.init()).toBe('ok');
    expect(s2.get(ctx.db, 'x')).toBe('vrijednost');
    await s2.createKey();
    expect(s2.get(ctx.db, 'x')).toBeNull();
    expect(s2.info(ctx.db, 'x')).toMatchObject({ stored: true, readable: false });
  });

  it('DPAPI: ključ se zaštićuje/otključava PowerShellom, a tajna se šalje samo kroz stdin', async () => {
    const dir = tmpDir();
    const calls: { file: string; args: string[]; input: string }[] = [];
    // Simulacija PowerShella (stvarni DPAPI postoji samo na Windowsu): „zaštita” = obrnuti bajtovi
    const exec = async (file: string, args: string[], input: string) => {
      calls.push({ file, args, input });
      const buf = Buffer.from(input, 'base64');
      return { stdout: Buffer.from(buf).reverse().toString('base64'), stderr: '' };
    };
    const keyFile = path.join(dir, 'k.json');
    const s = new SecretStore({ keyFile, protection: 'dpapi', dpapiScope: 'CurrentUser', exec });
    await s.init();
    const s2 = new SecretStore({ keyFile, protection: 'dpapi', dpapiScope: 'CurrentUser', exec });
    expect(await s2.init()).toBe('ok');
    expect(calls[0].file).toBe('powershell.exe');
    expect(calls[0].args).toContain('-EncodedCommand');
    const script = Buffer.from(calls[0].args[calls[0].args.length - 1], 'base64').toString('utf16le');
    expect(script).toContain('ProtectedData]::Protect');
    expect(script).toContain('DataProtectionScope]::CurrentUser');
    expect(calls[0].args.join(' ')).not.toContain(calls[0].input); // ključ nije u argumentima
    const kf = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    expect(kf.protection).toBe('dpapi');
    expect(powershellArgs('Unprotect', 'LocalMachine').length).toBe(6);
  });
});

describe('Provjera URL-a Televend portala (zlouporaba korisnički unesene adrese)', () => {
  const cfg = { allowedHosts: [] as string[], extraNavigationHosts: [], browserExecutable: null, allowTestTargets: false };
  it('odbija nesiguran protokol, IP adrese, lokalne adrese i vjerodajnice u URL-u', async () => {
    await expect(validatePortalUrl('http://portal.primjer.com', cfg)).rejects.toThrow(/HTTPS/);
    await expect(validatePortalUrl('https://192.168.1.10/login', cfg)).rejects.toThrow(/IP adresu/);
    await expect(validatePortalUrl('https://localhost/login', cfg)).rejects.toThrow(/Lokalne/);
    await expect(validatePortalUrl('https://intranet/login', cfg)).rejects.toThrow(/Lokalne/);
    await expect(validatePortalUrl('https://user:pass@portal.primjer.com', cfg)).rejects.toThrow(/korisničko ime/);
    await expect(validatePortalUrl('https://portal.primjer.com:8443', cfg)).rejects.toThrow(/443/);
    await expect(validatePortalUrl('nije-url', cfg)).rejects.toThrow(/nije ispravna/);
  });

  it('popis dopuštenih domena iz konfiguracije servera', async () => {
    await expect(validatePortalUrl('https://zlo.example.com/login', { ...cfg, allowedHosts: ['*.televend.example'] })).rejects.toThrow(/dopuštenih domena/);
  });

  it('preglednik blokira navigaciju na druge domene i zahtjeve prema lokalnoj mreži', () => {
    const policy = { origin: 'https://portal.primjer.com', host: 'portal.primjer.com', navigationHosts: ['portal.primjer.com', '*.sso.primjer.com'], allowTestTargets: false };
    expect(requestDecision(policy, 'https://portal.primjer.com/izvjestaji', true)).toEqual({ allow: true });
    expect(requestDecision(policy, 'https://login.sso.primjer.com/', true)).toEqual({ allow: true });
    expect(requestDecision(policy, 'https://phishing.example/', true)).toMatchObject({ allow: false });
    expect(requestDecision(policy, 'https://cdn.example/lib.js', false)).toEqual({ allow: true });
    expect(requestDecision(policy, 'http://portal.primjer.com/x', true)).toMatchObject({ allow: false });
    expect(requestDecision(policy, 'https://169.254.169.254/latest', false)).toMatchObject({ allow: false });
    expect(requestDecision(policy, 'https://10.0.0.5/', false)).toMatchObject({ allow: false });
    expect(requestDecision(policy, 'file:///C:/Windows/win.ini', true)).toMatchObject({ allow: false });
  });
});

describe('API: autentifikacija, CSRF, uloge, mrežno ograničenje', () => {
  it('zaštićene rute traže prijavu', async () => {
    const { app: a } = await app();
    const r = await a.inject({ method: 'GET', url: '/api/products', remoteAddress: '192.168.1.20' });
    expect(r.statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/api/health', remoteAddress: '192.168.1.20' })).statusCode).toBe(200);
  });

  it('prijava postavlja httpOnly SameSite=Strict kolačić; pogrešna lozinka ne otkriva postoji li korisnik', async () => {
    const { app: a } = await app();
    const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PASS }, remoteAddress: '192.168.1.20' });
    expect(r.statusCode).toBe(200);
    const sc = String(r.headers['set-cookie']);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    const bad1 = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'kriva' }, remoteAddress: '192.168.1.21' });
    const bad2 = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nepostoji', password: 'kriva' }, remoteAddress: '192.168.1.21' });
    expect(bad1.json().error.message).toBe(bad2.json().error.message);
  });

  it('promjene podataka zahtijevaju CSRF token i ispravan Origin', async () => {
    const { app: a } = await app();
    const s = await login(a);
    const body = { name: 'Napitci' };
    const noToken = await a.inject({ method: 'POST', url: '/api/categories', payload: body, headers: { cookie: s.cookie }, remoteAddress: '192.168.1.20' });
    expect(noToken.statusCode).toBe(403);
    const badOrigin = await a.inject({ method: 'POST', url: '/api/categories', payload: body, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, origin: 'https://zlo.example', host: 'localhost:3000' }, remoteAddress: '192.168.1.20' });
    expect(badOrigin.statusCode).toBe(403);
    const crossSite = await a.inject({ method: 'POST', url: '/api/categories', payload: body, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'sec-fetch-site': 'cross-site' }, remoteAddress: '192.168.1.20' });
    expect(crossSite.statusCode).toBe(403);
    const ok = await a.inject({ method: 'POST', url: '/api/categories', payload: body, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, remoteAddress: '192.168.1.20' });
    expect(ok.statusCode).toBe(200);
  });

  it('uloga „pregled” ne može mijenjati podatke ni pristupiti administraciji', async () => {
    const { app: a } = await app();
    const s = await login(a, 'pregled');
    const read = await a.inject({ method: 'GET', url: '/api/products', headers: { cookie: s.cookie }, remoteAddress: '192.168.1.20' });
    expect(read.statusCode).toBe(200);
    const write = await a.inject({ method: 'POST', url: '/api/categories', payload: { name: 'X' }, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, remoteAddress: '192.168.1.20' });
    expect(write.statusCode).toBe(403);
    const admin = await a.inject({ method: 'GET', url: '/api/users', headers: { cookie: s.cookie }, remoteAddress: '192.168.1.20' });
    expect(admin.statusCode).toBe(403);
  });

  it('API nikad ne vraća spremljene lozinke', async () => {
    const { ctx, app: a } = await app();
    ctx.secrets.set(ctx.db, 'televend.password', 'NeSmijeVan!');
    ctx.secrets.set(ctx.db, 'email.password', 'NiOvaNe!');
    const s = await login(a);
    for (const url of ['/api/televend/state', '/api/settings/email', '/api/system']) {
      const r = await a.inject({ method: 'GET', url, headers: { cookie: s.cookie }, remoteAddress: '192.168.1.20' });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain('NeSmijeVan');
      expect(r.body).not.toContain('NiOvaNe');
    }
  });

  it('zaključavanje računa nakon 5 neuspjelih prijava', async () => {
    const { app: a } = await app();
    for (let i = 0; i < 5; i++) await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'kriva' }, remoteAddress: '192.168.1.30' });
    const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PASS }, remoteAddress: '192.168.1.31' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toMatch(/zaključan/);
  });

  it('ograničenje broja pokušaja prijave po IP adresi (rate limiting)', async () => {
    const { app: a } = await app();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `x${i}`, password: 'kriva' }, remoteAddress: '192.168.1.40' });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('pristup izvan lokalne mreže je odbijen', async () => {
    const { app: a } = await app();
    const r = await a.inject({ method: 'GET', url: '/api/health', remoteAddress: '203.0.113.7' });
    expect(r.statusCode).toBe(403);
  });

  it('početni administrator samo s računala servera (localhost)', async () => {
    const ctx = await makeContext();
    const a = await buildApp(ctx);
    const remote = await a.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: PASS }, remoteAddress: '192.168.1.50' });
    expect(remote.statusCode).toBe(403);
    const local = await a.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: PASS }, remoteAddress: '127.0.0.1' });
    expect(local.statusCode).toBe(200);
    const again = await a.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'drugi', password: PASS }, remoteAddress: '127.0.0.1' });
    expect(again.statusCode).toBe(403);
  });

  it('validacija unosa (Zod) vraća poruku na hrvatskom; SQL znakovi se tretiraju kao podatak', async () => {
    const { app: a, ctx } = await app();
    const s = await login(a);
    const h = { cookie: s.cookie, 'x-csrf-token': s.csrf };
    const bad = await a.inject({ method: 'POST', url: '/api/products', payload: { code: '', name: 'x' }, headers: h, remoteAddress: '192.168.1.20' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/Neispravan unos/);
    const evil = "x'); DROP TABLE products; --";
    const ok = await a.inject({
      method: 'POST',
      url: '/api/products',
      payload: { code: 'SQL1', name: evil, purchasePrice: 1, unit: 'kom', packSize: 1, minStock: 0, targetStock: 0, active: true },
      headers: h,
      remoteAddress: '192.168.1.20',
    });
    expect(ok.statusCode).toBe(200);
    expect((ctx.db.prepare('SELECT name FROM products WHERE code = ?').get('SQL1') as { name: string }).name).toBe(evil);
  });

  it('sigurnosna zaglavlja (CSP, X-Frame, nosniff)', async () => {
    const { app: a } = await app();
    const r = await a.inject({ method: 'GET', url: '/api/health', remoteAddress: '192.168.1.20' });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
