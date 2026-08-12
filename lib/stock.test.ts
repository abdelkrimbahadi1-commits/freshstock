import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

// Importé après le mock pour récupérer la même référence mockée.
import { createClient } from "./supabase/client";
import { addStockItem, computeExpiryDate, setStockItemStatus, updateExpiryDate } from "./stock";

beforeEach(async () => {
  await db.stock_items.clear();
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset();
});

describe("addStockItem", () => {
  it("pose created_at et updated_at a la creation locale et les envoie dans sync_queue", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const item = await addStockItem({
      name: "Pates",
      category: "epicerie",
      quantity: 1,
      unit: "kg",
      location: "placard",
    });

    expect(item.created_at).toBeDefined();
    expect(item.updated_at).toBeDefined();
    expect(item.created_at).toBe(item.updated_at);

    const stored = await db.stock_items.get(item.id);
    expect(stored?.created_at).toBe(item.created_at);
    expect(stored?.updated_at).toBe(item.updated_at);

    const [queued] = await db.sync_queue.toArray();
    expect(queued.payload).toMatchObject({
      id: item.id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    });
  });

  it("calcule expiry_date depuis purchase_date, pas depuis le jour du scan", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const item = await addStockItem({
      name: "Ticket ancien",
      category: "fruit_legume",
      quantity: 1,
      unit: "piece",
      location: "frigo",
      purchase_date: "2026-08-10",
    });

    expect(item.purchase_date).toBe("2026-08-10");
    expect(item.expiry_date).toBe("2026-08-17");
  });

  it("conserve le comportement actuel quand purchase_date est aujourd'hui", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const before = new Date().toISOString().slice(0, 10);

    const item = await addStockItem({
      name: "Lait du jour",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
    });

    const after = new Date().toISOString().slice(0, 10);
    expect([before, after]).toContain(item.purchase_date);
    expect(item.expiry_date).toBe(computeExpiryDate(item.purchase_date, 10));
  });

  it("calcule les dates metier sans derive de fuseau", () => {
    expect(computeExpiryDate("2026-08-10", 5)).toBe("2026-08-15");
    expect(computeExpiryDate("2026-01-31", 3)).toBe("2026-02-03");
    expect(computeExpiryDate("2026-12-30", 5)).toBe("2027-01-04");
    expect(computeExpiryDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(computeExpiryDate("2028-02-29", 1)).toBe("2028-03-01");
    expect(computeExpiryDate("2026-08-10", 0)).toBe("2026-08-10");
  });

  it("ne reecrit pas created_at lors d'une modification de expiry_date", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const item = await addStockItem({
      name: "Fromage",
      category: "produit_laitier",
      quantity: 1,
      unit: "piece",
      location: "frigo",
    });
    await db.sync_queue.clear();

    await updateExpiryDate(item.id, "2026-08-25");

    const stored = await db.stock_items.get(item.id);
    expect(stored?.created_at).toBe(item.created_at);
    expect(stored?.updated_at).toBeDefined();
    const [queued] = await db.sync_queue.toArray();
    expect(queued.payload).toMatchObject({
      id: item.id,
      created_at: item.created_at,
      expiry_date: "2026-08-25",
    });
    expect(queued.payload.updated_at).toBe(stored?.updated_at);
  });

  it("ne reecrit pas created_at lors d'un changement de statut", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const item = await addStockItem({
      name: "Yaourt",
      category: "produit_laitier",
      quantity: 4,
      unit: "piece",
      location: "frigo",
    });
    await db.sync_queue.clear();

    await setStockItemStatus(item.id, "consumed");

    const stored = await db.stock_items.get(item.id);
    expect(stored?.created_at).toBe(item.created_at);
    expect(stored?.updated_at).toBeDefined();
    expect(stored?.status).toBe("consumed");
    const [queued] = await db.sync_queue.toArray();
    expect(queued.payload.created_at).toBe(item.created_at);
  });

  it("utilise l'id Supabase authentifié comme added_by pour une nouvelle écriture après connexion", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-42" } } }) },
    } as never);

    const item = await addStockItem({
      name: "Lait",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
    });

    expect(item.added_by).toBe("auth-user-42");
    const stored = await db.stock_items.get(item.id);
    expect(stored?.added_by).toBe("auth-user-42");
  });

  it("retombe sur l'id local en mode local sans authentification", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const item = await addStockItem({
      name: "Riz",
      category: "epicerie",
      quantity: 1,
      unit: "kg",
      location: "placard",
    });

    expect(item.added_by).not.toBe("auth-user-42");
    expect(typeof item.added_by).toBe("string");
    expect(item.added_by!.length).toBeGreaterThan(0);
  });
});
