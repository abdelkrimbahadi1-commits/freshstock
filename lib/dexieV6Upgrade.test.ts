import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { DISCARD_REASON, SYNC_STATUS, db, type SyncQueueEntry } from "./db";

// Vérifie le CÂBLAGE réel de la migration : pas seulement la fonction, mais le
// fait qu'un appareil réellement en Dexie v5 déclenche bien l'upgrade v6 tout
// seul, à la première ouverture de la base, sans aucune action.
//
// Fichier séparé volontairement : la base v5 doit être créée AVANT que le
// singleton `db` (qui déclare la v6) ne soit ouvert. Vitest isole chaque
// fichier de test, ce qui garantit cet ordre.

const T0 = "2026-07-28T10:00:00.000Z";
const PGRST204 =
  "Could not find the 'updated_at' column of 'shopping_list' in the schema cache";

const V5_STORES = {
  stock_items: "id, household_id, status, expiry_date, category",
  shopping_list: "id, household_id, checked",
  products: "id, barcode",
  meal_history: "id, household_id, date",
  feedback: "id, household_id, created_at",
  sync_queue: "++id, table, created_at, status, next_retry_at",
  household_migrations: "id, old_household_id, new_household_id, status",
  pull_meta: "household_id",
};

function makeEntry(over: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    table: "shopping_list",
    op: "upsert",
    payload: { id: "row-1", household_id: "household-1", item_name: "Lait", updated_at: T0 },
    created_at: T0,
    updated_at: T0,
    status: SYNC_STATUS.DEAD_LETTER,
    attempts: 6,
    last_error: PGRST204,
    next_retry_at: T0,
    ...over,
  };
}

describe("upgrade automatique Dexie v5 -> v6", () => {
  it("1. une base v5 existante est migrée à la première ouverture, sans action", async () => {
    // --- Appareil réel, encore en v5 ---
    const legacy = new Dexie("freshstock");
    legacy.version(5).stores(V5_STORES);
    await legacy.open();
    expect(legacy.verno).toBe(5);

    await legacy.table("shopping_list").add({
      id: "row-1",
      household_id: "household-1",
      item_name: "Lait",
      quantity: 1,
      unit: "unite",
      source: "manual",
      recipe_name: null,
      checked: false,
      updated_at: T0,
    });
    const requeuedId = (await legacy.table("sync_queue").add(makeEntry())) as number;
    // Entrée dont la ligne locale n'existe plus -> doit être archivée.
    const discardedId = (await legacy
      .table("sync_queue")
      .add(makeEntry({ payload: { id: "row-disparue", household_id: "household-1" } }))) as number;
    // Entrée hors périmètre -> doit rester strictement intacte.
    const untouchedId = (await legacy
      .table("sync_queue")
      .add(makeEntry({ last_error: "new row violates row-level security policy" }))) as number;
    legacy.close();

    // --- Ouverture par le code applicatif, qui déclare la v6 ---
    await db.open();
    // Le sujet du test est l'EXÉCUTION de l'upgrade v6, pas le numéro de
    // version courant : celui-ci augmente à chaque nouvelle version déclarée
    // (v7 pour local_repairs, etc.), et une base v5 traverse alors toutes les
    // versions intermédiaires en une seule ouverture.
    expect(db.verno).toBeGreaterThanOrEqual(6);

    const requeued = await db.sync_queue.get(requeuedId);
    expect(requeued?.status).toBe(SYNC_STATUS.PENDING);
    expect(requeued?.attempts).toBe(0);
    expect(requeued?.last_error).toBeNull();

    expect(await db.sync_queue.get(discardedId)).toBeUndefined();
    const archived = await db.sync_queue_discarded.get(discardedId);
    expect(archived?.original_queue_id).toBe(discardedId);
    expect(archived?.discarded_reason).toBe(
      DISCARD_REASON.MISSING_UPDATED_AT_AND_LOCAL_ROW_ABSENT
    );

    const untouched = await db.sync_queue.get(untouchedId);
    expect(untouched?.status).toBe(SYNC_STATUS.DEAD_LETTER);
    expect(untouched?.attempts).toBe(6);

    // Aucune donnée métier perdue au passage.
    expect(await db.shopping_list.count()).toBe(1);
  });

  it("2. l'upgrade ne se rejoue pas : réouvrir la base ne change plus rien", async () => {
    const queueBefore = await db.sync_queue.toArray();
    const archiveBefore = await db.sync_queue_discarded.toArray();

    db.close();
    await db.open();

    expect(db.verno).toBeGreaterThanOrEqual(6);
    expect(await db.sync_queue.toArray()).toEqual(queueBefore);
    expect(await db.sync_queue_discarded.toArray()).toEqual(archiveBefore);
  });
});
