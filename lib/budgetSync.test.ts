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
//
// INDÉPENDANCE TEMPORELLE. `computeBudgetSummary` filtre sur le mois COURANT
// (`isThisMonth`, lib/budget.ts). Les fixtures étaient auparavant figées en
// juillet 2026 : le test passait pendant ce mois-là puis échouait à jamais
// dès le 1er août — une bombe à retardement, pas une régression du code
// métier. Deux mesures y remédient ici, sans toucher à `computeBudgetSummary`
// ni à aucune logique Budget :
//
//   1. l'horloge est FIGÉE (`vi.setSystemTime`) pendant chaque cas, ce qui
//      élimine aussi la fenêtre de bascule à minuit entre la construction des
//      fixtures et l'appel au calcul ;
//   2. les dates sont dérivées du mois de l'instant figé, et le scénario est
//      rejoué sur plusieurs instants représentatifs — milieu de mois, dernier
//      jour d'un mois de 30 et de 31 jours, 31 décembre, 29 février, 1er
//      janvier — ce qui couvre explicitement les bascules de mois et d'année.
//
// Seuls le fichier de test et ses fixtures changent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Instants figés couvrant les bascules qui cassaient l'ancienne version.
// Construits en heure LOCALE (constructeur à composants) pour rester
// univoques quel que soit le fuseau de la machine qui exécute les tests —
// `isThisMonth` compare lui aussi des dates locales.
const INSTANTS_FIGES = [
  { libelle: "milieu de mois", maintenant: new Date(2026, 6, 15, 12, 0, 0) },
  { libelle: "dernier jour d'un mois de 31 jours", maintenant: new Date(2026, 6, 31, 12, 0, 0) },
  { libelle: "dernier jour d'un mois de 30 jours", maintenant: new Date(2026, 3, 30, 12, 0, 0) },
  { libelle: "31 décembre — bascule d'année", maintenant: new Date(2026, 11, 31, 12, 0, 0) },
  { libelle: "29 février — année bissextile", maintenant: new Date(2028, 1, 29, 12, 0, 0) },
  { libelle: "1er janvier", maintenant: new Date(2027, 0, 1, 12, 0, 0) },
];

// Jour du mois COURANT au format ISO. Seuls des jours ≤ 28 sont utilisés par
// les fixtures nominales : ils existent dans tous les mois, y compris février
// d'une année non bissextile.
function jourDuMoisCourant(maintenant: Date, jour: number): string {
  const annee = maintenant.getFullYear();
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  return `${annee}-${mois}-${String(jour).padStart(2, "0")}`;
}

function dernierJourDuMoisCourant(maintenant: Date): string {
  const dernier = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0);
  return jourDuMoisCourant(maintenant, dernier.getDate());
}

function premierJourDuMoisSuivant(maintenant: Date): string {
  const suivant = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 1);
  const annee = suivant.getFullYear();
  const mois = String(suivant.getMonth() + 1).padStart(2, "0");
  return `${annee}-${mois}-01`;
}

// Snapshot Supabase faisant autorité : l'article a été acheté puis marqué
// "Consommé" LA VEILLE de sa péremption — donc dans la fenêtre "gaspillage
// évité" de ±2 jours. Structure temporelle identique à l'ancienne fixture
// figée (achat, puis consommation plus tard dans le mois, péremption le
// lendemain de la consommation), mais rapportée au mois de l'instant figé.
function ligneDistante(maintenant: Date): StockItem {
  return {
    id: "shared-item",
    household_id: HOUSEHOLD_ID,
    product_id: null,
    barcode: null,
    name: "Fromage",
    category: "produit_laitier",
    quantity: 1,
    unit: "pièce",
    location: "frigo",
    purchase_date: jourDuMoisCourant(maintenant, 5),
    expiry_date: jourDuMoisCourant(maintenant, 21),
    price: 6,
    added_by: AUTH_USER,
    status: "consumed",
    updated_at: `${jourDuMoisCourant(maintenant, 20)}T10:00:00.000Z`,
  };
}

// Horodatage d'une copie locale PÉRIMÉE : antérieur à la consommation, mais
// toujours dans le mois courant.
function horodatagePerime(maintenant: Date): string {
  return `${jourDuMoisCourant(maintenant, 12)}T09:00:00.000Z`;
}

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
  // Seul `Date` est simulé : les minuteurs réels restent en place, dont ceux
  // dont dépendent Dexie et fake-indexeddb.
  vi.useFakeTimers({ toFake: ["Date"] });
  await db.stock_items.clear();
  await db.pull_meta.clear();
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(HOUSEHOLD_ID);
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(INSTANTS_FIGES)(
  "cohérence du budget entre deux membres d'un même foyer après pull ($libelle)",
  ({ maintenant }) => {
    it("un appareil sans copie locale et un appareil avec une copie locale périmée convergent vers le même résumé budgétaire", async () => {
      vi.setSystemTime(maintenant);
      const remoteRow = ligneDistante(maintenant);
      vi.mocked(createClient).mockReturnValue(makeFakeSupabase(remoteRow) as never);

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
        ...remoteRow,
        status: "in_stock",
        updated_at: horodatagePerime(maintenant),
      });

      await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
      const itemsB = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
      const summaryB = computeBudgetSummary(itemsB);

      expect(summaryB).toEqual(summaryA);
      expect(summaryA.wasteAvoided).toBe(6);
      expect(summaryA.wasteLost).toBe(0);
    });

    it("une écriture locale encore en attente empêche la convergence tant qu'elle n'a pas synchronisé (documenté, pas un bug)", async () => {
      vi.setSystemTime(maintenant);
      const remoteRow = ligneDistante(maintenant);
      const perime = horodatagePerime(maintenant);
      vi.mocked(createClient).mockReturnValue(makeFakeSupabase(remoteRow) as never);

      // Cet appareil a une modification locale non encore synchronisée sur ce
      // même article (ex. file d'attente bloquée) : la protection contre
      // l'écrasement d'une écriture en attente (LOT 4) empêche volontairement
      // le pull de faire converger cette copie tant que la file n'est pas
      // vide — comportement voulu, distinct du bug corrigé ci-dessus.
      await db.stock_items.put({ ...remoteRow, status: "in_stock", updated_at: perime });
      await db.sync_queue.add({
        table: "stock_items",
        op: "upsert",
        payload: { id: remoteRow.id, household_id: HOUSEHOLD_ID },
        created_at: perime,
        updated_at: perime,
        status: "pending",
        attempts: 0,
        last_error: null,
        next_retry_at: perime,
      });

      await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
      const items = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
      const summary = computeBudgetSummary(items);

      // Toujours la version locale périmée : pas de convergence tant que la
      // file d'attente locale n'est pas vidée (comportement attendu et
      // documenté, pas la régression corrigée ici).
      expect(summary.wasteAvoided).toBe(0);
    });
  }
);

// Cas limite propre au filtre `isThisMonth` : la fenêtre "gaspillage évité"
// se calcule sur l'écart entre `updated_at` et `expiry_date`, sans exiger que
// la péremption tombe dans le mois courant. Un article consommé le DERNIER
// jour du mois et périmant le 1er du mois SUIVANT doit donc bien être compté.
describe("bascule de fin de mois", () => {
  it.each(INSTANTS_FIGES)(
    "un article consommé le dernier jour du mois, périmant le 1er du mois suivant, reste compté ($libelle)",
    async ({ maintenant }) => {
      vi.setSystemTime(maintenant);
      const remoteRow: StockItem = {
        ...ligneDistante(maintenant),
        purchase_date: jourDuMoisCourant(maintenant, 1),
        updated_at: `${dernierJourDuMoisCourant(maintenant)}T18:00:00.000Z`,
        expiry_date: premierJourDuMoisSuivant(maintenant),
      };
      vi.mocked(createClient).mockReturnValue(makeFakeSupabase(remoteRow) as never);

      await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
      const items = await db.stock_items.where("household_id").equals(HOUSEHOLD_ID).toArray();
      const summary = computeBudgetSummary(items);

      expect(summary.wasteAvoided).toBe(6);
      expect(summary.monthlySpend).toBe(6);
      expect(summary.wasteLost).toBe(0);
    }
  );
});
