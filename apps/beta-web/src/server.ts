import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { createBetaAuthProvider } from './auth/beta-provider.ts';
import { ConfigError, loadAuthConfig } from './auth/config.ts';
import { createAuthService } from './auth/service.ts';

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
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const server = createServer(createApp(auth));
server.listen(port, host, () => {
  console.log(
    `[renvara-beta] Listening on http://${host === '127.0.0.1' ? 'localhost' : host}:${port} ` +
      `(secure cookies: ${config.secureCookies ? 'on' : 'off'})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
