import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, SYNC_STATUS } from "./db";
import type { StockItem } from "./types";

const HOUSEHOLD_ID = "household-1";
const OTHER_HOUSEHOLD_ID = "household-2";
const AUTH_USER = "auth-user-1";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));
vi.mock("./session", () => ({
  getHouseholdId: vi.fn().mockReturnValue("household-1"),
}));

// Importés après les mocks pour récupérer les mêmes références mockées.
import { createClient } from "./supabase/client";
import { getHouseholdId } from "./session";
import { flushSyncQueue, queueWrite } from "./offlineSync";
import { pullHouseholdData } from "./householdPull";

interface FakeOptions {
  userId?: string | null;
  member?: boolean;
  tableData?: Record<string, unknown[]>;
  tableErrorOnPage?: Record<string, number>; // table -> page index (0-based) qui doit échouer
  onRange?: (table: string, from: number, to: number) => void;
}

function makeFakeSupabase(opts: FakeOptions = {}) {
  const { userId = AUTH_USER, member = true, tableData = {}, tableErrorOnPage = {}, onRange } = opts;
  const pageCounters: Record<string, number> = {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from(table: string) {
      if (table === "household_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: member ? { household_id: HOUSEHOLD_ID } : null }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_col: string, householdId: string) => ({
            order: () => ({
              range: async (from: number, to: number) => {
                onRange?.(table, from, to);
                const pageIndex = pageCounters[table] ?? 0;
                pageCounters[table] = pageIndex + 1;
                if (tableErrorOnPage[table] === pageIndex) {
                  return { data: null, error: { message: `erreur simulée sur ${table}` } };
                }
                const rows = (tableData[table] ?? []).filter(
                  (r) => (r as Record<string, unknown>).household_id === householdId
                );
                return { data: rows.slice(from, to + 1), error: null };
              },
            }),
          }),
        }),
      };
    },
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition non atteinte dans le délai imparti");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stockRow(id: string, householdId: string, overrides: Partial<StockItem> = {}): StockItem {
  return {
    id,
    household_id: householdId,
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
    added_by: AUTH_USER,
    status: "in_stock",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.stock_items.clear();
  await db.shopping_list.clear();
  await db.feedback.clear();
  await db.sync_queue.clear();
  await db.pull_meta.clear();
  vi.mocked(createClient).mockReset();
  vi.mocked(getHouseholdId).mockReset().mockReturnValue(HOUSEHOLD_ID);
});

describe("pullHouseholdData", () => {
  it("première récupération vers une base Dexie vide", async () => {
    const remoteStock = stockRow("s1", HOUSEHOLD_ID);
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableData: { stock_items: [remoteStock] } }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.errors).toEqual([]);
    expect(result.perTable.stock_items).toMatchObject({ fetched: 1, created: 1, updated: 0, deletedLocally: 0 });
    const stored = await db.stock_items.get("s1");
    expect(stored?.name).toBe("Lait");
  });

  it("met à jour une ligne locale déjà présente sans écriture en attente", async () => {
    await db.stock_items.put(stockRow("s1", HOUSEHOLD_ID, { quantity: 1 }));
    const remoteStock = stockRow("s1", HOUSEHOLD_ID, { quantity: 5 });
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableData: { stock_items: [remoteStock] } }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items).toMatchObject({ created: 0, updated: 1 });
    const stored = await db.stock_items.get("s1");
    expect(stored?.quantity).toBe(5);
  });

  it("protège une ligne locale avec une écriture active dans sync_queue (non écrasée)", async () => {
    const localItem = stockRow("s1", HOUSEHOLD_ID, { quantity: 2 });
    await db.stock_items.put(localItem);
    await queueWrite("stock_items", "upsert", localItem as unknown as Record<string, unknown>);

    const remoteStock = stockRow("s1", HOUSEHOLD_ID, { quantity: 99 });
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableData: { stock_items: [remoteStock] } }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items).toMatchObject({ created: 0, updated: 0, skippedConflict: 1 });
    const stored = await db.stock_items.get("s1");
    expect(stored?.quantity).toBe(2); // version locale conservée, pas écrasée par la version distante
  });

  it("ne supprime pas et ne réécrit pas une ligne protégée dead_letter, et la compte à part", async () => {
    const localItem = stockRow("s1", HOUSEHOLD_ID, { quantity: 2 });
    await db.stock_items.put(localItem);
    await db.sync_queue.add({
      table: "stock_items",
      op: "upsert",
      payload: localItem as unknown as Record<string, unknown>,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      status: SYNC_STATUS.DEAD_LETTER,
      attempts: 6,
      last_error: "contrainte violée",
      next_retry_at: "2026-07-01T00:00:00.000Z",
    });

    // La ligne distante n'existe même plus (supprimée ailleurs) : sans la
    // protection dead_letter, elle serait candidate à la suppression locale.
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase({ tableData: {} }) as never);

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items).toMatchObject({ deletedLocally: 0, protectedDeadLetter: 1 });
    const stored = await db.stock_items.get("s1");
    expect(stored).toBeDefined();
  });

  it("supprime localement une ligne absente du snapshot distant sans écriture en attente", async () => {
    await db.stock_items.put(stockRow("s1", HOUSEHOLD_ID));
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase({ tableData: {} }) as never);

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items).toMatchObject({ deletedLocally: 1 });
    expect(await db.stock_items.get("s1")).toBeUndefined();
  });

  it("n'importe et ne supprime aucune donnée d'un autre household_id", async () => {
    await db.stock_items.put(stockRow("other-1", OTHER_HOUSEHOLD_ID));
    const remoteStock = stockRow("s1", HOUSEHOLD_ID);
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableData: { stock_items: [remoteStock, stockRow("s2", OTHER_HOUSEHOLD_ID)] } }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items.created).toBe(1);
    // La ligne du foyer 1 est bien présente, celle du foyer 2 n'a pas été touchée ni importée.
    expect(await db.stock_items.get("s1")).toBeDefined();
    expect(await db.stock_items.get("s2")).toBeUndefined();
    const otherHouseholdItem = await db.stock_items.get("other-1");
    expect(otherHouseholdItem?.household_id).toBe(OTHER_HOUSEHOLD_ID); // toujours là, intact
  });

  it("enregistre une erreur Supabase sans perte de données locales, et n'applique aucune modification partielle pour la table en erreur", async () => {
    await db.stock_items.put(stockRow("s1", HOUSEHOLD_ID, { quantity: 3 }));
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableErrorOnPage: { stock_items: 0 } }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.errors).toEqual([{ table: "stock_items", message: "erreur simulée sur stock_items" }]);
    expect(result.perTable.stock_items).toMatchObject({ fetched: 0, created: 0, updated: 0, deletedLocally: 0 });
    // La ligne locale existante n'a pas bougé.
    const stored = await db.stock_items.get("s1");
    expect(stored?.quantity).toBe(3);

    const meta = await db.pull_meta.get(HOUSEHOLD_ID);
    expect(meta?.last_pull_error).toContain("stock_items");
    expect(meta?.pull_in_progress).toBe(false);
  });

  it("pagine explicitement sur plusieurs pages jusqu'à une page incomplète", async () => {
    const rows = Array.from({ length: 505 }, (_, i) =>
      stockRow(`s${String(i).padStart(4, "0")}`, HOUSEHOLD_ID)
    );
    const rangeCalls: Array<[string, number, number]> = [];
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({
        tableData: { stock_items: rows },
        onRange: (table, from, to) => rangeCalls.push([table, from, to]),
      }) as never
    );

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.perTable.stock_items.fetched).toBe(505);
    expect(result.perTable.stock_items.created).toBe(505);
    const stockCalls = rangeCalls.filter(([t]) => t === "stock_items");
    expect(stockCalls.length).toBe(2); // page pleine (500) puis page incomplète (5)
    expect(await db.stock_items.count()).toBe(505);
  }, 15000);

  it("regroupe deux appels simultanés (un seul passage réseau, même résultat)", async () => {
    let callCount = 0;
    const fake = makeFakeSupabase({
      tableData: { stock_items: [stockRow("s1", HOUSEHOLD_ID)] },
      onRange: () => {
        callCount++;
      },
    });
    vi.mocked(createClient).mockReturnValue(fake as never);

    const [first, second] = await Promise.all([
      pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER }),
      pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER }),
    ]);

    expect(first).toBe(second); // même référence : résultat partagé, pas un second appel réseau
    expect(callCount).toBe(3); // une seule passe (stock_items, shopping_list, feedback)
  });

  it("attend la fin d'un flush déjà actif avant de démarrer (coordination pull/push)", async () => {
    const order: string[] = [];
    let releaseGetUser!: () => void;
    let getUserCallCount = 0;
    const fake = {
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          getUserCallCount++;
          if (getUserCallCount === 1) {
            order.push("flush:getUser:start");
            await new Promise<void>((resolve) => {
              releaseGetUser = resolve;
            });
            order.push("flush:getUser:end");
            return { data: { user: null } }; // passe de flush non authentifiée, ne fera rien
          }
          order.push("pull:getUser");
          return { data: { user: { id: AUTH_USER } } };
        }),
      },
      from(table: string) {
        if (table === "household_members") {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { household_id: HOUSEHOLD_ID } }) }) }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async () => {
                  order.push(`pull:range:${table}`);
                  return { data: [], error: null };
                },
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    };
    vi.mocked(createClient).mockReturnValue(fake as never);

    const flushPromise = flushSyncQueue();
    await waitFor(() => order.includes("flush:getUser:start"));

    const pullPromise = pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["flush:getUser:start"]); // le pull n'a encore rien fait

    releaseGetUser();
    await flushPromise;
    await pullPromise;

    expect(order[0]).toBe("flush:getUser:start");
    expect(order[1]).toBe("flush:getUser:end");
    expect(order.indexOf("pull:getUser")).toBeGreaterThan(order.indexOf("flush:getUser:end"));
  });

  it("aucun doublon après plusieurs pulls successifs (idempotence)", async () => {
    const remoteStock = stockRow("s1", HOUSEHOLD_ID);
    vi.mocked(createClient).mockReturnValue(
      makeFakeSupabase({ tableData: { stock_items: [remoteStock] } }) as never
    );

    const first = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    expect(first.perTable.stock_items.created).toBe(1);

    // Débloque l'anti-rafale pour simuler un second déclenchement plus tard
    // (ex. retour "online"), sans rien changer côté distant entre-temps.
    const meta = await db.pull_meta.get(HOUSEHOLD_ID);
    await db.pull_meta.put({ ...meta!, last_pull_success_at: new Date(0).toISOString() });

    const second = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    expect(second.perTable.stock_items).toMatchObject({ created: 0, updated: 0, deletedLocally: 0 });
    expect(await db.stock_items.count()).toBe(1); // pas de doublon
  });

  it("l'anti-rafale ignore un second appel trop rapproché après un pull réussi", async () => {
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase({ tableData: {} }) as never);

    const first = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    expect(first.skipped).toBe(false);

    const second = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });
    expect(second.skipped).toBe(true);
  });

  it("échoue proprement si l'utilisateur n'est pas membre du foyer demandé", async () => {
    await db.stock_items.put(stockRow("s1", HOUSEHOLD_ID));
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase({ member: false }) as never);

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(await db.stock_items.get("s1")).toBeDefined(); // rien touché localement
  });

  it("échoue proprement si householdId ne correspond pas au foyer actif local", async () => {
    vi.mocked(getHouseholdId).mockReturnValue("un-autre-foyer-local");
    vi.mocked(createClient).mockReturnValue(makeFakeSupabase({ tableData: {} }) as never);

    const result = await pullHouseholdData({ householdId: HOUSEHOLD_ID, authenticatedUserId: AUTH_USER });

    expect(result.errors.length).toBeGreaterThan(0);
  });
});
