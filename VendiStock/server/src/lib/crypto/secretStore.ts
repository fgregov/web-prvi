import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../../db/index.js';
import { nowIso } from '../time.js';
import { dpapiProtect, dpapiUnprotect, type ExecFn } from './dpapi.js';

export interface KeyFile {
  version: 1;
  protection: 'dpapi' | 'file';
  scope?: 'CurrentUser' | 'LocalMachine';
  keyId: string;
  createdAt: string;
  blob: string;
}

export interface SecretStoreOptions {
  keyFile: string;
  protection: 'dpapi' | 'file';
  dpapiScope: 'CurrentUser' | 'LocalMachine';
  exec?: ExecFn;
}

export type KeyStatus = 'ok' | 'created' | 'unavailable';

/**
 * Šifrirana pohrana tajni (lozinke Televenda i SMTP-a, kolačići sesije portala).
 * Glavni ključ (AES-256) zaštićen je Windows DPAPI-jem; šifrirani zapisi nalaze se u tablici `secrets`.
 * Tajne nikad ne napuštaju backend – API vraća samo informaciju postoji li tajna.
 */
export class SecretStore {
  private key: Buffer | null = null;
  keyId: string | null = null;
  status: KeyStatus = 'unavailable';
  lastError: string | null = null;

  constructor(private readonly opts: SecretStoreOptions) {}

  async init(): Promise<KeyStatus> {
    try {
      if (fs.existsSync(this.opts.keyFile)) {
        const kf = JSON.parse(fs.readFileSync(this.opts.keyFile, 'utf8')) as KeyFile;
        const raw = Buffer.from(kf.blob, 'base64');
        this.key =
          kf.protection === 'dpapi'
            ? await dpapiUnprotect(raw, kf.scope ?? this.opts.dpapiScope, this.opts.exec)
            : raw;
        if (this.key.length !== 32) throw new Error('Neispravna duljina ključa.');
        const id = keyIdOf(this.key);
        if (id !== kf.keyId) throw new Error('Identifikator ključa ne odgovara.');
        this.keyId = id;
        this.status = 'ok';
      } else {
        await this.createKey();
        this.status = 'created';
      }
      this.lastError = null;
    } catch (e) {
      this.key = null;
      this.keyId = null;
      this.status = 'unavailable';
      this.lastError =
        (e as Error).message +
        ' – ključ je vjerojatno zaštićen za drugi Windows korisnički račun ili računalo.';
    }
    return this.status;
  }

  /** Stvara novi glavni ključ. Postojeće šifrirane tajne postaju nečitljive i moraju se ponovno unijeti. */
  async createKey(): Promise<void> {
    const key = crypto.randomBytes(32);
    const blob =
      this.opts.protection === 'dpapi'
        ? await dpapiProtect(key, this.opts.dpapiScope, this.opts.exec)
        : key;
    const kf: KeyFile = {
      version: 1,
      protection: this.opts.protection,
      scope: this.opts.protection === 'dpapi' ? this.opts.dpapiScope : undefined,
      keyId: keyIdOf(key),
      createdAt: nowIso(),
      blob: blob.toString('base64'),
    };
    fs.mkdirSync(path.dirname(this.opts.keyFile), { recursive: true });
    const tmp = `${this.opts.keyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(kf, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.opts.keyFile);
    this.key = key;
    this.keyId = kf.keyId;
    this.status = 'ok';
    this.lastError = null;
  }

  get available(): boolean {
    return this.key !== null;
  }

  encrypt(name: string, plaintext: string | Buffer): string {
    if (!this.key) throw new Error('Ključ za šifriranje nije dostupan.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
  }

  decrypt(name: string, payload: string): Buffer {
    if (!this.key) throw new Error('Ključ za šifriranje nije dostupan.');
    if (!payload.startsWith('v1:')) throw new Error('Nepoznat format šifriranog zapisa.');
    const buf = Buffer.from(payload.slice(3), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(name, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  set(db: DB, name: string, value: string | Buffer): void {
    const ciphertext = this.encrypt(name, value);
    db.prepare(
      `INSERT INTO secrets (name, ciphertext, key_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, key_id = excluded.key_id, updated_at = excluded.updated_at`,
    ).run(name, ciphertext, this.keyId, nowIso());
  }

  /** Vraća dešifriranu vrijednost ili null ako tajna ne postoji / nije čitljiva trenutačnim ključem. */
  get(db: DB, name: string): string | null {
    const buf = this.getBuffer(db, name);
    return buf ? buf.toString('utf8') : null;
  }

  getBuffer(db: DB, name: string): Buffer | null {
    const row = db.prepare('SELECT ciphertext, key_id FROM secrets WHERE name = ?').get(name) as
      | { ciphertext: string; key_id: string }
      | undefined;
    if (!row || !this.key || row.key_id !== this.keyId) return null;
    try {
      return this.decrypt(name, row.ciphertext);
    } catch {
      return null;
    }
  }

  /** Postoji li tajna i može li se pročitati. */
  info(db: DB, name: string): { stored: boolean; readable: boolean; updatedAt: string | null } {
    const row = db.prepare('SELECT key_id, updated_at FROM secrets WHERE name = ?').get(name) as
      | { key_id: string; updated_at: string }
      | undefined;
    if (!row) return { stored: false, readable: false, updatedAt: null };
    return { stored: true, readable: this.available && row.key_id === this.keyId, updatedAt: row.updated_at };
  }

  delete(db: DB, name: string): void {
    db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
  }
}

function keyIdOf(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}
