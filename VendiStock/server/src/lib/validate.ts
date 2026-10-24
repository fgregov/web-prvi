import { z } from 'zod';
import { badRequest } from './errors.js';

function issueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'obavezno polje' : 'neispravan tip vrijednosti';
    case 'too_small':
      return issue.origin === 'string'
        ? `minimalno ${String(issue.minimum)} znakova`
        : `vrijednost mora biti ${issue.inclusive ? '≥' : '>'} ${String(issue.minimum)}`;
    case 'too_big':
      return issue.origin === 'string'
        ? `maksimalno ${String(issue.maximum)} znakova`
        : `vrijednost mora biti ${issue.inclusive ? '≤' : '<'} ${String(issue.maximum)}`;
    case 'invalid_format':
      return 'neispravan format';
    case 'invalid_value':
      return 'nedopuštena vrijednost';
    case 'unrecognized_keys':
      return `nepoznata polja: ${issue.keys.join(', ')}`;
    default:
      return issue.message || 'neispravna vrijednost';
  }
}

/** Validira ulaz i baca AppError(400) s porukom na hrvatskom. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = r.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.code === 'custom' ? i.message : issueMessage(i),
  }));
  const summary = fields
    .slice(0, 5)
    .map((f) => (f.path ? `${f.path}: ${f.message}` : f.message))
    .join('; ');
  throw badRequest(`Neispravan unos – ${summary}`, { fields });
}

export const zId = z.coerce.number().int().positive();
export const zIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'datum mora biti u formatu GGGG-MM-DD');
export const zQty = z.number().finite();
export const zPositiveQty = z.number().finite().positive().max(1e9);
export const zMoney = z.number().finite().min(0).max(1e9);
export const zText = (max = 500) => z.string().trim().max(max);
export const zOptText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
export const zIdParams = z.object({ id: zId });
