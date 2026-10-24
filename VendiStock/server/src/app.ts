import fs from 'node:fs';
import path from 'node:path';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { APP_VERSION } from './config.js';
import type { AppContext } from './context.js';
import { loadSession, safeEqual, SESSION_COOKIE } from './auth/sessions.js';
import { AppError, forbidden, unauthorized } from './lib/errors.js';
import { buildBlockList, ipInList } from './lib/ip.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerSalesRoutes } from './routes/sales.js';
import { registerProcurementRoutes } from './routes/procurement.js';
import { registerTelevendRoutes } from './routes/televend.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerExportRoutes } from './routes/exports.js';

const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/auth/setup', '/api/auth/setup-status']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VIEWER_WRITE_ALLOWED = new Set(['/api/auth/logout', '/api/auth/password', '/api/export/xlsx']);

export function httpsOptions(ctx: AppContext): HttpsServerOptions | null {
  const h = ctx.config.https;
  if (!h.enabled) return null;
  if (h.pfxPath) return { pfx: fs.readFileSync(h.pfxPath), passphrase: h.pfxPassphrase ?? undefined, minVersion: 'TLSv1.2' };
  return { cert: fs.readFileSync(h.certPath!), key: fs.readFileSync(h.keyPath!), minVersion: 'TLSv1.2' };
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const https = httpsOptions(ctx);
  const app = Fastify({
    loggerInstance: ctx.log,
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 5 * 1024 * 1024,
    ...(https ? { https } : {}),
  }) as unknown as FastifyInstance;

  const allowList = buildBlockList(ctx.config.allowedClientCidrs);
  const secureCookies = ctx.config.https.enabled;

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: secureCookies ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 1200,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: { code: 'TOO_MANY_REQUESTS', message: `Previše zahtjeva. Pokušajte ponovno za ${Math.ceil(context.ttl / 1000)} s.` },
    }),
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 } });

  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req, reply) => {
    // Aplikacija je namijenjena isključivo lokalnoj mreži.
    if (!ipInList(allowList, req.ip)) {
      req.log.warn({ ip: req.ip }, 'Odbijen pristup izvan dopuštene mreže');
      return reply.code(403).send({ error: { code: 'IP_NOT_ALLOWED', message: 'Pristup s ove mrežne adrese nije dopušten.' } });
    }
    if (!req.url.startsWith('/api/')) return;
    const p = req.url.split('?')[0];
    if (ctx.maintenance && p !== '/api/health') {
      return reply.code(503).send({ error: { code: 'MAINTENANCE', message: ctx.maintenance } });
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = loadSession(ctx.db, token, ctx.config.sessionTtlHours);
      if (s) {
        req.user = s.user;
        req.session = s.session;
      }
    }
    const isPublic = PUBLIC_API.has(p);
    if (!isPublic && !req.user) throw unauthorized();
    if (UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          /* neispravan Origin */
        }
        if (originHost !== req.headers.host) throw forbidden('Neispravno podrijetlo zahtjeva (CSRF zaštita).');
      }
      const fetchSite = req.headers['sec-fetch-site'];
      if (typeof fetchSite === 'string' && !['same-origin', 'none'].includes(fetchSite)) {
        throw forbidden('Zahtjev s drugog web mjesta nije dopušten (CSRF zaštita).');
      }
      if (!isPublic) {
        const t = req.headers['x-csrf-token'];
        if (typeof t !== 'string' || !req.session || !safeEqual(t, req.session.csrf_token)) {
          throw forbidden('Sigurnosni (CSRF) token nije ispravan. Osvježite stranicu i pokušajte ponovno.');
        }
        if (req.user?.role === 'viewer' && !VIEWER_WRITE_ALLOWED.has(p)) {
          throw forbidden('Korisnik s ulogom „pregled” ne može mijenjati podatke.');
        }
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'TOO_MANY_REQUESTS', message: 'Previše zahtjeva. Pokušajte ponovno za nekoliko minuta.' } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'Datoteka je prevelika (najviše 25 MB).' } });
    }
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.validation) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Neispravan zahtjev.' } });
    }
    if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      req.log.warn({ err: err.message }, 'Ograničenje baze');
      return reply.code(409).send({ error: { code: 'CONSTRAINT', message: 'Radnja nije dopuštena: podatak krši ograničenje baze (duplikat ili povezani zapis).' } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'Neobrađena pogreška');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Interna pogreška poslužitelja. Detalji su zapisani u dnevnik.' } });
  });

  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION, mode: ctx.config.mode, time: new Date().toISOString() }));

  registerAuthRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerInventoryRoutes(app, ctx);
  registerSalesRoutes(app, ctx);
  registerProcurementRoutes(app, ctx);
  registerTelevendRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerExportRoutes(app, ctx);

  const dist = ctx.config.clientDistDir;
  const hasClient = fs.existsSync(path.join(dist, 'index.html'));
  if (hasClient) {
    // Datoteke se poslužuju dinamički (i nakon ponovne izgradnje klijenta); hashirani resursi smiju se dugo predmemorirati.
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      index: ['index.html'],
      setHeaders: (res, filePath) => {
        res.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'API ruta ne postoji.' } });
    }
    if (req.url.startsWith('/assets/')) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Nije pronađeno.');
    }
    if (hasClient && req.method === 'GET') {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply
      .code(404)
      .type('text/plain; charset=utf-8')
      .send('VendiStock: korisničko sučelje nije izgrađeno. Pokrenite "npm run build" u mapi VendiStock.');
  });

  return app;
}
