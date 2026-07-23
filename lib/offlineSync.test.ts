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

// flushSyncQueue() est appelé "fire and forget" par les listeners (comme en
// prod), et les opérations Dexie contre fake-indexeddb peuvent prendre
// plusieurs tours de boucle d'événements réels pour se résoudre. On attend
// donc une condition précise plutôt qu'un nombre fixe de ticks, plus fiable
// qu'un enchaînement de `setTimeout(0)` devinés au hasard.
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition non atteinte dans le délai imparti");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Pour vérifier une absence (ex. "rien n'a encore été synchronisé") à un
// instant précis, on laisse quelques ticks s'écouler sans plus.
async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

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
    // Laisse le 1er flush (non authentifié, no-op) se terminer avant de
    // déclencher SIGNED_IN, sinon la 2e tentative de flush est ignorée car
    // une précédente est encore "en vol".
    await waitFor(() => fake.auth.getUser.mock.calls.length >= 1);
    await tick();
    expect(calls).toEqual([]);

    fake.__setAuthed(true);
    fake.__triggerAuthChange("SIGNED_IN");

    await waitFor(() => calls.length > 0);
    expect(calls).toEqual(["feedback:avis-1"]);
    await waitFor(async () => (await db.sync_queue.count()) === 0);
  });

  it("un SIGNED_IN reçu pendant qu'une passe non authentifiée est encore en vol n'est pas perdu", async () => {
    // Reproduit précisément la race condition : la 1re passe (non
    // authentifiée, déclenchée par registerSyncListeners) est délibérément
    // bloquée en plein milieu de son appel getUser(). SIGNED_IN arrive
    // pendant ce blocage. On vérifie que la demande n'est pas perdue et
    // qu'une 2e passe, authentifiée cette fois, synchronise bien l'entrée.
    const calls: string[] = [];
    // Ref objects plutôt que de simples `let` : évite un piège d'inférence
    // TypeScript où une variable réassignée uniquement à l'intérieur d'une
    // closure imbriquée se retrouve narrowée à `never` aux points d'usage
    // plus bas (tsc est plus strict que le transform utilisé par vitest).
    const releaseFirstGetUserRef: { current: (() => void) | null } = { current: null };
    const authChangeCallbackRef: { current: ((event: string) => void) | null } = { current: null };
    let getUserCallCount = 0;
    let authed = false;

    const fake = {
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          getUserCallCount++;
          if (getUserCallCount === 1) {
            // Le 1er appel (celui de la passe non authentifiée) reste en
            // attente tant que le test ne le débloque pas explicitement —
            // et répond "pas connecté" quel que soit l'état de `authed` au
            // moment où on le débloque, pour bien simuler une passe qui a
            // *commencé* avant que la connexion ne soit établie.
            await new Promise<void>((resolve) => {
              releaseFirstGetUserRef.current = resolve;
            });
            return { data: { user: null } };
          }
          return { data: { user: authed ? { id: "user-1" } : null } };
        }),
        onAuthStateChange: vi.fn().mockImplementation((cb: (event: string) => void) => {
          authChangeCallbackRef.current = cb;
        }),
      },
      from(table: string) {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            calls.push(`${table}:${payload.id}`);
            return { error: null };
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    };
    vi.mocked(createClient).mockReturnValue(fake as never);

    await queueWrite("feedback", "upsert", { id: "avis-race" });

    // 1. Démarre la 1re passe (non authentifiée) — reste bloquée sur getUser().
    registerSyncListeners();
    await waitFor(() => getUserCallCount >= 1);

    // 2. SIGNED_IN arrive alors que cette 1re passe est toujours en vol.
    authed = true;
    authChangeCallbackRef.current?.("SIGNED_IN");
    await tick();

    // 3. La demande n'a pas pu s'exécuter tout de suite (flushing=true) :
    // rien n'est encore synchronisé, et un 2e appel getUser() n'a pas eu
    // lieu puisque flushSyncQueue() a juste mémorisé la demande et retourné.
    expect(calls).toEqual([]);
    expect(getUserCallCount).toBe(1);

    // Débloque enfin la 1re passe (qui se termine en "pas connecté").
    releaseFirstGetUserRef.current?.();

    // 4. Une 2e passe démarre bien juste après la 1re (nouvel appel
    // getUser(), cette fois authentifié).
    await waitFor(() => getUserCallCount >= 2);
    // 5. L'entrée en attente a été synchronisée.
    await waitFor(() => calls.length > 0);
    expect(calls).toEqual(["feedback:avis-race"]);
    await waitFor(async () => (await db.sync_queue.count()) === 0);
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
