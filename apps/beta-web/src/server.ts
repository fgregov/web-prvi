import { createServer } from 'node:http';
import { consoleLogger, createApp } from './app.ts';
import { createBetaAuthProvider } from './auth/beta-provider.ts';
import { ConfigError, loadAuthConfig } from './auth/config.ts';
import { createAuthService } from './auth/service.ts';
import { loadCrmConfig } from './crm/config.ts';
import { createCrmServices } from './crm/index.ts';
import { createFileRepository } from './crm/file-repository.ts';
import { emptyData } from './crm/repository.ts';
import { seedDemoData } from './crm/seed.ts';
import { DEMO_CONTENT } from '../public/app/js/core/edition.js';
import { createReminderScheduler } from './notifications/reminder-scheduler.ts';
import { createWebPushSender, loadVapidKeys, PushConfigError } from './notifications/web-push.ts';

let config;
let vapid;
try {
  config = loadAuthConfig(process.env);
  vapid = loadVapidKeys(process.env);
} catch (error) {
  if (error instanceof ConfigError || error instanceof PushConfigError) {
    console.error(`\n[renvara-beta] Cannot start: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const auth = createAuthService(config, createBetaAuthProvider(config));
const crmConfig = loadCrmConfig(process.env);
// First start: demo records in the presentation demo, nothing in a clean start.
const repo = createFileRepository(crmConfig.dataFile, () =>
  DEMO_CONTENT
    ? seedDemoData({
        organizationId: crmConfig.organizationId,
        timeZone: crmConfig.timeZone,
        user: { id: `beta-${config.username}`, displayName: config.displayName },
        now: new Date(),
      })
    : emptyData(),
);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const services = createCrmServices(repo);
// Push reminders are delivered by this process, whether or not a page is open.
const sender = createWebPushSender(vapid);
const scheduler = createReminderScheduler({ services, sender, logger: consoleLogger });
scheduler.start();

const server = createServer(
  createApp(auth, {
    crm: {
      services,
      organizationId: crmConfig.organizationId,
      timeZone: crmConfig.timeZone,
      push: { configured: sender.configured, publicKey: sender.publicKey },
    },
  }),
);
server.listen(port, host, () => {
  console.log(
    `[renvara-beta] Listening on http://${host === '127.0.0.1' ? 'localhost' : host}:${port} ` +
      `(secure cookies: ${config.secureCookies ? 'on' : 'off'}, push reminders: ${sender.configured ? 'on' : 'off'})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
