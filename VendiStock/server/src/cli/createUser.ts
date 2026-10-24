import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { migrate, openDatabase } from '../db/index.js';
import { createUser, type Role } from '../modules/users/service.js';

/** Stvaranje korisnika iz naredbenog retka: npm run user:create -- --username admin --role admin */
async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = loadConfig();
  const db = openDatabase(config.dbFile);
  migrate(db);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const username = arg('username') ?? (await rl.question('Korisničko ime: '));
  const fullName = arg('name') ?? (await rl.question('Ime i prezime (neobavezno): '));
  const role = (arg('role') ?? 'admin') as Role;
  let password = process.env.VENDISTOCK_NEW_PASSWORD ?? '';
  if (!password) {
    password = await rl.question('Lozinka (min. 10 znakova, 3 vrste znakova): ');
  }
  rl.close();
  const id = await createUser(db, { username: username.trim(), fullName: fullName.trim(), password, role });
  console.log(`Korisnik „${username}” (${role}) stvoren, ID ${id}. Baza: ${config.dbFile}`);
  db.close();
}

main().catch((e) => {
  console.error('Greška:', (e as Error).message);
  process.exit(1);
});
