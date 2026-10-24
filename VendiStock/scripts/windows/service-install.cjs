/**
 * Instalacija VendiStocka kao Windows servisa (automatsko pokretanje nakon pokretanja Windowsa).
 * Pokrenuti u PowerShellu kao administrator:  npm run service:install
 * Koristi node-windows (WinSW). Servis se zove „VendiStock”.
 */
const path = require('node:path');
const fs = require('node:fs');

if (process.platform !== 'win32') {
  console.error('Windows servis može se instalirati samo na Windowsu.');
  process.exit(1);
}
let Service;
try {
  ({ Service } = require('node-windows'));
} catch {
  console.error('Paket node-windows nije instaliran. Pokrenite: npm install (u mapi VendiStock).');
  process.exit(1);
}
const root = path.resolve(__dirname, '..', '..');
const script = path.join(root, 'server', 'dist', 'index.js');
if (!fs.existsSync(script)) {
  console.error('Server nije izgrađen. Pokrenite: npm run build');
  process.exit(1);
}
const svc = new Service({
  name: 'VendiStock',
  description: 'VendiStock – Inventory & Sales Intelligence (Vending Express, interna aplikacija)',
  script,
  workingDirectory: root,
  nodeOptions: ['--enable-source-maps'],
  env: [{ name: 'NODE_ENV', value: 'production' }],
  wait: 5,
  grow: 0.5,
  maxRestarts: 20,
});
svc.on('install', () => {
  console.log('Servis „VendiStock” instaliran. Pokrećem…');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('Servis „VendiStock” je već instaliran.'));
svc.on('start', () => console.log('Servis pokrenut. Status: services.msc → VendiStock (Startup type: Automatic).'));
svc.on('error', (e) => console.error('Greška:', e));
svc.install();
