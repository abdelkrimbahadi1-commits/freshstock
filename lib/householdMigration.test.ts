import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, MIGRATION_STATUS, SYNC_STATUS } from "./db";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));
vi.mock("./session", () => ({
  getRemoteOwnerId: vi.fn().mockReturnValue(null),
}));

// Importés après les mocks pour récupérer les mêmes références mockées.
import { createClient } from "./supabase/client";
import { getRemoteOwnerId } from "./session";
import { flushSyncQueue, queueWrite } from "./offlineSync";
import { migrateLocalDataToHousehold } from "./householdMigration";

const OLD_ID = "old-household";
const NEW_ID = "new-household";
const AUTH_USER = "auth-user-1";

function makeFakeSupabase(handler: (table: string, payload: Record<string, unknown>) => { error: unknown }) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: AUTH_USER } } }),
    },
    from(table: string) {
      return {
        upsert: async (payload: Record<string, unknown>) => handler(table, payload),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition non atteinte dans le délai imparti");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(async () => {
  await db.stock_items.clear();
  await db.shopping_list.clear();
  await db.feedback.clear();
  await db.meal_history.clear();
  await db.sync_queue.clear();
  await db.household_migrations.clear();
  vi.mocked(createClient).mockReset();
  vi.mocked(getRemoteOwnerId).mockReset().mockReturnValue(null);
});

describe("migrateLocalDataToHousehold", () => {
  it("migre toutes les tables (stock, courses, avis, historique, queue) et réécrit added_by", async () => {
    await db.stock_items.put({
      id: "stock-1",
      household_id: OLD_ID,
      product_id: null,
      barcode: null,
      name: "Lait",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
      purchase_date: "2026-07-01",
      expiry_date: "2026-07-10",
      price: null,
      added_by: "local-user-9",
      status: "in_stock",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    await db.shopping_list.put({
      id: "sl-1",
      household_id: OLD_ID,
      item_name: "Pain",
      quantity: 1,
      unit: "pièce",
      source: "manual",
      recipe_name: null,
      checked: false,
    });
    await db.feedback.put({ id: "fb-1", household_id: OLD_ID, message: "top", created_at: "2026-07-01T00:00:00.000Z" });
    await db.meal_history.put({ id: "mh-1", household_id: OLD_ID, recipe_id: "r1", date: "2026-07-01", ingredients_used: [] });
    await queueWrite("stock_items", "upsert", {
      id: "stock-1",
      household_id: OLD_ID,
      added_by: "local-user-9",
      name: "Lait",
    });

    const outcome = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });

    expect(outcome.success).toBe(true);
    if (!outcome.success) throw new Error("unreachable");
    expect(outcome.result.migratedCounts.stock_items).toBe(1);
    expect(outcome.result.migratedCounts.shopping_list).toBe(1);
    expect(outcome.result.migratedCounts.feedback).toBe(1);
    expect(outcome.result.migratedCounts.meal_history).toBe(1);
    expect(outcome.result.queueEntriesFixed).toBe(1);

    const stockItem = await db.stock_items.get("stock-1");
    expect(stockItem?.household_id).toBe(NEW_ID);
    expect(stockItem?.added_by).toBe(AUTH_USER);

    const shoppingItem = await db.shopping_list.get("sl-1");
    expect(shoppingItem?.household_id).toBe(NEW_ID);

    const feedbackItem = await db.feedback.get("fb-1");
    expect(feedbackItem?.household_id).toBe(NEW_ID);

    const mealItem = await db.meal_history.get("mh-1");
    expect(mealItem?.household_id).toBe(NEW_ID);

    const [queueEntry] = await db.sync_queue.toArray();
    expect(queueEntry.payload.household_id).toBe(NEW_ID);
    expect(queueEntry.payload.added_by).toBe(AUTH_USER);

    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record?.status).toBe(MIGRATION_STATUS.COMPLETED);
  });

  it("est idempotent : un second appel avec la même paire ne remigre rien et retourne le résultat mémorisé", async () => {
    await db.stock_items.put({
      id: "stock-2",
      household_id: OLD_ID,
      product_id: null,
      barcode: null,
      name: "Riz",
      category: "epicerie",
      quantity: 1,
      unit: "kg",
      location: "placard",
      purchase_date: "2026-07-01",
      expiry_date: "2027-07-01",
      price: null,
      added_by: "local-user-9",
      status: "in_stock",
      updated_at: "2026-07-01T00:00:00.000Z",
    });

    const first = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });
    expect(first.success).toBe(true);

    // Manipule le foyer pour un item qui n'aurait jamais dû être remigré si
    // le 2e appel touchait encore la table (le household_id resterait NEW_ID
    // de toute façon puisqu'il ne matche plus OLD_ID, mais on vérifie aussi
    // que le résultat renvoyé est bien celui mémorisé, sans repasser en
    // "in_progress").
    const second = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });
    expect(second).toEqual(first);

    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record?.status).toBe(MIGRATION_STATUS.COMPLETED);
  });

  it("reprend un marqueur in_progress abandonné (crash précédent) sans rester bloqué", async () => {
    await db.household_migrations.put({
      id: `${OLD_ID}->${NEW_ID}`,
      old_household_id: OLD_ID,
      new_household_id: NEW_ID,
      status: MIGRATION_STATUS.IN_PROGRESS,
      started_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:05.000Z",
      completed_at: null,
      last_error: null,
      result: null,
    });
    await db.stock_items.put({
      id: "stock-3",
      household_id: OLD_ID,
      product_id: null,
      barcode: null,
      name: "Yaourt",
      category: "produit_laitier",
      quantity: 2,
      unit: "pièce",
      location: "frigo",
      purchase_date: "2026-07-01",
      expiry_date: "2026-07-15",
      price: null,
      added_by: "local-user-9",
      status: "in_stock",
      updated_at: "2026-07-01T00:00:00.000Z",
    });

    const outcome = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });

    expect(outcome.success).toBe(true);
    const stockItem = await db.stock_items.get("stock-3");
    expect(stockItem?.household_id).toBe(NEW_ID);
    expect(stockItem?.added_by).toBe(AUTH_USER);

    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record?.status).toBe(MIGRATION_STATUS.COMPLETED);
    expect(record?.started_at).toBe("2026-07-20T00:00:00.000Z");
  });

  it("ne transfère aucune donnée quand le foyer local appartient à un autre compte déjà confirmé (changement de compte sur le même navigateur)", async () => {
    vi.mocked(getRemoteOwnerId).mockReturnValue("compte-A");

    await db.stock_items.put({
      id: "stock-4",
      household_id: OLD_ID,
      product_id: null,
      barcode: null,
      name: "Fromage",
      category: "produit_laitier",
      quantity: 1,
      unit: "pièce",
      location: "frigo",
      purchase_date: "2026-07-01",
      expiry_date: "2026-07-08",
      price: null,
      added_by: "compte-A",
      status: "in_stock",
      updated_at: "2026-07-01T00:00:00.000Z",
    });

    const outcome = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: "compte-B",
    });

    expect(outcome.success).toBe(true);
    if (!outcome.success) throw new Error("unreachable");
    expect(outcome.result.migratedCounts).toEqual({});
    expect(outcome.result.queueEntriesFixed).toBe(0);

    // Les données du compte A restent inchangées, sous l'ancien foyer.
    const stockItem = await db.stock_items.get("stock-4");
    expect(stockItem?.household_id).toBe(OLD_ID);
    expect(stockItem?.added_by).toBe("compte-A");

    // Aucun enregistrement de migration n'a été créé pour cette paire.
    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record).toBeUndefined();
  });

  it("attend la fin d'un flush déjà actif avant de migrer, puis relance la synchro après coup", async () => {
    const order: string[] = [];
    let releaseGetUser!: () => void;
    let getUserCallCount = 0;
    const fake = {
      auth: {
        // Le 1er appel (la passe déjà "en vol" avant la demande de
        // migration) reste bloqué puis se résout "pas connecté" — reproduit
        // le même motif que offlineSync.test.ts pour une passe démarrée
        // avant que l'authentification ne soit disponible. Elle ne touchera
        // donc rien à la file une fois débloquée.
        getUser: vi.fn().mockImplementation(async () => {
          getUserCallCount++;
          if (getUserCallCount === 1) {
            order.push("getUser:start");
            await new Promise<void>((resolve) => {
              releaseGetUser = resolve;
            });
            order.push("getUser:end");
            return { data: { user: null } };
          }
          return { data: { user: { id: AUTH_USER } } };
        }),
      },
      from(table: string) {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            order.push(`upsert:${table}:${payload.household_id}`);
            return { error: null };
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    };
    vi.mocked(createClient).mockReturnValue(fake as never);

    // Une entrée déjà en file sous l'ancien foyer, comme si une écriture
    // avait eu lieu juste avant la migration.
    await queueWrite("stock_items", "upsert", { id: "stock-5", household_id: OLD_ID, added_by: "local-user-9" });

    // Démarre une passe de flush qui reste bloquée en plein milieu de
    // getUser() — simule une passe déjà "en vol" au moment où la migration
    // est demandée.
    const flushPromise = flushSyncQueue();
    await waitFor(() => order.includes("getUser:start"));

    const migrationPromise = migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });

    // Laisse quelques ticks : la migration ne doit pas avoir touché la
    // table tant que la passe de flush est encore en vol.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stillQueued = await db.sync_queue.toArray();
    expect(stillQueued).toHaveLength(1); // toujours en file, rien n'a encore été envoyé
    expect(order).toEqual(["getUser:start"]);

    releaseGetUser();
    await flushPromise;

    const outcome = await migrationPromise;
    expect(outcome.success).toBe(true);

    // La synchro doit avoir repris toute seule après la migration : la
    // queue est vidée par une nouvelle passe de flush automatique, avec le
    // household_id déjà réécrit.
    await waitFor(async () => (await db.sync_queue.count()) === 0);
    expect(order).toContain(`upsert:stock_items:${NEW_ID}`);
    expect(order).not.toContain(`upsert:stock_items:${OLD_ID}`);

    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record?.status).toBe(MIGRATION_STATUS.COMPLETED);
  });

  it("une entrée ne devient pas dead_letter à cause d'une concurrence migration/flush", async () => {
    const fake = makeFakeSupabase(() => ({ error: null }));
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("stock_items", "upsert", { id: "stock-6", household_id: OLD_ID, added_by: "local-user-9" });

    // Lance migration et flush en même temps, dans les deux ordres possibles
    // (l'ordre réel dépend du scheduler, mais withSyncPaused garantit la
    // sérialisation dans tous les cas).
    const [outcome] = await Promise.all([
      migrateLocalDataToHousehold({
        oldHouseholdId: OLD_ID,
        newHouseholdId: NEW_ID,
        authenticatedUserId: AUTH_USER,
      }),
      flushSyncQueue(),
    ]);

    expect(outcome.success).toBe(true);
    await waitFor(async () => (await db.sync_queue.count()) === 0);
    const remaining = await db.sync_queue.toArray();
    expect(remaining.some((e) => e.status === SYNC_STATUS.DEAD_LETTER)).toBe(false);
  });

  it("rollback transactionnel : une erreur en cours de migration ne laisse aucune donnée partiellement modifiée", async () => {
    await db.stock_items.put({
      id: "stock-7",
      household_id: OLD_ID,
      product_id: null,
      barcode: null,
      name: "Beurre",
      category: "produit_laitier",
      quantity: 1,
      unit: "pièce",
      location: "frigo",
      purchase_date: "2026-07-01",
      expiry_date: "2026-07-20",
      price: null,
      added_by: "local-user-9",
      status: "in_stock",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    await queueWrite("stock_items", "upsert", { id: "stock-7", household_id: OLD_ID, added_by: "local-user-9" });

    // Force une exception au milieu de la transaction (après que stock_items
    // a déjà été modifié, avant que le marqueur "completed" ne soit écrit)
    // pour vérifier que le rollback Dexie annule bien tout, y compris le
    // déplacement déjà appliqué à stock_items.
    const updateSpy = vi.spyOn(db.sync_queue, "update").mockImplementationOnce(() => {
      throw new Error("panne simulée pendant la réécriture de la file");
    });

    const outcome = await migrateLocalDataToHousehold({
      oldHouseholdId: OLD_ID,
      newHouseholdId: NEW_ID,
      authenticatedUserId: AUTH_USER,
    });

    expect(outcome.success).toBe(false);
    updateSpy.mockRestore();

    // Rollback : le stock item n'a pas été déplacé malgré le `.modify()`
    // exécuté avant l'échec, puisque toute la transaction est annulée.
    const stockItem = await db.stock_items.get("stock-7");
    expect(stockItem?.household_id).toBe(OLD_ID);

    const record = await db.household_migrations.get(`${OLD_ID}->${NEW_ID}`);
    expect(record?.status).toBe(MIGRATION_STATUS.FAILED);
    expect(record?.last_error).toBeTruthy();
  });
});
