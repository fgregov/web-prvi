// Follow-up Engine over Node HTTP (ADR-0008).
//
//   /api/follow-up/...   session required; writes same-origin only; JSON bodies
//                        up to 32 KB, PDF uploads as a raw body up to the limit
//   /o/{token}           the customer's viewer page (records link_access)
//   /o/{token}/...       viewer data: info, document, view events
//   /viewer/...          the viewer's own scripts and pdf.js (public, no data)
//
// Public responses are never cached, never indexed, send no Referer, and look
// the same for unknown, revoked and expired links.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BodyError,
  clientAddress,
  isJsonRequest,
  isSameOrigin,
  noStore,
  readJsonBody,
  sendJson,
  sendText,
} from '../http/respond.ts';
import { RequestLimiter } from '../http/request-limiter.ts';
import { resolveStaticFile, sendFile } from '../http/static.ts';
import { MESSAGES } from '../messages.ts';
import { MESSAGES as CRM_MESSAGES } from '../../public/app/js/core/validation.js';
import {
  createFollowUpApi,
  VIEWER_PAGE,
  type FollowUpRequest,
  type FollowUpResponse,
} from './follow-up-api.ts';
import type { CrmServices } from './index.ts';
import type { Body } from './scope.ts';
import type { CrmContext } from './types.ts';

const MAX_JSON_BYTES = 32 * 1024;
const APP_DIR = resolve(import.meta.dirname, '../..');
const VIEWER_DIR = resolve(APP_DIR, 'public/viewer');
const PDFJS_DIR = resolve(APP_DIR, 'node_modules/pdfjs-dist');
/** pdf.js files the viewer may load (nothing else of the package is served). */
const PDFJS_FILES =
  /^(build\/pdf(\.worker)?\.min\.mjs|(standard_fonts|cmaps|wasm)\/[A-Za-z0-9_.-]+)$/;

/** CSP of pages that render PDFs with pdf.js (viewer, internal preview). */
export function applyViewerCsp(res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self'",
      "style-src 'self'",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
}

/** Every public response: private, unindexed, no Referer leaving with the token. */
function publicHeaders(res: ServerResponse): void {
  noStore(res);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function send(res: ServerResponse, response: FollowUpResponse): void {
  if ('json' in response) return sendJson(res, response.status, response.json);
  noStore(res);
  res.statusCode = response.status;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(response.bytes.length));
  res.setHeader('Content-Disposition', contentDisposition(response.fileName));
  // If a browser ever renders it directly: no scripts, no plugins, no embedding.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(Buffer.from(response.bytes.buffer, response.bytes.byteOffset, response.bytes.length));
}

class TooLarge extends Error {}

async function readBytes(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers['content-length'] ?? 'NaN');
  if (Number.isFinite(declared) && declared > limit) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const header = (req: IncomingMessage, name: string) => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
};

export interface FollowUpRouteOptions {
  readonly publicOrigin: string | null;
  readonly now: () => Date;
  /** RENVARA_TRUST_PROXY: public limits count the visitor, not the proxy in front. */
  readonly trustProxy?: boolean;
}

export function createFollowUpRoutes(crm: CrmServices, options: FollowUpRouteOptions) {
  const api = createFollowUpApi(crm);
  const limits = {
    public: new RequestLimiter(120, 60_000),
    events: new RequestLimiter(30, 60_000),
    uploads: new RequestLimiter(30, 10 * 60_000),
  };
  let viewerHtml: Promise<Buffer> | null = null;

  /** Where share links point: RENVARA_PUBLIC_ORIGIN, else this server as requested. */
  function originOf(req: IncomingMessage): string {
    if (options.publicOrigin) return options.publicOrigin;
    const host = header(req, 'host') ?? '';
    const safeHost = /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? host : 'localhost';
    const secure = (req.socket as { encrypted?: boolean }).encrypted === true;
    return `${secure ? 'https' : 'http'}://${safeHost}`;
  }

  function requestOf(
    req: IncomingMessage,
    url: URL,
    ctx: CrmContext | null,
    internal: boolean,
    json: Body | null,
    bytes: Uint8Array | null,
  ): FollowUpRequest {
    return {
      method: req.method === 'HEAD' ? 'HEAD' : (req.method ?? 'GET'),
      path: url.pathname,
      query: url.searchParams,
      ctx,
      json,
      bytes,
      headers: {
        contentType: header(req, 'content-type'),
        fileName: header(req, 'x-file-name'),
        userAgent: header(req, 'user-agent'),
        purpose:
          header(req, 'sec-purpose') ??
          header(req, 'purpose') ??
          header(req, 'x-purpose') ??
          header(req, 'x-moz'),
      },
      internal,
      origin: originOf(req),
      now: options.now(),
    };
  }

  async function viewerPage(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    token: string,
    hasSession: boolean,
  ) {
    publicHeaders(res);
    applyViewerCsp(res);
    const live = await api.pageAccess(token, requestOf(req, url, null, hasSession, null, null));
    viewerHtml ??= readFile(resolve(VIEWER_DIR, 'index.html'));
    res.statusCode = live ? 200 : 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(req.method === 'HEAD' ? undefined : await viewerHtml);
  }

  async function viewerAsset(res: ServerResponse, path: string) {
    const relative = path.slice('/viewer/'.length);
    let file: string | null = null;
    if (relative.startsWith('pdfjs/')) {
      const inner = relative.slice('pdfjs/'.length);
      // build/ is pdf.js's legacy build: the modern one needs very recent
      // browsers (e.g. Map#getOrInsertComputed), customers' phones may be older.
      if (PDFJS_FILES.test(inner)) {
        file = await resolveStaticFile(
          PDFJS_DIR,
          inner.startsWith('build/') ? `legacy/${inner}` : inner,
        );
      }
    } else {
      file = await resolveStaticFile(VIEWER_DIR, relative);
    }
    if (!file || file.endsWith('index.html')) return sendText(res, 404, 'Not found');
    return sendFile(res, file, { cacheControl: 'public, max-age=86400' });
  }

  /**
   * Handles Follow-up Engine paths; false for anything else. `context` is the
   * signed-in user's CRM context (null without a session).
   */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    context: () => CrmContext | null,
  ): Promise<boolean> {
    const path = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const isApi = path.startsWith('/api/follow-up/');
    const isPublic = path.startsWith('/o/');
    if (path.startsWith('/viewer/')) {
      if (method !== 'GET') return (sendText(res, 405, 'Method not allowed'), true);
      await viewerAsset(res, path);
      return true;
    }
    if (!isApi && !isPublic) return false;

    if (isPublic) {
      publicHeaders(res);
      const ip = clientAddress(req, options.trustProxy ?? false);
      if (!limits.public.allow(ip, Date.now())) {
        res.setHeader('Retry-After', '60');
        sendJson(res, 429, { success: false, message: MESSAGES.tooManyAttempts });
        return true;
      }
      const page = VIEWER_PAGE.exec(path);
      if (page) {
        if (method !== 'GET') {
          res.setHeader('Allow', 'GET, HEAD');
          sendText(res, 405, 'Method not allowed');
          return true;
        }
        await viewerPage(req, res, url, page[1]!, context() !== null);
        return true;
      }
    }

    const hit = api.match(method, path);
    if (hit.kind === 'none') {
      sendJson(
        res,
        404,
        isPublic
          ? { success: false, message: 'Ova poveznica više nije dostupna.' }
          : api.badRequest,
      );
      return true;
    }
    if (hit.kind === 'method_not_allowed') {
      res.setHeader('Allow', hit.allow);
      sendJson(res, 405, api.badRequest);
      return true;
    }

    const ctx = context();
    if (hit.route.scope === 'internal' && !ctx) {
      sendJson(res, 401, { success: false, message: MESSAGES.sessionRequired });
      return true;
    }

    let json: Body | null = null;
    let bytes: Uint8Array | null = null;
    if (hit.route.method === 'POST') {
      // Writes only from this site (internal) and view events only from the viewer page.
      if (!isSameOrigin(req, options.publicOrigin)) {
        sendJson(res, 403, api.badRequest);
        return true;
      }
      if (hit.route.body === 'pdf') {
        if (!limits.uploads.allow(ctx!.user.id, Date.now())) {
          sendJson(res, 429, { success: false, message: MESSAGES.tooManyAttempts });
          return true;
        }
        const type = (header(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        if (type !== 'application/pdf') {
          req.resume();
          sendJson(res, 415, {
            success: false,
            message: CRM_MESSAGES.documentUnsupported,
            errors: { document: CRM_MESSAGES.documentUnsupported },
          });
          return true;
        }
        try {
          bytes = await readBytes(req, crm.followUp.maxBytes);
        } catch (error) {
          if (!(error instanceof TooLarge)) throw error;
          req.resume();
          res.setHeader('Connection', 'close');
          sendJson(res, 413, {
            success: false,
            message: CRM_MESSAGES.documentTooLarge,
            errors: { document: CRM_MESSAGES.documentTooLarge },
          });
          return true;
        }
      } else {
        if (
          isPublic &&
          !limits.events.allow(clientAddress(req, options.trustProxy ?? false), Date.now())
        ) {
          sendJson(res, 429, { success: false, message: MESSAGES.tooManyAttempts });
          return true;
        }
        if (!isJsonRequest(req)) {
          sendJson(res, 415, api.badRequest);
          return true;
        }
        try {
          const parsed = await readJsonBody(req, MAX_JSON_BYTES);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            sendJson(res, 400, api.badRequest);
            return true;
          }
          json = parsed as Body;
        } catch (error) {
          if (!(error instanceof BodyError)) throw error;
          sendJson(res, 400, api.badRequest);
          return true;
        }
      }
    }

    const response = await api.run(hit, requestOf(req, url, ctx, ctx !== null, json, bytes));
    send(res, response);
    return true;
  }

  return { handle };
}
