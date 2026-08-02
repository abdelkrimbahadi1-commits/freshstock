import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCARD_REASON,
  REPAIR_STATUS,
  SYNC_STATUS,
  db,
  type SyncQueueEntry,
} from "./db";
import type { StockItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({
  getHouseholdId: vi.fn(),
  getRemoteOwnerId: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { getHouseholdId, getRemoteOwnerId } from "./session";
import { flushSyncQueue } from "./offlineSync";
import {
  STOCK_RLS_REPAIR_ID,
  isStockItemsRlsFailure,
  normalizeSyncError,
  repairStockItemsRlsDeadLetters,
} from "./stockRlsRepair";

const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OLD_HOUSEHOLD = "33333333-3333-4333-8333-333333333333";
const OLD_USER = "44444444-4444-4444-8444-444444444444";

const RLS = 'new row violates row-level security policy for table "stock_items"';
const T0 = "2026-07-20T10:00:00.000Z";

function makeItem(over: Partial<StockItem> = {}): StockItem {
  return {
    id: "item-1",
    household_id: HOUSEHOLD,
    product_id: null,
    barcode: null,
    name: "Yaourt",
    category: "produit_laitier",
    quantity: 2,
    unit: "pièce",
    location: "frigo",
    purchase_date: "2026-07-18",
    expiry_date: "2026-07-30",
    price: 3.5,
    added_by: USER,
    status: "in_stock",
    updated_at: T0,
    ...over,
  };
}

function makeEntry(over: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    table: "stock_items",
    op: "upsert",
    // Payload figé, volontairement PÉRIMÉ : la réparation ne doit jamais le
    // rejouer tel quel.
    payload: {
      ...makeItem({ household_id: OLD_HOUSEHOLD, added_by: OLD_USER, quantity: 99, name: "ANCIEN" }),
    } as unknown as Record<string, unknown>,
    created_at: T0,
    updated_at: T0,
    status: SYNC_STATUS.DEAD_LETTER,
    attempts: 1,
    last_error: RLS,
    next_retry_at: T0,
    ...over,
  };
}

async function reset() {
  await db.sync_queue.clear();
  await db.sync_queue_discarded.clear();
  await db.stock_items.clear();
  await db.local_repairs.clear();
}

beforeEach(async () => {
  await reset();
  vi.mocked(createClient).mockReset();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(HOUSEHOLD);
  vi.mocked(getRemoteOwnerId).mockReset().mockReturnValue(USER);
});

const input = { householdId: HOUSEHOLD, authenticatedUserId: USER };

// ---------------------------------------------------------------------------
// Filtre
// ---------------------------------------------------------------------------

describe("détection de la signature RLS", () => {
  it("1. reconnaît la signature exacte", () => {
    expect(isStockItemsRlsFailure(makeEntry())).toBe(true);
  });

  it("2. tolère casse, espaces multiples et point final", () => {
    for (const variante of [
      RLS.toUpperCase(),
      `  ${RLS}  `,
      RLS.replace(/ /g, "   "),
      `${RLS}.`,
    ]) {
      expect(isStockItemsRlsFailure(makeEntry({ last_error: variante }))).toBe(true);
    }
    expect(normalizeSyncError(`  ${RLS.toUpperCase()}.  `)).toBe(RLS);
  });

  it("3. rejette une RLS sur une AUTRE table", () => {
    const autre = 'new row violates row-level security policy for table "shopping_list"';
    expect(isStockItemsRlsFailure(makeEntry({ last_error: autre }))).toBe(false);
  });

  it("4. rejette une autre erreur, un message vide ou absent", () => {
    for (const message of [
      'insert or update on table "stock_items" violates foreign key constraint',
      "Erreur inconnue",
      "",
      null,
    ]) {
      expect(isStockItemsRlsFailure(makeEntry({ last_error: message }))).toBe(false);
    }
  });

  it("5. rejette delete, autre table, autre statut, payload sans id", () => {
    expect(isStockItemsRlsFailure(makeEntry({ op: "delete" }))).toBe(false);
    expect(isStockItemsRlsFailure(makeEntry({ table: "shopping_list" }))).toBe(false);
    for (const status of [SYNC_STATUS.PENDING, SYNC_STATUS.PROCESSING, SYNC_STATUS.RETRY_PENDING]) {
      expect(isStockItemsRlsFailure(makeEntry({ status }))).toBe(false);
    }
    expect(isStockItemsRlsFailure(makeEntry({ payload: { name: "sans id" } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Préconditions
// ---------------------------------------------------------------------------

describe("préconditions authentifiées", () => {
  it("6. paramètres invalides -> aucune mutation, erreur explicite", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());

    for (const mauvais of [
      { householdId: HOUSEHOLD, authenticatedUserId: "" },
      { householdId: HOUSEHOLD, authenticatedUserId: "pas-un-uuid" },
      { householdId: "", authenticatedUserId: USER },
      { householdId: "12345", authenticatedUserId: USER },
    ]) {
      const outcome = await repairStockItemsRlsDeadLetters(mauvais);
      expect(outcome).toMatchObject({ ok: false, reason: "precondition" });
    }

    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
    expect(await db.local_repairs.count()).toBe(0);
  });

  it("7. confirmRemoteHousehold non établi -> aucune mutation", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());

    vi.mocked(getRemoteOwnerId).mockReturnValue(null);
    expect(await repairStockItemsRlsDeadLetters(input)).toMatchObject({
      ok: false,
      reason: "precondition",
    });

    vi.mocked(getRemoteOwnerId).mockReturnValue(OLD_USER);
    expect(await repairStockItemsRlsDeadLetters(input)).toMatchObject({ ok: false });

    vi.mocked(getRemoteOwnerId).mockReturnValue(USER);
    vi.mocked(getHouseholdId).mockReturnValue(OLD_HOUSEHOLD);
    expect(await repairStockItemsRlsDeadLetters(input)).toMatchObject({ ok: false });

    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
    expect(await db.local_repairs.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Traitement par produit
// ---------------------------------------------------------------------------

describe("réparation par produit", () => {
  it("8. deux dead_letter du même produit -> 2 archives, 1 seule pending", async () => {
    await db.stock_items.add(makeItem());
    const a = (await db.sync_queue.add(makeEntry())) as number;
    const b = (await db.sync_queue.add(
      makeEntry({ created_at: "2026-07-21T10:00:00.000Z" })
    )) as number;

    const outcome = await repairStockItemsRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: true, skipped: false });
    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({
      inspectedDeadLetter: 2,
      matchedEntries: 2,
      produits: 1,
      archivedEntries: 2,
      requeuedProducts: 1,
      discardedNoLocalRow: 0,
      skippedOtherSignature: 0,
    });

    expect(await db.sync_queue_discarded.count()).toBe(2);
    for (const id of [a, b]) {
      const archive = await db.sync_queue_discarded.get(id);
      expect(archive?.original_queue_id).toBe(id);
      expect(archive?.discarded_reason).toBe(
        DISCARD_REASON.STOCK_ITEMS_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP
      );
    }

    const restantes = await db.sync_queue.toArray();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].status).toBe(SYNC_STATUS.PENDING);
    expect(restantes[0].id).not.toBe(a);
    expect(restantes[0].id).not.toBe(b);
  });

  it("9. une seule dead_letter -> 1 archive, 1 pending", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());

    const outcome = await repairStockItemsRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ archivedEntries: 1, requeuedProducts: 1, produits: 1 });
    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(1);
  });

  it("10. le payload provient de la ligne locale ACTUELLE, jamais de l'ancien", async () => {
    await db.stock_items.add(makeItem({ name: "Yaourt nature", quantity: 4, status: "consumed" }));
    await db.sync_queue.add(makeEntry());

    await repairStockItemsRlsDeadLetters(input);

    const [nouvelle] = await db.sync_queue.toArray();
    expect(nouvelle.payload.name).toBe("Yaourt nature");
    expect(nouvelle.payload.quantity).toBe(4);
    expect(nouvelle.payload.status).toBe("consumed");
    expect(nouvelle.payload.name).not.toBe("ANCIEN");
    expect(nouvelle.payload.quantity).not.toBe(99);
  });

  it("11. household_id et added_by sont reposés depuis la session authentifiée", async () => {
    // Même si la ligne locale porte encore d'anciennes valeurs.
    await db.stock_items.add(makeItem({ household_id: OLD_HOUSEHOLD, added_by: OLD_USER }));
    await db.sync_queue.add(makeEntry());

    await repairStockItemsRlsDeadLetters(input);

    const [nouvelle] = await db.sync_queue.toArray();
    expect(nouvelle.payload.household_id).toBe(HOUSEHOLD);
    expect(nouvelle.payload.added_by).toBe(USER);
  });

  it("12. ligne locale absente -> archivage, retrait, aucune résurrection", async () => {
    await db.sync_queue.add(makeEntry());

    const outcome = await repairStockItemsRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({
      archivedEntries: 1,
      requeuedProducts: 0,
      discardedNoLocalRow: 1,
    });
    expect(await db.sync_queue.count()).toBe(0);
    expect(await db.sync_queue_discarded.count()).toBe(1);
    expect(await db.stock_items.count()).toBe(0);
  });

  it("13. archive préexistante -> ni doublon, ni conservation de l'entrée technique", async () => {
    await db.stock_items.add(makeItem());
    const id = (await db.sync_queue.add(makeEntry())) as number;
    await db.sync_queue_discarded.add({
      ...makeEntry(),
      id,
      original_queue_id: id,
      discarded_at: T0,
      discarded_reason: DISCARD_REASON.STOCK_ITEMS_RLS_BEFORE_HOUSEHOLD_MEMBERSHIP,
    });
    const avant = await db.sync_queue_discarded.get(id);

    const outcome = await repairStockItemsRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report).toMatchObject({ alreadyArchived: 1, archivedEntries: 0 });
    expect(await db.sync_queue_discarded.count()).toBe(1);
    expect(await db.sync_queue_discarded.get(id)).toEqual(avant);
    expect(await db.sync_queue.get(id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Non-action
// ---------------------------------------------------------------------------

describe("entrées laissées strictement intactes", () => {
  it("14. autre message, delete, autre table, autre statut", async () => {
    await db.stock_items.add(makeItem());
    const intactes: SyncQueueEntry[] = [
      makeEntry({ last_error: "violates foreign key constraint stock_items_added_by_fkey" }),
      makeEntry({ last_error: 'new row violates row-level security policy for table "feedback"' }),
      makeEntry({ op: "delete" }),
      makeEntry({ table: "shopping_list" }),
      makeEntry({ status: SYNC_STATUS.RETRY_PENDING }),
      makeEntry({ last_error: null }),
    ];
    for (const entry of intactes) await db.sync_queue.add(entry);
    const avant = await db.sync_queue.toArray();

    const outcome = await repairStockItemsRlsDeadLetters(input);

    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report.matchedEntries).toBe(0);
    expect(outcome.report.requeuedProducts).toBe(0);
    // 4 dead_letter stock_items examinées (delete inclus), aucune retenue.
    expect(outcome.report.skippedOtherSignature).toBe(4);
    expect(await db.sync_queue.toArray()).toEqual(avant);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("15. aucune donnée métier stock_items n'est créée, modifiée ou supprimée", async () => {
    const lignes = [makeItem({ id: "item-1" }), makeItem({ id: "item-2", name: "Beurre" })];
    await db.stock_items.bulkAdd(lignes);
    await db.sync_queue.add(makeEntry());
    await db.sync_queue.add(makeEntry({ payload: { ...makeItem({ id: "item-2" }) } as never }));

    await repairStockItemsRlsDeadLetters(input);

    expect(await db.stock_items.orderBy("id").toArray()).toEqual(lignes);
  });
});

// ---------------------------------------------------------------------------
// Atomicité, idempotence, reprise
// ---------------------------------------------------------------------------

describe("atomicité et idempotence", () => {
  it("16. échec d'archivage -> transaction annulée, rien ne change", async () => {
    await db.stock_items.add(makeItem());
    const id = (await db.sync_queue.add(makeEntry())) as number;

    const espion = vi
      .spyOn(db.sync_queue_discarded, "add")
      .mockImplementation((() =>
        Dexie.Promise.reject(
          new Error("archivage impossible (simulé)")
        )) as typeof db.sync_queue_discarded.add);

    const outcome = await repairStockItemsRlsDeadLetters(input);
    espion.mockRestore();

    expect(outcome).toMatchObject({ ok: false, reason: "transaction" });
    expect(await db.sync_queue.get(id)).toBeDefined();
    expect(await db.sync_queue_discarded.count()).toBe(0);
    expect((await db.local_repairs.get(STOCK_RLS_REPAIR_ID))?.status).toBe(REPAIR_STATUS.FAILED);
  });

  it("17. échec de création du pending -> transaction annulée, anciennes entrées conservées", async () => {
    await db.stock_items.add(makeItem());
    const id = (await db.sync_queue.add(makeEntry())) as number;

    const espion = vi
      .spyOn(db.sync_queue, "add")
      .mockImplementation((() =>
        Dexie.Promise.reject(
          new Error("création impossible (simulée)")
        )) as typeof db.sync_queue.add);

    const outcome = await repairStockItemsRlsDeadLetters(input);
    espion.mockRestore();

    expect(outcome).toMatchObject({ ok: false, reason: "transaction" });
    expect(await db.sync_queue.get(id)).toBeDefined();
    expect(await db.sync_queue.count()).toBe(1);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("18. double exécution -> aucun doublon, second appel court-circuité", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());

    const premier = await repairStockItemsRlsDeadLetters(input);
    const fileApres = await db.sync_queue.toArray();
    const archiveApres = await db.sync_queue_discarded.toArray();

    const second = await repairStockItemsRlsDeadLetters(input);

    expect(premier).toMatchObject({ ok: true, skipped: false });
    expect(second).toMatchObject({ ok: true, skipped: true });
    expect(await db.sync_queue.toArray()).toEqual(fileApres);
    expect(await db.sync_queue_discarded.toArray()).toEqual(archiveApres);
  });

  it("19. reprise après crash : un marqueur in_progress ne bloque pas, la réparation est rejouée", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());
    // Simule une fermeture entre l'écriture du marqueur et la transaction.
    await db.local_repairs.put({
      id: STOCK_RLS_REPAIR_ID,
      status: REPAIR_STATUS.IN_PROGRESS,
      started_at: T0,
      updated_at: T0,
      completed_at: null,
      last_error: null,
      report: null,
    });

    const outcome = await repairStockItemsRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: true, skipped: false });
    if (!outcome.ok) throw new Error("attendu ok");
    expect(outcome.report.requeuedProducts).toBe(1);
    const marqueur = await db.local_repairs.get(STOCK_RLS_REPAIR_ID);
    expect(marqueur?.status).toBe(REPAIR_STATUS.COMPLETED);
    // started_at d'origine conservé : la tentative interrompue reste traçable.
    expect(marqueur?.started_at).toBe(T0);
  });

  it("20. un marqueur failed autorise une nouvelle tentative", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());
    await db.local_repairs.put({
      id: STOCK_RLS_REPAIR_ID,
      status: REPAIR_STATUS.FAILED,
      started_at: T0,
      updated_at: T0,
      completed_at: null,
      last_error: "échec précédent",
      report: null,
    });

    const outcome = await repairStockItemsRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: true, skipped: false });
    const marqueur = await db.local_repairs.get(STOCK_RLS_REPAIR_ID);
    expect(marqueur?.status).toBe(REPAIR_STATUS.COMPLETED);
    expect(marqueur?.last_error).toBeNull();
  });

  it("21. seul completed court-circuite réellement", async () => {
    await db.stock_items.add(makeItem());
    await db.sync_queue.add(makeEntry());
    await db.local_repairs.put({
      id: STOCK_RLS_REPAIR_ID,
      status: REPAIR_STATUS.COMPLETED,
      started_at: T0,
      updated_at: T0,
      completed_at: T0,
      last_error: null,
      report: {
        inspectedDeadLetter: 0,
        matchedEntries: 0,
        produits: 0,
        archivedEntries: 0,
        alreadyArchived: 0,
        requeuedProducts: 0,
        discardedNoLocalRow: 0,
        skippedOtherSignature: 0,
      },
    });

    const outcome = await repairStockItemsRlsDeadLetters(input);

    expect(outcome).toMatchObject({ ok: true, skipped: true });
    // La file n'a pas été touchée : le court-circuit est réel.
    const [entry] = await db.sync_queue.toArray();
    expect(entry.status).toBe(SYNC_STATUS.DEAD_LETTER);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Intégration avec le flush
// ---------------------------------------------------------------------------

describe("intégration avec flushSyncQueue", () => {
  function fakeSupabase(rows: Map<string, Record<string, unknown>>, cibles: string[]) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
      from(table: string) {
        cibles.push(table);
        return {
          // upsert = INSERT ... ON CONFLICT (id) DO UPDATE : une seule ligne
          // distante par id, que la ligne existe déjà ou non.
          upsert: async (payload: Record<string, unknown>) => {
            rows.set(payload.id as string, payload);
            return { error: null };
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    };
  }

  // `withSyncPaused` relance flushSyncQueue() en sortie, en fire-and-forget.
  // Un appel immédiat retomberait sur la passe déjà en vol et se contenterait
  // de demander une repasse. On draine donc explicitement jusqu'à file vide.
  async function drainerLaFile(max = 20) {
    for (let i = 0; i < max; i++) {
      if ((await db.sync_queue.count()) === 0) return;
      await flushSyncQueue();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it("22. après flush réussi : une seule ligne distante par id, file vidée", async () => {
    await db.stock_items.bulkAdd([makeItem({ id: "item-1" }), makeItem({ id: "item-2" })]);
    await db.sync_queue.add(makeEntry({ payload: { ...makeItem({ id: "item-1" }) } as never }));
    await db.sync_queue.add(makeEntry({ payload: { ...makeItem({ id: "item-1" }) } as never }));
    await db.sync_queue.add(makeEntry({ payload: { ...makeItem({ id: "item-2" }) } as never }));

    const distant = new Map<string, Record<string, unknown>>();
    const cibles: string[] = [];
    vi.mocked(createClient).mockReturnValue(fakeSupabase(distant, cibles) as never);

    await repairStockItemsRlsDeadLetters(input);
    await drainerLaFile();

    expect(distant.size).toBe(2);
    expect(distant.get("item-1")).toMatchObject({ household_id: HOUSEHOLD, added_by: USER });
    expect(await db.sync_queue.count()).toBe(0);
    expect(cibles).toEqual(["stock_items", "stock_items"]);
  });

  it("23. un produit déjà présent à distance est mis à jour sans doublon", async () => {
    await db.stock_items.add(makeItem({ name: "Yaourt nature" }));
    await db.sync_queue.add(makeEntry());

    const distant = new Map<string, Record<string, unknown>>([
      ["item-1", { id: "item-1", name: "version distante antérieure" }],
    ]);
    vi.mocked(createClient).mockReturnValue(fakeSupabase(distant, []) as never);

    await repairStockItemsRlsDeadLetters(input);
    await drainerLaFile();

    expect(distant.size).toBe(1);
    expect(distant.get("item-1")).toMatchObject({ id: "item-1", name: "Yaourt nature" });
    expect(await db.sync_queue.count()).toBe(0);
  });
});
