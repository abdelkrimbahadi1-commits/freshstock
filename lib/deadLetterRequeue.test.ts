import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCARD_REASON,
  SYNC_STATUS,
  db,
  isMissingUpdatedAtFailure,
  requeueMissingUpdatedAtFailures,
  type SyncQueueEntry,
} from "./db";
import type { ShoppingListItem } from "./types";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { flushSyncQueue } from "./offlineSync";

// Les deux formulations réellement possibles pour l'absence de la colonne.
const PGRST204 =
  "Could not find the 'updated_at' column of 'shopping_list' in the schema cache";
const PG42703 = 'column "updated_at" of relation "shopping_list" does not exist';

const T0 = "2026-07-28T10:00:00.000Z";

function makeRow(over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "row-1",
    household_id: "household-1",
    item_name: "Lait",
    quantity: 1,
    unit: "unite",
    source: "manual",
    recipe_name: null,
    checked: false,
    updated_at: T0,
    ...over,
  };
}

function makeEntry(over: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    table: "shopping_list",
    op: "upsert",
    payload: { ...makeRow() } as unknown as Record<string, unknown>,
    created_at: T0,
    updated_at: T0,
    status: SYNC_STATUS.DEAD_LETTER,
    attempts: 6,
    last_error: PGRST204,
    next_retry_at: T0,
    ...over,
  };
}

function runMigration() {
  return db.transaction(
    "rw",
    [db.sync_queue, db.sync_queue_discarded, db.shopping_list],
    (tx) => requeueMissingUpdatedAtFailures(tx)
  );
}

beforeEach(async () => {
  await db.sync_queue.clear();
  await db.sync_queue_discarded.clear();
  await db.shopping_list.clear();
  vi.mocked(createClient).mockReset();
});

// ---------------------------------------------------------------------------
// Filtre : ce qui est retenu
// ---------------------------------------------------------------------------

describe("isMissingUpdatedAtFailure — cas retenus", () => {
  it("1. dead_letter shopping_list/upsert avec le message PostgREST PGRST204", () => {
    expect(isMissingUpdatedAtFailure(makeEntry({ last_error: PGRST204 }))).toBe(true);
  });

  it("2. dead_letter shopping_list/upsert avec le message PostgreSQL 42703", () => {
    expect(isMissingUpdatedAtFailure(makeEntry({ last_error: PG42703, attempts: 1 }))).toBe(true);
  });

  it("3. la détection est insensible à la casse du message", () => {
    expect(isMissingUpdatedAtFailure(makeEntry({ last_error: PGRST204.toUpperCase() }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Filtre : ce qui doit rester intact — aucune dead_letter rejouée aveuglément
// ---------------------------------------------------------------------------

describe("isMissingUpdatedAtFailure — cas explicitement NON retenus", () => {
  it("4. une violation RLS sur shopping_list n'est pas retenue", () => {
    const entry = makeEntry({
      last_error: 'new row violates row-level security policy for table "shopping_list"',
    });
    expect(isMissingUpdatedAtFailure(entry)).toBe(false);
  });

  it("5. une entrée d'une autre table n'est pas retenue, même avec un message similaire", () => {
    const entry = makeEntry({
      table: "stock_items",
      last_error: "Could not find the 'updated_at' column of 'stock_items' in the schema cache",
    });
    expect(isMissingUpdatedAtFailure(entry)).toBe(false);
  });

  it("6. une opération delete n'est pas retenue", () => {
    expect(isMissingUpdatedAtFailure(makeEntry({ op: "delete" }))).toBe(false);
  });

  it("7. un statut autre que dead_letter n'est pas retenu (retry_pending se répare seul)", () => {
    for (const status of [SYNC_STATUS.PENDING, SYNC_STATUS.PROCESSING, SYNC_STATUS.RETRY_PENDING]) {
      expect(isMissingUpdatedAtFailure(makeEntry({ status }))).toBe(false);
    }
  });

  it("8. un message absent, générique ou incomplet n'est pas retenu", () => {
    expect(isMissingUpdatedAtFailure(makeEntry({ last_error: null }))).toBe(false);
    expect(isMissingUpdatedAtFailure(makeEntry({ last_error: "Erreur inconnue" }))).toBe(false);
    // "updated_at" seul, sans "shopping_list" : insuffisant.
    expect(
      isMissingUpdatedAtFailure(makeEntry({ last_error: "column updated_at does not exist" }))
    ).toBe(false);
    // les deux jetons mais aucune des deux formulations d'échec : insuffisant.
    expect(
      isMissingUpdatedAtFailure(makeEntry({ last_error: "shopping_list updated_at conflict" }))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Action : ligne locale présente
// ---------------------------------------------------------------------------

describe("requeueMissingUpdatedAtFailures — ligne locale présente", () => {
  it("9. l'entrée repart en pending avec le payload rafraîchi depuis la ligne Dexie courante", async () => {
    await db.shopping_list.add(makeRow({ item_name: "Lait demi-écrémé", quantity: 3, checked: true }));
    const id = await db.sync_queue.add(makeEntry());

    const report = await runMigration();

    const entry = await db.sync_queue.get(id as number);
    expect(report).toMatchObject({ matched: 1, requeued: 1, discardedObsolete: 0 });
    expect(entry?.status).toBe(SYNC_STATUS.PENDING);
    expect(entry?.attempts).toBe(0);
    expect(entry?.last_error).toBeNull();
    // Payload = état local ACTUEL, pas l'instantané figé au moment de l'écriture.
    expect(entry?.payload.item_name).toBe("Lait demi-écrémé");
    expect(entry?.payload.quantity).toBe(3);
    expect(entry?.payload.checked).toBe(true);
  });

  it("10. si la ligne locale a perdu updated_at, on retombe sur l'horodatage d'origine", async () => {
    const row = makeRow();
    delete (row as Partial<ShoppingListItem>).updated_at;
    await db.shopping_list.add(row as ShoppingListItem);
    const id = await db.sync_queue.add(makeEntry());

    await runMigration();

    const entry = await db.sync_queue.get(id as number);
    expect(entry?.payload.updated_at).toBe(T0);
  });
});

// ---------------------------------------------------------------------------
// Action : ligne locale disparue -> archivage puis retrait
// ---------------------------------------------------------------------------

describe("requeueMissingUpdatedAtFailures — ligne locale disparue (archivage)", () => {
  it("11. l'entrée est archivée intégralement PUIS retirée de la file", async () => {
    const original = makeEntry();
    const id = (await db.sync_queue.add(original)) as number;

    const report = await runMigration();

    expect(report).toMatchObject({ matched: 1, requeued: 0, discardedObsolete: 1 });
    // Retirée de la file technique...
    expect(await db.sync_queue.get(id)).toBeUndefined();
    // ...mais intégralement conservée dans l'archive locale.
    const archived = await db.sync_queue_discarded.get(id);
    expect(archived).toBeDefined();
    expect(archived?.original_queue_id).toBe(id);
    expect(archived?.discarded_reason).toBe(
      DISCARD_REASON.MISSING_UPDATED_AT_AND_LOCAL_ROW_ABSENT
    );
    expect(archived?.discarded_at).toEqual(expect.any(String));
    expect(archived?.table).toBe(original.table);
    expect(archived?.op).toBe(original.op);
    expect(archived?.created_at).toBe(original.created_at);
    expect(archived?.last_error).toBe(original.last_error);
    expect(archived?.attempts).toBe(original.attempts);
    expect(archived?.payload).toEqual(original.payload);
  });

  it("12. archivage et retrait sont atomiques : un échec d'archivage laisse l'entrée en file", async () => {
    const id = (await db.sync_queue.add(makeEntry())) as number;

    // Provoque l'échec de l'archivage à l'intérieur de la transaction.
    const failure = new Error("archivage impossible (simulé)");
    await expect(
      db.transaction("rw", [db.sync_queue, db.sync_queue_discarded, db.shopping_list], async (tx) => {
        const archive = tx.table("sync_queue_discarded");
        const add = archive.add.bind(archive);
        archive.add = (() => Dexie.Promise.reject(failure)) as typeof archive.add;
        try {
          return await requeueMissingUpdatedAtFailures(tx);
        } finally {
          archive.add = add;
        }
      })
    ).rejects.toThrow();

    // Transaction annulée : rien n'a été retiré, rien n'a été archivé.
    expect(await db.sync_queue.get(id)).toBeDefined();
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("13. aucun double archivage, et l'archive d'origine est conservée au 2e passage", async () => {
    const id = (await db.sync_queue.add(makeEntry())) as number;
    await runMigration();
    const first = await db.sync_queue_discarded.get(id);

    // On remet la même entrée technique en file (cas d'une reprise partielle)
    // puis on rejoue : l'archive existante ne doit être ni dupliquée ni écrasée.
    await db.sync_queue.add({ ...makeEntry(), id } as SyncQueueEntry);
    const report = await runMigration();

    expect(report).toMatchObject({ discardedObsolete: 1, alreadyArchived: 1 });
    expect(await db.sync_queue_discarded.count()).toBe(1);
    expect(await db.sync_queue_discarded.get(id)).toEqual(first);
    expect(await db.sync_queue.get(id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Innocuité, idempotence, absence de réseau
// ---------------------------------------------------------------------------

describe("requeueMissingUpdatedAtFailures — innocuité", () => {
  it("14. idempotence : un second passage ne change plus rien", async () => {
    await db.shopping_list.add(makeRow());
    await db.sync_queue.add(makeEntry());
    await db.sync_queue.add(makeEntry({ payload: { ...makeRow({ id: "row-absente" }) } }));

    const first = await runMigration();
    const snapshotQueue = await db.sync_queue.toArray();
    const snapshotArchive = await db.sync_queue_discarded.toArray();

    const second = await runMigration();

    expect(first).toMatchObject({ requeued: 1, discardedObsolete: 1 });
    expect(second).toMatchObject({ matched: 0, requeued: 0, discardedObsolete: 0 });
    expect(await db.sync_queue.toArray()).toEqual(snapshotQueue);
    expect(await db.sync_queue_discarded.toArray()).toEqual(snapshotArchive);
  });

  it("15. aucune donnée métier n'est créée, modifiée ou supprimée", async () => {
    const rows = [makeRow({ id: "row-1" }), makeRow({ id: "row-2", item_name: "Pain" })];
    await db.shopping_list.bulkAdd(rows);
    await db.sync_queue.add(makeEntry({ payload: { ...rows[0] } }));
    await db.sync_queue.add(makeEntry({ payload: { ...makeRow({ id: "row-disparue" }) } }));

    await runMigration();

    expect(await db.shopping_list.orderBy("id").toArray()).toEqual(rows);
  });

  it("16. les entrées non retenues sont laissées strictement intactes", async () => {
    const untouched: SyncQueueEntry[] = [
      makeEntry({ last_error: "new row violates row-level security policy" }),
      makeEntry({ table: "stock_items" }),
      makeEntry({ op: "delete" }),
      makeEntry({ status: SYNC_STATUS.RETRY_PENDING }),
      makeEntry({ last_error: null }),
    ];
    for (const entry of untouched) await db.sync_queue.add(entry);

    const before = await db.sync_queue.toArray();
    const report = await runMigration();

    expect(report.matched).toBe(0);
    expect(await db.sync_queue.toArray()).toEqual(before);
    expect(await db.sync_queue_discarded.count()).toBe(0);
  });

  it("17. la migration n'effectue aucune écriture réseau", async () => {
    await db.shopping_list.add(makeRow());
    await db.sync_queue.add(makeEntry());
    await db.sync_queue.add(makeEntry({ payload: { ...makeRow({ id: "row-disparue" }) } }));

    await runMigration();

    expect(createClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Intégration : le rejeu aboutit, y compris si la ligne distante existe déjà
// ---------------------------------------------------------------------------

describe("intégration avec flushSyncQueue", () => {
  it("18. une entrée remise en pending est poussée avec succès et l'archive n'est jamais envoyée", async () => {
    await db.shopping_list.add(makeRow());
    await db.sync_queue.add(makeEntry());
    await db.sync_queue.add(makeEntry({ payload: { ...makeRow({ id: "row-disparue" }) } }));
    await runMigration();

    const targets: string[] = [];
    const upserted: Record<string, unknown>[] = [];
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from(table: string) {
        targets.push(table);
        return {
          // `upsert` = INSERT ... ON CONFLICT (id) DO UPDATE : réussit que la
          // ligne distante existe déjà ou non, sans jamais créer de doublon.
          upsert: async (payload: Record<string, unknown>) => {
            upserted.push(payload);
            return { error: null };
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await flushSyncQueue();

    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ id: "row-1", updated_at: expect.any(String) });
    // La file est vidée de l'entrée réussie...
    expect(await db.sync_queue.count()).toBe(0);
    // ...et l'archive locale n'a jamais été poussée vers Supabase.
    expect(targets).toEqual(["shopping_list"]);
    expect(targets).not.toContain("sync_queue_discarded");
    expect(await db.sync_queue_discarded.count()).toBe(1);
  });
});
