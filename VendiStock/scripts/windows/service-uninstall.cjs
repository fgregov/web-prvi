/** Uklanjanje Windows servisa VendiStock:  npm run service:uninstall  (PowerShell kao administrator) */
const path = require('node:path');
if (process.platform !== 'win32') {
  console.error('Samo za Windows.');
  process.exit(1);
}
const { Service } = require('node-windows');
const root = path.resolve(__dirname, '..', '..');
const svc = new Service({ name: 'VendiStock', script: path.join(root, 'server', 'dist', 'index.js') });
svc.on('uninstall', () => console.log('Servis „VendiStock” uklonjen. Podaci u mapi data/ nisu dirani.'));
svc.on('error', (e) => console.error('Greška:', e));
svc.uninstall();
