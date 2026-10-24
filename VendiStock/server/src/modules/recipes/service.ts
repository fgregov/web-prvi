import { z } from 'zod';
import type { DB } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { roundQty } from '../../lib/num.js';
import { nowIso } from '../../lib/time.js';
import { zOptText } from '../../lib/validate.js';
import { audit, type Actor } from '../audit/audit.js';

/**
 * Normativi (recepture) napitaka – PRIPREMA za buduću verziju.
 * U v1.0.0 sastojci se NE razdužuju automatski; izračun potrošnje je samo informativan prikaz.
 */
export const recipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tvProductId: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
  note: zOptText(1000),
  ingredients: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().finite().positive().max(1e6),
        unit: z.string().trim().min(1).max(10),
      }),
    )
    .max(50),
});
export type RecipeInput = z.infer<typeof recipeSchema>;

export function listRecipes(db: DB) {
  const recipes = db
    .prepare(
      `SELECT r.*, tp.name AS tv_product_name FROM recipes r LEFT JOIN tv_products tp ON tp.id = r.tv_product_id ORDER BY r.name`,
    )
    .all() as Record<string, unknown>[];
  const ing = db.prepare(
    `SELECT ri.*, p.code, p.name, p.unit AS product_unit FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id
     WHERE ri.recipe_id = ? ORDER BY p.name`,
  );
  return recipes.map((r) => ({ ...r, ingredients: ing.all(r.id) }));
}

export function saveRecipe(db: DB, id: number | null, input: RecipeInput, actor: Actor): number {
  return db.transaction(() => {
    const dup = db.prepare('SELECT id FROM recipes WHERE name = ? AND id <> ?').get(input.name, id ?? 0);
    if (dup) throw conflict('Normativ s tim nazivom već postoji.');
    if (input.tvProductId) {
      const used = db.prepare('SELECT id FROM recipes WHERE tv_product_id = ? AND id <> ?').get(input.tvProductId, id ?? 0);
      if (used) throw conflict('Televend artikl je već povezan s drugim normativom.');
    }
    const seen = new Set<number>();
    for (const i of input.ingredients) {
      if (seen.has(i.productId)) throw badRequest('Isti sastojak je naveden više puta.');
      seen.add(i.productId);
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(i.productId)) throw badRequest('Sastojak (artikl) ne postoji.');
    }
    let rid = id;
    if (rid) {
      const r = db
        .prepare('UPDATE recipes SET name = ?, tv_product_id = ?, active = ?, note = ?, verified = 0, updated_at = ? WHERE id = ?')
        .run(input.name, input.tvProductId ?? null, input.active ? 1 : 0, input.note, nowIso(), rid);
      if (r.changes === 0) throw notFound('Normativ nije pronađen.');
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(rid);
    } else {
      rid = Number(
        db
          .prepare('INSERT INTO recipes (name, tv_product_id, active, note) VALUES (?, ?, ?, ?)')
          .run(input.name, input.tvProductId ?? null, input.active ? 1 : 0, input.note).lastInsertRowid,
      );
    }
    const ins = db.prepare('INSERT INTO recipe_ingredients (recipe_id, product_id, qty, unit) VALUES (?, ?, ?, ?)');
    for (const i of input.ingredients) ins.run(rid, i.productId, roundQty(i.qty), i.unit);
    audit(db, actor, id ? 'recipe.update' : 'recipe.create', 'recipe', rid, input);
    return rid;
  })();
}

export function deleteRecipe(db: DB, id: number, actor: Actor): void {
  if (db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes === 0) throw notFound('Normativ nije pronađen.');
  audit(db, actor, 'recipe.delete', 'recipe', id);
}

const UNIT_FACTORS: Record<string, Record<string, number>> = {
  g: { g: 1, kg: 0.001 },
  kg: { kg: 1, g: 1000 },
  ml: { ml: 1, l: 0.001 },
  l: { l: 1, ml: 1000 },
  kom: { kom: 1 },
};

/** Informativni izračun teorijske potrošnje sastojaka prema prodaji povezanih napitaka (bez knjiženja). */
export function consumptionPreview(db: DB, from: string, to: string) {
  const rows = db
    .prepare(
      `SELECT r.id AS recipe_id, r.name AS recipe_name, COALESCE(SUM(s.quantity), 0) AS sold
       FROM recipes r LEFT JOIN sales_transactions s ON s.tv_product_id = r.tv_product_id
         AND s.status = 'valid' AND s.sold_date_local BETWEEN ? AND ?
       WHERE r.active = 1 AND r.tv_product_id IS NOT NULL GROUP BY r.id`,
    )
    .all(from, to) as { recipe_id: number; recipe_name: string; sold: number }[];
  const ing = db.prepare(
    'SELECT ri.qty, ri.unit, p.id, p.code, p.name, p.unit AS product_unit FROM recipe_ingredients ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id = ?',
  );
  const totals = new Map<number, { productId: number; code: string; name: string; unit: string; qty: number; convertible: boolean }>();
  for (const r of rows) {
    for (const i of ing.all(r.recipe_id) as { qty: number; unit: string; id: number; code: string; name: string; product_unit: string }[]) {
      const factor = UNIT_FACTORS[i.unit]?.[i.product_unit];
      const t = totals.get(i.id) ?? { productId: i.id, code: i.code, name: i.name, unit: i.product_unit, qty: 0, convertible: true };
      if (factor === undefined) t.convertible = false;
      else t.qty = roundQty(t.qty + r.sold * i.qty * factor);
      totals.set(i.id, t);
    }
  }
  return { recipes: rows, ingredients: [...totals.values()], note: 'Informativni izračun – sastojci se u verziji 1.0.0 ne razdužuju automatski.' };
}
