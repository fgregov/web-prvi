import type { DB } from '../db/index.js';
import { SYSTEM_ACTOR, type Actor } from '../modules/audit/audit.js';
import { autoBookRefills, autoCreateProducts, automationSettings, ensureStartDate, reconcileMachineStock, type RefillAutomationResult } from '../modules/automation/service.js';
import type { Dataset } from './config.js';
import type { ImportSummary } from './importers.js';
import { postSalesToMachineStock, type PostingSummary } from './salesPosting.js';

export interface AutomationRunResult {
  startDate: string | null;
  createdProducts: number;
  sales: PostingSummary | null;
  refills: RefillAutomationResult | null;
  machineStock: { movements: number; lines: number } | null;
}

/**
 * Nakon uvoza (sinkronizacija ili ručni uvoz) aplikacija sama generira artikle i skladišna kretanja.
 * Redoslijed je bitan: artikli → prodaja → dopune → usklađenje stanja automata (stanje iz Televenda
 * već uključuje prodaju i dopune do trenutka mjerenja, pa se korekcija računa na kraju).
 */
export function runAutomation(db: DB, imports: { dataset: Dataset; summary: ImportSummary }[], actor: Actor = SYSTEM_ACTOR): AutomationRunResult {
  const committed = imports.filter((i) => i.summary.status === 'committed');
  const result: AutomationRunResult = { startDate: automationSettings(db).startDate, createdProducts: 0, sales: null, refills: null, machineStock: null };
  if (!committed.length) return result;
  result.startDate = ensureStartDate(db);
  const a = automationSettings(db);
  if (a.autoCreateProducts) result.createdProducts = autoCreateProducts(db, actor).length;
  result.sales = postSalesToMachineStock(db, 'all', actor);
  if (committed.some((i) => i.dataset === 'refills')) result.refills = autoBookRefills(db, actor);
  for (const i of committed.filter((x) => x.dataset === 'machine_stock')) {
    const r = reconcileMachineStock(db, i.summary.batchId, actor);
    result.machineStock = { movements: (result.machineStock?.movements ?? 0) + r.movements, lines: (result.machineStock?.lines ?? 0) + r.lines };
  }
  return result;
}
