import type { DB } from '../../db/index.js';
import { roundQty } from '../../lib/num.js';
import { localDateOf, nowIso, todayLocal } from '../../lib/time.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../audit/audit.js';
import { ensureMachineLocation } from '../catalog/service.js';
import { centralLocationId, getBalance, postMovement } from '../inventory/ledger.js';
import { createTransfer } from '../inventory/operations.js';
import { getSetting, setSetting } from '../settings/store.js';

/**
 * Automatizacija prema zahtjevu Vending Expressa: RUČNO se unosi samo ulaz robe s nabavnom (ulaznom) cijenom,
 * a artikle, automate i kretanja zaliha (dopune, prodaja, usklađenje stanja automata) aplikacija generira sama
 * iz podataka preuzetih s Televend Clouda.
 */
export interface AutomationSettings {
  /** Novi Televend artikl → lokalni artikl (nabavna cijena se unosi ručno). */
  autoCreateProducts: boolean;
  /** Prodaja iz Televenda smanjuje zalihu automata. */
  autoPostSales: boolean;
  /** Dopuna automata iz Televenda knjiži se kao prijenos s izvorne lokacije (zadano centralno skladište) u automat. */
  autoBookRefills: boolean;
  /** Stanje artikala u automatu usklađuje se s Televendom (automatska korekcija razlike). */
  autoSyncMachineStock: boolean;
  /** Izvorna lokacija za dopune (null = centralno skladište). */
  refillSourceLocationId: number | null;
  /** Kretanja se generiraju samo za događaje od ovog datuma (postavlja se automatski pri prvom uvozu). */
  startDate: string | null;
}

export const DEFAULT_AUTOMATION: AutomationSettings = {
  autoCreateProducts: true,
  autoPostSales: true,
  autoBookRefills: true,
  autoSyncMachineStock: true,
  refillSourceLocationId: null,
  startDate: null,
};

export const automationSettings = (db: DB): AutomationSettings => getSetting(db, 'automation.config', DEFAULT_AUTOMATION);

/** Datum početka automatskog knjiženja postavlja se pri prvom uspješnom uvozu (povijesni podaci se samo analiziraju). */
export function ensureStartDate(db: DB): string {
  const a = automationSettings(db);
  if (a.startDate) return a.startDate;
  const today = todayLocal();
  setSetting(db, 'automation.config', { ...a, startDate: today });
  return today;
}

function sanitizeCode(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Za svaki Televend artikl bez povezanog lokalnog artikla stvara lokalni artikl i povezuje ih. */
export function autoCreateProducts(db: DB, actor: Actor = SYSTEM_ACTOR): number[] {
  const unlinked = db
    .prepare(
      `SELECT tp.id, tp.source_id, tp.name, tp.category_raw FROM tv_products tp
       WHERE NOT EXISTS (SELECT 1 FROM product_televend_links l WHERE l.tv_product_id = tp.id) ORDER BY tp.id`,
    )
    .all() as { id: number; source_id: string | null; name: string; category_raw: string | null }[];
  const created: number[] = [];
  const codeTaken = db.prepare('SELECT 1 FROM products WHERE code = ?');
  const byName = db.prepare('SELECT id FROM products WHERE name = ? AND active = 1');
  for (const tp of unlinked) {
    db.transaction(() => {
      // Ako već postoji lokalni artikl istog naziva (npr. ručno unesen), poveži ga umjesto stvaranja duplikata
      const sameName = byName.all(tp.name) as { id: number }[];
      let productId: number;
      if (sameName.length === 1) {
        productId = sameName[0].id;
      } else {
        const base = tp.source_id ? `TV-${sanitizeCode(tp.source_id)}` : `TV-${String(tp.id).padStart(5, '0')}`;
        let code = base || `TV-${tp.id}`;
        let n = 2;
        while (codeTaken.get(code)) code = `${base}-${n++}`;
        let categoryId: number | null = null;
        if (tp.category_raw) {
          const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(tp.category_raw.trim()) as { id: number } | undefined;
          categoryId = cat?.id ?? Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(tp.category_raw.trim()).lastInsertRowid);
        }
        productId = Number(
          db
            .prepare(
              `INSERT INTO products (code, name, category_id, purchase_price, unit, pack_size, min_stock, target_stock, active, note, auto_created, price_set)
               VALUES (?, ?, ?, 0, 'kom', 1, 0, 0, 1, ?, 1, 0)`,
            )
            .run(code, tp.name.slice(0, 200), categoryId, 'Automatski stvoren iz Televend Clouda – unesite nabavnu cijenu.').lastInsertRowid,
        );
        created.push(productId);
        audit(db, actor, 'product.auto_create', 'product', productId, { code, name: tp.name, televendProductId: tp.id });
      }
      db.prepare('INSERT INTO product_televend_links (product_id, tv_product_id, created_by) VALUES (?, ?, ?)').run(productId, tp.id, actor.id);
    })();
  }
  return created;
}

export interface RefillAutomationResult {
  booked: number;
  reconciled: number;
  skipped: number;
}

/**
 * Dopune iz Televenda (od datuma početka) knjiže se automatski. Ako već postoji ručno uneseni prijenos u automat
 * (isti artikl i količina, ±2 dana) koji nije povezan, dopuna se samo povezuje s njim – bez ponovnog knjiženja.
 */
export function autoBookRefills(db: DB, actor: Actor = SYSTEM_ACTOR): RefillAutomationResult {
  const a = automationSettings(db);
  const res: RefillAutomationResult = { booked: 0, reconciled: 0, skipped: 0 };
  if (!a.autoBookRefills || !a.startDate) return res;
  const source = a.refillSourceLocationId ?? centralLocationId(db);
  const pending = db
    .prepare(
      `SELECT r.id, r.machine_id, r.quantity, r.refilled_at_utc, l.product_id
       FROM tv_refills r LEFT JOIN product_televend_links l ON l.tv_product_id = r.tv_product_id
       WHERE r.status = 'pending' ORDER BY r.refilled_at_utc, r.id`,
    )
    .all() as { id: number; machine_id: number; quantity: number; refilled_at_utc: string; product_id: number | null }[];
  for (const r of pending) {
    const day = localDateOf(r.refilled_at_utc);
    if (day < a.startDate || !r.product_id) {
      res.skipped++;
      continue;
    }
    db.transaction(() => {
      const machineLoc = ensureMachineLocation(db, r.machine_id);
      const match = db
        .prepare(
          `SELECT m.id FROM stock_ledger sl JOIN stock_movements m ON m.id = sl.movement_id
           WHERE sl.location_id = ? AND sl.product_id = ? AND sl.qty_delta > 0 AND ABS(sl.qty_delta - ?) < 0.0005
             AND m.type IN ('issue','transfer') AND m.auto_generated = 0
             AND m.doc_date BETWEEN date(?, '-2 day') AND date(?, '+2 day')
             AND NOT EXISTS (SELECT 1 FROM stock_movements rv WHERE rv.reverses_movement_id = m.id)
             AND NOT EXISTS (SELECT 1 FROM tv_refills x JOIN product_televend_links xl ON xl.tv_product_id = x.tv_product_id
                             WHERE x.movement_id = m.id AND xl.product_id = sl.product_id)
           ORDER BY ABS(julianday(m.doc_date) - julianday(?)) LIMIT 1`,
        )
        .get(machineLoc, r.product_id, r.quantity, day, day, day) as { id: number } | undefined;
      if (match) {
        db.prepare("UPDATE tv_refills SET status = 'reconciled', movement_id = ?, resolved_at = ?, note = ? WHERE id = ?").run(
          match.id,
          nowIso(),
          'Automatski povezano s ručno unesenim prijenosom',
          r.id,
        );
        res.reconciled++;
        return;
      }
      if (source === machineLoc) {
        res.skipped++;
        return;
      }
      const mv = createTransfer(
        db,
        {
          docDate: day,
          fromLocationId: source,
          toLocationId: machineLoc,
          sourceRef: `refill:${r.id}`,
          note: `Dopuna automata (Televend #${r.id}) – automatski`,
          lines: [{ productId: r.product_id!, qty: r.quantity }],
          automated: true,
        },
        actor,
      );
      db.prepare("UPDATE tv_refills SET status = 'booked', movement_id = ?, resolved_at = ?, note = ? WHERE id = ?").run(
        mv.movementId,
        nowIso(),
        'Automatski proknjiženo',
        r.id,
      );
      res.booked++;
    })();
  }
  return res;
}

/**
 * Usklađenje zalihe automata sa stanjem koje prijavljuje Televend: za posljednje stanje svakog artikla
 * u automatu knjiži se korekcija razlike (jedan dokument po automatu i uvozu; isti uvoz se ne knjiži dvaput).
 */
export function reconcileMachineStock(db: DB, batchId: number, actor: Actor = SYSTEM_ACTOR): { movements: number; lines: number } {
  const a = automationSettings(db);
  if (!a.autoSyncMachineStock || !a.startDate) return { movements: 0, lines: 0 };
  const rows = db
    .prepare(
      `SELECT s.machine_id, s.tv_product_id, s.quantity, COALESCE(s.measured_at_utc, s.fetched_at) AS at, l.product_id
       FROM tv_machine_stock s LEFT JOIN product_televend_links l ON l.tv_product_id = s.tv_product_id
       WHERE s.import_batch_id = ? AND s.id IN (SELECT MAX(id) FROM tv_machine_stock WHERE import_batch_id = ? GROUP BY machine_id, tv_product_id)`,
    )
    .all(batchId, batchId) as { machine_id: number; tv_product_id: number; quantity: number; at: string; product_id: number | null }[];
  const byMachine = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!r.product_id || localDateOf(r.at) < a.startDate) continue;
    const list = byMachine.get(r.machine_id) ?? [];
    list.push(r);
    byMachine.set(r.machine_id, list);
  }
  let movements = 0;
  let lines = 0;
  for (const [machineId, list] of byMachine) {
    const ref = `tvstock:${batchId}:${machineId}`;
    if (db.prepare('SELECT 1 FROM stock_movements WHERE source_ref = ?').get(ref)) continue;
    const loc = ensureMachineLocation(db, machineId);
    // više Televend artikala može biti povezano s istim lokalnim artiklom → zbroj
    const target = new Map<number, number>();
    for (const r of list) target.set(r.product_id!, roundQty((target.get(r.product_id!) ?? 0) + r.quantity));
    const adj = [...target.entries()]
      .map(([productId, qty]) => ({ productId, locationId: loc, qtyDelta: roundQty(qty - getBalance(db, productId, loc)) }))
      .filter((l) => l.qtyDelta !== 0);
    if (!adj.length) continue;
    postMovement(
      db,
      {
        type: 'adjustment',
        docDate: localDateOf(list[0].at),
        sourceRef: ref,
        note: 'Usklađenje stanja automata s Televend Cloudom – automatski',
        lines: adj,
        allowNegative: true,
        autoGenerated: true,
      },
      actor,
    );
    movements++;
    lines += adj.length;
  }
  return { movements, lines };
}

export function automationOverview(db: DB) {
  const a = automationSettings(db);
  const q = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    settings: a,
    productsWithoutPrice: q('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND price_set = 0'),
    autoCreatedProducts: q('SELECT COUNT(*) AS n FROM products WHERE auto_created = 1'),
    negativeCentral: q("SELECT COUNT(*) AS n FROM stock_balances b JOIN locations l ON l.id = b.location_id WHERE l.type = 'central' AND b.qty < 0"),
    pendingRefills: q("SELECT COUNT(*) AS n FROM tv_refills WHERE status = 'pending'"),
    autoMovements: q('SELECT COUNT(*) AS n FROM stock_movements WHERE auto_generated = 1'),
  };
}
