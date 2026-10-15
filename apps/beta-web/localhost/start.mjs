// Renvara na vašem računalu (localhost): pokreće pravi Renvara server na
// http://localhost:<port>, samo za ovo računalo, s podacima u mapi `podaci`.
//
//   prvi put        pita ime, korisničko ime, e-mail i lozinku vlasnika;
//                   lozinka se sprema samo kao scrypt hash (nikad kao tekst)
//   --nova-lozinka  nova lozinka vlasnika
//   --bez-preglednika  ne otvara preglednik
//   --port=3000     drugi port
//
// Treba samo Node.js (20.11 ili noviji); ništa se ne instalira i ne preuzima.
import { spawn } from 'node:child_process';
import { createECDH, randomBytes, scrypt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const PROGRAM = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PROGRAM, '..');
const DATA = join(ROOT, 'podaci');
const SETTINGS = join(DATA, 'postavke.json');
const SERVER = join(PROGRAM, 'apps', 'beta-web', 'server', 'renvara.mjs');
const DEFAULT_PORT = 3000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const portArg = Number(args.find((a) => a.startsWith('--port='))?.slice('--port='.length));

const say = (text = '') => process.stdout.write(`${text}\n`);
const fail = (text) => {
  say();
  say(`  ✖ ${text}`);
  say();
  process.exitCode = 1;
};

// ------------------------------------------------------------- Node.js ---
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 11)) {
  fail(
    `Renvara treba Node.js 20.11 ili noviji (ovdje je ${process.versions.node}). ` +
      'Instalirajte verziju LTS s https://nodejs.org i pokrenite ponovno.',
  );
  process.exit(1);
}
if (!existsSync(SERVER)) {
  fail('Mapa "program" nije potpuna. Raspakirajte cijeli ZIP ponovno.');
  process.exit(1);
}

// ------------------------------------------------------------ questions ---
const input = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
});
let muted = false;
// While a password is typed nothing is echoed (like sudo); Enter still moves on.
const write = input._writeToOutput?.bind(input);
if (write) {
  input._writeToOutput = (text) => {
    if (!muted) return write(text);
    if (/[\r\n]/.test(text)) write('\n');
  };
}
let lines = null; // piped answers (tests, scripts): read line by line
const pending = [];
if (!process.stdin.isTTY) {
  lines = [];
  input.on('line', (line) => {
    const waiting = pending.shift();
    if (waiting) waiting(line);
    else lines.push(line);
  });
}
function ask(question, { hidden = false } = {}) {
  if (lines) {
    process.stdout.write(question);
    const next = lines.shift();
    if (next !== undefined) {
      say(hidden ? '' : next);
      return Promise.resolve(next);
    }
    return new Promise((done) =>
      pending.push((line) => {
        say(hidden ? '' : line);
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

async function askPassword(names) {
  const { passwordErrors } = await import('./apps/beta-web/public/app/js/core/validation.js').catch(
    () => ({ passwordErrors: null }),
  );
  for (;;) {
    const password = await ask(
      '  Lozinka (najmanje 12 znakova, slova i brojke; ne prikazuje se): ',
      {
        hidden: true,
      },
    );
    const confirm = await ask('  Ponovite lozinku: ', { hidden: true });
    const errors = passwordErrors
      ? passwordErrors(password, confirm, names)
      : password.length < 12
        ? { password: 'Lozinka mora imati barem 12 znakova.' }
        : password !== confirm
          ? { confirm: 'Lozinke se ne podudaraju.' }
          : {};
    const problem = errors.password ?? errors.confirm;
    if (!problem) return password;
    say(`    ${problem}`);
  }
}

// ----------------------------------------------------------- settings ---
/** scrypt$N$r$p$salt$key: the same format the server checks (RENVARA_BETA_PASSWORD_HASH). */
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

function readSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Datoteka ${SETTINGS} nije ispravna (${error.message}).`);
  }
}

function saveSettings(settings) {
  mkdirSync(DATA, { recursive: true });
  const temp = `${SETTINGS}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, SETTINGS);
}

async function firstRun() {
  say();
  say('  Dobro došli u Renvaru. Prvo postavljamo vlasnika (administratora) aplikacije.');
  say('  Podaci ostaju na ovom računalu, u mapi "podaci".');
  say();
  const displayName = await askUntil('  Ime i prezime: ', (v) =>
    v.length < 2 || v.length > 100 ? 'Upišite ime i prezime.' : null,
  );
  const username = await askUntil(
    '  Korisničko ime za prijavu (bez razmaka, npr. ana.horvat): ',
    (v) =>
      /^[A-Za-z0-9._-]{3,64}$/.test(v) ? null : 'Od 3 do 64 znaka: slova, brojke, točka, crtica.',
  );
  const email = await askUntil('  E-mail (neobavezno, Enter za preskočiti): ', (v) =>
    !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Neispravan e-mail.',
  );
  const password = await askPassword({ email, names: [...displayName.split(/\s+/), username] });
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const settings = {
    version: 1,
    owner: {
      username,
      displayName,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
    },
    sessionSecret: randomBytes(48).toString('base64url'),
    push: {
      publicKey: ecdh.getPublicKey().toString('base64url'),
      privateKey: ecdh.getPrivateKey().toString('base64url'),
      subject: `mailto:${email || 'renvara@localhost.invalid'}`,
    },
    port: DEFAULT_PORT,
    createdAt: new Date().toISOString(),
  };
  saveSettings(settings);
  say();
  say(
    '  ✔ Postavljeno. Prijavite se korisničkim imenom' +
      (email ? ' ili e-mailom' : '') +
      ' i lozinkom.',
  );
  return settings;
}

async function newPassword(settings) {
  say();
  say(`  Nova lozinka za vlasnika "${settings.owner.username}".`);
  const password = await askPassword({
    email: settings.owner.email,
    names: [...settings.owner.displayName.split(/\s+/), settings.owner.username],
  });
  settings.owner.passwordHash = await hashPassword(password);
  // Sessions signed with the old secret end: everyone signs in again.
  settings.sessionSecret = randomBytes(48).toString('base64url');
  saveSettings(settings);
  say('  ✔ Lozinka je promijenjena. Prijavite se ponovno.');
}

// --------------------------------------------------------------- start ---
const isFree = (port) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });

async function runningRenvara(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = await response.json();
    return typeof body.authenticated === 'boolean';
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (flag('bez-preglednika')) return;
  const [command, commandArgs] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, commandArgs, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* the address is printed anyway */
  }
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zagreb';
  } catch {
    return 'Europe/Zagreb';
  }
}

async function main() {
  let settings = readSettings();
  if (!settings) {
    settings = await firstRun();
  } else if (flag('nova-lozinka')) {
    const port = Number.isInteger(portArg) && portArg > 0 ? portArg : settings.port || DEFAULT_PORT;
    if (await runningRenvara(port)) {
      input.close();
      fail('Renvara upravo radi. Zatvorite njezin prozor, pa ponovite --nova-lozinka.');
      return;
    }
    await newPassword(settings);
  }
  input.close();

  let port = Number.isInteger(portArg) && portArg > 0 ? portArg : settings.port || DEFAULT_PORT;
  if (!(await isFree(port))) {
    if (await runningRenvara(port)) {
      const url = `http://localhost:${port}`;
      say();
      say(`  Renvara već radi na ${url} (u drugom prozoru). Otvaram preglednik.`);
      openBrowser(`${url}/login`);
      return;
    }
    let next = port + 1;
    while (next < port + 20 && !(await isFree(next))) next += 1;
    if (next >= port + 20) {
      fail(`Port ${port} i sljedeći su zauzeti. Pokrenite s --port=XXXX.`);
      return;
    }
    say(`  Port ${port} je zauzet; koristim ${next}.`);
    port = next;
  }

  const url = `http://localhost:${port}`;
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('RENVARA_') && key !== 'NODE_ENV',
      ),
    ),
    HOST: '127.0.0.1', // only this computer
    PORT: String(port),
    RENVARA_BETA_USERNAME: settings.owner.username,
    RENVARA_BETA_PASSWORD_HASH: settings.owner.passwordHash,
    RENVARA_BETA_DISPLAY_NAME: settings.owner.displayName,
    RENVARA_BETA_EMAIL: settings.owner.email ?? '',
    RENVARA_SESSION_SECRET: settings.sessionSecret,
    RENVARA_DATA_FILE: join(DATA, 'crm.json'),
    RENVARA_IDENTITY_FILE: join(DATA, 'identity.json'),
    RENVARA_DOCUMENTS_DIR: join(DATA, 'ponude'),
    RENVARA_ORG_TIMEZONE: timeZone(),
    ...(settings.push
      ? {
          RENVARA_VAPID_PUBLIC_KEY: settings.push.publicKey,
          RENVARA_VAPID_PRIVATE_KEY: settings.push.privateKey,
          RENVARA_VAPID_SUBJECT: settings.push.subject,
        }
      : {}),
  };

  say();
  say('  Pokrećem Renvaru…');
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false;
  const relay = (stream, target) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      rest += chunk;
      const parts = rest.split('\n');
      rest = parts.pop() ?? '';
      for (const line of parts) {
        if (!started && line.includes('Listening on')) {
          started = true;
          say();
          say('  ────────────────────────────────────────────────────────────');
          say(`  ✔ Renvara radi:  ${url}`);
          say('    Otvorite tu adresu u pregledniku (Chrome, Edge, Safari, Firefox).');
          say('    Ne zatvarajte ovaj prozor dok radite. Kraj rada: Ctrl+C ili zatvorite prozor.');
          say('    Podaci: mapa "podaci" pokraj ove mape (kopirajte je za sigurnosnu kopiju).');
          say('  ────────────────────────────────────────────────────────────');
          say();
          openBrowser(`${url}/login`);
          continue;
        }
        target.write(`${line}\n`);
      }
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  const stop = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop); // the terminal window was closed
  child.on('exit', (code, signal) => {
    if (signal || code === 0) {
      say('  Renvara je zaustavljena.');
      return;
    }
    fail(
      started
        ? `Renvara se zaustavila (kod ${code}). Pokrenite je ponovno.`
        : `Renvara se nije pokrenula (kod ${code}). Poruka je iznad.`,
    );
  });
}

main().catch((error) => {
  input.close();
  fail(error.message);
});
