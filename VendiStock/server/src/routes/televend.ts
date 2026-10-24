import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { parse, zIdParams } from '../lib/validate.js';
import { actorOf, adminOnly, editors } from '../http/helpers.js';
import { DATASET_FIELDS, DATASET_LABEL, DATASETS, datasetConfigSchema, type Dataset, type DatasetConfig } from '../televend/config.js';
import { settingsInputSchema } from '../televend/service.js';
import { listImportBatches } from '../televend/importers.js';

const zDataset = z.enum(DATASETS);

async function readUpload(req: FastifyRequest): Promise<{ buffer: Buffer; fileName: string; fields: Record<string, string> }> {
  const parts = req.parts();
  let buffer: Buffer | null = null;
  let fileName = 'izvoz';
  const fields: Record<string, string> = {};
  for await (const part of parts) {
    if (part.type === 'file') {
      buffer = await part.toBuffer();
      fileName = part.filename || fileName;
    } else {
      fields[part.fieldname] = String(part.value).slice(0, 100_000);
    }
  }
  if (!buffer) throw badRequest('Datoteka nije priložena.');
  return { buffer, fileName, fields };
}

function overrideFrom(fields: Record<string, string>): DatasetConfig | null {
  if (!fields.config) return null;
  try {
    return parse(datasetConfigSchema, JSON.parse(fields.config));
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw badRequest('Neispravna konfiguracija mapiranja.');
  }
}

export function registerTelevendRoutes(app: FastifyInstance, ctx: AppContext) {
  const tv = () => ctx.televend;

  app.get('/api/televend/state', { preHandler: adminOnly }, async () => tv().publicState());
  app.get('/api/televend/datasets', async () =>
    DATASETS.map((d) => ({ key: d, label: DATASET_LABEL[d], fields: DATASET_FIELDS[d] })),
  );
  app.put('/api/televend/settings', { preHandler: adminOnly }, async (req) => tv().saveSettings(parse(settingsInputSchema, req.body), actorOf(req)));
  app.put('/api/televend/datasets/:dataset', { preHandler: adminOnly }, async (req) => {
    const { dataset } = parse(z.object({ dataset: zDataset }), req.params);
    return tv().saveDatasetConfig(dataset as Dataset, parse(datasetConfigSchema, req.body), actorOf(req));
  });
  app.post('/api/televend/test', { preHandler: adminOnly }, async (req) => tv().testConnection(actorOf(req)));
  app.post('/api/televend/sync', { preHandler: editors }, async (req) => tv().syncNow('manual', actorOf(req)));
  app.post('/api/televend/discover', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ maxPages: z.number().int().min(1).max(100).optional() }), req.body ?? {});
    return tv().discover(actorOf(req), b.maxPages ?? 40);
  });
  app.get('/api/televend/discovery', { preHandler: adminOnly }, async () => tv().latestDiscovery());
  app.post('/api/televend/disconnect', { preHandler: adminOnly }, async (req) => tv().disconnect(actorOf(req)));
  app.post('/api/televend/resume', { preHandler: adminOnly }, async (req) => tv().resumeAutoSync(actorOf(req)));
  app.get('/api/televend/runs', async () => tv().listRuns(200));
  app.get('/api/televend/runs/:id', async (req) => tv().runDetail(parse(zIdParams, req.params).id));
  app.get('/api/televend/imports', async () => listImportBatches(ctx.db));
  app.post('/api/televend/datasets/:dataset/preview-portal', { preHandler: adminOnly }, async (req) => {
    const { dataset } = parse(z.object({ dataset: zDataset }), req.params);
    const override = req.body && Object.keys(req.body as object).length ? parse(datasetConfigSchema, req.body) : null;
    return tv().previewPortalDataset(dataset as Dataset, override, actorOf(req));
  });

  // Ručni uvoz izvezene datoteke (CSV/XLSX) – isti parser, mapiranje i kontrola duplikata kao kod sinkronizacije
  app.post('/api/televend/upload/:dataset/preview', { preHandler: editors }, async (req) => {
    const { dataset } = parse(z.object({ dataset: zDataset }), req.params);
    const up = await readUpload(req);
    return tv().previewUpload(dataset as Dataset, up.buffer, up.fileName, overrideFrom(up.fields));
  });
  app.post('/api/televend/upload/:dataset/import', { preHandler: editors }, async (req) => {
    const { dataset } = parse(z.object({ dataset: zDataset }), req.params);
    const up = await readUpload(req);
    return tv().importUpload(dataset as Dataset, up.buffer, up.fileName, overrideFrom(up.fields), actorOf(req));
  });

  // Kontrolirana ručna sesija (MFA / ručna prijava)
  app.post('/api/televend/manual/start', { preHandler: adminOnly }, async (req) => tv().manual.start(actorOf(req)));
  app.get('/api/televend/manual/screenshot', { preHandler: adminOnly }, async (req, reply) => {
    const img = await tv().manual.screenshot(actorOf(req));
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'no-store').send(img);
  });
  app.post('/api/televend/manual/click', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ x: z.number().min(0).max(5000), y: z.number().min(0).max(5000) }), req.body);
    await tv().manual.click(actorOf(req), b.x, b.y);
    return { ok: true };
  });
  app.post('/api/televend/manual/type', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ text: z.string().max(500) }), req.body);
    await tv().manual.type(actorOf(req), b.text);
    return { ok: true };
  });
  app.post('/api/televend/manual/key', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ key: z.string().max(20) }), req.body);
    await tv().manual.press(actorOf(req), b.key);
    return { ok: true };
  });
  app.post('/api/televend/manual/scroll', { preHandler: adminOnly }, async (req) => {
    const b = parse(z.object({ dy: z.number().min(-5000).max(5000) }), req.body);
    await tv().manual.scroll(actorOf(req), b.dy);
    return { ok: true };
  });
  app.post('/api/televend/manual/finish', { preHandler: adminOnly }, async (req) => tv().manual.finish(actorOf(req)));
  app.post('/api/televend/manual/cancel', { preHandler: adminOnly }, async () => {
    await tv().manual.cancel();
    return { ok: true };
  });
}
