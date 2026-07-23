import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, SYNC_STATUS } from "./db";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

// Importés après le mock pour récupérer la même référence mockée.
import { createClient } from "./supabase/client";
import { flushSyncQueue, getSyncStatus, queueWrite, registerSyncListeners } from "./offlineSync";

type UpsertResult = { error: { code?: string; message: string } | null };
type Handler = (table: string, op: "upsert" | "delete", payload: Record<string, unknown>) => UpsertResult;

function makeFakeSupabase(handler: Handler, authed = true) {
  let authChangeCallback: ((event: string) => void) | null = null;
  const fake = {
    auth: {
      getUser: vi.fn().mockImplementation(async () => ({
        data: { user: authed ? { id: "user-1" } : null },
      })),
      onAuthStateChange: vi.fn().mockImplementation((cb: (event: string) => void) => {
        authChangeCallback = cb;
      }),
    },
    from(table: string) {
      return {
        upsert: async (payload: Record<string, unknown>) => handler(table, "upsert", payload),
        delete: () => ({
          eq: async (_col: string, id: string) => handler(table, "delete", { id }),
        }),
      };
    },
    // exposé pour déclencher manuellement l'event dans les tests
    __triggerAuthChange(event: string) {
      authChangeCallback?.(event);
    },
    __setAuthed(value: boolean) {
      authed = value;
    },
  };
  return fake;
}

beforeEach(async () => {
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset();
});

describe("flushSyncQueue", () => {
  it("ne bloque pas les entrées suivantes quand une entrée échoue définitivement", async () => {
    const calls: string[] = [];
    const fake = makeFakeSupabase((table, op, payload) => {
      calls.push(`${table}:${payload.id}`);
      if (payload.id === "bad-item") {
        return { error: { code: "23505", message: "duplicate key" } }; // permanent
      }
      return { error: null };
    });
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("stock_items", "upsert", { id: "bad-item", name: "Lait" });
    await queueWrite("stock_items", "upsert", { id: "good-item", name: "Riz" });

    await flushSyncQueue();

    expect(calls).toEqual(["stock_items:bad-item", "stock_items:good-item"]);

    const remaining = await db.sync_queue.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload.id).toBe("bad-item");
    expect(remaining[0].status).toBe(SYNC_STATUS.DEAD_LETTER);
    expect(remaining[0].attempts).toBe(1);
    expect(remaining[0].last_error).toContain("duplicate key");
  });

  it("respecte le nombre maximal de tentatives puis passe en dead_letter", async () => {
    const fake = makeFakeSupabase(() => ({ error: { message: "network error" } })); // pas de code -> temporaire
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("shopping_list", "upsert", { id: "flaky-item" });

    for (let i = 0; i < 6; i++) {
      await flushSyncQueue();
      // Débloque le backoff pour permettre au test de retenter tout de
      // suite, sans attendre le temps réel.
      const entry = (await db.sync_queue.toArray())[0];
      if (entry) {
        await db.sync_queue.update(entry.id!, { next_retry_at: new Date(0).toISOString() });
      }
    }

    const remaining = await db.sync_queue.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe(SYNC_STATUS.DEAD_LETTER);
    expect(remaining[0].attempts).toBe(6);
  });

  it("ne retente pas avant next_retry_at (backoff respecté)", async () => {
    let callCount = 0;
    const fake = makeFakeSupabase(() => {
      callCount++;
      return { error: { message: "network error" } };
    });
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("shopping_list", "upsert", { id: "slow-retry" });
    await flushSyncQueue(); // 1er essai : échoue, next_retry_at repoussé dans le futur
    expect(callCount).toBe(1);

    await flushSyncQueue(); // trop tôt : ne doit pas retenter
    expect(callCount).toBe(1);
  });

  it("repart automatiquement après un login réussi (event SIGNED_IN)", async () => {
    const calls: string[] = [];
    const fake = makeFakeSupabase(
      (table, _op, payload) => {
        calls.push(`${table}:${payload.id}`);
        return { error: null };
      },
      false // pas connecté au départ
    );
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("feedback", "upsert", { id: "avis-1", message: "top" });

    registerSyncListeners(); // enregistre le listener SIGNED_IN + tente un 1er flush (pas connecté -> no-op)
    // Laisse le 1er flush (non authentifié) se terminer et libérer le
    // verrou avant de déclencher SIGNED_IN, sinon la 2e tentative de flush
    // est ignorée car une précédente est encore "en vol".
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([]);

    fake.__setAuthed(true);
    fake.__triggerAuthChange("SIGNED_IN");
    // flushSyncQueue est fire-and-forget dans le listener : laisser la
    // microtask queue se vider.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual(["feedback:avis-1"]);
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe("getSyncStatus", () => {
  it("distingue en attente / en erreur / dead_letter et remonte la dernière erreur", async () => {
    const fake = makeFakeSupabase(() => ({ error: { message: "boom" } }));
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("stock_items", "upsert", { id: "still-pending" });
    await queueWrite("stock_items", "upsert", { id: "will-fail" });

    // "will-fail" échoue une première fois -> retry_pending
    const entries = await db.sync_queue.toArray();
    const willFail = entries.find((e) => e.payload.id === "will-fail")!;
    await db.sync_queue.update(willFail.id!, {
      status: SYNC_STATUS.RETRY_PENDING,
      attempts: 1,
      last_error: "boom",
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    });

    const status = await getSyncStatus();
    expect(status.pendingCount).toBe(1);
    expect(status.errorCount).toBe(1);
    expect(status.deadLetterCount).toBe(0);
    expect(status.lastError).toBe("boom");
  });
});
