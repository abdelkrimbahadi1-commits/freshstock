import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, SYNC_STATUS } from "./db";
import type { ShoppingListItem, StockItem } from "./types";

vi.mock("./supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./session", () => ({
  getEffectiveUserId: vi.fn().mockResolvedValue("user-1"),
  getHouseholdId: vi.fn().mockReturnValue("household-1"),
}));

import { createClient } from "./supabase/client";
import { addShoppingListItem, removeShoppingListItem, toggleShoppingListItem, updateShoppingListItemQuantity } from "./shoppingList";
import { addStockItem, setStockItemStatus, updateExpiryDate } from "./stock";

function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: "stock-1",
    household_id: "household-1",
    product_id: null,
    barcode: null,
    name: "Lait",
    category: "produit_laitier",
    quantity: 1,
    unit: "L",
    location: "frigo",
    purchase_date: "2026-08-01",
    expiry_date: "2026-08-10",
    price: null,
    added_by: "user-1",
    status: "in_stock",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function shoppingItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "shopping-1",
    household_id: "household-1",
    item_name: "Lait",
    quantity: 1,
    unit: "L",
    source: "manual",
    recipe_name: null,
    checked: false,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition non atteinte");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

beforeEach(async () => {
  await db.stock_items.clear();
  await db.shopping_list.clear();
  await db.sync_queue.clear();
  vi.mocked(createClient).mockReset().mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mutations stock atomiques", () => {
  it("création Stock : échec de queue -> aucune ligne métier committée", async () => {
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(
      addStockItem({
        name: "Lait",
        category: "produit_laitier",
        quantity: 1,
        unit: "L",
        location: "frigo",
      })
    ).rejects.toThrow("queue down");

    expect(await db.stock_items.count()).toBe(0);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("création Stock : échec métier -> aucune intention queue", async () => {
    vi.spyOn(db.stock_items, "put").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("stock down"))) as typeof db.stock_items.put
    );

    await expect(
      addStockItem({
        name: "Riz",
        category: "epicerie",
        quantity: 1,
        unit: "kg",
        location: "placard",
      })
    ).rejects.toThrow("stock down");

    expect(await db.stock_items.count()).toBe(0);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("modification Stock : échec de queue -> expiry_date rollback", async () => {
    await db.stock_items.put(stockItem());
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(updateExpiryDate("stock-1", "2026-08-20")).rejects.toThrow("queue down");

    expect((await db.stock_items.get("stock-1"))?.expiry_date).toBe("2026-08-10");
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("statut Stock : échec de queue -> statut rollback", async () => {
    await db.stock_items.put(stockItem());
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(setStockItemStatus("stock-1", "consumed")).rejects.toThrow("queue down");

    expect((await db.stock_items.get("stock-1"))?.status).toBe("in_stock");
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe("mutations shopping_list atomiques", () => {
  it("création shopping_list : échec de queue -> aucune ligne métier committée", async () => {
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(addShoppingListItem("Lait", 1, "L")).rejects.toThrow("queue down");

    expect(await db.shopping_list.count()).toBe(0);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("fusion shopping_list : échec de queue -> recipe_name rollback", async () => {
    await db.shopping_list.put(shoppingItem({ source: "auto", recipe_name: "Crêpes" }));
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(addShoppingListItem("Lait", 1, "L", "auto", "Gâteau")).rejects.toThrow("queue down");

    expect((await db.shopping_list.get("shopping-1"))?.recipe_name).toBe("Crêpes");
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("toggle shopping_list : échec de queue -> checked rollback", async () => {
    await db.shopping_list.put(shoppingItem());
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(toggleShoppingListItem("shopping-1", true)).rejects.toThrow("queue down");

    expect((await db.shopping_list.get("shopping-1"))?.checked).toBe(false);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("quantité shopping_list : échec de queue -> quantité rollback", async () => {
    await db.shopping_list.put(shoppingItem());
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(updateShoppingListItemQuantity("shopping-1", 3, "L")).rejects.toThrow("queue down");

    expect((await db.shopping_list.get("shopping-1"))?.quantity).toBe(1);
    expect(await db.sync_queue.count()).toBe(0);
  });

  it("suppression shopping_list : échec de queue -> suppression rollback", async () => {
    await db.shopping_list.put(shoppingItem());
    vi.spyOn(db.sync_queue, "add").mockImplementationOnce(
      (() => Dexie.Promise.reject(new Error("queue down"))) as typeof db.sync_queue.add
    );

    await expect(removeShoppingListItem("shopping-1")).rejects.toThrow("queue down");

    expect(await db.shopping_list.get("shopping-1")).toBeDefined();
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe("flush post-commit", () => {
  it("un échec de flush après commit conserve la ligne métier et l'entrée queue", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => ({
        upsert: async () => ({ error: { message: "network down" } }),
        delete: () => ({ eq: async () => ({ error: { message: "network down" } }) }),
      }),
    } as never);

    const item = await addStockItem({
      name: "Lait",
      category: "produit_laitier",
      quantity: 1,
      unit: "L",
      location: "frigo",
    });

    await waitFor(async () => {
      const [entry] = await db.sync_queue.toArray();
      return entry?.status === SYNC_STATUS.RETRY_PENDING;
    });

    expect(await db.stock_items.get(item.id)).toBeDefined();
    const [entry] = await db.sync_queue.toArray();
    expect(entry.payload.id).toBe(item.id);
    expect(entry.last_error).toBe("network down");
  });
});
