import dns from 'node:dns/promises';
import net from 'node:net';
import type { AppConfig } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { isNonPublicIp } from '../lib/ip.js';

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p;
}

export interface PortalPolicy {
  origin: string;
  host: string;
  /** Hostovi na koje je dopuštena navigacija glavnog okvira i iframeova. */
  navigationHosts: string[];
  allowTestTargets: boolean;
}

/**
 * Provjera URL-a koji je unio korisnik (zaštita od zlouporabe/SSRF):
 * – samo HTTPS, bez korisničkih podataka u URL-u, bez IP adresa i lokalnih imena,
 * – host mora biti na popisu TELEVEND_ALLOWED_HOSTS (ako je popis postavljen),
 * – DNS ne smije pokazivati na privatne/lokalne adrese.
 */
export async function validatePortalUrl(raw: string, cfg: AppConfig['televend']): Promise<PortalPolicy> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest('Web adresa nije ispravna. Primjer: https://portal.primjer.com');
  }
  const testMode = cfg.allowTestTargets;
  if (url.protocol !== 'https:' && !(testMode && url.protocol === 'http:')) {
    throw badRequest('Dopuštene su samo HTTPS adrese.');
  }
  if (url.username || url.password) throw badRequest('Web adresa ne smije sadržavati korisničko ime ili lozinku.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!testMode) {
    if (net.isIP(host)) throw badRequest('Unesite naziv domene, a ne IP adresu.');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
      throw badRequest('Lokalne adrese nisu dopuštene za Televend portal.');
    }
    if (url.port && url.port !== '443') throw badRequest('Dopušten je samo standardni HTTPS port (443).');
  }
  if (cfg.allowedHosts.length && !cfg.allowedHosts.some((p) => hostMatches(host, p))) {
    throw badRequest(
      `Domena „${host}” nije na popisu dopuštenih domena (TELEVEND_ALLOWED_HOSTS u konfiguraciji servera).`,
    );
  }
  if (!testMode) {
    let addrs: string[] = [];
    try {
      addrs = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw badRequest(`Domena „${host}” se ne može razriješiti (DNS). Provjerite adresu i internetsku vezu.`);
    }
    if (!addrs.length || addrs.some(isNonPublicIp)) {
      throw badRequest('Domena pokazuje na privatnu ili lokalnu mrežnu adresu, što nije dopušteno.');
    }
  }
  return {
    origin: url.origin,
    host,
    navigationHosts: [host, ...cfg.extraNavigationHosts],
    allowTestTargets: testMode,
  };
}

/** Odluka za svaki zahtjev preglednika. Navigacije izvan dopuštenih hostova se blokiraju. */
export function requestDecision(
  policy: PortalPolicy,
  reqUrl: string,
  isNavigation: boolean,
): { allow: true } | { allow: false; reason: string } {
  let u: URL;
  try {
    u = new URL(reqUrl);
  } catch {
    return { allow: false, reason: 'neispravan URL' };
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return { allow: true };
  if (u.protocol !== 'https:' && !(policy.allowTestTargets && u.protocol === 'http:')) {
    return { allow: false, reason: `protokol ${u.protocol} nije dopušten` };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!policy.allowTestTargets) {
    if (host === 'localhost' || (net.isIP(host) && isNonPublicIp(host))) {
      return { allow: false, reason: `pristup lokalnoj adresi ${host} nije dopušten` };
    }
  }
  if (isNavigation && !policy.navigationHosts.some((p) => hostMatches(host, p))) {
    return { allow: false, reason: `preusmjeravanje na ${host} nije dopušteno` };
  }
  return { allow: true };
}

/** Razrješava relativnu putanju s portala i provjerava da ostaje na istom hostu. */
export function resolvePortalPath(policy: PortalPolicy, pathOrUrl: string): string {
  const u = new URL(pathOrUrl, policy.origin);
  const host = u.hostname.toLowerCase();
  if (!policy.navigationHosts.some((p) => hostMatches(host, p))) {
    throw badRequest(`Adresa ${u.origin} nije na dopuštenoj domeni portala.`);
  }
  return u.toString();
}
