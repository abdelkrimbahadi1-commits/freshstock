import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISCARD_REASON, REPAIR_STATUS, SYNC_STATUS, db, type SyncQueueEntry } from "./db";
import type { ShoppingListItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({ getHouseholdId: vi.fn(), getRemoteOwnerId: vi.fn() }));

import { createClient } from "./supabase/client";
import { getHouseholdId, getRemoteOwnerId } from "./session";
import {
  SHOPPING_LIST_RLS_REPAIR_ID,
  construirePayloadCourses,
  isShoppingListRlsFailure,
  repairShoppingListRlsDeadLetters,
} from "./shoppingListRlsRepair";

const FOYER = "11111111-1111-4111-8111-111111111111";
const AUTRE_FOYER = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
const RLS = 'new row violates row-level security policy for table "shopping_list"';
const T0 = "2026-07-22T10:00:00.000Z";

const input = { householdId: FOYER, authenticatedUserId: USER };

function makeArticle(over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "article-1",
    household_id: FOYER,
    item_name: "Lait",
    quantity: 2,
    unit: "unite",
    source: "manual",
    recipe_name: null,
    checked: false,
    created_at: T0,
    updated_at: T0,
    ...over,
  };
}

// Payload historique du 22 juillet : ni created_at ni updated_at, household_id
// encore local. Il ne doit JAMAIS être rejoué tel quel.
function makeEntry(over: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    table: "shopping_list",
    op: "upsert",
    payload: {
      id: "article-1",
      household_id: "foyer-local-obsolete",
      item_name: "ANCIEN NOM",
      quantity: 99,
      unit: "unite",
      source: "manual",
      recipe_name: null,
      checked: false,
    },
    created_at: T0,
    updated_at: T0,
    status: SYNC_STATUS.DEAD_LETTER,
    attempts: 1,
    last_error: RLS,
    next_retry_at: T0,
    ...over,
  };
}

// Faux Supabase : `presents` liste les identifiants déjà côté serveur.
function fakeSupabase(presents: string[] = [], options: { membre?: boolean; erreur?: string } = {}) {
  const { membre = true, erreur } = options;
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from(table: string) {
      if (table === "household_members") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: membre ? { household_id: FOYER } : null }) }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: async (_col: string, ids: string[]) =>
              erreur
                ? { data: null, error: { message: erreur } }
                : { data: ids.filter((id) => presents.includes(id)).map((id) => ({ id })), error: null },
          }),
        }),
        upsert: async () => ({ error: null }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

beforeEach(async () => {
  await db.sync_queue.clear();
  await db.sync_queue_discarded.clear();
  await db.shopping_list.clear();
  await db.local_repairs.clear();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(FOYER);
  vi.mocked(getRemoteOwnerId).mockReset().mockReturnValue(USER);
  vi.mocked(createClient).mockReset().mockReturnValue(fakeSupabase() as never);
});

// ---------------------------------------------------------------------------
// Filtre
// ---------------------------------------------------------------------------

describe("détection de la signature RLS shopping_list", () => {
  it("1. reconnaît la signature exacte et ses variantes de forme", () => {
    expect(isShoppingListRlsFailure(makeEntry())).toBe(true);
    for (const variante of [RLS.toUpperCase(), `  ${RLS}  `, `${RLS}.`]) {
      expect(isShoppingListRlsFailure(makeEntry({ last_error: variante }))).toBe(true);
    }
  });

  it("2. rejette une autre signature, une autre table, un delete, un autre statut", () => {
    const autreTable = 'new row violates row-level security policy for table "stock_items"';
    expect(isShoppingListRlsFailure(makeEntry({ last_error: autreTable }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ last_error: "Could not find the 'created_at' column" }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ table: "stock_items" }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ op: "delete" }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ status: SYNC_STATUS.RETRY_PENDING }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ last_error: null }))).toBe(false);
    expect(isShoppingListRlsFailure(makeEntry({ payload: { household_id: FOYER } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payload reconstruit
// ---------------------------------------------------------------------------

describe("construirePayloadCourses", () => {
  it("3. force household_id depuis la session et ne contient AUCUN undefined", () => {
    const payload = construirePayloadCourses(
      makeArticle({ household_id: AUTRE_FOYER }),
      FOYER,
      T0,
      "2026-08-03T12:00:00.000Z"
    );
    expect(payload.household_id).toBe(FOYER);
    for (const [cle, valeur] of Object.entries(payload)) {
      expect(valeur, `champ ${cle}`).not.toBeUndefined();
    }
  });

  it("4. n'ajoute jamais added_by : shopping_list n'a pas cette colonne", () => {
    const payload = construirePayloadCourses(makeArticle(), FOYER, T0, T0);
    expect(Object.keys(payload).sort()).toEqual([
      "checked",
      "created_at",
      "household_id",
      "id",
      "item_name",
      "quantity",
      "recipe_name",
      "source",
      "unit",
      "updated_at",
    ]);
  });

  it("5. created_at absent -> repli sur la plus ancienne entrée de file", () => {
    const article = makeArticle();
    delete (article as Partial<ShoppingListItem>).created_at;
    const payload = construirePayloadCourses(article, FOYER, T0, "2026-08-03T12:00:00.000Z");
    expect(payload.created_at).toBe(T0);
  });

  it("6. updated_at absent -> instant de réparation, jamais undefined", () => {
    const article = makeArticle();
    delete (article as Partial<ShoppingListItem>).created_at;
    delete (article as Partial<ShoppingListItem>).updated_at;
    const instant = "2026-08-03T12:00:00.000Z";
    const payload = construirePayloadCourses(article, FOYER, undefined, instant);
    expect(payload.created_at).toBe(instant);
    expect(payload.updated_at).toBe(instant);
  });

  it("7. conserve les données métier locales actuelles", () => {
    const payload = construirePayloadCourses(
      makeArticle({ item_name: "Lait entier", quantity: 3, checked: true, source: "auto", recipe_name: "Crêpes" }),
      FOYER,
      T0,
      T0
    );
    expect(payload).toMatchObject({
      item_name: "Lait entier",
      quantity: 3,
      checked: true,
      source: "auto",
      recipe_name: "Crêpes",
    });
  });
});

// ---------------------------------------------------------------------------
// Préconditions
// ---------------------------------------------------------------------------

describe("préconditions post-auth", () => {
  it("8. session absente -> aucune mutation, compteur skippedMissingAuth", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
    } as never);

    const outcome = await repairShoppingListRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: false, reason: "missing-auth" });
    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
    const marqueur = await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID);
    expect(marqueur?.status).toBe(REPAIR_STATUS.FAILED);
    expect(marqueur?.report).toMatchObject({ skippedMissingAuth: 1 });
  });

  it("9. foyer différent ou non confirmé -> aucune mutation", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());

    vi.mocked(getHouseholdId).mockReturnValue(AUTRE_FOYER);
    expect(await repairShoppingListRlsDeadLetters(input)).toMatchObject({
      ok: false,
      reason: "household-mismatch",
    });

    vi.mocked(getHouseholdId).mockReturnValue(FOYER);
    vi.mocked(getRemoteOwnerId).mockReturnValue(null);
    expect(await repairShoppingListRlsDeadLetters(input)).toMatchObject({ ok: false });

    vi.mocked(getRemoteOwnerId).mockReturnValue(USER);
    vi.mocked(createClient).mockReturnValue(fakeSupabase([], { membre: false }) as never);
    const outcome = await repairShoppingListRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: false, reason: "household-mismatch" });
    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
    expect((await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID))?.report).toMatchObject({
      skippedHouseholdMismatch: 1,
    });
  });

  it("10. état distant indisponible -> aucune mutation", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());
    vi.mocked(createClient).mockReturnValue(fakeSupabase([], { erreur: "réseau" }) as never);

    const outcome = await repairShoppingListRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: false, reason: "remote" });
    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Décisions par article
// ---------------------------------------------------------------------------

describe("décision par article", () => {
  it("11. article ABSENT à distance + ligne locale -> une seule pending valide", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({
      matchedEntries: 1,
      articlesDistincts: 1,
      archivedEntries: 1,
      requeuedArticles: 1,
      articlesAlreadyRemote: 0,
      discardedNoLocalRow: 0,
    });
    const file = await db.sync_queue.toArray();
    expect(file).toHaveLength(1);
    expect(file[0].status).toBe(SYNC_STATUS.PENDING);
    // Le payload vient de la ligne locale ACTUELLE, jamais de l'ancien.
    expect(file[0].payload.item_name).toBe("Lait");
    expect(file[0].payload.quantity).toBe(2);
    expect(file[0].payload.household_id).toBe(FOYER);
  });

  it("12. article DÉJÀ présent à distance -> archive seule, aucune pending", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());
    vi.mocked(createClient).mockReturnValue(fakeSupabase(["article-1"]) as never);

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ articlesAlreadyRemote: 1, requeuedArticles: 0, archivedEntries: 1 });
    expect(await db.sync_queue.count()).toBe(0);
    expect(await db.sync_queue_discarded.count()).toBe(1);
  });

  it("13. ligne locale absente -> archive, aucune résurrection", async () => {
    await db.sync_queue.add(makeEntry());

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ discardedNoLocalRow: 1, requeuedArticles: 0, archivedEntries: 1 });
    expect(await db.sync_queue.count()).toBe(0);
    expect(await db.shopping_list.count()).toBe(0);
  });

  it("14. deux dead_letter du même article -> 2 archives, UNE seule décision", async () => {
    await db.shopping_list.add(makeArticle());
    const a = (await db.sync_queue.add(makeEntry())) as number;
    const b = (await db.sync_queue.add(
      makeEntry({ created_at: "2026-07-22T18:00:00.000Z", payload: { ...makeEntry().payload, item_name: "AUTRE ANCIEN" } })
    )) as number;

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ matchedEntries: 2, articlesDistincts: 1, archivedEntries: 2, requeuedArticles: 1 });
    expect(await db.sync_queue_discarded.count()).toBe(2);
    const file = await db.sync_queue.toArray();
    expect(file).toHaveLength(1);
    expect(file[0].id).not.toBe(a);
    expect(file[0].id).not.toBe(b);
    // Aucun des deux anciens payloads n'est rejoué.
    expect(file[0].payload.item_name).toBe("Lait");
  });

  it("15. reproduit le cas terrain : 17 entrées, 15 articles, 7 déjà distants", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `article-${i + 1}`);
    for (const id of ids) await db.shopping_list.add(makeArticle({ id }));
    for (const id of ids) await db.sync_queue.add(makeEntry({ payload: { ...makeEntry().payload, id } }));
    // Deux articles portent une seconde dead_letter -> 17 entrées.
    for (const id of ids.slice(0, 2)) {
      await db.sync_queue.add(makeEntry({ payload: { ...makeEntry().payload, id } }));
    }
    const dejaDistants = ids.slice(0, 7);
    vi.mocked(createClient).mockReturnValue(fakeSupabase(dejaDistants) as never);

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({
      inspectedDeadLetter: 17,
      matchedEntries: 17,
      articlesDistincts: 15,
      archivedEntries: 17,
      articlesAlreadyRemote: 7,
      requeuedArticles: 8,
      discardedNoLocalRow: 0,
      skippedOtherSignature: 0,
    });
    expect(await db.sync_queue.count()).toBe(8);
    expect(await db.sync_queue_discarded.count()).toBe(17);
    expect(await db.shopping_list.count()).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Non-action
// ---------------------------------------------------------------------------

describe("entrées laissées intactes", () => {
  it("16. autre signature, autre table, delete, autre statut", async () => {
    await db.shopping_list.add(makeArticle());
    const intactes: SyncQueueEntry[] = [
      makeEntry({ last_error: "Could not find the 'created_at' column of 'shopping_list'" }),
      makeEntry({ table: "stock_items" }),
      makeEntry({ op: "delete" }),
      makeEntry({ status: SYNC_STATUS.RETRY_PENDING }),
      makeEntry({ last_error: null }),
    ];
    for (const entry of intactes) await db.sync_queue.add(entry);
    const avant = await db.sync_queue.toArray();

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report.matchedEntries).toBe(0);
    // 3 dead_letter shopping_list examinées (delete inclus), aucune retenue.
    expect(outcome.report.skippedOtherSignature).toBe(3);
    expect(await db.sync_queue.toArray()).toEqual(avant);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("17. aucune donnée métier shopping_list n'est créée, modifiée ou supprimée", async () => {
    const lignes = [makeArticle({ id: "a" }), makeArticle({ id: "b", item_name: "Pain" })];
    await db.shopping_list.bulkAdd(lignes);
    await db.sync_queue.add(makeEntry({ payload: { ...makeEntry().payload, id: "a" } }));

    await repairShoppingListRlsDeadLetters(input);

    expect(await db.shopping_list.orderBy("id").toArray()).toEqual(lignes);
  });
});

// ---------------------------------------------------------------------------
// Atomicité, idempotence, reprise
// ---------------------------------------------------------------------------

// `withSyncPaused` relance flushSyncQueue() en sortie, en fire-and-forget. Avec
// un faux Supabase qui accepte les upsert, la pending créée part donc toute
// seule : on attend que la file se stabilise avant toute comparaison.
async function attendreFileStable(max = 30) {
  let precedent = -1;
  for (let i = 0; i < max; i++) {
    const actuel = await db.sync_queue.count();
    if (actuel === precedent) return;
    precedent = actuel;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("atomicité et idempotence", () => {
  it("18. échec d'archivage -> transaction annulée, rien ne change", async () => {
    await db.shopping_list.add(makeArticle());
    const id = (await db.sync_queue.add(makeEntry())) as number;
    const espion = vi
      .spyOn(db.sync_queue_discarded, "add")
      .mockImplementation((() =>
        Dexie.Promise.reject(new Error("archivage impossible"))) as typeof db.sync_queue_discarded.add);

    const outcome = await repairShoppingListRlsDeadLetters(input);
    espion.mockRestore();

    expect(outcome).toMatchObject({ ok: false, reason: "transaction" });
    expect(await db.sync_queue.get(id)).toBeDefined();
    expect(await db.sync_queue_discarded.count()).toBe(0);
    expect((await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID))?.status).toBe(REPAIR_STATUS.FAILED);
  });

  it("19. échec de création de la pending -> anciennes entrées conservées", async () => {
    await db.shopping_list.add(makeArticle());
    const id = (await db.sync_queue.add(makeEntry())) as number;
    const espion = vi
      .spyOn(db.sync_queue, "add")
      .mockImplementation((() => Dexie.Promise.reject(new Error("création impossible"))) as typeof db.sync_queue.add);

    const outcome = await repairShoppingListRlsDeadLetters(input);
    espion.mockRestore();

    expect(outcome).toMatchObject({ ok: false, reason: "transaction" });
    expect(await db.sync_queue.get(id)).toBeDefined();
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("20. second lancement : ni réarchivage, ni nouvelle pending", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());

    const premier = await repairShoppingListRlsDeadLetters(input);
    await attendreFileStable();
    const fileApres = await db.sync_queue.toArray();
    const archiveApres = await db.sync_queue_discarded.toArray();

    const second = await repairShoppingListRlsDeadLetters(input);
    await attendreFileStable();

    expect(premier).toMatchObject({ ok: true, skipped: false });
    expect(second).toMatchObject({ ok: true, skipped: true });
    expect(await db.sync_queue.toArray()).toEqual(fileApres);
    expect(await db.sync_queue_discarded.toArray()).toEqual(archiveApres);
  });

  it("21. reprise après interruption : in_progress ne bloque pas", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());
    await db.local_repairs.put({
      id: SHOPPING_LIST_RLS_REPAIR_ID,
      status: REPAIR_STATUS.IN_PROGRESS,
      started_at: T0,
      updated_at: T0,
      completed_at: null,
      last_error: null,
      report: null,
    });

    const outcome = await repairShoppingListRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: true, skipped: false });
    const marqueur = await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID);
    expect(marqueur?.status).toBe(REPAIR_STATUS.COMPLETED);
    expect(marqueur?.started_at).toBe(T0);
  });

  it("22. archive préexistante -> ni doublon, ni conservation de l'entrée technique", async () => {
    await db.shopping_list.add(makeArticle());
    const id = (await db.sync_queue.add(makeEntry())) as number;
    await db.sync_queue_discarded.add({
      ...makeEntry(),
      id,
      original_queue_id: id,
      discarded_at: T0,
      discarded_reason: DISCARD_REASON.SHOPPING_LIST_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP,
    });
    const avant = await db.sync_queue_discarded.get(id);

    const outcome = await repairShoppingListRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ alreadyArchived: 1, archivedEntries: 0 });
    expect(await db.sync_queue_discarded.count()).toBe(1);
    expect(await db.sync_queue_discarded.get(id)).toEqual(avant);
    expect(await db.sync_queue.get(id)).toBeUndefined();
  });

  it("23. le repair record porte tous les compteurs demandés", async () => {
    await db.shopping_list.add(makeArticle());
    await db.sync_queue.add(makeEntry());

    await repairShoppingListRlsDeadLetters(input);

    const marqueur = await db.local_repairs.get(SHOPPING_LIST_RLS_REPAIR_ID);
    expect(marqueur?.status).toBe(REPAIR_STATUS.COMPLETED);
    expect(marqueur?.started_at).toEqual(expect.any(String));
    expect(marqueur?.completed_at).toEqual(expect.any(String));
    expect(marqueur?.last_error).toBeNull();
    for (const compteur of [
      "inspectedDeadLetter",
      "matchedEntries",
      "articlesDistincts",
      "archivedEntries",
      "alreadyArchived",
      "articlesAlreadyRemote",
      "requeuedArticles",
      "discardedNoLocalRow",
      "skippedOtherSignature",
      "skippedMissingAuth",
      "skippedHouseholdMismatch",
    ]) {
      expect(marqueur?.report, compteur).toHaveProperty(compteur);
    }
  });
});
