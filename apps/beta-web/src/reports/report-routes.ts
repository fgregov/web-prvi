// IZVJEŠTAJI over Node HTTP: session required, writes (POST) same-origin JSON
// only, small bodies. PDFs are never cached and cannot run anything if a
// browser opens them directly.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BodyError,
  isJsonRequest,
  isSameOrigin,
  noStore,
  readJsonBody,
  sendJson,
} from '../http/respond.ts';
import { MESSAGES } from '../messages.ts';
import type { CrmContext } from '../crm/types.ts';
import type { ReportApi, ReportResponse } from './report-api.ts';

const MAX_BODY_BYTES = 32 * 1024;
const BAD_REQUEST = { success: false, message: MESSAGES.badRequest };

function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function send(res: ServerResponse, response: ReportResponse): void {
  if ('json' in response) {
    if (response.retryAfter) res.setHeader('Retry-After', String(response.retryAfter));
    return sendJson(res, response.status, response.json);
  }
  noStore(res);
  res.statusCode = response.status;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(response.bytes.length));
  res.setHeader('Content-Disposition', contentDisposition(response.fileName, response.inline));
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(Buffer.from(response.bytes.buffer, response.bytes.byteOffset, response.bytes.length));
}

export function createReportRoutes(
  api: ReportApi,
  { publicOrigin }: { publicOrigin: string | null },
) {
  /** False when the path is not a reports endpoint. */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    query: URLSearchParams,
    context: () => Promise<CrmContext | null>,
  ): Promise<boolean> {
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const hit = api.match(method, path);
    if (hit === 'none') return false;
    if (hit === 'method') {
      res.setHeader('Allow', api.allowed(path));
      sendJson(res, 405, BAD_REQUEST);
      return true;
    }
    const ctx = await context();
    if (!ctx) {
      sendJson(res, 401, { success: false, message: MESSAGES.sessionRequired });
      return true;
    }
    let body: Record<string, unknown> = {};
    if (method === 'POST') {
      if (!isSameOrigin(req, publicOrigin)) {
        sendJson(res, 403, BAD_REQUEST);
        return true;
      }
      if (!isJsonRequest(req)) {
        sendJson(res, 415, BAD_REQUEST);
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJsonBody(req, MAX_BODY_BYTES);
      } catch (error) {
        if (!(error instanceof BodyError)) throw error;
        sendJson(res, 400, BAD_REQUEST);
        return true;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, BAD_REQUEST);
        return true;
      }
      body = parsed as Record<string, unknown>;
    }
    send(res, await api.run(method, path, ctx, body, query));
    return true;
  }
  return { handle };
}
