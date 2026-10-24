import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionRow, SessionUser } from '../auth/sessions.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Actor } from '../modules/audit/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    session: SessionRow | null;
  }
}

export function actorOf(req: FastifyRequest): Actor {
  if (!req.user) throw unauthorized();
  return { id: req.user.id, username: req.user.username, ip: req.ip };
}

export function requireRole(...roles: SessionUser['role'][]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}

export const adminOnly = requireRole('admin');
export const editors = requireRole('admin', 'user');

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  db: 'application/octet-stream',
};

export function sendFile(reply: FastifyReply, buf: Buffer, fileName: string) {
  const ext = fileName.split('.').pop() ?? '';
  const ascii = fileName.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '');
  return reply
    .header('Content-Type', MIME[ext] ?? 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    .header('Cache-Control', 'no-store')
    .send(buf);
}
