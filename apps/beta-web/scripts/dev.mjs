// npm run dev (pnpm dev) → Renvara on http://localhost:3000 for development
// and local testing, restarted on every code change (node --watch).
//
//   first start   no apps/beta-web/.env yet: asks for the owner (name, user
//                 name, e-mail, password) and writes .env — the password only
//                 as a scrypt hash, a new session secret and push keys. .env is
//                 git-ignored and never leaves this computer.
//   --demo        OPTIONAL demo records, in their own files (.data/demo/,
//                 scripts/seed-demo.ts): never mixed with the organization's
//                 data in .data/crm.json.
//
// The port is PORT from .env (3000 by default); when it is taken, this says so
// instead of quietly using another one. E-mail for IZVJEŠTAJI: RESEND_API_KEY
// and RENVARA_EMAIL_FROM in .env (see .env.example); without them the app runs
// and says that e-mail is not configured.
import { spawn } from 'node:child_process';
import { createECDH, randomBytes, scrypt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(APP, '.env');
const DEMO = process.argv.includes('--demo');
const say = (text = '') => process.stdout.write(`${text}\n`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  say(
    `\n  ✖ Renvara (npm run dev) treba Node.js 22.18 ili noviji (ovdje je ${process.versions.node}).` +
      '\n    Instalirajte Node.js 22 LTS ili 24 LTS s https://nodejs.org i pokrenite ponovno.\n',
  );
  process.exit(1);
}

// ------------------------------------------------------------ questions ---
let input = null;
let lines = null; // piped answers (tests, scripts)
const pending = [];
let muted = false;
function openInput() {
  input = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  const write = input._writeToOutput?.bind(input);
  if (write) {
    input._writeToOutput = (text) => {
      if (!muted) return write(text);
      if (/[\r\n]/.test(text)) write('\n');
    };
  }
  if (!process.stdin.isTTY) {
    lines = [];
    input.on('line', (line) => {
      const waiting = pending.shift();
      if (waiting) waiting(line);
      else lines.push(line);
    });
  }
}
function ask(question, { hidden = false } = {}) {
  if (lines) {
    process.stdout.write(question);
    const next = lines.shift();
    const echo = (line) => say(hidden ? '' : line);
    if (next !== undefined) {
      echo(next);
      return Promise.resolve(next);
    }
    return new Promise((done) =>
      pending.push((line) => {
        echo(line);
        done(line);
      }),
    );
  }
  return new Promise((done) => {
    input.question(question, (answer) => {
      muted = false;
      done(answer);
    });
    muted = hidden;
  });
}
async function askUntil(question, check, options) {
  for (;;) {
    const answer = (await ask(question, options)).trim();
    const problem = check(answer);
    if (!problem) return answer;
    say(`    ${problem}`);
  }
}

/** scrypt$N$r$p$salt$key: the format the server checks (RENVARA_BETA_PASSWORD_HASH). */
function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((done, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error
        ? reject(error)
        : done(
            ['scrypt', 32768, 8, 1, salt.toString('base64url'), key.toString('base64url')].join(
              '$',
            ),
          ),
    ),
  );
}

async function firstRun() {
  const { passwordErrors } = await import('../public/app/js/core/validation.js');
  openInput();
  say();
  say('  Renvara — prvo pokretanje (npm run dev).');
  say(
    '  Postavljamo vlasnika aplikacije; zapisuje se u apps/beta-web/.env (lozinka samo kao hash).',
  );
  say();
  const displayName = await askUntil('  Ime i prezime: ', (v) =>
    v.length < 2 || v.length > 100 ? 'Upišite ime i prezime.' : null,
  );
  const username = await askUntil('  Korisničko ime za prijavu (npr. ana.horvat): ', (v) =>
    /^[A-Za-z0-9._-]{3,64}$/.test(v) ? null : 'Od 3 do 64 znaka: slova, brojke, točka, crtica.',
  );
  const email = await askUntil('  E-mail (neobavezno, Enter za preskočiti): ', (v) =>
    !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Neispravan e-mail.',
  );
  let password;
  for (;;) {
    password = await ask('  Lozinka (najmanje 12 znakova, slova i brojke; ne prikazuje se): ', {
      hidden: true,
    });
    const confirm = await ask('  Ponovite lozinku: ', { hidden: true });
    const errors = passwordErrors(password, confirm, {
      email,
      names: [...displayName.split(/\s+/), username],
    });
    const problem = errors.password ?? errors.confirm;
    if (!problem) break;
    say(`    ${problem}`);
  }
  input.close();
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const quote = (v) => (/^[A-Za-z0-9._@:/+=$-]*$/.test(v) ? v : JSON.stringify(v));
  const env = [
    '# Renvara — lokalne postavke (npm run dev, prvo pokretanje). Ne dijelite ovu datoteku.',
    '# Lozinka vlasnika je spremljena samo kao scrypt hash.',
    'HOST=127.0.0.1',
    'PORT=3000',
    `RENVARA_BETA_USERNAME=${quote(username)}`,
    `RENVARA_BETA_PASSWORD_HASH=${await hashPassword(password)}`,
    `RENVARA_BETA_DISPLAY_NAME=${quote(displayName)}`,
    ...(email ? [`RENVARA_BETA_EMAIL=${quote(email.toLowerCase())}`] : []),
    `RENVARA_SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
    'RENVARA_ORG_TIMEZONE=Europe/Zagreb',
    `RENVARA_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`,
    `RENVARA_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`,
    `RENVARA_VAPID_SUBJECT=mailto:${email || 'renvara@localhost.invalid'}`,
    '',
    '# IZVJEŠTAJI → Pošalji e-mail (neobavezno): e-mail servis Resend (https://resend.com).',
    '# Bez ovih postavki aplikacija radi, a slanje e-maila jasno javlja da nije konfigurirano.',
    '# RESEND_API_KEY=re_...',
    '# RENVARA_EMAIL_FROM="RENVARA CRM <izvjestaji@vasa-domena.hr>"',
    '',
  ].join('\n');
  writeFileSync(ENV_FILE, env, { mode: 0o600 });
  say();
  say(
    `  ✔ Zapisano u ${ENV_FILE}. Prijavite se korisničkim imenom${email ? ' ili e-mailom' : ''} i lozinkom.`,
  );
}

/** The values of .env (KEY=value lines; quotes removed). */
function readEnv() {
  const values = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const isFree = (port, host) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, host, () => probe.close(() => done(true)));
  });

async function main() {
  if (!existsSync(ENV_FILE)) {
    if (process.env.RENVARA_BETA_USERNAME) {
      say('  (Bez .env: koriste se RENVARA_* varijable okruženja.)');
    } else {
      await firstRun();
    }
  }
  const fileEnv = existsSync(ENV_FILE) ? readEnv() : {};
  const port = Number(process.env.PORT ?? fileEnv.PORT ?? 3000);
  const host = process.env.HOST ?? fileEnv.HOST ?? '127.0.0.1';
  if (!(await isFree(port, host))) {
    say();
    say(`  ✖ Port ${port} je zauzet (možda Renvara već radi u drugom prozoru).`);
    say('    Zatvorite program koji ga koristi ili u apps/beta-web/.env postavite drugi PORT=…');
    say();
    process.exit(1);
  }

  const overrides = { PORT: String(port) };
  if (DEMO) {
    // Demo records only in .data/demo/: the organization's data is never touched.
    const dir = join(APP, '.data', 'demo');
    Object.assign(overrides, {
      RENVARA_DATA_FILE: join(dir, 'crm.json'),
      RENVARA_IDENTITY_FILE: join(dir, 'identity.json'),
      RENVARA_DOCUMENTS_DIR: join(dir, 'offer-documents'),
    });
    const { seedDemoFile } = await import('./seed-demo.ts');
    seedDemoFile({ ...fileEnv, ...process.env, ...overrides });
  }

  const url = `http://localhost:${port}`;
  say();
  say(`  Renvara se pokreće na ${url}${DEMO ? ' (DEMO podaci, .data/demo/)' : ''}`);
  say(`  Prijava: ${url}/login · Izvještaji: ${url}/reports · Zaustavljanje: Ctrl+C`);
  say();
  const child = spawn(
    process.execPath,
    [...(existsSync(ENV_FILE) ? ['--env-file=.env'] : []), '--watch', 'src/server.ts'],
    { cwd: APP, stdio: 'inherit', env: { ...process.env, ...overrides } },
  );
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  say(`\n  ✖ ${error.message}\n`);
  process.exit(1);
});
