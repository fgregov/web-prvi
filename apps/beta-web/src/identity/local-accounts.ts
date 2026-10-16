// The BETA server's own identity state, one JSON file next to the CRM data
// (RENVARA_IDENTITY_FILE, mode 0600), never inside it:
//   accounts   e-mail and scrypt password hash per user
//   links      SHA-256 of one-time password links (invitation, reset)
//   sessions   per user: sessions issued before this time are refused
// The first owner (RENVARA_BETA_USERNAME / _PASSWORD) keeps the password from
// the server settings, compared as before (auth/beta-provider.ts).
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthProvider } from '../auth/types.ts';
import type { AccountStore, PasswordLink, SessionPolicy } from './accounts.ts';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** scrypt N=2^15, r=8, p=1: about 50 ms per check, 32 MiB of memory. */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 2 * 60 * 60 * 1000;

interface AccountRecord {
  email: string;
  /** scrypt$N$r$p$salt$hash (base64url); null until the user sets a password. */
  hash: string | null;
  /** The first owner: the password is RENVARA_BETA_PASSWORD. */
  serverPassword?: true;
  passwordChangedAt: string | null;
}

interface LinkRecord {
  userId: string;
  purpose: 'invite' | 'reset';
  expiresAt: string;
}

interface IdentityState {
  version: 1;
  accounts: Record<string, AccountRecord>;
  links: Record<string, LinkRecord>;
  sessions: Record<string, number>;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Spent on unknown e-mails too, so the answer time does not tell which addresses exist. */
let dummyHash: Promise<string> | null = null;

export interface LocalIdentity {
  readonly accounts: AccountStore;
  readonly sessions: SessionPolicy;
}

/**
 * @param file  RENVARA_IDENTITY_FILE
 * @param bootstrap  the first owner from the server settings: user id and the
 *                   provider that checks RENVARA_BETA_USERNAME / _PASSWORD
 */
export function createLocalIdentity(
  file: string,
  bootstrap: { userId: string; username: string; provider: AuthProvider } | null,
  now: () => Date = () => new Date(),
): LocalIdentity {
  let state: IdentityState;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<IdentityState>;
    state = {
      version: 1,
      accounts: parsed.accounts ?? {},
      links: parsed.links ?? {},
      sessions: parsed.sessions ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    state = { version: 1, accounts: {}, links: {}, sessions: {} };
  }
  if (bootstrap && !state.accounts[bootstrap.userId]) {
    state.accounts[bootstrap.userId] = {
      email: '',
      hash: null,
      serverPassword: true,
      passwordChangedAt: null,
    };
  }

  function save() {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, file);
  }
  save();

  const prune = () => {
    const at = now().getTime();
    for (const [key, link] of Object.entries(state.links)) {
      if (Date.parse(link.expiresAt) <= at) delete state.links[key];
    }
  };

  function issueLink(userId: string, purpose: LinkRecord['purpose'], origin: string): PasswordLink {
    prune();
    // One live link per user: a new one replaces the previous.
    for (const [key, link] of Object.entries(state.links)) {
      if (link.userId === userId) delete state.links[key];
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      now().getTime() + (purpose === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS),
    ).toISOString();
    state.links[digest(token)] = { userId, purpose, expiresAt };
    save();
    // In the fragment: never sent to a server, so never in an access log.
    return { delivery: 'link', url: `${origin}/set-password#token=${token}`, expiresAt };
  }

  const sessions: SessionPolicy = {
    validAfter: (userId) => state.sessions[userId] ?? 0,
    revokeAll(userId, atSeconds) {
      // Always later than the previous cut-off: a session issued right after
      // it (at the cut-off) ends too, even within the same second.
      state.sessions[userId] = Math.max(atSeconds, (state.sessions[userId] ?? 0) + 1);
      save();
    },
  };

  const accounts: AccountStore = {
    kind: 'local',

    async verify(identifier, password) {
      const login = identifier.trim();
      if (bootstrap && login === bootstrap.username) {
        return bootstrap.provider.authenticate(login, password) ? bootstrap.userId : null;
      }
      const email = login.toLowerCase();
      const entry = Object.entries(state.accounts).find(([, a]) => a.email && a.email === email);
      if (entry?.[1].serverPassword && bootstrap) {
        return bootstrap.provider.authenticate(bootstrap.username, password) ? entry[0] : null;
      }
      if (!entry?.[1].hash) {
        dummyHash ??= hashPassword(randomUUID());
        await verifyPassword(password, await dummyHash);
        return null;
      }
      return (await verifyPassword(password, entry[1].hash)) ? entry[0] : null;
    },

    async confirm(userId, _email, password) {
      const account = state.accounts[userId];
      if (!account) return false;
      if (account.serverPassword) {
        return Boolean(bootstrap && bootstrap.provider.authenticate(bootstrap.username, password));
      }
      return account.hash ? verifyPassword(password, account.hash) : false;
    },

    async create(input, origin) {
      const userId = randomUUID();
      state.accounts[userId] = {
        email: input.email.toLowerCase(),
        hash: null,
        passwordChangedAt: null,
      };
      return { userId, link: issueLink(userId, 'invite', origin) };
    },

    async remove(userId) {
      delete state.accounts[userId];
      for (const [key, link] of Object.entries(state.links)) {
        if (link.userId === userId) delete state.links[key];
      }
      save();
    },

    async setEmail(userId, email) {
      const account = state.accounts[userId];
      if (!account) throw new Error('account not found');
      account.email = email.toLowerCase();
      save();
    },

    async setPassword(userId, password) {
      const account = state.accounts[userId];
      if (!account || account.serverPassword) throw new Error('password is managed elsewhere');
      account.hash = await hashPassword(password);
      account.passwordChangedAt = now().toISOString();
      save();
    },

    async passwordLink(userId, _email, origin) {
      const account = state.accounts[userId];
      if (!account || account.serverPassword) throw new Error('password is managed elsewhere');
      return issueLink(userId, account.hash ? 'reset' : 'invite', origin);
    },

    async linkUser(token) {
      prune();
      const link = state.links[digest(token)];
      return link && state.accounts[link.userId] ? link.userId : null;
    },

    async completeLink(token, password) {
      prune();
      const key = digest(token);
      const link = state.links[key];
      const account = link && state.accounts[link.userId];
      if (!link || !account || account.serverPassword) return null;
      delete state.links[key]; // once only
      account.hash = await hashPassword(password);
      account.passwordChangedAt = now().toISOString();
      save();
      return link.userId;
    },

    async setBlocked() {
      // Sign-in checks the member's status in the directory on every request.
    },

    async passwordState(userId) {
      const account = state.accounts[userId];
      if (account?.serverPassword) return 'server';
      return account?.hash ? 'set' : 'pending';
    },
  };

  return { accounts, sessions };
}
