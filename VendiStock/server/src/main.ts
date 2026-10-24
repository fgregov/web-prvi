import os from 'node:os';
import { buildApp } from './app.js';
import { createContext } from './bootstrap.js';
import { APP_VERSION, loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const ctx = await createContext(config);
  const interrupted = ctx.televend.markInterruptedRuns();
  if (interrupted) ctx.log.warn({ interrupted }, 'Prekinute sinkronizacije iz prethodnog pokretanja označene su kao prekinute');
  const app = await buildApp(ctx);
  await app.listen({ host: config.host, port: config.port });
  ctx.scheduler.start();

  const proto = config.https.enabled ? 'https' : 'http';
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `${proto}://${i!.address}:${config.port}`);
  ctx.log.info(
    { version: APP_VERSION, mode: config.mode, local: `${proto}://localhost:${config.port}`, lan, db: config.dbFile },
    `VendiStock ${APP_VERSION} pokrenut`,
  );
  if (config.mode === 'demo') ctx.log.warn('DEMO NAČIN: koristi se zasebna demo baza s izmišljenim podacima.');
  if (!config.https.enabled) ctx.log.warn('HTTPS nije uključen. Za produkcijski LAN pristup postavite HTTPS (vidi README).');

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    ctx.log.info({ signal }, 'Zaustavljanje VendiStocka…');
    ctx.scheduler.stop();
    await ctx.televend.manual.cancel().catch(() => undefined);
    await app.close().catch(() => undefined);
    try {
      ctx.db.close();
    } catch {
      /* već zatvoreno */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => ctx.log.error({ err: e }, 'Neobrađeno odbijeno obećanje'));
}

main().catch((e) => {
  console.error('VendiStock se nije mogao pokrenuti:', e);
  process.exit(1);
});
