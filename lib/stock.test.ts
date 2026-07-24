import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

// Importé après le mock pour récupérer la même référence mockée.
import { createClient } from "./supabase/client";
import { addStockItem } from "./stock";

beforeEach(async () => {
  await db.stock_items.clear();
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset();
});

describe("addStockItem", () => {
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
