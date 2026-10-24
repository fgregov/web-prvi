import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { createSession, destroySession, destroyUserSessions, SESSION_COOKIE } from '../auth/sessions.js';
import { verifyPassword } from '../auth/passwords.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { isLoopback } from '../lib/ip.js';
import { parse } from '../lib/validate.js';
import { audit } from '../modules/audit/audit.js';
import { countUsers, createUser, setPassword, verifyLogin, LOCK_MINUTES } from '../modules/users/service.js';
import { actorOf } from '../http/helpers.js';

const loginSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) });

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const cookieOpts = () => ({
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: ctx.config.https.enabled,
    path: '/',
    maxAge: ctx.config.sessionTtlHours * 3600,
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user || !req.session) return { user: null, csrfToken: null, mode: ctx.config.mode };
    return { user: req.user, csrfToken: req.session.csrf_token, mode: ctx.config.mode };
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const r = await verifyLogin(ctx.db, body.username, body.password);
      if (!r.ok) {
        audit(ctx.db, { id: null, username: body.username, ip: req.ip }, 'auth.login_failed', 'user', null, { reason: r.reason });
        if (r.reason === 'locked') {
          throw unauthorized(`Račun je privremeno zaključan zbog više neuspjelih prijava. Pokušajte ponovno za ${LOCK_MINUTES} minuta.`);
        }
        throw unauthorized('Neispravno korisničko ime ili lozinka.');
      }
      if (req.cookies[SESSION_COOKIE]) destroySession(ctx.db, req.cookies[SESSION_COOKIE]!);
      const s = createSession(ctx.db, r.user.id, ctx.config.sessionTtlHours, { ip: req.ip, userAgent: req.headers['user-agent'] });
      audit(ctx.db, { id: r.user.id, username: r.user.username, ip: req.ip }, 'auth.login', 'user', r.user.id);
      reply.setCookie(SESSION_COOKIE, s.token, cookieOpts());
      return { user: r.user, csrfToken: s.csrfToken, mode: ctx.config.mode };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(ctx.db, token);
    if (req.user) audit(ctx.db, actorOf(req), 'auth.logout', 'user', req.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }), req.body);
    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!(await verifyPassword(body.currentPassword, row.password_hash))) throw badRequest('Trenutna lozinka nije ispravna.');
    await setPassword(ctx.db, req.user!.id, body.newPassword);
    destroyUserSessions(ctx.db, req.user!.id, req.cookies[SESSION_COOKIE]);
    audit(ctx.db, actorOf(req), 'auth.password_change', 'user', req.user!.id);
    return { ok: true };
  });

  // Prvo pokretanje: administratorski račun može se stvoriti samo s računala na kojem radi server.
  app.get('/api/auth/setup-status', async (req) => ({
    needsSetup: countUsers(ctx.db) === 0,
    localRequest: isLoopback(req.ip),
    mode: ctx.config.mode,
  }));

  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      if (countUsers(ctx.db) > 0) throw forbidden('Početno postavljanje je već dovršeno.');
      if (!isLoopback(req.ip)) {
        throw forbidden('Administratorski račun može se stvoriti samo na računalu na kojem radi server (http://localhost:3000) ili naredbom „npm run user:create”.');
      }
      const body = parse(
        z.object({ username: z.string().trim().min(3).max(40), fullName: z.string().trim().max(100).optional(), password: z.string().min(1).max(200) }),
        req.body,
      );
      const id = await createUser(ctx.db, { username: body.username, fullName: body.fullName, password: body.password, role: 'admin' });
      audit(ctx.db, { id, username: body.username, ip: req.ip }, 'auth.setup_admin', 'user', id);
      const s = createSession(ctx.db, id, ctx.config.sessionTtlHours, { ip: req.ip, userAgent: req.headers['user-agent'] });
      reply.setCookie(SESSION_COOKIE, s.token, cookieOpts());
      const user = ctx.db.prepare('SELECT id, username, full_name, email, role FROM users WHERE id = ?').get(id);
      return { user, csrfToken: s.csrfToken, mode: ctx.config.mode };
    },
  );
}
