// Régression pour le bug rapporté : deux membres d'un même foyer voyaient
// des montants de budget différents ("gaspillage évité") pour le même
// article marqué "Consommé", parce qu'un onglet resté ouvert depuis avant
// la modification n'avait jamais retenté de pull tant que le calcul de
// budget (app/budget/page.tsx) ne l'exigeait pas explicitement. Ce test ne
// vérifie pas la logique de calcul elle-même (déjà pure et correcte, voir
// budget.test.ts) mais la PROPRIÉTÉ DE CONVERGENCE : deux appareils partant
// d'états locaux différents doivent obtenir le même résumé budgétaire une
// fois qu'ils ont chacun effectué un pull complet, sans écriture locale en
// attente qui protégerait une version périmée.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBudgetSummary } from "./budget";
import { db } from "./db";
import type { StockItem } from "./types";

const HOUSEHOLD_ID = "household-budget";
const AUTH_USER = "auth-user-budget";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));
vi.mock("./session", () => ({
  getHouseholdId: vi.fn().mockReturnValue("household-budget"),
}));

// Importés après les mocks pour récupérer les mêmes références mockées.
import { createClient } from "./supabase/client";
import { getHouseholdId } from "./session";
import { pullHouseholdData } from "./householdPull";

// Snapshot Supabase faisant autorité : l'article a été marqué "Consommé"
// la veille de sa péremption (dans la fenêtre "gaspillage évité").
const REMOTE_ROW: StockItem = {
  id: "shared-item",
  household_id: HOUSEHOLD_ID,
  product_id: null,
  barcode: null,
  name: "Fromage",
  category: "produit_laitier",
  quantity: 1,
  unit: "pièce",
  location: "frigo",
  purchase_date: "2026-07-15",
  expiry_date: "2026-07-27",
  price: 6,
  added_by: AUTH_USER,
  status: "consumed",
  updated_at: "2026-07-26T10:00:00.000Z",
};

function makeFakeSupabase(remoteRow: StockItem) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: AUTH_USER } } }),
    },
    from(table: string) {
      if (table === "household_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { household_id: HOUSEHOLD_ID } }) }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async (from: number) => {
                if (table !== "stock_items") return { data: [], error: null };
                return { data: from === 0 ? [remoteRow] : [], error: null };
              },
            }),
          }),
        }),
      };
    },
  };
}

beforeEach(async () => {
  await db.stock_items.clear();
  await db.pull_meta.clear();
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(HOUSEHOLD_ID);
});

describe("cohérence du budget entre deux membres d'un même foyer après pull", () => {
  it("un appareil sans copie locale et un appareil avec une copie locale périmée convergent vers le même résumé budgétaire", async () => {
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase(REMOTE_ROW) as never);

    // Membre A : aucune copie locale de l'article (première synchro sur
    // cet appareil, ou appareil qui vient de rejoindre le foyer).
    await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    const itemsA = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
    const summaryA = computeBudgetSummary(itemsA);

    // Membre B : reprend d'une base locale distincte contenant une copie
    // PÉRIMÉE du même article (encore "in_stock", horodatage antérieur) —
    // reproduit exactement le scénario rapporté : un onglet resté ouvert
    // depuis avant que l'article n'ait été marqué "Consommé" ailleurs.
    await db.stock_items.clear();
    await db.pull_meta.clear();
    await db.stock_items.put({
      ...REMOTE_ROW,
      status: "in_stock",
      updated_at: "2026-07-20T09:00:00.000Z",
    });

    await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    const itemsB = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
    const summaryB = computeBudgetSummary(itemsB);

    expect(summaryB).toEqual(summaryA);
    expect(summaryA.wasteAvoided).toBe(6);
    expect(summaryA.wasteLost).toBe(0);
  });

  it("une écriture locale encore en attente empêche la convergence tant qu'elle n'a pas synchronisé (documenté, pas un bug)", async () => {
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase(REMOTE_ROW) as never);

    // Cet appareil a une modification locale non encore synchronisée sur ce
    // même article (ex. file d'attente bloquée) : la protection contre
    // l'écrasement d'une écriture en attente (LOT 4) empêche volontairement
    // le pull de faire converger cette copie tant que la file n'est pas
    // vide — comportement voulu, distinct du bug corrigé ci-dessus.
    await db.stock_items.put({ ...REMOTE_ROW, status: "in_stock", updated_at: "2026-07-20T09:00:00.000Z" });
    await db.sync_queue.add({
      table: "stock_items",
      op: "upsert",
      payload: { id: REMOTE_ROW.id, household_id: HOUSEHOLD_ID },
      created_at: "2026-07-20T09:00:00.000Z",
      updated_at: "2026-07-20T09:00:00.000Z",
      status: "pending",
      attempts: 0,
      last_error: null,
      next_retry_at: "2026-07-20T09:00:00.000Z",
    });

    await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    const items = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
    const summary = computeBudgetSummary(items);

    // Toujours la version locale périmée : pas de convergence tant que la
    // file d'attente locale n'est pas vidée (comportement attendu et
    // documenté, pas la régression corrigée ici).
    expect(summary.wasteAvoided).toBe(0);
  });
});
