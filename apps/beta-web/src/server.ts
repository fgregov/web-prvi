import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { createBetaAuthProvider } from './auth/beta-provider.ts';
import { ConfigError, loadAuthConfig } from './auth/config.ts';
import { createAuthService } from './auth/service.ts';
import { loadCrmConfig } from './crm/config.ts';
import { createCrmServices } from './crm/index.ts';
import { createFileRepository } from './crm/repository.ts';
import { seedDemoData } from './crm/seed.ts';

let config;
try {
  config = loadAuthConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`\n[renvara-beta] Cannot start: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const auth = createAuthService(config, createBetaAuthProvider(config));
const crmConfig = loadCrmConfig(process.env);
const repo = createFileRepository(crmConfig.dataFile, () =>
  seedDemoData({
    organizationId: crmConfig.organizationId,
    timeZone: crmConfig.timeZone,
    user: { id: `beta-${config.username}`, displayName: config.displayName },
    now: new Date(),
  }),
);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const server = createServer(
  createApp(auth, {
    crm: {
      services: createCrmServices(repo),
      organizationId: crmConfig.organizationId,
      timeZone: crmConfig.timeZone,
    },
  }),
);
server.listen(port, host, () => {
  console.log(
    `[renvara-beta] Listening on http://${host === '127.0.0.1' ? 'localhost' : host}:${port} ` +
      `(secure cookies: ${config.secureCookies ? 'on' : 'off'})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
