import { createServer } from 'node:http';
import { consoleLogger, createApp } from './app.ts';
import { mailerFromEnv } from './email/mailer.ts';
import { ConfigError, loadAuthConfig } from './auth/config.ts';
import { createAuthService, systemClock } from './auth/service.ts';
import { createLocalIdentityLayer } from './identity/local.ts';
import { createSupabaseIdentityLayer, loadSupabaseIdentityConfig } from './identity/supabase.ts';
import { loadCrmConfig, loadFollowUpConfig } from './crm/config.ts';
import { createCrmServices } from './crm/index.ts';
import { createFileDocumentStore } from './crm/file-document-store.ts';
import { createFileRepository } from './crm/file-repository.ts';
import { inspectPdfWithPdfJs } from './crm/pdf-inspect.ts';
import { deriveShareKey } from './crm/share-token.ts';
import { emptyData } from './crm/repository.ts';
import { seedDemoData } from './crm/seed.ts';
import { DEMO_CONTENT } from '../public/app/js/core/edition.js';
import { createReminderScheduler } from './notifications/reminder-scheduler.ts';
import { createWebPushSender, loadVapidKeys, PushConfigError } from './notifications/web-push.ts';

let config;
let vapid;
let followUpConfig;
try {
  config = loadAuthConfig(process.env);
  vapid = loadVapidKeys(process.env);
  followUpConfig = loadFollowUpConfig(process.env);
} catch (error) {
  if (
    error instanceof ConfigError ||
    error instanceof PushConfigError ||
    (error instanceof Error && error.message.startsWith('RENVARA_'))
  ) {
    console.error(`\n[renvara-beta] Cannot start: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

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

// Follow-up Engine: offer PDFs in a private directory, checked with pdf.js; share
// tokens sealed with a key from RENVARA_SHARE_LINK_KEY or the session secret.
const documents = createFileDocumentStore(followUpConfig.documentsDir);
await documents.clearStaging();
const services = createCrmServices(repo, {
  followUp: {
    documents,
    inspectPdf: inspectPdfWithPdfJs,
    shareKey: deriveShareKey(
      followUpConfig.shareLinkKey ?? `${config.sessionSecret}:offer-share-links`,
    ),
    maxBytes: followUpConfig.maxBytes,
    linkTtlDays: followUpConfig.linkTtlDays,
    retentionDays: followUpConfig.retentionDays,
  },
});
// Korisnici (ADR-0014). Local (default): members and rights in the CRM store,
// credentials in the identity file next to it; the first owner is the account
// from the server settings. RENVARA_IDENTITY=supabase: Supabase Auth and the
// member tables (the service role key stays on this server).
let supabaseIdentity: ReturnType<typeof loadSupabaseIdentityConfig>;
try {
  supabaseIdentity = loadSupabaseIdentityConfig(process.env);
} catch (error) {
  console.error(`\n[renvara-beta] Cannot start: ${(error as Error).message}\n`);
  process.exit(1);
}
const identity = supabaseIdentity
  ? createSupabaseIdentityLayer({ config: supabaseIdentity, sessionsFile: crmConfig.identityFile })
  : await createLocalIdentityLayer({
      repo,
      organizationId: crmConfig.organizationId,
      file: crmConfig.identityFile,
      config,
      ownerEmail: process.env.RENVARA_BETA_EMAIL?.trim() || null,
    });
const auth = createAuthService(
  config,
  identity.authenticate,
  systemClock,
  undefined,
  identity.validAfter,
);

// Push reminders are delivered by this process, whether or not a page is open.
const sender = createWebPushSender(vapid);
const scheduler = createReminderScheduler({ services, sender, logger: consoleLogger });
scheduler.start();

// IZVJEŠTAJI → "Pošalji e-mail": an e-mail service when configured (email/mailer.ts).
const mailer = mailerFromEnv(process.env);
if (!mailer.configured) {
  consoleLogger.info('email_not_configured', { reason: mailer.problem });
}

const server = createServer(
  createApp(auth, {
    mailer,
    users: identity.users,
    crm: {
      services,
      organizationId: crmConfig.organizationId,
      timeZone: crmConfig.timeZone,
      push: { configured: sender.configured, publicKey: sender.publicKey },
      pushTest: (ctx) => scheduler.sendTest(ctx.organizationId, ctx.user.id),
    },
    publicOrigin: config.publicOrigin,
    trustProxy: config.trustProxy,
  }),
);
server.listen(port, host, () => {
  console.log(
    `[renvara-beta] Listening on http://${host === '127.0.0.1' ? 'localhost' : host}:${port} ` +
      `(secure cookies: ${config.secureCookies ? 'on' : 'off'}, push reminders: ${sender.configured ? 'on' : 'off'}, ` +
      `report e-mail: ${mailer.configured ? mailer.provider : 'off'}` +
      `${config.publicOrigin ? `, public address: ${config.publicOrigin}` : ''}` +
      `${config.trustProxy ? ', behind a proxy' : ''})`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
