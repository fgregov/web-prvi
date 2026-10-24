import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Korijenska mapa projekta VendiStock (iznad server/). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const APP_VERSION = '1.1.0-test.1';
export const TIMEZONE = 'Europe/Zagreb';

/** Službena adresa korisničkog portala Televend Cloud (potvrdio Vending Express). */
export const TELEVEND_OFFICIAL_URL = 'https://app.televendcloud.com';
export const TELEVEND_DEFAULT_ALLOWED_HOSTS = ['app.televendcloud.com'];
export const TELEVEND_DEFAULT_NAVIGATION_HOSTS = ['*.televendcloud.com'];

export type AppMode = 'production' | 'demo' | 'test';
export type KeyProtection = 'dpapi' | 'file';

export interface AppConfig {
  mode: AppMode;
  host: string;
  port: number;
  /** Adresa koju korisnici koriste u LAN-u, npr. https://192.168.1.50:3000 (samo za prikaz i e-mail). */
  publicUrl: string | null;
  dataDir: string;
  dbFile: string;
  backupDir: string;
  logDir: string;
  clientDistDir: string;
  https: {
    enabled: boolean;
    pfxPath: string | null;
    pfxPassphrase: string | null;
    certPath: string | null;
    keyPath: string | null;
  };
  /** CIDR rasponi s kojih je dopušten pristup aplikaciji. */
  allowedClientCidrs: string[];
  trustProxy: boolean;
  sessionTtlHours: number;
  keyProtection: KeyProtection;
  dpapiScope: 'CurrentUser' | 'LocalMachine';
  televend: {
    /** Ako je postavljeno, URL portala mora pripadati jednom od ovih hostova (podržan prefiks *.). */
    allowedHosts: string[];
    /** Dodatni hostovi na koje je dopuštena navigacija (npr. SSO prijava). */
    extraNavigationHosts: string[];
    browserExecutable: string | null;
    /** Samo za automatske testove: dopušta http:// i localhost ciljeve. */
    allowTestTargets: boolean;
  };
}

export function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'test') return;
  const file = process.env.VENDISTOCK_ENV_FILE ?? path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(file)) {
    process.loadEnvFile(file);
  }
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'da', 'on'].includes(v.trim().toLowerCase());
}

function list(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hostList(v: string | undefined, def: string[]): string[] {
  if (v === undefined || v.trim() === '') return def;
  const l = list(v).map((h) => h.toLowerCase());
  return l.includes('*') ? [] : l;
}

function resolvePath(p: string | undefined, def: string): string {
  const value = p && p.trim() ? p.trim() : def;
  return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
}

export const DEFAULT_ALLOWED_CIDRS = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fe80::/10',
  'fc00::/7',
];

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv();
  const env = process.env;
  const mode: AppMode =
    env.NODE_ENV === 'test' ? 'test' : env.VENDISTOCK_MODE === 'demo' ? 'demo' : 'production';
  const dataDir = resolvePath(env.VENDISTOCK_DATA_DIR, 'data');
  const defaultDb = mode === 'demo' ? 'vendistock-demo.db' : 'vendistock.db';
  const keyProtection: KeyProtection =
    (env.VENDISTOCK_KEY_PROTECTION as KeyProtection | undefined) ??
    (process.platform === 'win32' ? 'dpapi' : 'file');

  const cfg: AppConfig = {
    mode,
    host: env.VENDISTOCK_HOST ?? '0.0.0.0',
    port: Number(env.VENDISTOCK_PORT ?? 3000),
    publicUrl: env.VENDISTOCK_PUBLIC_URL?.trim() || null,
    dataDir,
    dbFile: resolvePath(env.VENDISTOCK_DB_FILE, path.join(dataDir, defaultDb)),
    backupDir: resolvePath(env.VENDISTOCK_BACKUP_DIR, path.join(dataDir, 'backups')),
    logDir: resolvePath(env.VENDISTOCK_LOG_DIR, path.join(dataDir, 'logs')),
    clientDistDir: path.join(PROJECT_ROOT, 'client', 'dist'),
    https: {
      enabled: bool(env.HTTPS_ENABLED, false),
      pfxPath: env.HTTPS_PFX_PATH ? resolvePath(env.HTTPS_PFX_PATH, '') : null,
      pfxPassphrase: env.HTTPS_PFX_PASSPHRASE ?? null,
      certPath: env.HTTPS_CERT_PATH ? resolvePath(env.HTTPS_CERT_PATH, '') : null,
      keyPath: env.HTTPS_KEY_PATH ? resolvePath(env.HTTPS_KEY_PATH, '') : null,
    },
    allowedClientCidrs: list(env.ALLOWED_CLIENT_CIDRS).length
      ? list(env.ALLOWED_CLIENT_CIDRS)
      : DEFAULT_ALLOWED_CIDRS,
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    keyProtection,
    dpapiScope: env.DPAPI_SCOPE === 'LocalMachine' ? 'LocalMachine' : 'CurrentUser',
    televend: {
      // Zadano: samo službeni portal. „*” uklanja ograničenje popisom (ostala pravila i dalje vrijede).
      allowedHosts: hostList(env.TELEVEND_ALLOWED_HOSTS, TELEVEND_DEFAULT_ALLOWED_HOSTS),
      extraNavigationHosts: hostList(env.TELEVEND_EXTRA_NAVIGATION_HOSTS, TELEVEND_DEFAULT_NAVIGATION_HOSTS),
      browserExecutable: env.TELEVEND_BROWSER_EXECUTABLE?.trim() || null,
      allowTestTargets: mode === 'test' && bool(env.TELEVEND_ALLOW_TEST_TARGETS, false),
    },
    ...overrides,
  };

  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error(`Neispravan VENDISTOCK_PORT: ${env.VENDISTOCK_PORT}`);
  }
  if (cfg.https.enabled && !cfg.https.pfxPath && !(cfg.https.certPath && cfg.https.keyPath)) {
    throw new Error('HTTPS_ENABLED=true zahtijeva HTTPS_PFX_PATH ili HTTPS_CERT_PATH + HTTPS_KEY_PATH.');
  }
  return cfg;
}
